#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v42 → v43（2026-10-28 T84 市值量纲切换 + 双臂 6 卡制）
//   三变量（同批=用户一次裁定）：
//     1. fire 市值带 USD→BNB：marketCap > 3500 → > 4.7；< 20000 → < 27
//        （FA marketCap 因子同批换 BNB 域=priceBnb×totalSupply；bnbUsd≈745 时
//         3500/20000 USD ≈ 4.7/26.8 BNB，取 4.7/27）
//     2. gmgn 豁免臂同步换算：marketCap < 8000 → < 10.7（T82 臂，8000/745≈10.74）
//     3. cards 4 → 3（用户裁定：主腿+早期臂共 6 卡、每腿每次买 3 卡）
//   ⚠️ 前置：FA/引擎代码已含 T84 commit（marketCap BNB 域）——旧 USD 数字配新
//      BNB 域因子=市值门恒死。先 pull 再跑。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v43 才生效。
// 防呆：断言 v42 + 旧子串恰一替换 / trigger 不动 / 兄弟门锚定 / cards 恰 4→3。
// 用法：node scripts/bump-buy-v2-v43.cjs [--commit]   （在 182 跑；先跑 bump-buy-v2-v42.cjs --commit）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

// 顺序敏感：长串先换（marketCap < 20000 在 tier 类子串内不出现于本 fire 串，
// 但 8000/3500/20000 三锚必须各自恰一次）
const REPLACEMENTS = [
  ['marketCap > 3500', 'marketCap > 4.7'],
  ['marketCap < 20000', 'marketCap < 27'],
  ['(marketCap < 8000 OR gmgnBundlerWalletRatio <= 65)', '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 65)'],
];
const KEEP_SEGS = [
  'tradesNetBuyRatio >= 40',
  'tradesRouterPct >= 30',
  'bundleClusterHoldCircPct < 35',
  'top2BundleClusterHoldCircPct < 55',
  'top3BundleClusterHoldCircPct < 75',
  'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20',
  'sybilClusterHolderCircPct < 35',
  'famousCopyWalletCircPct < 15',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 42) throw new Error(`buy-v2 版本=${entry.version}，期望 42（先跑 bump-buy-v2-v42.cjs --commit）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`腿数=${legs.length}（期望 1）`);
  const leg = legs[0];

  for (const [oldS, newS] of REPLACEMENTS) {
    const n = (leg.condition + '\n' + (leg.gmgnCheckCondition || '')).split(oldS).length - 1;
    if (n !== 1) throw new Error(`锚定子串非恰一次(${n}): ${oldS}`);
  }
  for (const seg of KEEP_SEGS) {
    if (leg.condition.split(seg).length !== 2) throw new Error(`兄弟门锚定子串非恰一次: ${seg}`);
  }
  if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + leg.narrativeTriggerCondition);
  }
  if (leg.cards !== 4) throw new Error(`cards=${leg.cards}，期望 4（谱系异常，先核对）`);

  const outLegs = JSON.parse(JSON.stringify(legs));
  const out = outLegs[0];
  for (const [oldS, newS] of REPLACEMENTS) {
    if (out.condition.includes(oldS)) out.condition = out.condition.split(oldS).join(newS);
    if (out.gmgnCheckCondition && out.gmgnCheckCondition.includes(oldS)) {
      out.gmgnCheckCondition = out.gmgnCheckCondition.split(oldS).join(newS);
    }
  }
  out.cards = 3;

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('condition:', out.condition);
  console.log('gmgn:     ', out.gmgnCheckCondition);
  console.log('cards:    4 → 3');
  const newDescription = (full.description || '') + ' | 2026-10-28 v43（T84 市值量纲切换+6 卡制，用户裁定）：'
    + '①FA marketCap 因子换 BNB 域（priceBnb×totalSupply，原 USD 域随 BNB 价漂移）——'
    + '市值带 3500/20000 USD → 4.7/27 BNB、gmgn 豁免臂 8000 USD → 10.7 BNB（bnbUsd≈745 换算）；'
    + '②cards 4→3（主腿 buy-v2 + 早期臂 buy-early-narrative 共 6 卡、每腿每次买 3 卡）。'
    + '需进程含 T84 commit。⚠️copy-in：需新建实验引用 v43 才生效。'
    + '详档 docs/交易策略改进与Case台账.md T84';
  console.log('description 追加: 2026-10-28 v43（T84 …）');
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const saved = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 42,
  });
  console.log('UPDATED version=' + saved.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
