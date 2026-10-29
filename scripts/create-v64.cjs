#!/usr/bin/env node
// ============================================================================
// 建 v64 live both 实验（2026-10-29 四变量同批）
//   克隆 v63（T103 再买腰斩 -40 + T104 流动性止损 10s + 撤 momentum 臂版：
//   buy-v2 v51·first + early v10 + buy-v2-repeat v3·repeat + 24 卖腿快照 +
//   stallClose {stallMs:10000}）。本批四个 config 变量：
//   ① T105 主腿 buy-v2 v51 → v53——holderTrendSlope > 0 →
//      holderTrendSlopeExSniper > 0（跳过有交易后前 4 个 slot，第 5 个 slot
//      起 ≥4 点 holder 上涨趋势才过门；v60 对拍火点拦 MWEZI/大肚柴犬/0x297d
//      三张 P1 亏损票，WOFL dp8 不拦，赢单 0x5ca9 保住）。
//   ② T106 主腿放宽（同 v53）：删集中度两门 top2HolderCircPct < 55 AND
//      top1HolderCircPct < 35（两键退役纯观察）+ tradesNetBuyRatioShortWin
//      >= 40 → >= 20（T96 短窗净买臂放宽半档，LongWin >= 0 不动）。
//      用户指令「触发太少了，没有啥用」整体放宽语境。
//   ③ 撤 T84 early 早期叙事臂（buy-early-narrative v10 整腿删除，买 3 腿→2）：
//      用户指令「触发太少了，没有啥用」。实跑核查（v46 起 1.3 天，P2 归属）：
//      27 信号/24 成交 round，净 -0.0289 BNB、胜率 3/24=12.5%（0x4a4417ad
//      +0.0045 唯一像样赢单；0xac1a6fc5/0x3b942497/0x80b81993 -0.006 死仓
//      ×3）——触发少且亏，撤得有数据支撑；库条目 v10 留档可复挂。
//   ④ repeat v3/24 卖腿/stallClose/其余 config 与 v63 逐字一致（无第四变量，
//      列此为防呆锚定）。
//   ⚠️ 前置：①bump-t106-concentration-slim-shortwin20.cjs --commit 已跑
//   （库 v53 已存在，含 T105 v52 换轨+T106 两改）；②create-v63.cjs --commit
//   已跑且 v63 已停（源发现=experiment_name 'v63-'）。
//   ⚠️ 部署红线：182 须先 git pull 至含 ddc0f3c（FA 新键）再跑本脚本+start
//   ——旧 FA 代码遇 holderTrendSlopeExSniper 条件=loadStrategies 未知因子
//   三防线 throw 拒启（防线动作，非 bug）。
// 防呆：源必须 stopped + 买 3 腿形状（first·P1 旧趋势键+两门+ShortWin40/
//   early·P2·tokenAgeSec<600/repeat·v3 区间段 -40）+ stallClose 恰
//   {stallMs:10000} + 库 v53 锚定（version/buyPhase/maxEx=2/ExSniper 段恰
//   一次+无裸残留/top2·top1 两键零残留/ShortWin>=20/全门锚定）+ 除 condition
//   外库腿与源主腿逐字一致 + repeat 腿逐字不动 + early 腿恰被移除（3→2）
//   + refs 仅 buy-v2 51→53 且 early 条目移除（3→2）。
// 用法：node scripts/create-v64.cjs [--commit] [--src=<id>]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_SEG = 'holderTrendSlope > 0';
const NEW_SEG = 'holderTrendSlopeExSniper > 0';
const NEW_DD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -40)';
const NEW_SW = 'tradesNetBuyRatioShortWin >= 20';

// 全门锚定（库 v53 腿上仍须恰一次；趋势段/两门/ShortWin40=被换被删者剔除）
const KEEPS = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  'tradesNetBuyRatioLongWin >= 0',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];

async function findSrcId() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  if (argSrc) return argSrc.slice(6);
  const { dbManager } = require('../src/services/dbManager.js');
  const c = dbManager.getClient();
  const { data, error } = await c.from('experiments')
    .select('id,experiment_name,status').ilike('experiment_name', 'v63-%')
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error('查 v63 失败: ' + error.message);
  if (!data || !data.length) {
    throw new Error("未找到 v63 实验（先跑 create-v63.cjs --commit；或 --src=<id> 显式指定）");
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
  if (buys.length !== 3) throw new Error('源买腿数=' + buys.length + ' 期望 3（v63=撤 momentum 版）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');

  // ── 源三腿形状锚定（v63 快照）──
  if (buys[0].buyPhase !== 'first') throw new Error('主腿 buyPhase=' + JSON.stringify(buys[0].buyPhase) + " 期望 'first'");
  if (buys[0].priority !== 1) throw new Error('主腿 priority=' + buys[0].priority + ' 期望 1');
  if (buys[0].condition.split(OLD_SEG).length !== 2) throw new Error('源主腿旧趋势段 holderTrendSlope > 0 非恰一次');
  if (buys[0].condition.includes('ExSniper')) throw new Error('源主腿已含 ExSniper（源应是 v63=旧键）');
  if (buys[0].condition.split('top2HolderCircPct < 55').length !== 2) throw new Error('源主腿缺 top2<55 门（源应是 v63=T106 前）');
  if (buys[0].condition.split('tradesNetBuyRatioShortWin >= 40').length !== 2) throw new Error('源主腿 ShortWin 非 >=40（源应是 v63=T106 前）');
  if (buys[1].buyPhase != null) throw new Error('early 腿 buyPhase=' + JSON.stringify(buys[1].buyPhase) + ' 期望 null');
  if (buys[1].priority !== 2) throw new Error('早期腿 priority=' + buys[1].priority + ' 期望 2');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 tokenAgeSec < 600 特征段（源应是 v63 含 early）');
  if (buys[2].buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(buys[2].buyPhase) + " 期望 'repeat'");
  if (!buys[2].condition.includes(NEW_DD_SEG)) throw new Error('源再买腿缺 v3 区间段 (-70,-40)（源应是 v63）');

  // ── T104 stallClose 段锚定（本批不动）──
  if (JSON.stringify(cfg.stallClose) !== JSON.stringify({ stallMs: 10000 })) {
    throw new Error('源 stallClose 非 {stallMs:10000}: ' + JSON.stringify(cfg.stallClose));
  }

  // ── 卖腿锚定（T97+T80+T99 拱形在场，本批不动）──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60'))) throw new Error('T97 secSincePeak 卖腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');

  // ── 从库拉 buy-v2 v53 快照（copy-in 单一真相源；v53=T105 换键+T106 两改）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const v2Entry = list.find((e) => e.name === 'buy-v2');
  if (!v2Entry) throw new Error('库中无 buy-v2（先跑 bump-t106-concentration-slim-shortwin20.cjs --commit）');
  if (v2Entry.version !== 53) throw new Error('buy-v2 version=' + v2Entry.version + ' 期望 53');
  const v2Full = await svc.getById(v2Entry.id);
  const v2Legs = v2Full.legs.legs || v2Full.legs;
  if (v2Legs.length !== 1) throw new Error('buy-v2 腿数=' + v2Legs.length + ' 期望 1');
  const v2Leg = v2Legs[0];
  // 锚定（库 v53 形状锁定）
  if (v2Leg.buyPhase !== 'first') throw new Error('库 v53 buyPhase=' + JSON.stringify(v2Leg.buyPhase) + " 期望 'first'");
  if (v2Leg.maxExecutions !== 2) throw new Error('库 v53 maxExecutions=' + v2Leg.maxExecutions + ' 期望 2');
  if (v2Leg.condition.split(NEW_SEG).length !== 2) throw new Error('库 v53 缺 ExSniper 趋势段（非恰一次）');
  if (v2Leg.condition.replace(/holderTrendSlopeExSniper/g, '').includes('holderTrendSlope')) {
    throw new Error('库 v53 残留裸 holderTrendSlope 字样');
  }
  if (v2Leg.condition.split(NEW_SW).length !== 2) throw new Error('库 v53 缺 ShortWin >= 20 段（非恰一次）');
  for (const k of ['top2HolderCircPct', 'top1HolderCircPct']) {
    if (v2Leg.condition.includes(k)) throw new Error('库 v53 残留集中度键 ' + k + '（T106 应已删）');
  }
  for (const seg of KEEPS) {
    if (v2Leg.condition.split(seg).length !== 2) throw new Error('库 v53 防误伤锚定子串非恰一次: ' + seg);
  }
  // 库腿除 condition 外与源主腿逐字一致（本批只许换条件串）
  const srcMain = buys[0];
  const libStrip = { ...v2Leg }; delete libStrip.condition;
  const srcStrip = { ...srcMain }; delete srcStrip.condition;
  if (JSON.stringify(libStrip) !== JSON.stringify(srcStrip)) {
    throw new Error('库 v53 腿除 condition 外与源主腿不一致：lib=' + JSON.stringify(libStrip) + ' src=' + JSON.stringify(srcStrip));
  }

  // ── 改装①：换主腿 condition（T105 换键+T106 两改，库 v53 整串）──
  const srcRepCond = JSON.stringify(buys[2]); // repeat 腿原文（撤 early 前先存）
  buys[0].condition = v2Leg.condition;
  if (!buys[0].condition.includes(NEW_SEG)) throw new Error('改装后主腿缺 ExSniper 趋势段');

  // ── 改装②：撤 T84 early 臂（用户 2026-10-29 指令；库条目 v10 留档可复挂）──
  if (buys[1].priority !== 2 || !buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('源腿[1]非 early 形状（缺 tokenAgeSec<600 特征段，源应是 v63）');
  }
  buys.splice(1, 1);
  if (buys.length !== 2) throw new Error('撤腿后买腿数=' + buys.length + ' 期望 2');
  if (JSON.stringify(buys[1]) !== srcRepCond) throw new Error('撤 early 后 repeat 腿被误改（应逐字不动）');
  if (buys[1].buyPhase !== 'repeat') throw new Error('撤腿后[1]非 repeat（索引错位）');

  // ── libraryRefs：buy-v2 51→53 + early 条目移除（3→2）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const refsBefore = refs.length; // v63=3 条（buy-v2+early+repeat）
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref || v2ref.version !== 51) throw new Error('libraryRefs buy-v2 非 51（源应是 v63）');
  const earlyRefIdx = refs.findIndex(r => r.name === 'buy-early-narrative');
  if (earlyRefIdx === -1 || refs[earlyRefIdx].version !== 10) throw new Error('libraryRefs buy-early-narrative 非 10（源应是 v63 含 early）');
  const repRef = refs.find(r => r.name === 'buy-v2-repeat');
  if (!repRef || repRef.version !== 3) throw new Error('libraryRefs buy-v2-repeat 非 3（源应是 v63）');
  if (refs.some(r => r.name === 'buy-v2-momentum')) throw new Error('refs 仍含 momentum（源应是 v63 撤臂版）');
  refs.splice(earlyRefIdx, 1);
  if (refs.length !== refsBefore - 1) throw new Error('refs 移除 early 后条数异常: ' + refsBefore + '→' + refs.length);
  v2ref.version = 53;
  v2ref.snapshotAt = new Date().toISOString();

  cfg.name = 'v64-实盘-both-剔狙击趋势键-撤early-主腿放宽-1029';
  cfg.description = 'v63（T103 再买腰斩 -40 + T104 流动性止损 10s + 撤 momentum 臂）+ 四变量同批：'
    + '①T105 主腿 buy-v2 v51→v53——holderTrendSlope > 0 → holderTrendSlopeExSniper > 0'
    + '（跳过有交易后前 4 个 slot=有 tick 的前 4 个不同 block，无交易块不计入；第 5 个 slot 起'
    + ' ≥4 点 holder 上涨趋势才过门，<4 点键缺失 fail-closed）。动机=出生初期 8 点窗被狙击手段'
    + '污染。v60 对拍：火点拦 MWEZI 0x20d2fa63…/大肚柴犬 0x763ef316…/날다람쥐 0x297d33af…'
    + '（dp≤7 必拦），WOFL 0x681c4dc9… dp8 不拦，赢单 0x5ca91444… 保住；实效多为 wallet 段'
    + '追平后延迟 1-9s 放行非拦死。用户裁定 2026-10-29「好，换吧」。'
    + '②T106 主腿放宽（同 v53）：删集中度两门 top2HolderCircPct < 55 AND top1HolderCircPct < 35'
    + '（T91 瘦身/T93 换轴谱系最终退出，两键退役纯观察 FA 照算）+ tradesNetBuyRatioShortWin'
    + ' >= 40 → >= 20（T96 短窗净买臂放宽半档；LongWin >= 0「长期下跌趋势解除」不动）。'
    + '用户指令「触发太少了，没有啥用」整体放宽语境。'
    + '③撤 T84 early 早期叙事臂（buy-early-narrative v10 整腿删除，买 3 腿→2、refs 3→2）：'
    + '用户指令「触发太少了，没有啥用」。实跑核查（v46 起 1.3 天，P2 归属）：27 信号/24 成交'
    + ' round，净 -0.0289 BNB、胜率 3/24=12.5%（0x4a4417ad +0.0045 唯一像样赢单；'
    + ' -0.006 死仓 ×3）——触发少且亏；库条目 v10 留档可复挂。'
    + 'repeat v3/24 卖腿/stallClose/其余 config 与 v63 逐字一致。'
    + '源=' + (src.config?.name || srcId) + '。详档 docs/交易策略改进与Case台账.md T105/T106/T84';

  // 改装后终检
  if (JSON.stringify(cfg.stallClose) !== JSON.stringify({ stallMs: 10000 })) {
    throw new Error('stallClose 终检失败（本批不动它）: ' + JSON.stringify(cfg.stallClose));
  }

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('stallClose: ' + JSON.stringify(cfg.stallClose) + '（T104 逐字保留）');
  console.log('buy[0]: P' + buys[0].priority + ' buyPhase=' + buys[0].buyPhase + ' maxEx=' + buys[0].maxExecutions
    + ' 趋势段: ' + (buys[0].condition.includes(NEW_SEG) ? 'ExSniper ✓' : '(MISS)')
    + ' ShortWin: ' + (buys[0].condition.includes(NEW_SW) ? '20 ✓' : '(MISS)')
    + ' 集中度门: ' + (buys[0].condition.includes('top2HolderCircPct') ? '(残留!)' : '已删 ✓'));
  console.log('buy[1]: P' + buys[1].priority + ' buyPhase=' + buys[1].buyPhase + ' 区间段: ' + (buys[1].condition.includes(NEW_DD_SEG) ? '(-70,-40) ✓' : '(MISS)'));
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V64_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
