#!/usr/bin/env node
/**
 * 策略库 validateLegs 入库校验（纯函数）——本地零 DB 零网络单测
 *
 * 背景（策略库一期 2026-09-28 + 2026-10-03 hg55 事故防线前移）：
 * validateLegs 是库条目 create/update 与库页「从实验导入」共用的单点校验。
 * 2026-10-15 cycle 分桶路由机制删除，groups 校验随机制移除——本文件承接
 * _test_strategy_library_groups.cjs 的 condition/side 校验部分（原 G 段）。
 *
 * 覆盖：
 *   A. 合法腿集合（全部条件字段合法形态：condition/narrativeCall/preBuy/repeat/gmgn）
 *   B. 形状校验（side 非法 / 空数组 / 非数组 / 腿非对象 / 缺 condition / 空串）
 *   C. 条件未知因子拦截（condition·narrativeCall=FA 集 / preBuy 系=PreBuy 集 /
 *      gmgn=GMGN 集——分集防双向误报）
 *   D. 语法错误拦截（parseCondition throw → 腿非法）
 *   E. side 与腿字段错配放行（引擎「携带不生效」语义）
 *
 * 用法：node scripts/_test_strategy_library_validate_legs.cjs
 */
'use strict';

const { validateLegs } = require('../src/web/services/StrategyLibraryService');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// 真键（与生产条件同款）：FA=profitPercent / PreBuy=narrativeRating / GMGN=gmgnRiskCovered
check('前置：preBuy 键集含 narrativeRating（键集捕获健康）',
  PreBuyCheckService.getConditionFactorKeys().includes('narrativeRating'), true);

// ═══ A. 合法腿集合 ═══
console.log('A. 合法腿集合');
{
  const r = validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1 },
    { condition: 'profitPercent >= 60 OR profitPercent IS NULL', cards: 'all' },
  ]);
  check('合法卖腿集合（含 cards）', r, { valid: true, errors: [] });

  const rb = validateLegs('buy', [{
    condition: 'profitPercent >= 20',
    narrativeCallCondition: 'profitPercent >= 10',
    preBuyCheckCondition: 'narrativeRating == 2 OR narrativeRating == 3',
    repeatBuyCheckCondition: 'narrativeRating == 9',
    gmgnCheckCondition: 'gmgnRiskCovered == 1',
  }]);
  check('合法买腿集合（全部条件字段）', rb.valid, true);
}

// ═══ B. 形状校验 ═══
console.log('B. 形状校验');
{
  check('side 非法拒', validateLegs('hold', [{ condition: 'profitPercent > 1' }]).errors[0]
    .includes('side'), true);
  check('空腿集合拒', validateLegs('buy', []).valid, false);
  check('非数组拒', validateLegs('buy', null).valid, false);
  check('腿非对象拒（带腿序号）', validateLegs('buy', [null]).errors[0], '腿[0]必须是对象');
  check('缺 condition 拒', validateLegs('sell', [{ priority: 1 }]).errors[0], '腿[0]缺少 condition');
  check('condition 空串拒', validateLegs('sell', [{ condition: '  ' }]).valid, false);
  check('多错误聚合（两腿各一错）', validateLegs('sell', [
    { priority: 1, cards: 1 }, { condition: '  ', cards: 1 },
  ]).errors.length, 2);
}

// ═══ C. 条件未知因子拦截（分集）═══
console.log('C. 未知因子拦截（hg55 事故防线：写错因子名入库前 400）');
{
  check('condition 未知因子拒（带字段名）', validateLegs('sell', [
    { condition: 'zzFakeFactor >= 1' },
  ]).errors.some(e => e.includes('condition') && e.includes('zzFakeFactor')), true);
  check('narrativeCallCondition 未知因子拒（FA 集）', validateLegs('buy', [
    { condition: 'profitPercent > 1', narrativeCallCondition: 'zzFakeFactor >= 1' },
  ]).errors.some(e => e.includes('narrativeCallCondition')), true);
  check('preBuyCheckCondition 未知因子拒（PreBuy 集）', validateLegs('buy', [
    { condition: 'profitPercent > 1', preBuyCheckCondition: 'zzFakePreBuyKey >= 1' },
  ]).errors.some(e => e.includes('preBuyCheckCondition')), true);
  check('repeatBuyCheckCondition 未知因子拒', validateLegs('buy', [
    { condition: 'profitPercent > 1', repeatBuyCheckCondition: 'zzFakePreBuyKey >= 1' },
  ]).errors.some(e => e.includes('repeatBuyCheckCondition')), true);
  check('gmgnCheckCondition 未知因子拒（GMGN 四键集）', validateLegs('buy', [
    { condition: 'profitPercent > 1', gmgnCheckCondition: 'zzFakeGmgnKey >= 1' },
  ]).errors.some(e => e.includes('gmgnCheckCondition')), true);
  check('preBuy 真键在 preBuy 字段放行（分集不误报）', validateLegs('buy', [
    { condition: 'profitPercent > 1', preBuyCheckCondition: 'narrativeRating == 3' },
  ]).valid, true);
  check('gmgn 真键在 gmgn 字段放行', validateLegs('buy', [
    { condition: 'profitPercent > 1', gmgnCheckCondition: 'gmgnBundlerWalletRatio <= 75' },
  ]).valid, true);
}

// ═══ D. 语法错误拦截 ═══
console.log('D. 语法错误拦截');
{
  check('condition 语法错拒', validateLegs('sell', [
    { condition: 'profitPercent >= ' },
  ]).errors.some(e => e.includes('语法错误')), true);
  check('preBuy 字段语法错拒', validateLegs('buy', [
    { condition: 'profitPercent > 1', preBuyCheckCondition: 'narrativeRating ==' },
  ]).errors.some(e => e.includes('语法错误')), true);
}

// ═══ E. side 与腿字段错配放行 ═══
console.log('E. 错配放行（引擎「携带不生效」语义）');
{
  check('买腿带卖侧字段放行', validateLegs('buy', [
    { condition: 'profitPercent >= 20', sellPercentage: 0.5, bypassDebounce: true },
  ]).valid, true);
  check('卖腿带买侧字段放行', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1, preBuyCheckCondition: 'narrativeRating == 2' },
  ]).valid, true);
}

// ═══ F. groups 字段不再校验（cycle 分桶路由 2026-10-15 删除） ═══
console.log('F. groups 字段不再报错（存量库条目须能重新保存）');
{
  check('腿带任意 groups 字符串放行（不再解析校验）', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1, groups: 'cycle==3' },
  ]).valid, true);
  check('腿带非法形态 groups 也放行（解析器已删，入库层零耦合）', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1, groups: 'not_a_var == 1' },
  ]).valid, true);
  check('腿带 cycle 数字字段放行（legacy 字段透传由引擎 fail-fast 管）', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1, cycle: 3 },
  ]).valid, true);
}

// ═══ G. 卖腿 sizing 退役（2026-10-24：sellPercentage 退役，cards 唯一表达）═══
console.log('G. 卖腿 sizing 退役（sellPercentage 拒 / cards 必配）');
{
  check('卖腿携带 sellPercentage 拒（与引擎 loadStrategies 拒启同口径）', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1, sellPercentage: 0.5 },
  ]).errors.some(e => e.includes('sellPercentage')), true);
  check('卖腿缺 cards 拒（执行侧退化为全清=腿语义不完整）', validateLegs('sell', [
    { condition: 'profitPercent >= 20' },
  ]).errors.some(e => e.includes('cards')), true);
  check("卖腿 cards='all' 合法", validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 'all' },
  ]).valid, true);
  check('卖腿 cards 整数 ≥1 合法', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 2 },
  ]).valid, true);
  check('卖腿 cards 小数拒', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 1.5 },
  ]).valid, false);
  check('卖腿 cards 0 拒', validateLegs('sell', [
    { condition: 'profitPercent >= 20', cards: 0 },
  ]).valid, false);
  check('买腿不要求 cards（买入 sizing=perCardBNB×cards 缺省 1 卡）', validateLegs('buy', [
    { condition: 'profitPercent >= 20' },
  ]).valid, true);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
