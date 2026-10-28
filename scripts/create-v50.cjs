#!/usr/bin/env node
// ============================================================================
// 建 v50 live both 实验（2026-10-28 T90 人气门 OR→AND；先 commit/pull 本批）
//   克隆 v49 596bfb92（buy-v2 v45 + buy-early-narrative v4 快照）。唯一变量：
//   两条买腿 condition 人气门 ← 库 copy-in（v46/v5）——
//     主腿 (buyVolumeBnb >= 1.25 OR holders >= 10) → (… AND …)（阈值原值）
//     早期 (buyVolumeBnb >= 0.25 OR holders >= 4)  → (… AND … >= 5)（人臂 +1）
//   （T90 用户裁定「必须与的关系，防很少人刷量/多钱包极小量买入」；矩阵实证
//    主腿死票过门 57%→33%、早期 100%→83%，活票损失 ≤3pp。）
//   21 卖腿/gmgn 10.7 豁免臂/maxExecutions=2/发起门/cards 6 卡制/perCardBNB/
//   钱包/其余 config 与 v49 逐字一致。libraryRefs buy-v2 45→46 + early 4→5。
//   ⚠️ 前置：182 已跑 bump-t90-pop-and.cjs --commit（v46/v5 已写库）。
//   ⚠️ copy-in：停 v49 与建 v50 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且买腿含旧 OR 人气门 + T89 形状（sybil<60/bundler<=100/
//   maxExecutions=2）；库必须 v46/v5（AND 串在场）；库/实验 gmgn/trigger 逐字一致；
//   条件除人气门段外逐字一致；买 2/卖 21/主腿 BNB 4.7/cards 3/三门锚定。
// 用法：node scripts/create-v50.cjs [--commit]   （在 182 跑；先跑 bump-t90-pop-and.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = '596bfb92-b07a-452e-b437-988db6e2438d'; // v49 live both（T89 门放宽+二次入场快照）

const SWAPS_MAIN = [['(buyVolumeBnb >= 1.25 OR holders >= 10)', '(buyVolumeBnb >= 1.25 AND holders >= 10)']];
const SWAPS_EARLY = [['(buyVolumeBnb >= 0.25 OR holders >= 4)', '(buyVolumeBnb >= 0.25 AND holders >= 5)']];

function applySwaps(str, swaps, label) {
  let out = str;
  for (const [o, n] of swaps) {
    if (out.split(o).length !== 2) throw new Error(label + ' 缺旧段恰一次: ' + o);
    out = out.replace(o, n);
  }
  return out;
}

async function main() {
  const argSrc = process.argv.find(a => a.startsWith('--src='));
  const srcId = argSrc ? argSrc.slice(6) : SRC;
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(srcId);
  if (!src) throw new Error('源实验不存在: ' + srcId);
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v49（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v49 快照：T89 形状 + 旧 OR 人气门）──
  const SWAPS_BY_LEG = [SWAPS_MAIN, SWAPS_EARLY];
  for (const [i, leg] of buys.entries()) {
    applySwaps(leg.condition, SWAPS_BY_LEG[i], '买腿[' + i + ']'); // 断言旧 OR 人气门在场
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2（T89）');
    if (!leg.condition.includes('sybilClusterHolderCircPct < 60')) throw new Error('买腿[' + i + '] 缺 T89 sybil<60');
    if (!leg.gmgnCheckCondition.includes('gmgnBundlerWalletRatio <= 100')) throw new Error('买腿[' + i + '] 缺 T89 bundler<=100');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3（6 卡制）');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v45 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (!buys[0].condition.includes('bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75')) {
    throw new Error('主腿缺三门 35/55/75 段（bundle 三门不动）: ' + buys[0].condition);
  }
  if (!buys[1].condition.includes('bundleClusterHoldCircPct < 45 AND top2BundleClusterHoldCircPct < 65 AND top3BundleClusterHoldCircPct < 85')) {
    throw new Error('早期腿缺三门 45/65/85 段: ' + buys[1].condition);
  }
  if (!buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('早期腿缺 600s 段: ' + buys[1].condition);
  }

  // ── v50 唯一变量：两条买腿 condition ← 库 v46/v5 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const libPair = [
    { name: 'buy-v2', wantVersion: 46, leg: buys[0], swaps: SWAPS_MAIN },
    { name: 'buy-early-narrative', wantVersion: 5, leg: buys[1], swaps: SWAPS_EARLY },
  ];
  for (const t of libPair) {
    const entry = list.find(e => e.name === t.name);
    if (!entry || entry.version !== t.wantVersion) {
      throw new Error('库 ' + t.name + ' version=' + (entry && entry.version) + ' 期望 ' + t.wantVersion + '（先跑 bump-t90-pop-and.cjs --commit）');
    }
    const full = await svc.getById(entry.id);
    const libLegs = full.legs.legs || full.legs;
    const libLeg = libLegs[0];
    if (libLeg.maxExecutions !== 2) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' maxExecutions=' + JSON.stringify(libLeg.maxExecutions) + ' 期望 2');
    }
    if (libLeg.narrativeTriggerCondition !== t.leg.narrativeTriggerCondition) {
      throw new Error('库/实验 ' + t.name + ' trigger 漂移\nLIB: ' + libLeg.narrativeTriggerCondition + '\nEXP: ' + t.leg.narrativeTriggerCondition);
    }
    if (libLeg.gmgnCheckCondition !== t.leg.gmgnCheckCondition) {
      throw new Error('库/实验 ' + t.name + ' gmgn 漂移（本批不动它）\nLIB: ' + libLeg.gmgnCheckCondition + '\nEXP: ' + t.leg.gmgnCheckCondition);
    }
    // 库新条件=源旧条件仅人气门段差异（其余逐字一致防线）
    if (libLeg.condition !== applySwaps(t.leg.condition, t.swaps, t.name)) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 与源条件除人气门段外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + applySwaps(t.leg.condition, t.swaps, t.name));
    }
    if (t.leg.cards !== libLeg.cards) {
      throw new Error('库/实验 ' + t.name + ' cards 漂移: ' + libLeg.cards + ' vs ' + t.leg.cards);
    }
    t.leg.condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 45→46 + buy-early-narrative 4→5（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 45) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 45');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 4) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 4');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 46; buyRef.snapshotAt = new Date().toISOString();
  earlyRef.version = 5; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v50-实盘-both-人气门AND-1028';
  cfg.description = 'v49 + T90 人气门 OR→AND（用户裁定「必须与的关系，防很少人'
    + '刷量/多钱包极小量买入，两个都满足基础要求」）：主腿 (buyVolumeBnb >= 1.25 '
    + 'AND holders >= 10)（阈值原值）；早期臂 (buyVolumeBnb >= 0.25 AND holders >= 5)'
    + '（人臂 +1）。10d 叙事池矩阵（127 活跃）：主腿死票过门 57%→33%、活票 66%→63%；'
    + '早期死票 100%→83%、活票/中间组 100% 不动。21 卖腿/gmgn 10.7 豁免臂/'
    + 'maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与 v49 596bfb92 逐字一致。'
    + '源=v49 596bfb92（v45/v4 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v46):', buys[0].condition);
  console.log('buy[1] (early v5):', buys[1].condition);
  console.log('buy[0] maxExecutions:', buys[0].maxExecutions, '| buy[1] maxExecutions:', buys[1].maxExecutions);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V50_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
