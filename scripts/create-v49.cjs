#!/usr/bin/env node
// ============================================================================
// 建 v49 live both 实验（2026-10-28 T89 门放宽+二次入场；先 commit/pull 本批）
//   克隆 v48 f9c2ec74（buy-v2 v44 + buy-early-narrative v3 快照）。唯一变量：
//   两条买腿三字段 ← 库 copy-in（v45/v4）——
//     ① condition：人气门 ExSybil 键→原键（主 1.25/10、早期 0.25/4，OR 不动）
//        + sybil 门 < 35 → < 60
//     ② gmgnCheckCondition：bundler 门 <= 65 → <= 100（10.7 豁免臂保留）
//     ③ maxExecutions 1 → 2（二次入场：卖后可再入场，卡牌 6 卡帽不变；
//        引擎零代码改动——成交计数闸/completedPairs 轮次/全清删卡机制已就绪）
//   21 卖腿/发起门/cards 6 卡制/perCardBNB/钱包/观察信号/其余 config
//   与 v48 逐字一致。libraryRefs buy-v2 44→45 + buy-early-narrative 3→4。
//   ⚠️ 前置：182 已跑 bump-t89-gate-loosen.cjs --commit（v45/v4 已写库）。
//   ⚠️ copy-in：停 v48 与建 v49 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且买腿含旧三门形状；库必须 v45/v4（新形状在场）；
//   库/实验 trigger 逐字一致；条件与 gmgn 除变更段外逐字一致；买 2/卖 21/
//   主腿 BNB 4.7 锚定/cards 3 锚定/三门锚定（主 35/55/75、早期 45/65/85——
//   bundle 三门本批不动）/maxExecutions 源 1 库 2 锚定。
// 用法：node scripts/create-v49.cjs [--commit]   （在 182 跑；先跑 bump-t89-gate-loosen.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'f9c2ec74-6a7f-46f2-a88a-403b353d47bc'; // v48 live both（T88 长窗 100 快照）

// T89 三段变更（人气门主/早期 + sybil 门 + bundler 门）
const SWAPS_COND_MAIN = [
  ['(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)', '(buyVolumeBnb >= 1.25 OR holders >= 10)'],
  ['sybilClusterHolderCircPct < 35', 'sybilClusterHolderCircPct < 60'],
];
const SWAPS_COND_EARLY = [
  ['(buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4)', '(buyVolumeBnb >= 0.25 OR holders >= 4)'],
  ['sybilClusterHolderCircPct < 35', 'sybilClusterHolderCircPct < 60'],
];
const SWAPS_GMGN = [['gmgnBundlerWalletRatio <= 65', 'gmgnBundlerWalletRatio <= 100']];

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
  // dry-run 允许源 running（只读验证全链锚定）；建行必须源已停（停 v48 与建 v49 同批）
  if (COMMIT && src.status !== 'stopped') {
    throw new Error('--commit 须先停 v48（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v48 快照：v44/v3 形状=旧三门 + maxExecutions=1）──
  const SWAPS_BY_LEG = [SWAPS_COND_MAIN, SWAPS_COND_EARLY];
  for (const [i, leg] of buys.entries()) {
    applySwaps(leg.condition, SWAPS_BY_LEG[i], '买腿[' + i + ']'); // 断言旧形状在场（不消费返回值）
    if (leg.maxExecutions !== 1) {
      throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 1（v44/v3 快照锚点）');
    }
    applySwaps(leg.gmgnCheckCondition, SWAPS_GMGN, '买腿[' + i + '] gmgn');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3（6 卡制）');
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v44 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (!buys[0].condition.includes('bundleClusterHoldCircPct < 35 AND top2BundleClusterHoldCircPct < 55 AND top3BundleClusterHoldCircPct < 75')) {
    throw new Error('主腿缺三门 35/55/75 段（bundle 三门本批不动）: ' + buys[0].condition);
  }
  if (!buys[1].condition.includes('bundleClusterHoldCircPct < 45 AND top2BundleClusterHoldCircPct < 65 AND top3BundleClusterHoldCircPct < 85')) {
    throw new Error('早期腿缺三门 45/65/85 段（应=v3 快照）: ' + buys[1].condition);
  }
  if (!buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('早期腿缺 600s 段: ' + buys[1].condition);
  }

  // ── v49 唯一变量：两条买腿 condition/gmgn/maxExecutions ← 库 v45/v4 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const libPair = [
    { name: 'buy-v2', wantVersion: 45, leg: buys[0], swaps: SWAPS_COND_MAIN },
    { name: 'buy-early-narrative', wantVersion: 4, leg: buys[1], swaps: SWAPS_COND_EARLY },
  ];
  for (const t of libPair) {
    const entry = list.find(e => e.name === t.name);
    if (!entry || entry.version !== t.wantVersion) {
      throw new Error('库 ' + t.name + ' version=' + (entry && entry.version) + ' 期望 ' + t.wantVersion + '（先跑 bump-t89-gate-loosen.cjs --commit）');
    }
    const full = await svc.getById(entry.id);
    const libLegs = full.legs.legs || full.legs;
    const libLeg = libLegs[0];
    if (libLeg.maxExecutions !== 2) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' maxExecutions=' + JSON.stringify(libLeg.maxExecutions) + ' 期望 2（T89 二次入场）');
    }
    // 库/实验谱系防漂移：trigger 整串比对（本批不动它）
    if (libLeg.narrativeTriggerCondition !== t.leg.narrativeTriggerCondition) {
      throw new Error('库/实验 ' + t.name + ' trigger 漂移\nLIB: ' + libLeg.narrativeTriggerCondition + '\nEXP: ' + t.leg.narrativeTriggerCondition);
    }
    // 库新条件=源旧条件仅 T89 变更段差异（其余逐字一致防线）
    if (libLeg.condition !== applySwaps(t.leg.condition, t.swaps, t.name)) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 与源条件除 T89 段外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + applySwaps(t.leg.condition, t.swaps, t.name));
    }
    if (libLeg.gmgnCheckCondition !== applySwaps(t.leg.gmgnCheckCondition, SWAPS_GMGN, t.name)) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' gmgn 除 bundler 段外漂移\nLIB: ' + libLeg.gmgnCheckCondition + '\nEXP: ' + applySwaps(t.leg.gmgnCheckCondition, SWAPS_GMGN, t.name));
    }
    if (t.leg.cards !== libLeg.cards) {
      throw new Error('库/实验 ' + t.name + ' cards 漂移: ' + libLeg.cards + ' vs ' + t.leg.cards);
    }
    t.leg.condition = libLeg.condition;
    t.leg.gmgnCheckCondition = libLeg.gmgnCheckCondition;
    t.leg.maxExecutions = 2;
  }

  // ── libraryRefs buy-v2 44→45 + buy-early-narrative 3→4（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 44) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 44');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 3) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 3');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 45; buyRef.snapshotAt = new Date().toISOString();
  earlyRef.version = 4; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v49-实盘-both-门放宽-二次入场-1028';
  cfg.description = 'v48 + T89 门放宽+二次入场：sybil 门 35→60、GMGN bundler 门 65→100'
    + '（10.7 豁免臂/issuer 分档门保留）、人气门 ExSybil 键→原键 buyVolumeBnb/holders'
    + '（用户裁定恢复原始不去 sybil 版本，OR 与阈值不动：主 1.25/10、早期 0.25/4）、'
    + 'maxExecutions 1→2（卖出后允许再入场一次，卡牌仍 6 卡帽；BATCOIN 0xd145…7777'
    + '被震荡下车案）。背景=叙事通过票无人问津/流动性差/条件偏严致买在高位。'
    + '21 卖腿/发起门/cards 6 卡制/perCardBNB 0.002/钱包/其余 config 与 v48 f9c2ec74'
    + ' 逐字一致。源=v48 f9c2ec74（v44/v3 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v45):', buys[0].condition);
  console.log('buy[1] (early v4):', buys[1].condition);
  console.log('buy[0] gmgn:', buys[0].gmgnCheckCondition);
  console.log('buy[0] maxExecutions:', buys[0].maxExecutions, '| buy[1] maxExecutions:', buys[1].maxExecutions);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V49_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
