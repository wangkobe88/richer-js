#!/usr/bin/env node
// ============================================================================
// 库 T89 门放宽 + 二次入场（buy-v2 v44→v45 + buy-early-narrative v3→v4 同批）
//   背景（2026-10-28 用户裁定）：「叙事通过的票无人问津占大多数，流动性非常不好，
//   条件明显偏严格，导致买入的票在高位」——放宽三门提升交易数量 + 允许二次入场
//   （BATCOIN 0xd145…7777 被震荡下车可惜，卖后可再入场；卡牌总数不变）。
//   两策略同批四处改动：
//     ① 人气门 ExSybil 键→原键（用户裁定「恢复原始的不去处 sybil 版本」，OR 结构与
//        阈值不动）：主 (buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)
//           → (buyVolumeBnb >= 1.25 OR holders >= 10)
//        早期 (…>= 0.25 OR … >= 4) 同款换键
//     ② sybil 簇门 sybilClusterHolderCircPct < 35 → < 60（用户拍板 60）
//     ③ GMGN bundler 门 <= 65 → <= 100（用户拍板 100；marketCap < 10.7 豁免臂与
//        issuer 分档门保留不动）
//     ④ maxExecutions 1 → 2（二次入场：引擎零代码改动——成交计数闸 2 次后才封；
//        卖出全清删卡账本/completedPairs 轮次推进/repeat 轮 GMGN 同串机制已就绪）
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（v48 config 自包含旧门），新建实验
//      引用新版本才生效（create-v49.cjs）。
// 防呆：断言两策略当前版本 + 四处旧形状恰一次 → 新形状恰一次 / 兄弟门锚定 /
//   trigger 不动 / cards=3 锚定 / maxExecutions===1 锚定。
// 用法：node scripts/bump-t89-gate-loosen.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

// ① 人气门（主/早期各自子串）
const OLD_POP_MAIN = '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)';
const NEW_POP_MAIN = '(buyVolumeBnb >= 1.25 OR holders >= 10)';
const OLD_POP_EARLY = '(buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4)';
const NEW_POP_EARLY = '(buyVolumeBnb >= 0.25 OR holders >= 4)';
// ② sybil 门
const OLD_SYBIL = 'sybilClusterHolderCircPct < 35';
const NEW_SYBIL = 'sybilClusterHolderCircPct < 60';
// ③ GMGN bundler 门（豁免臂/issuer 分档门不动）
const OLD_BUNDLER = 'gmgnBundlerWalletRatio <= 65';
const NEW_BUNDLER = 'gmgnBundlerWalletRatio <= 100';

const KEEP_SEGS = [
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(platform != \'flap\' OR tradesRouterPct >= 30)',
  '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
  'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20',
  'famousCopyWalletCircPct < 15',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_KEEP = [
  'marketCap < 10.7',
  '(narrativeCategory IS NULL OR (narrativeCategory != \'project\' AND narrativeCategory != \'account_based_meme\' AND narrativeCategory != \'web3_native_ip_early\')) OR gmgnIssuerTokenCount <= 1',
];

const TARGETS = [
  { name: 'buy-v2', fromVersion: 44,
    pop: [OLD_POP_MAIN, NEW_POP_MAIN],
    keeps: [...KEEP_SEGS, 'bundleClusterHoldCircPct < 35', 'top2BundleClusterHoldCircPct < 55',
      'top3BundleClusterHoldCircPct < 75', '(tokenAgeSec < 90 OR tradeCount >= 25)',
      'marketCap > 4.7', 'marketCap < 27', 'holderTrendSlope > 0'],
    desc: ' | 2026-10-28 v45（T89 门放宽+二次入场）：sybil 门 35→60、GMGN bundler 门 '
      + '65→100（10.7 豁免臂/issuer 分档门保留）、人气门 ExSybil 键→原键 buyVolumeBnb/'
      + 'holders（用户裁定恢复原始不去 sybil 版本，OR 与阈值 1.25/10 不动）、maxExecutions '
      + '1→2（卖后允许再入场一次，卡牌仍 6 卡帽）。背景=叙事通过票无人问津/流动性差/'
      + '条件偏严致买在高位（v47 归因：sybil 门 2/4 binder、蝙蝠币 GMGN 层 33 连拒）。'
      + '⚠️copy-in：需新建实验引用 v45 才生效。详档 docs/交易策略改进与Case台账.md T89' },
  { name: 'buy-early-narrative', fromVersion: 3,
    pop: [OLD_POP_EARLY, NEW_POP_EARLY],
    keeps: [...KEEP_SEGS, 'tokenAgeSec < 600', 'marketCap > 6.0', 'marketCap < 6.7',
      'bundleClusterHoldCircPct < 45', 'top2BundleClusterHoldCircPct < 65',
      'top3BundleClusterHoldCircPct < 85'],
    cards: 3,
    desc: ' | 2026-10-28 v4（T89 门放宽+二次入场）：同 buy-v2 v45——sybil 35→60、'
      + 'bundler 65→100、人气门 ExSybil→原键（0.25/4）、maxExecutions 1→2。'
      + '⚠️copy-in：需新建实验引用 v4 才生效。详档 docs/交易策略改进与Case台账.md T89' },
];

function replaceOnce(str, oldSeg, newSeg, label) {
  if (str.split(oldSeg).length !== 2) throw new Error(`${label} 旧子串非恰好一次: ${oldSeg}`);
  const out = str.replace(oldSeg, newSeg);
  if (out.split(newSeg).length !== 2) throw new Error(`${label} 新子串非恰好一次: ${newSeg}`);
  return out;
}

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

    // ①② condition 两处替换
    const cond = replaceOnce(replaceOnce(leg.condition, t.pop[0], t.pop[1], `${t.name} 人气门`),
      OLD_SYBIL, NEW_SYBIL, `${t.name} sybil 门`);
    for (const seg of t.keeps) {
      if (cond.split(seg).length !== 2) throw new Error(`${t.name} 防误伤锚定子串非恰一次: ${seg}`);
    }
    if (cond.includes('ExSybil')) throw new Error(`${t.name} 条件串仍残留 ExSybil 键`);
    // ③ gmgn bundler 门替换（豁免臂/issuer 分档门锚定不动）
    const gmgn = replaceOnce(leg.gmgnCheckCondition, OLD_BUNDLER, NEW_BUNDLER, `${t.name} bundler 门`);
    for (const seg of GMGN_KEEP) {
      if (gmgn.split(seg).length !== 2) throw new Error(`${t.name} gmgn 锚定子串非恰一次: ${seg}`);
    }
    // ④ maxExecutions 1→2
    if (leg.maxExecutions !== 1) {
      throw new Error(`${t.name} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 1（二次入场锚点）`);
    }
    if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) {
      throw new Error(`${t.name} 发起门 trigger 形状非预期: ${leg.narrativeTriggerCondition}`);
    }
    if (t.cards != null && leg.cards !== t.cards) {
      throw new Error(`${t.name} cards=${leg.cards}，期望 ${t.cards}（6 卡制）`);
    }

    console.log(`\n== ${t.name}: v${full.version} → v${full.version + 1}`);
    console.log('new condition:', cond);
    console.log('new gmgn     :', gmgn);
    console.log('maxExecutions: 1 → 2');
    const newDescription = (full.description || '') + t.desc;
    if (!COMMIT) { console.log('[dry-run]'); continue; }

    const outLegs = JSON.parse(JSON.stringify(legs));
    outLegs[0].condition = cond;
    outLegs[0].gmgnCheckCondition = gmgn;
    outLegs[0].maxExecutions = 2;
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
