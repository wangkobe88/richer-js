#!/usr/bin/env node
// ============================================================================
// 库 T96 净买门换轨（两臂同改：buy-v2 v48→v49 + buy-early-narrative v8→v9）
//   2026-10-29 用户裁定「把买入条件 tradesNetBuyRatioLongWin >= 40 OR
//   tradesNetBuyRatioShortWin >= 40 改为 tradesNetBuyRatioLongWin >= 0 AND
//   tradesNetBuyRatioShortWin >= 40，也就是『短期开始涨，长期下跌趋势解除』」
//   「两个臂都改」。
//   语义：短窗（尾 20 笔）须强净买 ≥40（短期开始涨）∧ 长窗（尾 100 笔）净比
//   非负（长期下跌趋势解除）。数学上新门 ⊆ 旧 OR 门（严格收紧）：
//   旧过新不过=①长≥40 但短<40（长强短弱）②短≥40 但长<0（短反弹、长期仍在净卖）。
//   null 语义不变：长短窗同源于 _activityEvents 环（环空两者皆 null fail-closed）。
//   其余一切门不动（T95 早期臂 45/75 放宽保留在 v9；主腿集中度 35/55 不动）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v49/v9（create-v54.cjs）。
// 防呆：两源段恰一次 → 换后旧段零残留 / 新段恰一次 / 兄弟门锚定（T90/T93/T95
//   形状）/ trigger 与 gmgn 不动 / maxExecutions===2 / 谱系核对（48→49、8→9）。
// 用法：node scripts/bump-t96-netbuy-reshape.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_NETBUY = '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)';
const NEW_NETBUY = '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)';

const TASKS = [
  {
    name: 'buy-v2', fromVersion: 48,
    keeps: [
      '(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
      '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
      'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
      '(buyVolumeBnb >= 1.25 AND holders >= 10)',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v49（T96 净买门换轨）：OR→AND 形状——'
      + '(LongWin >= 0 AND ShortWin >= 40)「短期开始涨，长期下跌趋势解除」'
      + '（用户裁定两臂同改；严格收紧：拦「长强短弱」与「短反弹但长期净卖」两形状）。'
      + '其余门不动（集中度 35/55=T93 形状）。⚠️copy-in：需新建实验引用 v49。'
      + '详档 docs/交易策略改进与Case台账.md T96',
  },
  {
    name: 'buy-early-narrative', fromVersion: 8,
    keeps: [
      '(narrativeRating == 2 OR narrativeRating == 3)', 'tokenAgeSec < 600',
      'marketCap > 6.0', 'marketCap < 6.7', '(buyVolumeBnb >= 0.25 AND holders >= 5)',
      'top1HolderCircPct < 45', 'top2HolderCircPct < 75',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v9（T96 净买门换轨，与主腿 v49 同款）：OR→AND 形状——'
      + '(LongWin >= 0 AND ShortWin >= 40)「短期开始涨，长期下跌趋势解除」'
      + '（用户裁定两臂同改）。T95 集中度放宽 45/75 保留不动。'
      + '⚠️copy-in：需新建实验引用 v9。详档 docs/交易策略改进与Case台账.md T96',
  },
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  for (const task of TASKS) {
    const entry = list.find((e) => e.name === task.name);
    if (!entry) throw new Error(`库中无 ${task.name} 条目`);
    if (entry.version !== task.fromVersion) {
      throw new Error(`${task.name} version=${entry.version}，期望 ${task.fromVersion}（先核对谱系再跑）`);
    }
    const full = await svc.getById(entry.id);
    const legs = full.legs.legs || full.legs;
    if (legs.length !== 1) throw new Error(`${task.name} 腿数=${legs.length}，期望 1`);
    const leg = legs[0];

    let cond = leg.condition;
    if (cond.split(OLD_NETBUY).length !== 2) throw new Error(`${task.name} 源净买段非恰一次`);
    cond = cond.replace(OLD_NETBUY, NEW_NETBUY);
    if (cond.includes('tradesNetBuyRatioLongWin >= 40')) throw new Error(`${task.name} 残留旧 OR 段`);
    if (cond.includes('OR tradesNetBuyRatioShortWin')) throw new Error(`${task.name} 残留旧 OR 臂`);
    for (const seg of [NEW_NETBUY, ...task.keeps]) {
      if (cond.split(seg).length !== 2) throw new Error(`${task.name} 防误伤锚定子串非恰一次: ${seg}`);
    }
    if (leg.gmgnCheckCondition !== GMGN_EXPECT) throw new Error(`${task.name} gmgn 非 T89 形状（本批不动它）`);
    if (leg.maxExecutions !== 2) throw new Error(`${task.name} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2`);
    if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error(`${task.name} trigger 形状非预期`);

    console.log(`\n== ${task.name}: v${full.version} → v${full.version + 1}`);
    console.log('new condition:', cond);
    if (COMMIT) {
      const outLegs = JSON.parse(JSON.stringify(legs));
      outLegs[0].condition = cond;
      const out = await svc.update(entry.id, {
        name: full.name,
        description: (full.description || '') + task.desc,
        legs: outLegs,
        expectedVersion: full.version,
      });
      console.log(`✅ committed version=${out.version}`);
    }
  }
  if (!COMMIT) console.log('\n[dry-run]');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
