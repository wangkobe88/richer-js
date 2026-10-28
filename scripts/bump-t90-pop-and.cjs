#!/usr/bin/env node
// ============================================================================
// 库 T90 人气门 OR→AND（buy-v2 v45→v46 + buy-early-narrative v4→v5 同批）
//   背景（2026-10-28 用户裁定）：「买入量/持有者必须改为与的关系，防止前期就很
//   少的人刷量，或者多钱包极小量买入；强势臂同样至少需要一个与条件，这两个必须
//   都满足基础要求才行」。分界分析（10d 叙事通过池 127 活跃，tmp-pop-and-gate-
//   analysis.cjs，182）：OR 下死票（全史 buyB<3）主腿 57%/早期 100% 过门——58 张
//   早期过门死票 52 张首达标帧=「量到 0.25 而人 <4」单钱包/寡头刷量形状；
//   主腿 23/33 过门死票=buyB>=1.25 但 holders<10（量到人不到）。
//   两策略同批（用户拍板阈值）：
//     主腿 (buyVolumeBnb >= 1.25 OR holders >= 10) → (… AND …)   （阈值原值）
//     早期 (buyVolumeBnb >= 0.25 OR holders >= 4)  → (… AND … >= 5)（人臂 +1）
//   矩阵实证：主腿死票 57%→33%、活票 66%→63%；早期死票 100%→83%、
//   活票/中间组 100% 不动。maxExecutions=2/sybil<60/bundler<=100 承 T89 不动。
//   ⚠️ copy-in 快照语义：需新建实验引用 v46/v5（create-v50.cjs）。
// 防呆：断言两策略当前版本 + 旧 OR 子串恰一次 → 新 AND 子串恰一次 / 兄弟门
//   锚定（含 T89 新形状）/ trigger 不动 / cards=3 / maxExecutions===2。
// 用法：node scripts/bump-t90-pop-and.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_POP_MAIN = '(buyVolumeBnb >= 1.25 OR holders >= 10)';
const NEW_POP_MAIN = '(buyVolumeBnb >= 1.25 AND holders >= 10)';
const OLD_POP_EARLY = '(buyVolumeBnb >= 0.25 OR holders >= 4)';
const NEW_POP_EARLY = '(buyVolumeBnb >= 0.25 AND holders >= 5)';

const KEEP_SEGS = [
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(platform != \'flap\' OR tradesRouterPct >= 30)',
  '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
  'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20',
  'famousCopyWalletCircPct < 15',
  'sybilClusterHolderCircPct < 60',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != \'project\' AND narrativeCategory != \'account_based_meme\' AND narrativeCategory != \'web3_native_ip_early\')) OR gmgnIssuerTokenCount <= 1)';

const TARGETS = [
  { name: 'buy-v2', fromVersion: 45, pop: [OLD_POP_MAIN, NEW_POP_MAIN],
    keeps: [...KEEP_SEGS, 'bundleClusterHoldCircPct < 35', 'top2BundleClusterHoldCircPct < 55',
      'top3BundleClusterHoldCircPct < 75', '(tokenAgeSec < 90 OR tradeCount >= 25)',
      'marketCap > 4.7', 'marketCap < 27', 'holderTrendSlope > 0'],
    desc: ' | 2026-10-28 v46（T90 人气门 OR→AND）：(buyVolumeBnb >= 1.25 AND '
      + 'holders >= 10)——用户裁定「必须与的关系，防很少人刷量/多钱包极小量买入，'
      + '两个都满足基础要求」；阈值原值不动。10d 叙事池矩阵：死票（全史<3BNB）过门 '
      + '57%→33%、活票 66%→63%；主腿 OR 过门死票 23/33=量到人不到形状。'
      + '⚠️copy-in：需新建实验引用 v46。详档 docs/交易策略改进与Case台账.md T90' },
  { name: 'buy-early-narrative', fromVersion: 4, pop: [OLD_POP_EARLY, NEW_POP_EARLY],
    keeps: [...KEEP_SEGS, 'tokenAgeSec < 600', 'marketCap > 6.0', 'marketCap < 6.7',
      'bundleClusterHoldCircPct < 45', 'top2BundleClusterHoldCircPct < 65',
      'top3BundleClusterHoldCircPct < 85'],
    cards: 3,
    desc: ' | 2026-10-28 v5（T90 人气门 OR→AND）：(buyVolumeBnb >= 0.25 AND '
      + 'holders >= 5)——同 buy-v2 v46 裁定；人臂 4→5（矩阵：死票 100%→83%，'
      + '活票/中间组 100% 不动）；量臂 0.25 原值。⚠️copy-in：需新建实验引用 v5。'
      + '详档 docs/交易策略改进与Case台账.md T90' },
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

    const cond = replaceOnce(leg.condition, t.pop[0], t.pop[1], `${t.name} 人气门`);
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
    if (t.cards != null && leg.cards !== t.cards) {
      throw new Error(`${t.name} cards=${leg.cards}，期望 ${t.cards}（6 卡制）`);
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
