#!/usr/bin/env node
// ============================================================================
// 库 T98 人气门换键（两臂同改：buy-v2 v49→v50 + buy-early-narrative v9→v10）
//   2026-10-29 用户裁定「极小持仓者剔除（这样不会让假活跃票进门），可以新搞一个
//   因子，替换现有的 holders 因子」：人气门 holders → holdersExDust（净持仓按
//   首可靠价折算 ≥ holderDustBnb 0.002 的钱包数——刷 holder 的尘埃钱包不计入）。
//   阈值不动（主 10 / 早期 5）：口径变小（分子剔尘）同阈值=更严，观察后可调。
//   其余一切门不动（T96 AND 净买门/T95 早期臂 45/75/T93 35/55 全保留）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v50/v10（create-v55.cjs）。
// 防呆：两源段恰一次 → 换后旧段零残留 / 新段恰一次 / 兄弟门锚定 / 裸 `holders`
//   零残留（防同前缀误判 holdersExDust——反查 condition 不含 ' holders '）/
//   trigger 与 gmgn 不动 / maxExecutions===2 / 谱系核对（49→50、9→10）。
// 用法：node scripts/bump-t98-holders-exdust.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const SWAPS = [
  ['(buyVolumeBnb >= 1.25 AND holders >= 10)', '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)'],
  ['(buyVolumeBnb >= 0.25 AND holders >= 5)', '(buyVolumeBnb >= 0.25 AND holdersExDust >= 5)'],
];

const TASKS = [
  {
    name: 'buy-v2', fromVersion: 49, swap: 0,
    keeps: [
      '(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
      '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
      '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
      'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v50（T98 人气门换键）：holders >= 10 → holdersExDust >= 10'
      + '——剔尘埃口径（净持仓按首价折算 ≥ 0.002 BNB=2× tick 尘门+单卡仓位才计持有人；'
      + '用户裁定「极小持仓者剔除——不让假活跃票进门」）。阈值 10 不动（口径变小同阈=更严）。'
      + '其余门不动（T96 AND 净买门保留）。⚠️copy-in：需新建实验引用 v50。'
      + '详档 docs/交易策略改进与Case台账.md T98',
  },
  {
    name: 'buy-early-narrative', fromVersion: 9, swap: 1,
    keeps: [
      '(narrativeRating == 2 OR narrativeRating == 3)', 'tokenAgeSec < 600',
      'marketCap > 6.0', 'marketCap < 6.7',
      '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
      'top1HolderCircPct < 45', 'top2HolderCircPct < 75',
      'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
      'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
    ],
    desc: ' | 2026-10-29 v10（T98 人气门换键，与主腿 v50 同款）：holders >= 5 → '
      + 'holdersExDust >= 5——剔尘埃口径（同 v50；用户裁定两臂同换）。T95 集中度放宽 '
      + '45/75 与 T96 AND 净买门保留不动。⚠️copy-in：需新建实验引用 v10。'
      + '详档 docs/交易策略改进与Case台账.md T98',
  },
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  for (const task of TASKS) {
    const [OLD_SEG, NEW_SEG] = SWAPS[task.swap];
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
    if (cond.split(OLD_SEG).length !== 2) throw new Error(`${task.name} 源人气段非恰一次`);
    cond = cond.replace(OLD_SEG, NEW_SEG);
    if (cond.includes('holders >= ')) throw new Error(`${task.name} 残留裸 holders 门`);
    if (cond.split(NEW_SEG).length !== 2) throw new Error(`${task.name} 新人气段非恰一次`);
    for (const seg of task.keeps) {
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
