#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v41 → v42（2026-10-28 T82 mcap 早期豁免臂，0xa44e…7777 案用户裁定）
//   唯一变量：gmgnCheckCondition 加市值豁免臂——
//     gmgnBundlerWalletRatio <= 65 AND (…)
//     → (marketCap < 8000 OR gmgnBundlerWalletRatio <= 65) AND (…)
//   判据：GMGN wallet_tags_stat 分母个位数的超早期盘 bundler ratio 是采样噪声
//   （案票 0xa44ef3ea…7777 同盘 3min 内 58.8→166.7 剧变，反推形状 10/17→5/3——
//   分母收缩时 bundler 可大于 top 出 >100 值）；市值 <8K USD 豁免 bundler 门放行。
//   豁免只盖 bundler 门：issuer 分档门/narrativeCategory 臂不动（serial issuer
//   拦截面与市值无关）；fire condition / 发起门 / 兄弟门全部不动。
//   ⚠️ 进程代码须含 T82 commit（GmgnRiskCheckService 键集+双向透传），先 pull 再跑
//      ——否则 validateLegs 未知因子 400 拒绝（三层防线设计内）。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v42 才生效。
// 防呆：断言 v41 + 旧 gmgn 串整串恰一替换 / fire 与 trigger 不动 / 兄弟门锚定。
// 用法：node scripts/bump-buy-v2-v42.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const GMGN_OLD = 'gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early')) "
  + 'OR gmgnIssuerTokenCount <= 1)';
const GMGN_NEW = '(marketCap < 8000 OR gmgnBundlerWalletRatio <= 65) AND ((narrativeCategory IS NULL OR '
  + "(narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' "
  + "AND narrativeCategory != 'web3_native_ip_early')) "
  + 'OR gmgnIssuerTokenCount <= 1)';
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
  'marketCap > 3500',
  'marketCap < 20000',
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
  if (entry.version !== 41) throw new Error(`buy-v2 版本=${entry.version}，期望 41（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.gmgnCheckCondition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes('gmgnBundlerWalletRatio <= 65'));
  if (hits.length !== 1) throw new Error(`gmgnCheckCondition 含 bundler 门的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  if (legs[legIdx].gmgnCheckCondition !== GMGN_OLD) {
    throw new Error('gmgnCheckCondition 非 v41 整串形状: ' + legs[legIdx].gmgnCheckCondition);
  }

  // fire condition 与发起门不动（防误伤锚定）
  const fire = legs[legIdx].condition;
  for (const seg of KEEP_SEGS) {
    if (fire.split(seg).length !== 2) throw new Error(`fire 防误伤锚定子串非恰一次: ${seg}`);
  }
  if (fire.includes('earlyTrades')) throw new Error('fire 仍含 earlyTrades 子串（谱系异常）');
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new gmgnCheckCondition:', GMGN_NEW);
  const newDescription = (full.description || '') + ' | 2026-10-28 v42（T82 mcap 早期豁免臂，0xa44e…7777 案）：'
    + 'gmgn bundler 门加 (marketCap < 8000 OR …) 豁免臂——GMGN wallet_tags_stat 分母个位数时'
    + 'bundler ratio 是采样噪声（案票同盘 3min 58.8→166.7，分母收缩出 >100 值）；市值 <8K 豁免'
    + 'bundler 门；issuer 分档门/narrativeCategory 臂不动。需进程含 T82 commit（键集+双向透传）。'
    + '⚠️copy-in：需新建实验引用 v42 才生效。详档 docs/交易策略改进与Case台账.md T82';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].gmgnCheckCondition = GMGN_NEW;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 41,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
