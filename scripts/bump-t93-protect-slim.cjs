#!/usr/bin/env node
// ============================================================================
// 库 T93 保护条件瘦身（buy-v2 v47→v48 + buy-early-narrative v6→v7 同批）
//   背景（2026-10-29 BI/Meecot 迟买归因用户裁定「保护条件还要再进一步瘦身，
//   不然真的没法搞了」）：
//   - BI 0xa7ef…7777（flap 税币，rating=3 +4.4s 就绪 leadMs=22.6s）：flap 路由门
//     (platform != 'flap' OR tradesRouterPct >= 30) 独拦 12s（GMGN 路由份额 +20s
//     才过 30%）+ top2 块簇门最后收口（+25s）→ fire=+27s 买在顶部右侧，反事实
//     +17s 价差 +48.6%，11.6s 后 -68% 止损；
//   - Meecot 0x8671d681（leadMs=179s）：sybil 门 100→59 稀释 150s 才擦线过 60 门，
//     等散户稀释换来的是接顶（两段 episode 全亏 -38%/-33%）——sybil 高位票本身
//     就是关联簇拉盘形状。
//   两策略同批三处瘦身（FA 因子与 roster loader 不动=纯观察键，只退条件串）：
//     ①删『 AND (platform != 'flap' OR tradesRouterPct >= 30)』（router 门整段去）
//     ②删『 AND sybilClusterHolderCircPct < 60』（sybil 门整段去）
//     ③『top2BundleClusterHoldCircPct < 55/65』→『top2HolderCircPct < 55/65』
//       （块簇门换 top2 持有人门，阈值承接——新键=前两大净持仓合计 ÷ 同 _circDen，
//       与 top1 同口径；单测 scripts/_test_top2_holder_circ.cjs）
//   ⚠️ copy-in 快照语义：需新建实验引用 v48/v7（create-v52.cjs）。
// 防呆：断言两策略当前版本 + 删除段恰一次 → 删换后三旧键零残留 / top1 门与
//   top2Holder 新门恰一次在场 / 其余兄弟门锚定（T89/T90/T91 形状）/ trigger 与
//   gmgn 不动 / maxExecutions===2。
// 用法：node scripts/bump-t93-protect-slim.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  {
    name: 'buy-v2', fromVersion: 47,
    dropSegs: [" AND (platform != 'flap' OR tradesRouterPct >= 30)", ' AND sybilClusterHolderCircPct < 60'],
    swap: ['top2BundleClusterHoldCircPct < 55', 'top2HolderCircPct < 55'],
    keeps: [
      '(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
      '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
      'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      '(buyVolumeBnb >= 1.25 AND holders >= 10)',
      '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v48（T93 保护条件瘦身）：删 flap 路由门'
      + '(platform != \'flap\' OR tradesRouterPct >= 30) 与 sybil 门'
      + ' sybilClusterHolderCircPct < 60，top2 块簇门换 top2 持有人门'
      + 'top2HolderCircPct < 55（阈值承接）——用户裁定「这些保护条件还要再进一步瘦身」。'
      + '驱动=BI 0xa7ef 案（router 门独拦 12s+top2 最后收口 +27s 买顶）与 Meecot'
      + '0x8671d681 案（sybil 100→59 稀释 150s 接顶全亏）。三键退为纯观察键（FA 照算）。'
      + '⚠️copy-in：需新建实验引用 v48。详档 docs/交易策略改进与Case台账.md T93',
  },
  {
    name: 'buy-early-narrative', fromVersion: 6,
    dropSegs: [" AND (platform != 'flap' OR tradesRouterPct >= 30)", ' AND sybilClusterHolderCircPct < 60'],
    swap: ['top2BundleClusterHoldCircPct < 65', 'top2HolderCircPct < 65'],
    keeps: [
      '(narrativeRating == 2 OR narrativeRating == 3)', 'tokenAgeSec < 600',
      'marketCap > 6.0', 'marketCap < 6.7', '(buyVolumeBnb >= 0.25 AND holders >= 5)',
      '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
      'top2HolderCircPct < 65', 'top1HolderCircPct < 35',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v7（T93 保护条件瘦身）：删 flap 路由门与 sybil 门，'
      + 'top2 块簇门换 top2 持有人门 top2HolderCircPct < 65（阈值承接）——同 buy-v2'
      + ' v48 裁定（早期臂同形状处理）。⚠️copy-in：需新建实验引用 v7。'
      + '详档 docs/交易策略改进与Case台账.md T93',
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
    // 块簇门 → 持有人门（阈值承接，恰一次换名）
    if (cond.split(t.swap[0]).length !== 2) throw new Error(`${t.name} 换名源段非恰好一次: ${t.swap[0]}`);
    cond = cond.replace(t.swap[0], t.swap[1]);
    // 删换后三旧键零残留（router/sybil/块簇 top2 彻底退出条件串）
    if (cond.includes('tradesRouterPct')) throw new Error(`${t.name} 残留 tradesRouterPct`);
    if (cond.includes('sybilClusterHolderCircPct')) throw new Error(`${t.name} 残留 sybilClusterHolderCircPct`);
    if (cond.includes('top2BundleClusterHoldCircPct')) throw new Error(`${t.name} 残留 top2BundleClusterHoldCircPct`);
    if (cond.includes('platform')) throw new Error(`${t.name} 残留 platform 子句（本批整段删）`);
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
