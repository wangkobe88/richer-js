#!/usr/bin/env node
// ============================================================================
// 建 v60 live both 实验（2026-10-29 T101 再买臂腰斩门换车）
//   克隆 v59 260e9339（T100 分臂版：buy-v2 v51·first + early v10 +
//   buy-v2-repeat v1·repeat + 24 卖腿快照）。
//   本批唯一 config 变量：再买腿 v1→v2 快照——drawdownFromHighest 加下界
//   (-70, -50) 区间「从最高点跌超 50% 才可再买」（用户裁定再买=深回调抄底
//   形状非趋势中继）；主腿/early 腿/24 卖腿/其余 config 与 v59 逐字一致。
//   ⚠️ 前置：bump-t101-repeat-drawdown-50.cjs --commit 已跑（库 v2 已存在）。
// 防呆：源必须 stopped + 买 3 腿形状（first/null/repeat）+ 源再买腿为 v1 形状
//   （裸 -70 段、无 < -50）+ 库 v2 五重锚定（gmgn 删臂版/buyPhase/maxEx/
//   priority/cards）+ 区间段恰一次 + 换后主腿与源逐字一致 + refs
//   buy-v2:51 不动 + buy-v2-repeat 1→2。
// 用法：node scripts/create-v60.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '260e9339-2a6d-4739-a6e1-90c94a6fe001'; // v59 live both（T100 分臂版）

const GMGN_REPEAT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';
const OLD_DD_SEG = 'drawdownFromHighest > -70';
const NEW_DD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -50)';

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v59（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 3) throw new Error('源买腿数=' + buys.length + ' 期望 3（T100 分臂版）');
  if (sells.length !== 24) throw new Error('源卖腿数=' + sells.length + ' 期望 24');

  // ── 源买腿形状锚定（v59=T100 分臂版快照，主腿/early 本批不动）──
  if (buys[0].buyPhase !== 'first') throw new Error('主腿 buyPhase=' + JSON.stringify(buys[0].buyPhase) + " 期望 'first'");
  if (buys[0].priority !== 1) throw new Error('主腿 priority=' + buys[0].priority + ' 期望 1');
  if (buys[0].condition.includes('holdersExDust') !== true) throw new Error('主腿缺 T98 holdersExDust 人气段');
  if (buys[0].condition.includes('(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)') !== true) {
    throw new Error('主腿缺 T96 AND 净买门');
  }
  if (buys[1].buyPhase != null) throw new Error('early 腿 buyPhase=' + JSON.stringify(buys[1].buyPhase) + ' 期望 null');
  if (buys[1].priority !== 2) throw new Error('早期腿 priority=' + buys[1].priority + ' 期望 2');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  // 源再买腿必须是 v1 形状（裸 -70 段无下界）——防对错车/重复改装
  if (buys[2].buyPhase !== 'repeat') throw new Error('源再买腿 buyPhase=' + JSON.stringify(buys[2].buyPhase) + " 期望 'repeat'");
  if (buys[2].maxExecutions !== 1) throw new Error('源再买腿 maxExecutions=' + JSON.stringify(buys[2].maxExecutions) + ' 期望 1');
  if (buys[2].condition.split(OLD_DD_SEG).length !== 2) throw new Error('源再买腿非 v1 裸 -70 段形状');
  if (buys[2].condition.includes('drawdownFromHighest < -50')) throw new Error('源再买腿已带 -50 下界（勿重复改装）');

  // ── 卖腿锚定（T97+T80+T99 拱形在场，本批不动）──
  if (!sells.some(s => (s.condition || '').includes('secSincePeak > 60'))) throw new Error('T97 secSincePeak 卖腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -15'))) throw new Error('T80 回撤锁盈腿不在场');
  if (!sells.some(s => (s.condition || '').includes('drawdownFromHighestSinceLastBuy <= -25'))) throw new Error('T99 拱形 -25 卖腿不在场');

  // ── 从库拉 buy-v2-repeat v2 快照（copy-in 单一真相源）──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const repEntry = list.find((e) => e.name === 'buy-v2-repeat');
  if (!repEntry) throw new Error('库中无 buy-v2-repeat');
  if (repEntry.version !== 2) throw new Error('buy-v2-repeat version=' + repEntry.version + ' 期望 2（先跑 bump-t101）');
  const repFull = await svc.getById(repEntry.id);
  const repLegs = repFull.legs.legs || repFull.legs;
  if (repLegs.length !== 1) throw new Error('buy-v2-repeat 腿数=' + repLegs.length + ' 期望 1');
  const repLeg = repLegs[0];
  // 五重锚定 + T101 区间段（库 v2 形状锁定）
  if (repLeg.gmgnCheckCondition !== GMGN_REPEAT) throw new Error('再买腿 gmgn 非删臂版全串');
  if (repLeg.gmgnCheckCondition.includes('gmgnIssuerTokenCount')) throw new Error('再买腿 gmgn 残留 issuer 门');
  if (repLeg.buyPhase !== 'repeat') throw new Error('再买腿 buyPhase=' + JSON.stringify(repLeg.buyPhase) + " 期望 'repeat'");
  if (repLeg.maxExecutions !== 1) throw new Error('再买腿 maxExecutions=' + JSON.stringify(repLeg.maxExecutions) + ' 期望 1');
  if (repLeg.priority !== 1) throw new Error('再买腿 priority=' + repLeg.priority + ' 期望 1（压过 early P2）');
  if (repLeg.cards !== 3) throw new Error('再买腿 cards=' + repLeg.cards + ' 期望 3');
  if (repLeg.condition.split(NEW_DD_SEG).length !== 2) throw new Error('库 v2 缺 T101 区间段');
  if (repLeg.condition.includes('drawdownFromHighest < -50') !== true) throw new Error('库 v2 无 -50 下界');
  if (repLeg.narrativeTriggerCondition !== buys[2].narrativeTriggerCondition) throw new Error('库 v2 trigger 与源再买腿不一致（本批只应改 condition）');

  // ── 改装：只换再买腿（主腿/early 逐字不动）──
  const srcMainCond = buys[0].condition, srcEarlyCond = buys[1].condition;
  buys[2] = JSON.parse(JSON.stringify(repLeg));
  if (buys[0].condition !== srcMainCond || buys[1].condition !== srcEarlyCond) throw new Error('主/early 腿被误改');
  if (buys.length !== 3) throw new Error('改装后买腿数=' + buys.length + ' 期望 3');

  // ── libraryRefs：buy-v2:51 不动 + buy-v2-repeat 1→2 ──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const v2ref = refs.find(r => r.name === 'buy-v2');
  if (!v2ref) throw new Error('libraryRefs 缺 buy-v2');
  if (v2ref.version !== 51) throw new Error('libraryRefs buy-v2 version=' + v2ref.version + ' 期望 51');
  const repRef = refs.find(r => r.name === 'buy-v2-repeat');
  if (!repRef) throw new Error('libraryRefs 缺 buy-v2-repeat');
  if (repRef.version !== 1) throw new Error('libraryRefs buy-v2-repeat version=' + repRef.version + ' 期望 1');
  repRef.version = 2;
  repRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v60-实盘-both-再买腰斩门-1029';
  cfg.description = 'v59 260e9339（T100 分臂版）+ T101 再买臂腰斩门：再买腿 buy-v2-repeat '
    + 'v1→v2——drawdownFromHighest 由裸 > -70 收紧成区间 (-70,-50)「从最高点跌超 50% '
    + '才可再买」（用户裁定再买=深回调抄底形状非趋势中继；与 v27 崩盘接刀门合并，'
    + '跌幅不足 50% 或崩穿 -70 均不可再买；任意接受价轨全时峰口径，无最高价=0 fail-closed）。'
    + '主腿 v51·first/early v10/24 卖腿（含 T99 拱形）/其余 config 与 v59 逐字一致。'
    + '源=v59 260e9339。详档 docs/交易策略改进与Case台账.md T101';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0]: P' + buys[0].priority + ' buyPhase=' + buys[0].buyPhase + '（first 不动）');
  console.log('buy[1]: P' + buys[1].priority + '（early 不动）');
  console.log('buy[2]: P' + buys[2].priority + ' buyPhase=' + buys[2].buyPhase + ' maxEx=' + buys[2].maxExecutions);
  console.log('buy[2] dd段:', NEW_DD_SEG in {} ? '' : '', buys[2].condition.includes(NEW_DD_SEG) ? NEW_DD_SEG : '(MISS)');
  console.log('libraryRefs:', JSON.stringify(refs.map(r => r.name + ':' + r.version)));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V60_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
