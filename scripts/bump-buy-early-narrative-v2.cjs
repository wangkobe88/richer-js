#!/usr/bin/env node
// ============================================================================
// 库 buy-early-narrative v1 → v2（2026-10-28 T85 早期臂 bundle 三门放宽，用户裁定）
//   三处替换（各 +10）：
//     bundleClusterHoldCircPct < 35 → < 45
//     top2BundleClusterHoldCircPct < 55 → < 65
//     top3BundleClusterHoldCircPct < 75 → < 85
//   背景：T84 落地时回放=乐观上界（未计 bundle 三门），三门沿主腿 35/55/75 全保留
//   ——早期臂带内（6.0-6.7 BNB）集中度天然更高，原阈值对该带偏紧（T84 余留项）。
//   其余门全部不动：rating 2|3/600s 窗/6.0-6.7 带/承接 0.25/4/净买 40/top1 35/
//   copy 20/famous 15/sybil 35/flap router/崩盘双门；gmgn/trigger/cards 不动。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（v46 在跑早期腿=v1 快照），新建实验
//      引用 v2 才生效（create-v47.cjs）。
// 防呆：断言 v1 + 三旧子串各恰一次（带键名，防 top1HolderCircPct < 35 误伤）→
//   三新子串各恰一次 / 兄弟门锚定 / gmgn 与 trigger 不动。
// 用法：node scripts/bump-buy-early-narrative-v2.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const REPLACES = [
  { old: 'bundleClusterHoldCircPct < 35', neu: 'bundleClusterHoldCircPct < 45', why: 'bundle 门 35→45' },
  { old: 'top2BundleClusterHoldCircPct < 55', neu: 'top2BundleClusterHoldCircPct < 65', why: 'top2 门 55→65' },
  { old: 'top3BundleClusterHoldCircPct < 75', neu: 'top3BundleClusterHoldCircPct < 85', why: 'top3 门 75→85' },
];
// 兄弟门锚定（防误伤；注意 top1/sybil 的 < 35 键名不同于 bundle 键）
const KEEP_SEGS = [
  '(narrativeRating == 2 OR narrativeRating == 3)',
  'tokenAgeSec < 600',
  'marketCap > 6.0',
  'marketCap < 6.7',
  '(buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4)',
  '(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)',
  'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20',
  'famousCopyWalletCircPct < 15',
  'sybilClusterHolderCircPct < 35',
  "(platform != 'flap' OR tradesRouterPct >= 30)",
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-early-narrative');
  if (!entry) throw new Error('库中无 buy-early-narrative 条目');
  if (entry.version !== 1) throw new Error(`buy-early-narrative 版本=${entry.version}，期望 1（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`条目腿数=${legs.length}，期望 1`);

  let cond = legs[0].condition;
  for (const r of REPLACES) {
    if (cond.split(r.old).length !== 2) throw new Error(`旧子串非恰好一次: ${r.old}`);
    cond = cond.replace(r.old, r.neu);
    if (cond.split(r.neu).length !== 2) throw new Error(`新子串非恰好一次: ${r.neu}`);
    console.log(`替换[${r.why}] ✓`);
  }
  // 兄弟门锚定（防误伤）
  for (const seg of KEEP_SEGS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }
  // gmgn 门与发起门不动（防误伤）
  if (!legs[0].gmgnCheckCondition || !legs[0].gmgnCheckCondition.includes('marketCap < 10.7')) {
    throw new Error('gmgnCheckCondition 非 v1 形状（本批不动它）: ' + legs[0].gmgnCheckCondition);
  }
  if (legs[0].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[0].narrativeTriggerCondition);
  }
  if (legs[0].cards !== 3) throw new Error('cards=' + legs[0].cards + '，期望 3（6 卡制）');

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-28 v2（T85 早期臂 bundle 三门放宽）：'
    + 'bundle 35→45 / top2 55→65 / top3 75→85（各 +10）——T84 落地时回放=乐观上界未计三门，'
    + '早期臂带内集中度天然更高，原阈值对该带偏紧（T84 余留项）。其余门全部不动。'
    + '⚠️copy-in：需新建实验引用 v2 才生效。详档 docs/交易策略改进与Case台账.md T85';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[0].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 1,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
