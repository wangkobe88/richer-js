#!/usr/bin/env node
// ============================================================================
// 库 T102 低评级强势独立买入臂：新建 buy-v2-momentum v1（整腿复制 buy-v2 v51，
//   四处差异——①评级门换向 (narrativeRating == 2 OR == 3) → narrativeRating == 1
//   ②加动量门 buyWallets >= 40 ③加快窗上限 tokenAgeSec < 600 ④maxExecutions 2→1）。
//   2026-10-29 Ragu 0xf1dc…7777 案（flap，@AnaMariaNicoar4「| BNB Chain」蓝V 875 粉
//   gm 狗推→rating=1 被 web3FitMassBlock 品味否决拦；用户重申目标函数=快速交易
//   「增长用户带来+非作弊+峰值高就行」裁定独立放行臂）。7 天全量回放（8415 票
//   逐 tick 因子重放，182 跑）：rating==1 过全部门后 buyW>=40 ∧ age<600 子集
//   134 fire，峰30min ≥3x 13% / ≥2x 31% / <1.2x 28%，与 rating 2|3 对照组
//   （13%/27%/34%）同质——叙事质量否决在这些因子门上无可测分选力；
//   buyWallets 门在新鲜票内分选力真实（无门 21% ≥2x → 40 门 31%）；
//   age>600 老票 fire 劣质（<1.2x 占 50%）多为回放工件，上限拦掉。
//   动机/裁定/回放数字详档 docs/交易策略改进与Case台账.md T102。
//   防呆：源恰 v51 / 腿数 1 / buyPhase='first' / trigger+gmgn 全串锚定（v51 形状
//   含 issuer 臂——首买时点 GMGN 计数干净，T100 裁定保留） / 评级门段恰一次
//   → 换后恰一次 / 新段 buyWallets·tokenAgeSec<600 恰一次 / 其余门逐字锚定 /
//   新条目重名预检（幂等防重）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v1（create-v6x.cjs）。
// 用法：node scripts/create-buy-v2-momentum.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const FROM_VERSION = 51;
const NEW_NAME = 'buy-v2-momentum';
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';
const GMGN_V51 = "(marketCap < 10.7 OR gmgnBundlerWalletRatio <= 100) AND ((narrativeCategory IS NULL OR (narrativeCategory != 'project' AND narrativeCategory != 'account_based_meme' AND narrativeCategory != 'web3_native_ip_early')) OR gmgnIssuerTokenCount <= 1)";
const OLD_RATING = '(narrativeRating == 2 OR narrativeRating == 3)';
const NEW_RATING = 'narrativeRating == 1';
// 评级门后紧跟动量门；快窗上限插在头部子句后（AND 链位置无关语义，取可读位）
const INSERT_AFTER_HEAD = '(tokenAgeSec < 90 OR tradeCount >= 25) AND ';
const KEEPS = [
  'marketCap > 4.7', 'marketCap < 27',
  'holderTrendSlope > 0',
  'top2HolderCircPct < 55', 'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
  '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
  '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
  'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10',
];

const DESC = '买腿 v1（2026-10-29 T102 低评级强势独立臂）：整腿复制 buy-v2 v51，四处差异——'
  + '①评级门换向 narrativeRating == 1（评级=low 但因子门全过的强势票专用；与主臂 rating 2|3 互斥'
  + '零同票竞争）②加动量门 buyWallets >= 40（K 组全史买家数，T76 键——「用户带来的增长」判据载体：'
  + '7 天回放新鲜票内 21%→31% ≥2x 分选力）③加快窗上限 tokenAgeSec < 600（快打窗口；拦 age>600 劣质'
  + '老票 fire——<1.2x 占 50%）④maxExecutions 2→1（快打一枪）。其余门（集中度/跟单/净买/崩盘/'
  + 'GMGN 含 issuer 分档臂）逐字不动=作弊票防线不变。案由 Ragu 0xf1dc…7777（BNB Chain 员工蓝V gm 狗推，'
  + 'rating=1 被 web3FitMassBlock 品味否决，61s 6.7x、71 钱包/60s top1 8% 净买+51%——干净用户盘被拦）；'
  + '回放 8415 票（182 跑）：本臂形状 134 fire 峰30min ≥3x 13%/≥2x 31%，与 rating 2|3 对照同质'
  + '——质量否决在因子门之上无可测增量。用户裁定 2026-10-29：快速交易目标函数=非作弊+用户增长+峰值高。'
  + '⚠️copy-in：需新建实验引用 v1。详档 docs/交易策略改进与Case台账.md T102';

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  const entry = list.find((e) => e.name === 'buy-v2');
  if (!entry) throw new Error('库中无 buy-v2 条目');
  if (entry.version !== FROM_VERSION) throw new Error(`buy-v2 version=${entry.version}，期望 ${FROM_VERSION}（先核对谱系再跑）`);
  const dup = list.find((e) => e.name === NEW_NAME);
  if (dup) throw new Error(`${NEW_NAME} 已存在（id=${dup.id} version=${dup.version}）——本脚本只建一次，勿重跑`);
  const full = await svc.getById(entry.id);
  const legs = full.legs.legs || full.legs;
  if (legs.length !== 1) throw new Error(`buy-v2 腿数=${legs.length}，期望 1`);
  const leg = legs[0];
  if (leg.buyPhase !== 'first') throw new Error(`buy-v2 buyPhase=${JSON.stringify(leg.buyPhase)}，期望 'first'（v51 形状）`);
  if (leg.gmgnCheckCondition !== GMGN_V51) throw new Error('buy-v2 gmgn 非 v51 形状');
  if (leg.narrativeTriggerCondition !== TRIGGER_EXPECT) throw new Error('buy-v2 trigger 形状非预期');
  if (leg.maxExecutions !== 2) throw new Error(`buy-v2 maxExecutions=${JSON.stringify(leg.maxExecutions)}，期望 2`);
  if (leg.priority !== 1) throw new Error(`buy-v2 priority=${JSON.stringify(leg.priority)}，期望 1`);
  if (leg.cards !== 3) throw new Error(`buy-v2 cards=${JSON.stringify(leg.cards)}，期望 3`);

  // condition 三步换：评级门换向 + 动量门 + 快窗上限
  let cond = String(leg.condition);
  if (cond.split(OLD_RATING).length !== 2) throw new Error('评级门段非恰一次');
  cond = cond.replace(OLD_RATING, `${NEW_RATING} AND buyWallets >= 40`);
  if (cond.split(NEW_RATING).length !== 2) throw new Error('换向后 rating==1 段非恰一次');
  if (cond.split('buyWallets >= 40').length !== 2) throw new Error('动量门段非恰一次');
  if (cond.split(INSERT_AFTER_HEAD).length !== 2) throw new Error('头部子句锚定非恰一次');
  cond = cond.replace(INSERT_AFTER_HEAD, `${INSERT_AFTER_HEAD}tokenAgeSec < 600 AND `);
  if (cond.split('tokenAgeSec < 600').length !== 2) throw new Error('快窗上限段非恰一次');
  for (const seg of KEEPS) {
    if (cond.split(seg).length !== 2) throw new Error(`防误伤锚定子串非恰一次: ${seg}`);
  }

  const newLeg = JSON.parse(JSON.stringify(leg));
  newLeg.condition = cond;
  newLeg.maxExecutions = 1;
  // buyPhase 保持 'first'（首买专用；rating-1 票的再入场不在本臂职责，T101 repeat 臂
  // rating 2|3 门天然不管它——观察点）；priority/cards/trigger/gmgn 全不动
  newLeg.description = DESC;

  console.log('== 新建 buy-v2-momentum v1（side=buy，单腿）');
  console.log('  condition:', cond);
  console.log('  maxExecutions:', newLeg.maxExecutions, '| buyPhase:', newLeg.buyPhase, '| priority:', newLeg.priority, '| cards:', newLeg.cards);

  if (COMMIT) {
    const created = await svc.create({ name: NEW_NAME, description: DESC, side: 'buy', legs: [newLeg] });
    console.log(`✅ committed ${NEW_NAME} v${created.version} (id=${created.id})`);
  } else {
    console.log('\n[dry-run] 未落库');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
