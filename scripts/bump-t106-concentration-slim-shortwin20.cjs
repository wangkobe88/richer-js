#!/usr/bin/env node
// ============================================================================
// 库 T106 主腿放宽：删集中度两门 + 短窗净买门 40→20
//   （buy-v2 v52→v53，仅首买主腿；early/repeat 臂不动）
//   2026-10-29 用户指令（同批撤 T84 early 臂语境「触发太少了，没有啥用」）：
//   ①`(top2HolderCircPct < 55 AND top1HolderCircPct < 35) AND` 整段直接删除
//     ——两键退役为纯观察（FA 照算不进条件串；T93 top2 持有人门/T91 瘦身
//     谱系的最终退出）。
//   ②tradesNetBuyRatioShortWin >= 40 → >= 20（T96「短期开始涨」臂放宽半档；
//     LongWin >= 0 不动——「长期下跌趋势解除」语义保留）。
//   动机=买腿触发太少，整体放宽提高交易频率（同日撤 momentum/撤 early 同向）。
//   台账 T106。
//   ⚠️ copy-in 快照语义：需新建实验引用 v53（create-v64.cjs 同批）。
// 防呆：源 v52 锚定（ExSniper 恰一次/无裸 holderTrendSlope/被删两门恰一次/
//   ShortWin >= 40 恰一次）→ 换后两键零残留 / ShortWin >= 20 恰一次 /
//   LongWin >= 0 保留 / 全门锚定 / first 路由（buyPhase/maxExecutions=2）/
//   trigger 与 gmgn 不动（与源逐字一致）。
// 用法：node scripts/bump-t106-concentration-slim-shortwin20.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const NAME = 'buy-v2';
const FROM_VERSION = 52;
const DEL_SEG = 'top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND ';
const OLD_SW = 'tradesNetBuyRatioShortWin >= 40';
const NEW_SW = 'tradesNetBuyRatioShortWin >= 20';

// 源 v52 形状锚定（换前须恰一次）
const KEEPS_SRC = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  'holderTrendSlopeExSniper > 0',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  'tradesNetBuyRatioLongWin >= 0',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];

// 换后 v53 形状锚定（须恰一次）
const KEEPS_NEW = [
  '(tokenAgeSec < 90 OR tradeCount >= 25)',
  'marketCap > 4.7', 'marketCap < 27',
  '(narrativeRating == 2 OR narrativeRating == 3)',
  'holderTrendSlopeExSniper > 0',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  'tradesNetBuyRatioLongWin >= 0',
  'tradesNetBuyRatioShortWin >= 20',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];

const DESC = ' | 2026-10-29 v53（T106 主腿放宽）：①删集中度两门'
  + ' top2HolderCircPct < 55 AND top1HolderCircPct < 35（T91 瘦身/T93 换轴谱系最终退出，'
  + '两键退役纯观察 FA 照算）②tradesNetBuyRatioShortWin >= 40 → >= 20（T96 短窗净买臂'
  + '放宽半档；LongWin >= 0「长期下跌趋势解除」不动）。动机=买腿触发太少整体放宽'
  + '（用户 2026-10-29 指令，同批撤 T84 early 臂同语境）。'
  + '⚠️copy-in：需新建实验引用 v53（create-v64.cjs 同批）。'
  + '详档 docs/交易策略改进与Case台账.md T106';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  const entry = list.find((e) => e.name === NAME);
  if (!entry) throw new Error(`库中无 ${NAME} 条目`);
  if (entry.version !== FROM_VERSION) {
    throw new Error(`${NAME} version=${entry.version}，期望 ${FROM_VERSION}（先跑 bump-t105 或核对谱系）`);
  }
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`${NAME} 腿数=${legs.length}，期望 1`);
  const leg = legs[0];
  if (leg.buyPhase !== 'first') throw new Error(`${NAME} buyPhase=${JSON.stringify(leg.buyPhase)}，期望 'first'（T100 路由）`);
  if (leg.maxExecutions !== 2) throw new Error(`${NAME} maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2（T89 二次入场）`);
  if (!leg.narrativeTriggerCondition) throw new Error(`${NAME} trigger 缺失（本批不动它）`);
  if (!leg.gmgnCheckCondition) throw new Error(`${NAME} gmgn 缺失（本批不动它）`);
  if (leg.condition.split('holderTrendSlopeExSniper > 0').length !== 2) {
    throw new Error(`${NAME} 源缺 ExSniper 趋势段（源应是 v52）`);
  }
  if (leg.condition.replace(/holderTrendSlopeExSniper/g, '').includes('holderTrendSlope')) {
    throw new Error(`${NAME} 源残留裸 holderTrendSlope 字样（源应是 v52）`);
  }
  for (const seg of KEEPS_SRC) {
    if (leg.condition.split(seg).length !== 2) throw new Error(`${NAME} 源防误伤锚定子串非恰一次: ${seg}`);
  }
  if (leg.condition.split(OLD_SW).length !== 2) throw new Error(`${NAME} 源 ShortWin >= 40 非恰一次`);

  let cond = leg.condition;
  // ①删集中度两门（整段含尾随 AND）
  if (cond.split(DEL_SEG).length !== 2) throw new Error(`${NAME} 被删段（两门+尾 AND）非恰一次`);
  cond = cond.replace(DEL_SEG, '');
  // ②ShortWin 40→20
  cond = cond.split(OLD_SW).join(NEW_SW);
  if (cond.split(NEW_SW).length !== 2) throw new Error(`${NAME} 新 ShortWin >= 20 非恰一次`);
  // 残留反证：两键零出现（含一切比较形状）
  for (const k of ['top2HolderCircPct', 'top1HolderCircPct']) {
    if (cond.includes(k)) throw new Error(`${NAME} 换后残留 ${k} 字样`);
  }
  for (const seg of KEEPS_NEW) {
    if (cond.split(seg).length !== 2) throw new Error(`${NAME} 换后防误伤锚定子串非恰一次: ${seg}`);
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
