#!/usr/bin/env node
// ============================================================================
// 库 T103 再买臂腰斩门放宽：drawdownFromHighest 区间 (-70,-50) → (-70,-40)
//   （buy-v2-repeat v2→v3）
//   2026-10-29 用户指令「把 drawdownFromHighest ∈ (-70,-50) 改为
//   drawdownFromHighest ∈ (-70,-40)」。案由 날다람쥐 0x5ca91444…7777
//   （v60 12:08:26 首买 3 卡 12:09:50 全清；12:09:53 卖出后最深回撤
//   **-45.2%** 未过 -50 门 → 12:10:51 起新高拉升至全时峰 3.55e-8
//   （较低点 +230%）零再买——-40~-50 段的浅腰斩 rebound 票是实际存在的
//   形状，T101 上线首日即观察到（台账 T101 观察点③贴边分布）。
//   仅上界 -50→-40，下界 -70（v27 接刀门）不动；首买/early/momentum 臂
//   不动。口径不变：任意接受价轨全时峰回撤、非 position 域键清仓后可
//   评估、无最高价=0 fail-closed。
//   ⚠️ copy-in 快照语义：需新建实验引用 v3（create-v62.cjs）。
// 防呆：源区间段恰一次 → 换后新区间段恰一次 / T100 移植全门锚定 /
//   repeat 路由（buyPhase/maxExecutions=1）/ trigger 与 gmgn 不动。
// 用法：node scripts/bump-t103-repeat-drawdown-40.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const NAME = 'buy-v2-repeat';
const FROM_VERSION = 2;
const OLD_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -50)';
const NEW_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -40)';

// T100 移植的全门锚定（换段后仍须恰一次）
const KEEPS = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = '(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100)';

const DESC = ' | 2026-10-29 v3（T103 腰斩门放宽）：区间上界 -50 → -40'
  + '——(-70,-40)：再买轮在「从最高点跌超 40% 但未崩穿 -70」段可见'
  + '（案由 날다람쥐 0x5ca9…7777 卖出后最深 -45.2% 未过 -50 门，随后 +230% 拉升零再买；'
  + '用户裁定放宽）。下界 -70 与口径不动（任意接受价轨、清仓后可评估、无最高价 fail-closed）；'
  + '首买/early/momentum 臂不动。⚠️copy-in：需新建实验引用 v3。'
  + '详档 docs/交易策略改进与Case台账.md T103';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  const entry = list.find((e) => e.name === NAME);
  if (!entry) throw new Error(`库中无 ${NAME} 条目`);
  if (entry.version !== FROM_VERSION) {
    throw new Error(`${NAME} version=${entry.version}，期望 ${FROM_VERSION}（先核对谱系再跑）`);
  }
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`${NAME} 腿数=${legs.length}，期望 1`);
  const leg = legs[0];
  if (leg.buyPhase !== 'repeat') throw new Error(`${NAME} buyPhase=${JSON.stringify(leg.buyPhase)}，期望 'repeat'（T100 路由）`);
  if (leg.maxExecutions !== 1) throw new Error(`${NAME} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 1（T100 再买次数 1）`);
  if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error(`${NAME} trigger 形状非预期（本批不动它）`);
  if (leg.gmgnCheckCondition !== GMGN_EXPECT) throw new Error(`${NAME} gmgn 非 T100 删 issuer 臂形状（本批不动它）`);

  let cond = leg.condition;
  if (cond.split(OLD_SEG).length !== 2) throw new Error(`${NAME} 源区间段 (-70,-50) 非恰一次`);
  cond = cond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error(`${NAME} 新区间段 (-70,-40) 非恰一次`);
  if (cond.includes('-50')) throw new Error(`${NAME} 换后仍残留 -50 字样`);
  for (const seg of KEEPS) {
    if (cond.split(seg).length !== 2) throw new Error(`${NAME} 防误伤锚定子串非恰一次: ${seg}`);
  }

  console.log(`== ${NAME}: v${full.version} → v${full.version + 1}`);
  console.log('new condition:', cond);
  if (COMMIT) {
    const outLegs = JSON.parse(JSON.stringify(legs));
    outLegs[0].condition = cond;
    const out = await svc.update(entry.id, {
      name: full.name,
      description: (full.description || '') + DESC,
      legs: outLegs,
      expectedVersion: full.version,
    });
    console.log(`✅ committed version=${out.version}`);
  } else {
    console.log('\n[dry-run]');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
