#!/usr/bin/env node
// ============================================================================
// 建 v65 live both 实验（2026-10-29 单变量：+T107 市值拱形时间全清臂）
//   克隆 v64（T105 ExSniper 趋势键 + T106 主腿放宽 + 撤 early + T103 再买
//   -40 + T104 stallClose 10s + T96/T99/T97/T100 全承继版：buy-v2 v53·first
//   + buy-v2-repeat v3·repeat + 24 卖腿快照 + stallClose {stallMs:10000}）。
//   本批唯一 config 变量：
//   ① T107 卖腿 +1（24→25）：X=首次交易→最高市值耗时；峰值市值超 15K USD
//      （=20.1 BNB @T84 换算率 745）后距峰已流逝 ≥ X/2 秒且未再破新高 →
//      全部清仓。库条目 mcap-arc-fullclose v1（copy-in）；插位=T97
//      secSincePeak 腿前（p10 同档稳定排序首中即赢：拱形完成全清 ⊃
//      T97/T80 减 1 卡）。
//   ② 其余 config（两买腿/24 存量卖腿/stallClose/refs 3 条）与 v64 逐字
//      一致（防呆锚定；libraryRefs 仅追加 mcap-arc-fullclose v1 条目 3→4）。
//   ⚠️ 前置：bump-t107-mcap-arc-fullclose.cjs --commit 已跑（库 v1 已存在）。
//   ⚠️ 部署红线：182 须先 git pull 至含本次 FA 提交（mcapPeakBnb/
//   secSinceMcapPeak/mcapRiseHalfSec 三键）再跑本脚本+start——旧 FA 代码
//   遇新键条件 = loadStrategies 未知因子三防线 throw 拒启（防线动作非 bug）。
// 防呆：源必须 stopped + 两买腿形状（first ExSniper·P1/repeat·P1）+ 卖腿
//   24 条 + stallClose 恰 {stallMs:10000} + T97/T80/-25 臂在场 + 库 v1 锚定
//   （side=sell/条件串逐字/cards all/bypass false/无 maxExecutions）+ 插腿
//   后剥除新腿恢复原文逐字节一致 + refs 恰追加一条。
// 用法：node scripts/create-v65.cjs [--commit] [--src=<id>]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const LIB_NAME = 'mcap-arc-fullclose';
const T107_COND = 'mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec';
const T97_ANCHOR = 'secSincePeak > 60';

async function findSrcId() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  if (argSrc) return argSrc.slice(6);
  const { dbManager } = require('../src/services/dbManager.js');
  const c = dbManager.getClient();
  const { data, error } = await c.from('experiments')
    .select('id,experiment_name,status').ilike('experiment_name', 'v64-%')
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error('查 v64 失败: ' + error.message);
  if (!data || !data.length) {
    throw new Error("未找到 v64 实验（先跑 create-v64.cjs --commit；或 --src=<id> 显式指定）");
  }
  console.log('源发现:', data[0].experiment_name, data[0].id.slice(0, 8), 'status=' + data[0].status);
  return data[0].id;
}

async function main() {
  const srcId = await findSrcId();
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须源已停（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（v64=撤 early 版）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');

  // ── 源两买腿形状锚定（v64 快照，本批不动）──
  if (buys[0].buyPhase !== 'first' || buys[0].priority !== 1) {
    throw new Error('主腿形状漂移（期望 first·P1）: ' + JSON.stringify({ p: buys[0].priority, bp: buys[0].buyPhase }));
  }
  if (!buys[0].condition.includes('holderTrendSlopeExSniper > 0')) throw new Error('主腿缺 ExSniper 趋势段（源应是 v64）');
  if (buys[0].condition.includes('top2HolderCircPct < 55')) throw new Error('主腿残留集中度门（源应是 v64=T106 已删）');
  if (!buys[0].condition.includes('tradesNetBuyRatioShortWin >= 20')) throw new Error('主腿缺 ShortWin >= 20（源应是 v64）');
  if (buys[1].buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(buys[1].buyPhase) + " 期望 'repeat'");
  if (!buys[1].condition.includes('(drawdownFromHighest > -70 AND drawdownFromHighest < -40)')) {
    throw new Error('再买腿缺 v3 区间段 (-70,-40)（源应是 v64）');
  }

  // ── T104 stallClose 段锚定（本批不动）──
  if (JSON.stringify(cfg.stallClose) !== JSON.stringify({ stallMs: 10000 })) {
    throw new Error('源 stallClose 非 {stallMs:10000}: ' + JSON.stringify(cfg.stallClose));
  }

  // ── 存量卖腿锚定（T97+T80+T99 拱形在场）──
  const t97Idx = sells.findIndex(s => (s.condition || '').includes(T97_ANCHOR));
  if (t97Idx === -1) throw new Error('T97 secSincePeak 卖腿不在场（插位锚点）');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');
  if (sells.some(s => (s.condition || '').includes('mcapPeakBnb'))) throw new Error('源已含 T107 腿（源应是 v64=无此臂）');
  const sellsBefore = JSON.stringify(sells);

  // ── 从库拉 mcap-arc-fullclose v1 快照（copy-in 单一真相源）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('sell');
  const arcEntry = list.find((e) => e.name === LIB_NAME);
  if (!arcEntry) throw new Error(`库中无 ${LIB_NAME}（先跑 bump-t107-mcap-arc-fullclose.cjs --commit）`);
  if (arcEntry.version !== 1) throw new Error(`${LIB_NAME} version=${arcEntry.version} 期望 1`);
  const arcFull = await svc.getById(arcEntry.id);
  const arcLegs = arcFull.legs.legs || arcFull.legs;
  if (arcLegs.length !== 1) throw new Error(`${LIB_NAME} 腿数=` + arcLegs.length + ' 期望 1');
  const arcLeg = arcLegs[0];
  if (arcLeg.condition !== T107_COND) throw new Error('库 v1 条件串漂移: ' + arcLeg.condition);
  if (arcLeg.cards !== 'all') throw new Error('库 v1 cards=' + JSON.stringify(arcLeg.cards) + " 期望 'all'");
  if (arcLeg.priority !== 10) throw new Error('库 v1 priority=' + arcLeg.priority + ' 期望 10（T97/T80 同档）');
  if (arcLeg.bypassDebounce !== false) throw new Error('库 v1 bypassDebounce 应 false（3.5s+5tick 双门）');
  if (arcLeg.maxExecutions !== undefined) throw new Error('库 v1 不得设 maxExecutions（卖出失败重试语义）');

  // ── 改装：T107 腿插在 T97 secSincePeak 腿前（p10 同档稳定排序首中即赢）──
  sells.splice(t97Idx, 0, JSON.parse(JSON.stringify(arcLeg)));
  if (sells.length !== 25) throw new Error('插腿后卖腿数=' + sells.length + ' 期望 25');
  if (!sells[t97Idx].condition.includes('mcapPeakBnb')) throw new Error('插位错乱：idx ' + t97Idx + ' 非 T107 腿');
  if (!sells[t97Idx + 1].condition.includes(T97_ANCHOR)) throw new Error('插位错乱：T97 腿应紧随其后');
  // 剥除新腿恢复原文逐字节一致（其余 24 腿零误伤）
  const sellsProbe = JSON.parse(JSON.stringify(sells));
  sellsProbe.splice(t97Idx, 1);
  if (JSON.stringify(sellsProbe) !== sellsBefore) throw new Error('剥除新腿后与源卖腿不一致（误伤存量腿）');

  // ── libraryRefs：恰追加 mcap-arc-fullclose v1（3→4）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const refsBefore = refs.length; // v64=3 条（buy-v2 + rug-exit + repeat）
  if (refsBefore !== 3) throw new Error('源 refs 条数=' + refsBefore + ' 期望 3（v64）');
  if (refs.find(r => r.name === LIB_NAME)) throw new Error('refs 已含 ' + LIB_NAME + '（源应是 v64）');
  refs.push({ name: LIB_NAME, side: 'sell', libId: arcEntry.id, version: 1, legCount: 1, snapshotAt: new Date().toISOString() });
  if (refs.length !== refsBefore + 1) throw new Error('refs 追加后条数异常: ' + refsBefore + '→' + refs.length);

  cfg.name = 'v65-实盘-both-拱形时间全清臂-1029';
  cfg.description = 'v64（T105 ExSniper 趋势键 + T106 主腿放宽/撤 early + T103 再买腰斩 -40'
    + ' + T104 流动性止损 10s + T100 首买/再买分臂）+ 单变量：①T107 市值拱形时间全清臂'
    + '（卖 24→25，库 mcap-arc-fullclose v1 copy-in，插 T97 secSincePeak 腿前 p10）：'
    + 'X=首次交易→最高市值耗时；峰值市值超 15K USD（=20.1 BNB @T84 换算率 745）后'
    + '距峰已流逝 ≥ X/2 秒且未再破新高 → 全部清仓——涨多久跌多久没新高=拱形走完，'
    + '时间维度与 T99 回撤深度维度互补（浅回落阴跌票 -25/-35 够不着，本臂按「再等'
    + '半个涨程还没新高」截断）。FA 三键 token 级全生命口径（mcapPeakBnb 峰=任意'
    + '接受价轨与 drawdownFromHighest 同峰 / secSinceMcapPeak 距峰秒数 / mcapRiseHalfSec'
    + ' X/2 预计算）；再破高=计时归零+X 变大；无接受价/supply 缺失 null fail-closed；'
    + '首峰即首 tick X=0 过门即清（忠实口径）；maxExecutions 不设（卖出失败重试直到'
    + '清仓）；bypass=false 走 3.5s+5tick 双门。两买腿/24 存量卖腿/stallClose/其余'
    + ' config 与 v64 逐字一致（refs 3→4 仅追加本臂）。'
    + '源=' + (src.config?.name || srcId) + '。详档 docs/交易策略改进与Case台账.md T107';

  // 改装后终检
  if (JSON.stringify(cfg.stallClose) !== JSON.stringify({ stallMs: 10000 })) {
    throw new Error('stallClose 终检失败（本批不动它）: ' + JSON.stringify(cfg.stallClose));
  }
  if (sells.filter(s => (s.condition || '').includes('mcapPeakBnb')).length !== 1) {
    throw new Error('T107 腿非恰一条');
  }

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('stallClose: ' + JSON.stringify(cfg.stallClose) + '（T104 逐字保留）');
  console.log('T107 腿: idx=' + t97Idx + ' P' + sells[t97Idx].priority + ' cards=' + sells[t97Idx].cards
    + ' | 条件: ' + sells[t97Idx].condition);
  console.log('插位邻接: idx' + (t97Idx - 1) + ' p' + sells[t97Idx - 1].priority
    + ' ← [T107] → idx' + (t97Idx + 1) + ' p' + sells[t97Idx + 1].priority + '（T97 腿）');
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V65_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
