#!/usr/bin/env node
// ============================================================================
// 建 v52 live both 实验（2026-10-29 T93 保护条件瘦身换车）
//   克隆 v51 d41b9c29（buy-v2 v47 + buy-early-narrative v6 快照，T91 集中度瘦身）。
//   本批唯一 config 变量：两条买腿 condition ← 库 copy-in（v48/v7）——
//     两腿同款三处：删『 AND (platform != 'flap' OR tradesRouterPct >= 30)』
//                   删『 AND sybilClusterHolderCircPct < 60』
//                   『top2BundleClusterHoldCircPct < 55/65』→『top2HolderCircPct < 55/65』
//     （T93 用户裁定「保护条件还要再进一步瘦身」；top2 持有人门=前两大净持仓合计
//      ÷ 同 _circDen，与 top1 同口径，阈值承接——新 FA 键随 pull 生效。）
//   21 卖腿/gmgn 10.7 豁免臂/maxExecutions=2/发起门/cards 6 卡制/perCardBNB/
//   钱包/其余 config 与 v51 逐字一致。libraryRefs buy-v2 47→48 + early 6→7。
//   ⚠️ 前置：182 已跑 bump-t93-protect-slim.cjs --commit（v48/v7 已写库）。
//   ⚠️ copy-in：停 v51 与建 v52 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且买腿含 router/sybil/块簇 top2 门（恰一次）+ T89/T90 形状
//   （bundler<=100/maxExecutions=2/人气门 AND）；库必须 v48/v7（三处已删换）；库/
//   实验 gmgn/trigger 逐字一致；条件=源串删两段换一名后逐字一致；买 2/卖 21/主腿
//   BNB 4.7/cards 3。
// 用法：node scripts/create-v52.cjs [--commit]   （在 182 跑；先跑 bump-t93-protect-slim.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'd41b9c29-2a06-4178-908a-cd97b33e497f'; // v51 live both（T91 集中度瘦身快照）

const DROPS = [" AND (platform != 'flap' OR tradesRouterPct >= 30)", ' AND sybilClusterHolderCircPct < 60'];
const SWAP_MAIN = ['top2BundleClusterHoldCircPct < 55', 'top2HolderCircPct < 55'];
const SWAP_EARLY = ['top2BundleClusterHoldCircPct < 65', 'top2HolderCircPct < 65'];

function applyT93(str, segs, swap, label) {
  let out = str;
  for (const seg of segs) {
    if (out.split(seg).length !== 2) throw new Error(label + ' 缺旧段恰一次: ' + seg);
    out = out.replace(seg, '');
  }
  if (out.split(swap[0]).length !== 2) throw new Error(label + ' 缺换名源段恰一次: ' + swap[0]);
  out = out.replace(swap[0], swap[1]);
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
    throw new Error('--commit 须先停 v51（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v51 快照：T89/T90/T91 形状 + router/sybil/块簇 top2 门在场）──
  const SWAPS_BY_LEG = [SWAP_MAIN, SWAP_EARLY];
  for (const [i, leg] of buys.entries()) {
    applyT93(leg.condition, DROPS, SWAPS_BY_LEG[i], '买腿[' + i + ']'); // 断言三门在场恰一次
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2（T89）');
    if (!leg.gmgnCheckCondition.includes('gmgnBundlerWalletRatio <= 100')) throw new Error('买腿[' + i + '] 缺 T89 bundler<=100');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3（6 卡制）');
    if (!leg.condition.includes('(buyVolumeBnb >= ')) throw new Error('买腿[' + i + '] 缺人气门');
    if (leg.condition.includes('bundleClusterHoldCircPct <')) throw new Error('买腿[' + i + '] 残留 bundle 单块门（T91 已删）');
    if (leg.condition.includes('top3BundleClusterHoldCircPct')) throw new Error('买腿[' + i + '] 残留 top3 门（T91 已删）');
  }
  if (!buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holders >= 10)')) {
    throw new Error('主腿缺 T90 AND 人气门: ' + buys[0].condition.slice(0, 120));
  }
  if (!buys[1].condition.includes('(buyVolumeBnb >= 0.25 AND holders >= 5)')) {
    throw new Error('早期腿缺 T90 AND 人气门: ' + buys[1].condition.slice(0, 120));
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v47 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (!buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('早期腿缺 600s 段: ' + buys[1].condition);
  }

  // ── v52 唯一变量：两条买腿 condition ← 库 v48/v7 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const libPair = [
    { name: 'buy-v2', wantVersion: 48, leg: buys[0], swap: SWAP_MAIN },
    { name: 'buy-early-narrative', wantVersion: 7, leg: buys[1], swap: SWAP_EARLY },
  ];
  for (const t of libPair) {
    const entry = list.find(e => e.name === t.name);
    if (!entry || entry.version !== t.wantVersion) {
      throw new Error('库 ' + t.name + ' version=' + (entry && entry.version) + ' 期望 ' + t.wantVersion + '（先跑 bump-t93-protect-slim.cjs --commit）');
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
    // 库新条件=源旧条件删两段换一名（其余逐字一致防线）
    const expected = applyT93(t.leg.condition, DROPS, t.swap, t.name);
    if (libLeg.condition !== expected) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 与源条件除 T93 三处外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + expected);
    }
    if (t.leg.cards !== libLeg.cards) {
      throw new Error('库/实验 ' + t.name + ' cards 漂移: ' + t.leg.cards + ' vs ' + libLeg.cards);
    }
    t.leg.condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 47→48 + buy-early-narrative 6→7（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 47) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 47');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 6) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 6');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 48; buyRef.snapshotAt = new Date().toISOString();
  earlyRef.version = 7; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v52-实盘-both-保护瘦身-1029';
  cfg.description = 'v51 + T93 保护条件瘦身（用户裁定「保护条件还要再进一步瘦身」）：'
    + '两买腿删 flap 路由门 (platform != \'flap\' OR tradesRouterPct >= 30) 与 sybil 门'
    + ' sybilClusterHolderCircPct < 60，top2 块簇门换 top2 持有人门 top2HolderCircPct'
    + ' < 55/65（阈值承接）。驱动=BI 0xa7ef…7777 案（router 门独拦 12s+top2 最后'
    + '收口，+27s 买顶、反事实价差 +48.6%）与 Meecot 0x8671d681 案（sybil 100→59'
    + ' 稀释 150s 擦线过门接顶全亏——sybil 高位票本身是关联簇拉盘形状）。三键退为'
    + '纯观察键（FA 照算）。21 卖腿/gmgn/maxExecutions=2/6 卡制/perCardBNB/钱包/'
    + '其余 config 与 v51 d41b9c29 逐字一致。源=v51 d41b9c29（v47/v6 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v48):', buys[0].condition);
  console.log('buy[1] (early v7):', buys[1].condition);
  console.log('buy[0] maxExecutions:', buys[0].maxExecutions, '| buy[1] maxExecutions:', buys[1].maxExecutions);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V52_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
