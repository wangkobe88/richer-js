#!/usr/bin/env node
// ============================================================================
// 建 v51 live both 实验（2026-10-28 T91 集中度族瘦身 + FA 分母修复换车）
//   克隆 v50 ced5d5a9（buy-v2 v46 + buy-early-narrative v5 快照，T90 AND 人气门）。
//   本批唯一 config 变量：两条买腿 condition ← 库 copy-in（v47/v6）——
//     主腿  删『bundleClusterHoldCircPct < 35 AND 』『 AND top3BundleClusterHoldCircPct < 75』
//     早期  删『bundleClusterHoldCircPct < 45 AND 』『 AND top3BundleClusterHoldCircPct < 85』
//     （T91b 用户裁定「只保留 top1 top2 集中度条件」；同车 T91a=FA 分母修复
//      max(circ, Σ正净持仓) 恒 ≤100、正常票 bit 不变——代码侧随 pull 生效。）
//   21 卖腿/gmgn 10.7 豁免臂/maxExecutions=2/发起门/cards 6 卡制/perCardBNB/
//   钱包/其余 config 与 v50 逐字一致。libraryRefs buy-v2 46→47 + early 5→6。
//   ⚠️ 前置：182 已跑 bump-t91-concentration-slim.cjs --commit（v47/v6 已写库）。
//   ⚠️ copy-in：停 v50 与建 v51 同批（单一实验纪律）；重启前持仓确认（卡账本净额口径）。
// 防呆：源必须 stopped 且买腿含 bundle/top3 门（恰一次）+ T89/T90 形状（sybil<60/
//   bundler<=100/maxExecutions=2/人气门 AND）；库必须 v47/v6（两门已删）；库/实验
//   gmgn/trigger 逐字一致；条件=源串删两段后逐字一致；买 2/卖 21/主腿 BNB 4.7/cards 3。
// 用法：node scripts/create-v51.cjs [--commit]   （在 182 跑；先跑 bump-t91-concentration-slim.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const SRC = 'ced5d5a9-6d24-49b2-80bd-5fbb069a81ec'; // v50 live both（T90 AND 人气门快照）

const DROPS_MAIN = ['bundleClusterHoldCircPct < 35 AND ', ' AND top3BundleClusterHoldCircPct < 75'];
const DROPS_EARLY = ['bundleClusterHoldCircPct < 45 AND ', ' AND top3BundleClusterHoldCircPct < 85'];

function applyDrops(str, segs, label) {
  let out = str;
  for (const seg of segs) {
    if (out.split(seg).length !== 2) throw new Error(label + ' 缺旧段恰一次: ' + seg);
    out = out.replace(seg, '');
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
    throw new Error('--commit 须先停 v50（单一实验纪律+重启前持仓确认）；当前 status=' + src.status);
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

  // ── 源形状锚定（v50 快照：T89/T90 形状 + bundle/top3 门在场）──
  const DROPS_BY_LEG = [DROPS_MAIN, DROPS_EARLY];
  for (const [i, leg] of buys.entries()) {
    applyDrops(leg.condition, DROPS_BY_LEG[i], '买腿[' + i + ']'); // 断言两门在场恰一次
    if (leg.maxExecutions !== 2) throw new Error('买腿[' + i + '] maxExecutions=' + JSON.stringify(leg.maxExecutions) + ' 期望 2（T89）');
    if (!leg.condition.includes('sybilClusterHolderCircPct < 60')) throw new Error('买腿[' + i + '] 缺 T89 sybil<60');
    if (!leg.gmgnCheckCondition.includes('gmgnBundlerWalletRatio <= 100')) throw new Error('买腿[' + i + '] 缺 T89 bundler<=100');
    if (leg.cards !== 3) throw new Error('买腿[' + i + '] cards=' + leg.cards + ' 期望 3（6 卡制）');
    if (!leg.condition.includes('(buyVolumeBnb >= ')) throw new Error('买腿[' + i + '] 缺人气门');
  }
  if (!buys[0].condition.includes('(buyVolumeBnb >= 1.25 AND holders >= 10)')) {
    throw new Error('主腿缺 T90 AND 人气门: ' + buys[0].condition.slice(0, 120));
  }
  if (!buys[1].condition.includes('(buyVolumeBnb >= 0.25 AND holders >= 5)')) {
    throw new Error('早期腿缺 T90 AND 人气门: ' + buys[1].condition.slice(0, 120));
  }
  if (!buys[0].condition.includes('marketCap > 4.7')) {
    throw new Error('主腿非 v46 BNB 形状: ' + buys[0].condition.slice(0, 80));
  }
  if (!buys[0].condition.includes('top2BundleClusterHoldCircPct < 55')) {
    throw new Error('主腿缺 top2<55（保留门）: ' + buys[0].condition);
  }
  if (!buys[1].condition.includes('top2BundleClusterHoldCircPct < 65')) {
    throw new Error('早期腿缺 top2<65（保留门）: ' + buys[1].condition);
  }
  if (!buys[1].condition.includes('tokenAgeSec < 600')) {
    throw new Error('早期腿缺 600s 段: ' + buys[1].condition);
  }

  // ── v51 唯一变量：两条买腿 condition ← 库 v47/v6 copy-in ──
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const libPair = [
    { name: 'buy-v2', wantVersion: 47, leg: buys[0], drops: DROPS_MAIN },
    { name: 'buy-early-narrative', wantVersion: 6, leg: buys[1], drops: DROPS_EARLY },
  ];
  for (const t of libPair) {
    const entry = list.find(e => e.name === t.name);
    if (!entry || entry.version !== t.wantVersion) {
      throw new Error('库 ' + t.name + ' version=' + (entry && entry.version) + ' 期望 ' + t.wantVersion + '（先跑 bump-t91-concentration-slim.cjs --commit）');
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
    // 库新条件=源旧条件删两段（其余逐字一致防线）
    if (libLeg.condition !== applyDrops(t.leg.condition, t.drops, t.name)) {
      throw new Error('库 ' + t.name + ' v' + t.wantVersion + ' 与源条件除两门删除外存在漂移\nLIB: ' + libLeg.condition + '\nEXP: ' + applyDrops(t.leg.condition, t.drops, t.name));
    }
    if (t.leg.cards !== libLeg.cards) {
      throw new Error('库/实验 ' + t.name + ' cards 漂移: ' + t.leg.cards + ' vs ' + libLeg.cards);
    }
    t.leg.condition = libLeg.condition;
  }

  // ── libraryRefs buy-v2 46→47 + buy-early-narrative 5→6（纯 provenance；其余不动）──
  const refs = cfg.strategiesConfig?.libraryRefs || [];
  const buyRef = refs.find(r => r.name === 'buy-v2');
  if (!buyRef || buyRef.version !== 46) throw new Error('libraryRefs buy-v2 version=' + (buyRef && buyRef.version) + ' 期望 46');
  const earlyRef = refs.find(r => r.name === 'buy-early-narrative');
  if (!earlyRef || earlyRef.version !== 5) throw new Error('libraryRefs buy-early-narrative version=' + (earlyRef && earlyRef.version) + ' 期望 5');
  if (!refs.find(r => r.name === 'rug-exit-account-arm')) throw new Error('libraryRefs 缺 rug-exit-account-arm');
  buyRef.version = 47; buyRef.snapshotAt = new Date().toISOString();
  earlyRef.version = 6; earlyRef.snapshotAt = new Date().toISOString();

  cfg.name = 'v51-实盘-both-集中度瘦身-1028';
  cfg.description = 'v50 + T91 集中度族瘦身（用户裁定「只保留 top1 top2 集中度条件」）：'
    + '两买腿删 bundleClusterHoldCircPct 与 top3BundleClusterHoldCircPct 门，留'
    + 'top1HolderCircPct < 35 + top2BundleClusterHoldCircPct < 55/65。驱动=孙权'
    + '0x3b1b…7777 案：叙事 14:20:48 完成、便宜门 14:20:50 全过，bundle/top3 拖到'
    + '14:23:17（163s gap 主凶，且几乎全是 T91a 分母口径病虚高假拦截——修正分母'
    + '重放 top3 age=12s 即过）。同车 T91a：FA ÷circ 分母统一 max(circ, Σ正净持仓)'
    + '恒 ≤100（孙权 top3=114% 病态消除；正常票恒等式 bit 不变）。21 卖腿/gmgn/'
    + 'maxExecutions=2/6 卡制/perCardBNB/钱包/其余 config 与 v50 ced5d5a9 逐字一致。'
    + '源=v50 ced5d5a9（v46/v5 快照）';

  console.log('platform:', cfg.platform, '| perCardBNB:', cfg.positionManagement.perCardBNB,
    '| buys:', buys.length, '| sells:', sells.length);
  console.log('buy[0] (buy-v2 v47):', buys[0].condition);
  console.log('buy[1] (early v6):', buys[1].condition);
  console.log('buy[0] maxExecutions:', buys[0].maxExecutions, '| buy[1] maxExecutions:', buys[1].maxExecutions);
  console.log('wallet:', JSON.stringify(cfg.wallet));
  console.log('libraryRefs:', JSON.stringify(refs));
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }
  const c = await factory.createFromConfig(cfg, 'live');
  console.log('V51_LIVE_ID=' + c.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
