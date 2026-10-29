#!/usr/bin/env node
// ============================================================================
// 建 v53 live both 实验（2026-10-29 T95 低市值臂 top1/top2 放宽换车）
//   克隆 v52 bc77ac6c（buy-v2 v48 + buy-early-narrative v7 快照，T93 保护瘦身）。
//   本批唯一 config 变量：早期腿 condition ← 库 copy-in（v8）——
//     『top1HolderCircPct < 35』→『top1HolderCircPct < 45』
//     『top2HolderCircPct < 65』→『top2HolderCircPct < 75』（各 +10）
//   主腿 buy-v2 v48 逐字不动（对照臂）。21 卖腿/gmgn/maxExecutions=2/6 卡制/
//   perCardBNB/钱包/其余 config 与 v52 逐字一致。libraryRefs early 7→8。
//   ⚠️ 前置：182 已跑 bump-t95-early-arm-loosen.cjs --commit（v8 已写库）+
//   代码在 ec7193e（T94 观察键 top1S/top2S 随本换车开始落快照）。
//   ⚠️ copy-in：停 v52 与建 v53 同批（单一实验纪律）；停前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且两买腿含 T93 形状（无 router/sybil/块簇键）+ 早期腿旧阈值
//   35/65 在场；库必须 early v8/buy-v2 v48；库/实验 gmgn/trigger 逐字一致；
//   早期条件=源串两处换阈值后逐字一致；买 2/卖 21/主腿 marketCap > 4.7/cards 3。
// 用法：node scripts/create-v53.cjs [--commit]   （在 182 跑；先跑 bump-t95-early-arm-loosen.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'bc77ac6c-f455-492a-9895-34e32581d57d'; // v52 live both（T93 保护瘦身快照）

const SWAPS = [
  ['top1HolderCircPct < 35', 'top1HolderCircPct < 45'],
  ['top2HolderCircPct < 65', 'top2HolderCircPct < 75'],
];

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v52（单一实验纪律+停前持仓确认）；当前 status=' + src.status);
  }
  if (src.status === 'stopped') console.log('注: 源已 stopped');
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== 'both') throw new Error('源 platform != both: ' + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error('源带 virtual 段（应为 live）');
  if (!cfg.wallet?.executorId) throw new Error('源 wallet.executorId 缺失');
  const buys = cfg.strategiesConfig?.buyStrategies || [];
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  if (buys.length !== 2) throw new Error('源买腿数=' + buys.length + ' 期望 2（主腿+早期臂）');
  if (sells.length !== 21) throw new Error('源卖腿数=' + sells.length + ' 期望 21');

  // ── 源形状锚定（v52 快照：T93 形状 + 早期腿旧阈值 35/65 在场）──
  for (const [i, leg] of buys.entries()) {
    for (const bad of ['tradesRouterPct', 'sybilClusterHolderCircPct', 'top2BundleClusterHoldCircPct', 'bundleClusterHoldCircPct <', 'top3BundleClusterHoldCircPct']) {
      if (leg.condition.includes(bad)) throw new Error('买腿[' + i + '] 残留已删键: ' + bad);
    }
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) throw new Error('主腿非 v48 BNB 形状');
  if (!buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holders >= 10)')) throw new Error('主腿缺 T90 AND 人气门');
  if (!buys[0].condition.includes('top2HolderCircPct < 55')) throw new Error('主腿缺 T93 top2 持有人门 55');
  if (!buys[1].condition.includes('tokenAgeSec < 600')) throw new Error('早期腿缺 600s 段');
  if (!buys[1].condition.includes('(buyVolumeBnb >= 0.25 AND holders >= 5)')) throw new Error('早期腿缺 T90 AND 人气门');
  for (const [from] of SWAPS) {
    if (buys[1].condition.split(from).length !== 2) throw new Error('早期腿缺源阈值段恰一次: ' + from);
  }

  // ── v53 唯一变量：早期腿 condition ← 库 v8 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const earlyEntry = list.find(e => e.name === 'buy-early-narrative');
  if (!earlyEntry || earlyEntry.version !== 8) throw new Error('库 buy-early-narrative version=' + (earlyEntry && earlyEntry.version) + ' 期望 8（先跑 bump-t95-early-arm-loosen.cjs --commit）');
  const mainEntry = list.find(e => e.name === 'buy-v2');
  if (!mainEntry || mainEntry.version !== 48) throw new Error('库 buy-v2 version=' + (mainEntry && mainEntry.version) + ' 期望 48（本批不动主腿）');
  const full = await svc.getById(earlyEntry.id);
  const libLegs = full.legs.legs || full.legs;
  const libLeg = libLegs[0];
  if (libLeg.maxExecutions !== 2) throw new Error('库 early v8 maxExecutions=' + JSON.stringify(libLeg.maxExecutions) + ' 期望 2');
  if (libLeg.narrativeTriggerCondition !== buys[1].narrativeTriggerCondition) {
    throw new Error('库/实验 early trigger 漂移\nLIB: ' + libLeg.narrativeTriggerCondition + '\nEXP: ' + buys[1].narrativeTriggerCondition);
  }
  if (libLeg.gmgnCheckCondition !== buys[1].gmgnCheckCondition) {
    throw new Error('库/实验 early gmgn 漂移（本批不动它）\nLIB: ' + libLeg.gmgnCheckCondition + '\nEXP: ' + buys[1].gmgnCheckCondition);
  }
  // 库新条件=源旧条件两处换阈值（其余逐字一致防线）
  let expected = buys[1].condition;
  for (const [from, to] of SWAPS) {
    if (expected.split(from).length !== 2) throw new Error('源条件缺段恰一次: ' + from);
    expected = expected.replace(from, to);
  }
  if (libLeg.condition !== expected) {
    throw new Error('库 early v8 与源条件除两处阈值外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + expected);
  }
  if (buys[1].cards !== libLeg.cards) throw new Error('库/实验 early cards 漂移: ' + buys[1].cards + ' vs ' + libLeg.cards);
  buys[1].condition = libLeg.condition;

  // ── libraryRefs early 7→8（buy-v2 48 不动；纯 provenance）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 7) throw new Error('libraryRefs early version=' + (earlyRef && earlyRef.version) + ' 期望 7');
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 48) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 48');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  earlyRef.version = 8; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v53-实盘-both-早期臂集中度放宽-1029';
  cfg.description = 'v52 + T95 低市值臂 top1/top2 放宽（用户裁定「低市值臂的当前'
    + 'top1/top2 因子再放宽一些」）：早期臂 top1HolderCircPct 35→45 /'
    + 'top2HolderCircPct 65→75（各 +10）。依据=3 天 492 有窗票网格（top1 主'
    + 'binder：早期流通分母小占比虚高，Binancians 0x04c1 案窗内 top1 49.9-62.5'
    + '从未达 35；t1<45∧t2<75 新增 18 票 up 中位 41.6%）。主腿 buy-v2 v48 逐字'
    + '不动=对照臂。同车带上 T94 观察键 top1HolderSupplyPct/top2HolderSupplyPct'
    + '（ec7193e，随本换车开始落快照）。21 卖腿/gmgn/maxExecutions=2/6 卡制/'
    + 'perCardBNB/钱包/其余 config 与 v52 bc77ac6c 逐字一致。源=v52 bc77ac6c（v48/v7 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB, '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v48 不动):', buys[0].condition);
  console.log('buy[1] (early v8):', buys[1].condition);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V53_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
