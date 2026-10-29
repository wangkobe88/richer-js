#!/usr/bin/env node
// ============================================================================
// 库 T95 低市值臂 top1/top2 门放宽（buy-early-narrative v7→v8，仅早期臂）
//   背景（2026-10-29 用户裁定「低市值臂的当前 top1/top2 因子再放宽一些」；
//   同日先落 T94 占总量比例观察键攒分布，本批是 circ 口径现行门的即时放宽）：
//   - Binancians 0x04c1…7777 案：早期窗 10s 内 top1C 49.9-62.5 全因流通分母小
//     虚高，top1<35 翻真时已出窗——集中度稀释速度赶不上市值出窗速度；
//   - 3 天 492 有窗票阈值网格（tmp-top-supply-analysis 数据）：top1 是主 binder
//     （单维 35→45 新增 13 票 up 中位 32.8%）、top2 边际小（65→75 仅 1 票）；
//     组合档 t1<45 ∧ t2<75 新增 18 票 up 中位 41.6%、up≥30% 占 11/18、
//     dn 中位 -15%、pnlΣ +0.0039；再宽 t1<65 up 中位掉到 20.9%。
//   两处阈值（各 +10，T85 同节奏）：
//     『top1HolderCircPct < 35』→『top1HolderCircPct < 45』
//     『top2HolderCircPct < 65』→『top2HolderCircPct < 75』
//   主腿 buy-v2 v48 本批不动（对照臂）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v8（create-v53.cjs）。
// 防呆：断言早期臂 v7 + 两源段恰一次 → 换后旧阈值零残留 / 其余兄弟门锚定
//   （T89/T90/T93 形状）/ trigger 与 gmgn 不动 / maxExecutions===2 / buy-v2 仍在 v48。
// 用法：node scripts/bump-t95-early-arm-loosen.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const SWAPS = [
  ['top1HolderCircPct < 35', 'top1HolderCircPct < 45'],
  ['top2HolderCircPct < 65', 'top2HolderCircPct < 75'],
];
const KEEPS = [
  '(narrativeRating == 2 OR narrativeRating == 3)', 'tokenAgeSec < 600',
  'marketCap > 6.0', 'marketCap < 6.7', '(buyVolumeBnb >= 0.25 AND holders >= 5)',
  '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)',
  'top1HolderCircPct < 45', 'top2HolderCircPct < 75',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_EXPECT = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  const mainEntry = list.find((e) => e.name === 'buy-v2');
  if (!mainEntry || mainEntry.version !== 48) {
    throw new Error(`buy-v2 version=${mainEntry && mainEntry.version}，期望 48（本批不动主腿，谱系核对）`);
  }
  const entry = list.find((e) => e.name === 'buy-early-narrative');
  if (!entry) throw new Error('库中无 buy-early-narrative 条目');
  if (entry.version !== 7) throw new Error(`buy-early-narrative 版本=${entry.version}，期望 7（先核对谱系再跑）`);

  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`条目腿数=${legs.length}，期望 1`);
  const leg = legs[0];

  let cond = leg.condition;
  for (const [from, to] of SWAPS) {
    if (cond.split(from).length !== 2) throw new Error(`源段非恰好一次: ${from}`);
    cond = cond.replace(from, to);
  }
  if (cond.includes('top1HolderCircPct < 35')) throw new Error('残留旧阈值 top1 < 35');
  if (cond.includes('top2HolderCircPct < 65')) throw new Error('残留旧阈值 top2 < 65');
  for (const seg of KEEPS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }
  if (cond.includes('tradesRouterPct') || cond.includes('sybilClusterHolderCircPct') || cond.includes('platform')) {
    throw new Error('条件串残留 T93 已删键（本批只动两个阈值）');
  }
  if (leg.gmgnCheckCondition !== GMGN_EXPECT) throw new Error(`gmgn 非 T89 形状（本批不动它）: ${leg.gmgnCheckCondition}`);
  if (leg.maxExecutions !== 2) throw new Error(`maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2`);
  if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error(`发起门 trigger 形状非预期: ${leg.narrativeTriggerCondition}`);

  console.log(`\n== buy-early-narrative: v${full.version} → v${full.version + 1}`);
  console.log('new condition:', cond);
  const desc = ' | 2026-10-29 v8（T95 低市值臂 top1/top2 放宽 +10）：'
    + 'top1HolderCircPct 35→45 / top2HolderCircPct 65→75——用户裁定「低市值臂的'
    + '当前 top1/top2 因子再放宽一些」。依据=3 天 492 有窗票网格：top1 是主 binder'
    + '（早期流通分母小占比虚高，Binancians 0x04c1 案窗内 top1 49.9-62.5 从未达 35），'
    + 't1<45∧t2<75 新增 18 票 up 中位 41.6%；主腿 buy-v2 v48 不动=对照臂。'
    + '总量分母口径另走 T94 观察键攒分布。⚠️copy-in：需新建实验引用 v8。'
    + '详档 docs/交易策略改进与Case台账.md T95';
  const newDescription = (full.description || '') + desc;
  if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

  const outLegs = JSON.parse(JSON.stringify(legs));
  outLegs[0].condition = cond;
  const out = await svc.update(entry.id, {
    name: full.name,
    description: newDescription,
    legs: outLegs,
    expectedVersion: full.version,
  });
  console.log(`✅ committed version=${out.version}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
