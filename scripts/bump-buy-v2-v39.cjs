#!/usr/bin/env node
// ============================================================================
// 库 buy-v2 v38 → v39（2026-10-26 T70 智子/币安1986 案用户三裁定：慢热票适配）
//   ①净买比门换实时载体+放宽：earlyTradesNetBuyRatio >= 50 → tradesNetBuyRatio >= 40
//    （智子 0x4451f373…7777：90s 窗净买比 49.8 差 0.2pp 拦掉毕业票；全史实时值
//     随买点评估，放宽到 40）
//   ②flap 路由门换实时载体：earlyTradesRouterPct >= 30 → tradesRouterPct >= 30
//    （币安1986 0xd6c7e7c9…7777：前 90s 仅 dev 自倒 2 笔 routerPct 冻结 0 恒拦，
//     90-300s 散户蜂拥 110 笔 77 钱包也改不了冻结值；实时版买点时刻真值）
//   ③慢热或臂去时间上限：tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600)
//     → tokenAgeSec < 90 OR tradeCount >= 25（流动性不足市场 ticks 数量与 90s 取或；
//     preFilter age 包络随之无上界=不再裁剪慢热票，设计内）
//   其余臂全部不动。earlyTrades* 键保留观测（快照照落），仅买条件不再消费。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验，新建实验引用 v39 才生效。
//   ⚠️ 进程代码须含 tradesNetBuyRatio/tradesRouterPct（T70 commit），先 pull 再跑——
//      否则 validateLegs 未知因子 400 拒绝（三层防线设计内）。
// 防呆：断言 v38 + 三旧子串恰一替换 → 新子串恰一 / 替换后条件不含 early 冻结两键 /
//   兄弟门锚定恰一次在场 / gmgn 与 trigger 不动。
// 用法：node scripts/bump-buy-v2-v39.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const REPLACES = [
  {
    old: 'earlyTradesNetBuyRatio >= 50',
    neu: 'tradesNetBuyRatio >= 40',
    why: '净买比门换实时载体+50→40',
  },
  {
    old: 'earlyTradesRouterPct >= 30',
    neu: 'tradesRouterPct >= 30',
    why: 'flap 路由门换实时载体',
  },
  {
    old: '(tokenAgeSec < 90 OR (tradeCount >= 25 AND tokenAgeSec < 600))',
    neu: '(tokenAgeSec < 90 OR tradeCount >= 25)',
    why: '慢热或臂去 600s 时间上限（ticks 数量与 90s 取或）',
  },
];
const KEEP_SEGS = [
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
  'holderTrendSlope > 0',
  "platform != 'flap'",
  'earlyTradesPerWallet < 4',
  '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "gmgnBundlerWalletRatio <= 65 AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early' AND narrativeCategory != 'event:W')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');
  const entry = list.find(e => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== 38) throw new Error(`buy-v2 版本=${entry.version}，期望 38（先核对谱系再跑）`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;

  const hits = legs
    .map((leg, i) => ({ i, cond: leg.condition }))
    .filter(x => typeof x.cond === 'string' && x.cond.includes('top3BundleClusterHoldCircPct < 75'));
  if (hits.length !== 1) throw new Error(`fire condition 含 v38 top3 门的腿数=${hits.length}（期望恰好 1）`);
  const legIdx = hits[0].i;
  let cond = legs[legIdx].condition;
  for (const r of REPLACES) {
    if (cond.split(r.old).length !== 2) throw new Error(`旧子串非恰好一次: ${r.old}`);
    cond = cond.replace(r.old, r.neu);
    if (cond.split(r.neu).length !== 2) throw new Error(`新子串非恰好一次: ${r.neu}`);
    console.log(`替换[${r.why}] ✓`);
  }
  // 替换后不得再消费 early 冻结两键（perWallet 等 early 键保留不动）
  if (cond.includes('earlyTradesNetBuyRatio') || cond.includes('earlyTradesRouterPct')) {
    throw new Error('替换后条件仍含 early 冻结两键（子串误伤？）');
  }
  // 兄弟门锚定（防误伤）
  for (const seg of KEEP_SEGS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }
  // gmgn 门与发起门不动（防误伤）
  if (legs[legIdx].gmgnCheckCondition !== GMGN_EXPECT) {
    throw new Error('gmgnCheckCondition 非 v38 形状（本批不动它）: ' + legs[legIdx].gmgnCheckCondition);
  }
  if (legs[legIdx].narrativeTriggerCondition !== TRIGGER_EXPECT) {
    throw new Error('发起门 trigger 形状非预期: ' + legs[legIdx].narrativeTriggerCondition);
  }

  console.log('name:    ', full.name, '| version:', full.version, '→', full.version + 1);
  console.log('new condition:', cond);
  const newDescription = (full.description || '') + ' | 2026-10-26 v39（T70 智子/币安1986 案三裁定）：'
    + '①净买比门 earlyTradesNetBuyRatio>=50 → tradesNetBuyRatio>=40（全史实时载体+放宽；智子 90s 窗 49.8 差 0.2pp 拦掉毕业票）'
    + '②flap 路由门 earlyTradesRouterPct>=30 → tradesRouterPct>=30（实时载体；币安1986 前 90s 仅 dev 自倒冻结 0 恒拦）'
    + '③慢热或臂去 600s 上限：tokenAgeSec<90 OR tradeCount>=25。⚠️copy-in：需新建实验引用 v39 才生效。'
    + '详档 docs/交易策略改进与Case台账.md T70';
  console.log('description:', newDescription);
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[legIdx].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: 38,
  });
  console.log('UPDATED version=' + out.version);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
