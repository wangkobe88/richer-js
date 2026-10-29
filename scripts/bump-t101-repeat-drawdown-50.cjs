#!/usr/bin/env node
// ============================================================================
// 库 T101 再买臂加「从最高点下跌超过 50%」门（buy-v2-repeat v1→v2）
//   2026-10-29 用户指令「再次买入的条件，增加一个从最高点下跌超过 50%」：
//   drawdownFromHighest < -50 与既有崩盘接刀门 drawdownFromHighest > -70 合并成
//   区间 ( -70, -50 ) —— 再买轮只在「腰斩但未崩穿 -70」段可见（抄底形状门，
//   首买臂 buy-v2 / early 臂不动）。drawdownFromHighest=当前价相对全时最高价
//   （任意接受价轨）回撤 %，清仓后再买轮无持仓也可评估（非 position 域键）；
//   无最高价时=0 有证据零值 → < -50 恒 false=fail-closed（合理：没见过正价
//   谈不上回撤）。
//   ⚠️ copy-in 快照语义：需新建实验引用 v2（create-v6x.cjs）。
// 防呆：源段恰一次 → 换后新区间段恰一次 / T100 移植全门锚定 / repeat 路由
//   （buyPhase/maxExecutions=1）/ trigger 与 gmgn（T100 删 issuer 臂形状）不动。
// 用法：node scripts/bump-t101-repeat-drawdown-50.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const NAME = 'buy-v2-repeat';
const FROM_VERSION = 1;
const OLD_SEG = 'drawdownFromHighest > -70';
const NEW_SEG = '(drawdownFromHighest > -70 AND drawdownFromHighest < -50)';

// T100 移植的全门锚定（拆新段后仍须恰一次；新段含 OLD_SEG 子串故先拆后检）
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

const DESC = ' | 2026-10-29 v2（T101 再买臂腰斩门）：drawdownFromHighest 加下界 < -50'
  + '——与既有 > -70 合并成区间 (-70,-50)：再买轮只在「从最高点跌超 50% 但未崩穿 -70」段可见'
  + '（用户裁定再买=深回调抄底形状，非趋势中继；首买/early 臂不动）。'
  + 'drawdownFromHighest=当前价相对全时最高价回撤 %（任意接受价轨，清仓后再买轮可评估；'
  + '无最高价=0 → 恒 false fail-closed）。⚠️copy-in：需新建实验引用 v2。'
  + '详档 docs/交易策略改进与Case台账.md T101';

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
  if (cond.split(OLD_SEG).length !== 2) throw new Error(`${NAME} 源回撤段非恰一次`);
  cond = cond.replace(OLD_SEG, NEW_SEG);
  if (cond.split(NEW_SEG).length !== 2) throw new Error(`${NAME} 新区间段非恰一次`);
  // 新段含 OLD_SEG 子串：拆出后数剩余出现次数（应恰一次=只在新区间内）
  const rest = cond.split(NEW_SEG).join('');
  if (rest.includes(OLD_SEG)) throw new Error(`${NAME} 新区间段外残留裸 -70 段`);
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
