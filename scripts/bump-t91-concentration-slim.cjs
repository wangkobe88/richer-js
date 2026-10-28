#!/usr/bin/env node
// ============================================================================
// 库 T91b 集中度族瘦身（buy-v2 v46→v47 + buy-early-narrative v5→v6 同批）
//   背景（2026-10-28 孙权 0x3b1b…7777 案用户裁定「只保留 top1 top2 集中度条件」）：
//   孙权重放——叙事 14:20:48 完成（leadMs=162s 单轮 high）、便宜门 14:20:50 全过、
//   top1 14:20:38 早过，但 bundle<35 与 top3<75 拖到 14:23:17 才过（161s，最后
//   收口门）→ BUY 14:23:31 mcap 17.0（若口径健康买点≈14:21-14:22、mcap≈6.3）。
//   修正分母（T91a max(circ,Σ正净持仓)）重放：top3 在 age=12s 就 <75、bundle
//   14:21:54 过——即两门对孙权的 163s 拦截几乎全是分母口径病的虚高假拦截；
//   且 top3 恒 ≥ top2 ≥ top1 与 top2 高度共线，边际拦截价值小。
//   两策略同批（只删两段，top1/top2 及其余门原样）：
//     主腿  删『bundleClusterHoldCircPct < 35 AND 』『 AND top3BundleClusterHoldCircPct < 75』
//     早期  删『bundleClusterHoldCircPct < 45 AND 』『 AND top3BundleClusterHoldCircPct < 85』
//   ⚠️ copy-in 快照语义：需新建实验引用 v47/v6（create-v51.cjs）。
//   ⚠️ 前置：v50 实跑中（ced5d5a9），本批与 T91a FA 分母修复（max(circ,Σ正) 恒
//   ≤100、正常票 bit 不变）同车部署（create-v51）。
// 防呆：断言两策略当前版本 + 删除段恰一次 → 删除后旧段零残留 / top1+top2 段
//   恰一次在场 / 兄弟门锚定（T89/T90 形状）/ trigger 不动 / maxExecutions===2。
// 用法：node scripts/bump-t91-concentration-slim.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  {
    name: 'buy-v2', fromVersion: 46,
    dropSegs: ['bundleClusterHoldCircPct < 35 AND ', ' AND top3BundleClusterHoldCircPct < 75'],
    keeps: [
      '(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
      '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
      'top2BundleClusterHoldCircPct < 55', 'top1HolderCircPct < 35',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'sybilClusterHolderCircPct < 60', "(platform != 'flap' OR tradesRouterPct >= 30)",
      '(buyVolumeBnb >= 1.25 AND holders >= 10)',
      '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-28 v47（T91b 集中度族瘦身）：删 bundleClusterHoldCircPct < 35 与'
      + 'top3BundleClusterHoldCircPct < 75 两门，只留 top1HolderCircPct < 35 +'
      + 'top2BundleClusterHoldCircPct < 55——用户裁定「只保留 top1 top2 集中度条件」。'
      + '驱动=孙权案：bundle/top3 是最后收口门（161s），T91a 分母修复重放显示其拦截'
      + '几乎全是口径虚高假拦截（修正后 top3 age=12s 即过）；top3 恒 ≥ top2 共线性高。'
      + '⚠️copy-in：需新建实验引用 v47。详档 docs/交易策略改进与Case台账.md T91',
  },
  {
    name: 'buy-early-narrative', fromVersion: 5,
    dropSegs: ['bundleClusterHoldCircPct < 45 AND ', ' AND top3BundleClusterHoldCircPct < 85'],
    keeps: [
      '(narrativeRating == 2 OR narrativeRating == 3)', 'tokenAgeSec < 600',
      'marketCap > 6.0', 'marketCap < 6.7', '(buyVolumeBnb >= 0.25 AND holders >= 5)',
      '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
      'top2BundleClusterHoldCircPct < 65', 'top1HolderCircPct < 35',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'sybilClusterHolderCircPct < 60', "(platform != 'flap' OR tradesRouterPct >= 30)",
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-28 v6（T91b 集中度族瘦身）：删 bundleClusterHoldCircPct < 45 与'
      + 'top3BundleClusterHoldCircPct < 85 两门，只留 top1HolderCircPct < 35 +'
      + 'top2BundleClusterHoldCircPct < 65——同 buy-v2 v47 裁定（早期臂同形状处理）。'
      + '⚠️copy-in：需新建实验引用 v6。详档 docs/交易策略改进与Case台账.md T91',
  },
];

const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  for (const t of TARGETS) {
    const entry = list.find((e) => e.name === t.name);
    if (!entry) throw new Error(`库中无 ${t.name} 条目`);
    if (entry.version !== t.fromVersion) {
      throw new Error(`${t.name} 版本=${entry.version}，期望 ${t.fromVersion}（先核对谱系再跑）`);
    }
    const full = await svc.getById(entry.id);
    const legs = full.legs.legs || full.legs;
    if (legs.length !== 1) throw new Error(`${t.name} 条目腿数=${legs.length}，期望 1`);
    const leg = legs[0];

    let cond = leg.condition;
    for (const seg of t.dropSegs) {
      if (cond.split(seg).length !== 2) throw new Error(`${t.name} 删除段非恰好一次: ${seg}`);
      cond = cond.replace(seg, '');
    }
    // 删除后旧键零残留（bundle 单块门与 top3 门彻底退出条件串）
    if (cond.includes('bundleClusterHoldCircPct <')) throw new Error(`${t.name} 残留 bundleClusterHoldCircPct 门`);
    if (cond.includes('top3BundleClusterHoldCircPct')) throw new Error(`${t.name} 残留 top3BundleClusterHoldCircPct`);
    for (const seg of t.keeps) {
      if (cond.split(seg).length !== 2) throw new Error(`${t.name} 防误伤锚定子串非恰一次: ${seg}`);
    }
    if (cond.includes('ExSybil')) throw new Error(`${t.name} 条件串残留 ExSybil 键`);
    if (leg.gmgnCheckCondition !== GMGN_EXPECT) {
      throw new Error(`${t.name} gmgn 非 T89 形状（本批不动它）: ${leg.gmgnCheckCondition}`);
    }
    if (leg.maxExecutions !== 2) {
      throw new Error(`${t.name} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2（T89 二次入场锚点）`);
    }
    if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) {
      throw new Error(`${t.name} 发起门 trigger 形状非预期: ${leg.narrativeTriggerCondition}`);
    }

    console.log(`\n== ${t.name}: v${full.version} → v${full.version + 1}`);
    console.log('new condition:', cond);
    const newDescription = (full.description || '') + t.desc;
    if (!COMMIT) { console.log('[dry-run]'); continue; }

    const outLegs = JSON.parse(JSON.stringify(legs));
    outLegs[0].condition = cond;
    const out = await svc.update(entry.id, {
      name: full.name,
      description: newDescription,
      legs: outLegs,
      expectedVersion: full.version, // 乐观并发门（update 内 version=expectedVersion+1）
    });
    console.log(`✅ committed version=${out.version}`);
  }
  if (!COMMIT) console.log('\n（dry-run 未写库；--commit 执行）');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
