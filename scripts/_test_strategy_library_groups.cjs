#!/usr/bin/env node
/**
 * 策略库 + 组路由泛化（groups 表达式）——本地零 DB 单测
 *
 * 背景（2026-09-28 策略库一期）：strategy.cycle 数字标注泛化为 groups 表达式
 * （'cycle==3'），loadStrategies 单点转换 + evaluate 对 token 标签上下文求值；
 * 求值复用 ConditionEvaluator（AND/OR/六操作符），为二期多维组铺路。
 *
 * 覆盖：
 *   A. cycle→groups 转换矩阵（normalizeGroups：优先级/脏 cycle）
 *   B. parseGroupsExpression 脏值矩阵（IS NULL 系/未知变量/右操作数非数字 throw；
 *      合法形态：等值/不等/范围/OR/括号）
 *   C. evaluate 过滤矩阵扩展（!=/范围/OR 并集/null 全隐/无 groups 恒可见）
 *   D. v1⇔v2 等价性（关键回归）：cycle∈{1,2,3} × cycleTag∈{1,2,3,null} 全积，
 *      {cycle:N} 腿与 {groups:'cycle==N'} 腿 evaluate 逐一相等——存量零变化机器证明
 *   E. 无 groups/cycle 配置 → 恒可见（旧语义）
 *   F. maxExecutions / 桶切换计数保留（v1 E 段形态改 groups 腿重跑）
 *   G. validateLegs（库页入库校验：缺 condition 拒/groups 脏拒带腿序号/side 错配放行）
 *
 * 用法：node scripts/_test_strategy_library_groups.cjs
 */
'use strict';

const { StrategyEngine } = require('../src/strategies/StrategyEngine');
const {
  GROUP_VARIABLES, normalizeGroups, parseGroupsExpression, buildTagContext,
} = require('../src/strategies/group-variables');
const { validateLegs } = require('../src/web/services/StrategyLibraryService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function checkThrows(name, fn, msgIncludes) {
  try {
    fn();
    fail++; console.log(`  ✗ ${name}\n    期望 throw 含 "${msgIncludes}"，实际未抛`);
  } catch (e) {
    if (String(e.message).includes(msgIncludes)) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}\n    期望 throw 含 "${msgIncludes}"，实际 "${e.message}"`); }
  }
}

const factorIds = new Set(['tradeCount']);
const leg = (id, extra = {}) => ({
  id, name: `策略${id}`, action: 'sell', condition: 'tradeCount >= 0', priority: 5, ...extra,
});

// ═══ A. cycle→groups 转换矩阵 ═══
console.log('A. normalizeGroups（groups 优先 > cycle∈{1,2,3} 转换 > null）');
{
  check('groups 非空串直用', normalizeGroups({ groups: 'cycle==3' }), 'cycle==3');
  check('groups 带空格 trim', normalizeGroups({ groups: '  cycle == 2  ' }), 'cycle == 2');
  check('groups 空串 → 落到 cycle 分支', normalizeGroups({ groups: '', cycle: 1 }), 'cycle==1');
  check('groups 与 cycle 并存 → groups 优先', normalizeGroups({ groups: 'cycle!=3', cycle: 1 }), 'cycle!=3');
  check('groups 非字符串（数字）→ 落到 cycle 分支', normalizeGroups({ groups: 3, cycle: 2 }), 'cycle==2');
  check('cycle 3 → cycle==3', normalizeGroups({ cycle: 3 }), 'cycle==3');
  check("cycle '3' 字符串 → null（v1 脏值语义保持）", normalizeGroups({ cycle: '3' }), null);
  check('cycle 4 越界 → null', normalizeGroups({ cycle: 4 }), null);
  check('cycle 1.5 小数 → null', normalizeGroups({ cycle: 1.5 }), null);
  check('未配 → null', normalizeGroups({}), null);
}

// ═══ B. parseGroupsExpression 脏值矩阵 ═══
console.log('B. parseGroupsExpression（AST 级限制校验）');
{
  // 合法形态
  check('等值', parseGroupsExpression('cycle==2').expression, 'cycle==2');
  check('单等号形态', parseGroupsExpression('cycle=1').expression, 'cycle=1');
  check('不等', parseGroupsExpression('cycle!=3').expression, 'cycle!=3');
  check('范围 >=', parseGroupsExpression('cycle>=2').expression, 'cycle>=2');
  check('OR 并集', parseGroupsExpression('cycle==1 OR cycle==3').vars, ['cycle']);
  check('括号复合', parseGroupsExpression('(cycle==1 OR cycle==3) AND cycle!=2').expression,
    '(cycle==1 OR cycle==3) AND cycle!=2');
  check('负数右值', parseGroupsExpression('cycle > -1').expression, 'cycle > -1');

  // throw 形态
  checkThrows('IS NULL 拒绝（null 逃生口）', () => parseGroupsExpression('cycle IS NULL'), 'IS NULL');
  checkThrows('IS NOT NULL 拒绝', () => parseGroupsExpression('cycle IS NOT NULL'), 'IS NOT NULL');
  checkThrows('未知变量', () => parseGroupsExpression('tokenCategory==2'), '组变量');
  checkThrows('左操作数数字', () => parseGroupsExpression('3==cycle'), '左操作数');
  checkThrows('右操作数变量（变量对变量）', () => parseGroupsExpression('cycle==tokenCategory'), '右操作数');
  checkThrows('右操作数字母尾巴', () => parseGroupsExpression('cycle==3abc'), '右操作数');
  checkThrows('语法错（缺右操作数）', () => parseGroupsExpression('cycle=='), '右操作数');
  checkThrows('语法错（缺运算符）', () => parseGroupsExpression('cycle 3'), '比较运算符');
  checkThrows('空串', () => parseGroupsExpression('  '), '非空字符串');
  checkThrows('非字符串', () => parseGroupsExpression(3), '非空字符串');

  // 注册表
  check('注册表一期单变量 cycle', Object.keys(GROUP_VARIABLES), ['cycle']);
}

// ═══ C. evaluate 过滤矩阵扩展 ═══
console.log('C. evaluate groups 过滤（!= / 范围 / OR / null fail-closed）');
{
  const mk = (legsCfg) => {
    const se = new StrategyEngine();
    se.loadStrategies(legsCfg, factorIds);
    return se;
  };
  const factors = { tradeCount: 5 };
  const legs = [
    leg('not3', { groups: 'cycle!=3', priority: 1 }),
    leg('ge2', { groups: 'cycle>=2', priority: 2 }),
    leg('or13', { groups: 'cycle==1 OR cycle==3', priority: 3 }),
    leg('plain', { priority: 9 }),
  ];
  // evaluate 返回首个触发（priority 升序）：not3(1) > ge2(2) > or13(3) > plain(9)
  check('cycleTag=1 → not3 可见且最高优', mk(legs).evaluate(factors, '0xa', 1, { cycleTag: 1 }, 'sell').id, 'not3');
  check('cycleTag=2 → not3/ge2 可见，ge2 更高…（not3 priority 1 也可见）',
    mk(legs).evaluate(factors, '0xa', 1, { cycleTag: 2 }, 'sell').id, 'not3');
  check('cycleTag=3 → not3 隐，ge2 可见', mk(legs).evaluate(factors, '0xa', 1, { cycleTag: 3 }, 'sell').id, 'ge2');
  check('cycleTag=null → 带 groups 腿全隐（fail-closed）→ plain 顶上',
    mk(legs).evaluate(factors, '0xa', 1, { cycleTag: null }, 'sell').id, 'plain');
  check('tokenData 缺失 → 同 null 语义', mk(legs).evaluate(factors, '0xa', 1, null, 'sell').id, 'plain');

  // OR 并集排除中间档：cycleTag=2 时 or13 隐（1∪3 不含 2）
  const legs2 = [leg('or13', { groups: 'cycle==1 OR cycle==3', priority: 1 }), leg('plain', { priority: 9 })];
  check('OR 并集：tag=2 → or13 隐', mk(legs2).evaluate(factors, '0xa', 1, { cycleTag: 2 }, 'sell').id, 'plain');
  check('OR 并集：tag=3 → or13 可见', mk(legs2).evaluate(factors, '0xa', 1, { cycleTag: 3 }, 'sell').id, 'or13');
}

// ═══ D. v1⇔v2 等价性（关键回归：cycle 数字 vs groups 表达式全积）═══
console.log('D. v1⇔v2 全积等价（{cycle:N} 腿 ≡ {groups:"cycle==N"} 腿）');
{
  const tags = [1, 2, 3, null];
  let allEqual = true;
  const mismatches = [];
  for (const n of [1, 2, 3]) {
    for (const tag of tags) {
      const v1 = new StrategyEngine();
      v1.loadStrategies([leg(`s_${n}_${tag}`, { cycle: n, priority: 1 }), leg('plain', { priority: 9 })], factorIds);
      const v2 = new StrategyEngine();
      v2.loadStrategies([leg(`s_${n}_${tag}`, { groups: `cycle==${n}`, priority: 1 }), leg('plain', { priority: 9 })], factorIds);
      const r1 = v1.evaluate({ tradeCount: 5 }, '0xa', 1, { cycleTag: tag }, 'sell');
      const r2 = v2.evaluate({ tradeCount: 5 }, '0xa', 1, { cycleTag: tag }, 'sell');
      const hit1 = r1 ? r1.id : null, hit2 = r2 ? r2.id : null;
      const expect = tag === n ? `s_${n}_${tag}` : 'plain';
      if (hit1 !== expect || hit2 !== expect) {
        allEqual = false;
        mismatches.push(`cycle=${n},tag=${tag}: v1=${hit1} v2=${hit2} expect=${expect}`);
      }
    }
  }
  check(`3×4 全积逐一相等（12 组合）`, [allEqual, mismatches], [true, []]);
}

// ═══ E. 无 groups/cycle 配置 → 恒可见 ═══
console.log('E. 无 groups/cycle 配置（存量零变化）');
{
  const se = new StrategyEngine();
  se.loadStrategies([leg('only', {})], factorIds);
  check('无标注腿 cycleTag=null 可见', se.evaluate({ tradeCount: 5 }, '0xa', 1, { cycleTag: null }, 'sell').id, 'only');
  check('无标注腿 tokenData=null 可见', se.evaluate({ tradeCount: 5 }, '0xa', 1, null, 'sell').id, 'only');
  check('脏 cycle（字符串）腿也恒可见', (() => {
    const se2 = new StrategyEngine();
    se2.loadStrategies([leg('dirty', { cycle: '3' })], factorIds);
    return se2.evaluate({ tradeCount: 5 }, '0xa', 1, { cycleTag: null }, 'sell').id;
  })(), 'dirty');
}

// ═══ F. maxExecutions / 桶切换计数保留（groups 腿）═══
console.log('F. 桶切换 → strategyExecutions 计数保留');
{
  const se = new StrategyEngine();
  se.loadStrategies([
    leg('hot1', { groups: 'cycle==3', priority: 1, maxExecutions: 2 }),
    leg('cold1', { groups: 'cycle==1', priority: 1 }),
    leg('plain', { priority: 9 }),
  ], factorIds);
  const factors = { tradeCount: 5 };
  const td = { cycleTag: 3, strategyExecutions: { hot1: { count: 2 } } };
  check('热桶：hot1 计数满 2/2 → 被挡，兜底腿顶上', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'plain');
  td.cycleTag = 1; // 切冷桶
  check('切冷桶 → cold1 可见', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'cold1');
  td.cycleTag = 3; // 切回热桶
  check('切回热桶 → hot1 计数保留仍被挡', se.evaluate(factors, '0xa', 1, td, 'sell').id, 'plain');

  // cooldown 同构：冷却中的 groups 腿被跳过 → 低优顶上
  const se2 = new StrategyEngine();
  se2.loadStrategies([
    leg('hotCd', { groups: 'cycle==3', priority: 1, cooldownSec: 600 }),
    leg('plain', { priority: 9 }),
  ], factorIds);
  const now = Date.now();
  const td2 = { cycleTag: 3, strategyExecutions: { hotCd: { count: 1, lastExecuted: now - 60 * 1000 } } };
  check('冷却中 groups 腿跳过 → 无标注腿顶上', se2.evaluate(factors, '0xa', now, td2, 'sell').id, 'plain');
}

// ═══ G. validateLegs（库页入库校验）═══
console.log('G. validateLegs（库是 groups 第一编辑面）');
{
  check('合法腿集合', validateLegs('sell', [
    { condition: 'profitPercent >= 20', groups: 'cycle==2', cards: 1 },
    { condition: 'profitPercent >= 60' },
  ]).valid, true);
  check('side 非法', validateLegs('hold', [{ condition: 'a > 1' }]).valid, false);
  check('空腿集合', validateLegs('buy', []).valid, false);
  check('非数组', validateLegs('buy', null).valid, false);
  check('缺 condition 拒', validateLegs('sell', [{ priority: 1 }]).errors[0], '腿[0]缺少 condition');
  check('condition 空串拒', validateLegs('sell', [{ condition: '  ' }]).valid, false);
  check('groups 脏值拒且带腿序号', validateLegs('sell', [
    { condition: 'a > 1' }, { condition: 'b > 1', groups: 'cycle==9x' },
  ]).errors.some(e => e.startsWith('腿[1]')), true);
  check('groups IS NULL 拒', validateLegs('sell', [{ condition: 'a > 1', groups: 'cycle IS NULL' }]).valid, false);
  check('side 与腿字段错配放行（引擎携带不生效）', validateLegs('buy', [
    { condition: 'a > 1', sellPercentage: 0.5, bypassDebounce: true },
  ]).valid, true);
  check('多错误聚合', validateLegs('sell', [{ priority: 1 }, { condition: 'a>1', groups: 'xx==1' }]).errors.length, 2);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
