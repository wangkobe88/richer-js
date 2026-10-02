#!/usr/bin/env node
/**
 * platform 因子 + router 平台分门单测（2026-10-02，四项回测变更配套）——零 DB 零网络。
 *
 * 背景：buy-v2 v5 preBuy 区间门 `earlyTradesRouterPct >= 50 AND < 80` 对 fourmeme
 * 恒假（four.meme 内盘不经 GMGN 聚合路由，rp 恒 0 → B1 实证 4/4 全 0.0）→ fourmeme
 * 全灭。v6 修复 = 平台分门：
 *   (platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))
 * ——fourmeme 豁免 router 门、flap 保 W2 验证语义。
 *
 * 代码链（本单测覆盖）：
 *   A. ConditionEvaluator 单引号字符串字面量（==/!= only；> < >= <= 字符串恒 false；
 *      未闭合 throw；null 语义；validateCondition 不误报；旧条件零回归）
 *   B. FA platform 键（registerToken 传入 → buildFactorMap 输出；未注册 null）
 *   C. v6 preBuy 条件语义对拍（四象限：fourmeme rp=0 放行 / flap rp<50 拦 /
 *      flap [50,80) 放行 / flap >=80 拦 + uw>=15 门 + TPA>2.5 门）
 *   D. 源码口径断言（透传链 5 处接线：回测 _registerToken/performAllChecks、
 *      实时 performAllChecks、PreBuyCheckService 三点、FA 快照白名单不含 platform）
 *
 * 运行：node scripts/_test_platform_router_gate.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const V6_PREBUY = `(narrativeRating == 2 OR narrativeRating == 3)` +
  ` AND earlyTradesTop1BuySharePct < 60 AND earlyTradesTop1BuyCovered == 1` +
  ` AND (platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))` +
  ` AND earlyTradesUniqueWallets >= 15`;

// ═══════════════ A. ConditionEvaluator 字符串字面量 ═══════════════
console.log('A. ConditionEvaluator 字符串字面量');
{
  const ev = new ConditionEvaluator();

  check('A1 parse platform != \'flap\' 得 rightString 节点', () => {
    const ast = ev.parseCondition("platform != 'flap'");
    assert.strictEqual(ast.type, 'COMPARISON');
    assert.strictEqual(ast.operator, '!=');
    assert.strictEqual(ast.left, 'platform');
    assert.strictEqual(ast.right, 'flap');
    assert.strictEqual(ast.rightString, true);
  });

  check('A2 字符串相等 ==', () => {
    assert.strictEqual(ev.evaluate("platform == 'fourmeme'", { platform: 'fourmeme' }), true);
    assert.strictEqual(ev.evaluate("platform == 'fourmeme'", { platform: 'flap' }), false);
  });

  check('A3 字符串不等 !=', () => {
    assert.strictEqual(ev.evaluate("platform != 'flap'", { platform: 'fourmeme' }), true);
    assert.strictEqual(ev.evaluate("platform != 'flap'", { platform: 'flap' }), false);
  });

  check('A4 因子值 null → 恒 false（fail-closed：分门失效落 router 门）', () => {
    assert.strictEqual(ev.evaluate("platform != 'flap'", { platform: null }), false);
    assert.strictEqual(ev.evaluate("platform != 'flap'", {}), false);
    assert.strictEqual(ev.evaluate("platform == 'flap'", {}), false);
  });

  check('A5 字符串参与数值运算符恒 false（防 JS 字典序）', () => {
    // 'flap' > 'abc' 字典序 true 但无意义——必须 false
    assert.strictEqual(ev.evaluate("platform > 'abc'", { platform: 'flap' }), false);
    assert.strictEqual(ev.evaluate("platform <= 'zzz'", { platform: 'flap' }), false);
    // 左数字右字符串（字面量）
    assert.strictEqual(ev.evaluate("age > '5'", { age: 10 }), false);
    // 左字符串因子右数字（platform 因子值参与 <）
    assert.strictEqual(ev.evaluate("platform < 5", { platform: 'flap' }), false);
  });

  check('A6 等值比较单 = 同样支持字符串', () => {
    assert.strictEqual(ev.evaluate("platform = 'flap'", { platform: 'flap' }), true);
  });

  check('A7 未闭合引号 throw', () => {
    assert.throws(() => ev.parseCondition("platform == 'flap"), /未闭合/);
  });

  check('A8 空字符串字面量可解析（值为空串）', () => {
    assert.strictEqual(ev.evaluate("platform == ''", { platform: '' }), true);
    assert.strictEqual(ev.evaluate("platform == ''", { platform: 'flap' }), false);
  });

  check('A9 validateCondition 字符串字面量不误报未知因子', () => {
    const ast = ev.parseCondition("platform != 'flap' AND age < 5");
    const v = ev.validateCondition(ast, new Set(['platform', 'age']));
    assert.deepStrictEqual(v.errors, []);
    assert.strictEqual(v.valid, true);
  });

  check('A10 validateCondition 左侧未知因子仍报（防笔误防线不撤）', () => {
    const ast = ev.parseCondition("platfrom != 'flap'");
    const v = ev.validateCondition(ast, new Set(['platform']));
    assert.ok(v.errors.some(e => e.includes('platfrom')));
  });

  check('A11 旧数字条件零回归（parse 形状/求值）', () => {
    const ast = ev.parseCondition('earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80');
    assert.strictEqual(ast.rightString, undefined); // 数字路径无标记
    assert.strictEqual(ev.evaluate(ast, { earlyTradesRouterPct: 63 }), true);
    assert.strictEqual(ev.evaluate(ast, { earlyTradesRouterPct: 90 }), false);
    assert.strictEqual(ev.evaluate(ast, { earlyTradesRouterPct: 0 }), false);
  });

  check('A12 括号 + OR/AND 组合里的字符串子句', () => {
    const cond = "(platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))";
    assert.strictEqual(ev.evaluate(cond, { platform: 'fourmeme', earlyTradesRouterPct: 0 }), true);
    assert.strictEqual(ev.evaluate(cond, { platform: 'flap', earlyTradesRouterPct: 63 }), true);
    assert.strictEqual(ev.evaluate(cond, { platform: 'flap', earlyTradesRouterPct: 90 }), false);
    assert.strictEqual(ev.evaluate(cond, { platform: 'flap', earlyTradesRouterPct: 0 }), false);
    assert.strictEqual(ev.evaluate(cond, { platform: null, earlyTradesRouterPct: 0 }), false);
  });

  check('A13 extractBuyRangeFromCondition 对含字符串子句的条件不炸（age 提取照常）', () => {
    const r = ConditionEvaluator.extractBuyRangeFromCondition(
      "age < 1.5 AND (platform != 'flap' OR earlyTradesRouterPct >= 50)");
    assert.ok(r && r.maxAgeMinutes === 1.5, JSON.stringify(r));
  });

  check('A14 evaluateWithScore 字符串叶子参与计数不炸', () => {
    const s = ev.evaluateWithScore("platform != 'flap' AND age < 5", { platform: 'fourmeme', age: 1 });
    assert.strictEqual(s, 100);
  });

  check('A15 groups 解析仍拒绝字符串右操作数（引号陷阱显式拒：\'3\'===3 恒 false）', () => {
    const { parseGroupsExpression } = require(path.join(ROOT, 'src', 'strategies', 'group-variables.js'));
    assert.throws(() => parseGroupsExpression("cycle == '3'"), /引号字符串不支持/);
    assert.throws(() => parseGroupsExpression("cycle == 'abc'"), /数字字面量/);
    // 裸数字照常通过（回归）
    const ok = parseGroupsExpression('cycle == 3');
    assert.strictEqual(ok.ast.right, '3');
  });
}

// ═══════════════ B. FA platform 键 ═══════════════
console.log('B. FA platform 键');
{
  const T0 = 1790802000000;
  const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, o);
  const newFA = () => new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });

  check('B1 registerToken 传 platform → buildFactorMap 输出', () => {
    const fa = newFA();
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'flap' });
    fa.processTick(mkTick({}), 0);
    const f = fa.buildFactorMap('0xtoken', T0 + 60000);
    assert.strictEqual(f.platform, 'flap');
  });

  check('B2 未传 platform → null（分门 fail-closed 落 router 门）', () => {
    const fa = newFA();
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    fa.processTick(mkTick({}), 0);
    const f = fa.buildFactorMap('0xtoken', T0 + 60000);
    assert.strictEqual(f.platform, null);
  });

  check('B3 fourmeme 标签原样输出', () => {
    const fa = newFA();
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    fa.processTick(mkTick({}), 0);
    assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 60000).platform, 'fourmeme');
  });

  check('B4 getFactorKeys 探针自动收 platform 键（策略条件可引用；返回 Set）', () => {
    const fa = newFA();
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'flap' });
    fa.processTick(mkTick({}), 0);
    fa.buildFactorMap('0xtoken', T0 + 60000);
    assert.ok(fa.getFactorKeys().has('platform'));
  });

  check('B5 FA platform 因子进 condition 全链（FA factors 直评 v6 分门子句）', () => {
    const fa = newFA();
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'flap' });
    fa.processTick(mkTick({}), 0);
    const f = fa.buildFactorMap('0xtoken', T0 + 60000);
    const ev = new ConditionEvaluator();
    const gate = "(platform != 'flap' OR (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80))";
    // flap 且 rp 缺失（0 缺省）→ 拦
    assert.strictEqual(ev.evaluate(gate, f), false);
    // fourmeme → 豁免放行
    const fa2 = newFA();
    fa2.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null, platform: 'fourmeme' });
    fa2.processTick(mkTick({}), 0);
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 60000);
    assert.strictEqual(ev.evaluate(gate, f2), true);
  });
}

// ═══════════════ C. v6 preBuy 条件语义对拍 ═══════════════
console.log('C. v6 preBuy 条件语义对拍（四象限 + uw/TPA 门）');
{
  const ev = new ConditionEvaluator();
  /** 模拟 preBuy 求值上下文（_evaluateWithCondition context 形状——只取 v6 引用键） */
  const ctx = (o) => Object.assign({
    narrativeRating: 2, earlyTradesTop1BuySharePct: 30, earlyTradesTop1BuyCovered: 1,
    platform: 'flap', earlyTradesRouterPct: 63, earlyTradesUniqueWallets: 20,
  }, o);

  check('C1 fourmeme + rp=0（恒 0 场景）→ 放行（v5 全灭 bug 修复点）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ platform: 'fourmeme', earlyTradesRouterPct: 0 })), true);
  });

  check('C2 flap + rp<50 → 拦（W2 语义保留）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesRouterPct: 30 })), false);
  });

  check('C3 flap + rp∈[50,80) → 放行', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesRouterPct: 50 })), true);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesRouterPct: 79.9 })), true);
  });

  check('C4 flap + rp>=80 → 拦（bot 盘）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesRouterPct: 80 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesRouterPct: 95 })), false);
  });

  check('C5 platform null → 落 router 门（fail-closed）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ platform: null, earlyTradesRouterPct: 0 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ platform: null, earlyTradesRouterPct: 63 })), true);
  });

  check('C6 uw<15 → 拦（新热度门）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ platform: 'fourmeme', earlyTradesUniqueWallets: 14 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ platform: 'flap', earlyTradesRouterPct: 63, earlyTradesUniqueWallets: 14 })), false);
  });

  check('C7 uw=15 边界 → 放行', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesUniqueWallets: 15 })), true);
  });

  check('C8 叙事门照旧（low=1 拦 / unrated=9 拦）', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ narrativeRating: 1 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ narrativeRating: 9 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ narrativeRating: 3 })), true);
  });

  check('C9 top1 门照旧', () => {
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesTop1BuySharePct: 70 })), false);
    assert.strictEqual(ev.evaluate(V6_PREBUY, ctx({ earlyTradesTop1BuyCovered: 0 })), false);
  });

  check('C10 v6 条件 condition 字符串可被 loadStrategies 消费（parse 不炸）', () => {
    const ast = ev.parseCondition(V6_PREBUY);
    assert.ok(ast.type === 'OR' || ast.type === 'AND'); // 顶层 = narrativeRating == 2 OR == 3
  });
}

// ═══════════════ D. 源码口径断言（透传链接线） ═══════════════
console.log('D. 源码口径断言（透传链 5 处接线）');
{
  check('D1 BacktestEngine._registerToken 传 platform: tick.platform（tick 行级权威，无 meta 兜底）', () => {
    const src = read('src/trading-engine/implementations/BacktestEngine.js');
    assert.ok(/platform: tick\.platform \|\| null,/.test(src), '_registerToken platform 接线缺失');
    // 注册段的 platform 必须在 FA registerToken 调用块内（不是 tokenPool.addToken 的旧字段）
    const m = src.match(/this\._factorAggregator\.registerToken\(tokenAddress, \{[\s\S]*?\}\);/);
    assert.ok(m && /platform: tick\.platform/.test(m[0]), 'platform 未进 FA registerToken');
  });

  check('D2 BacktestEngine performAllChecks options 透传 platform', () => {
    const src = read('src/trading-engine/implementations/BacktestEngine.js');
    assert.ok(/platform: token\.platform \|\| factorResults\.platform \|\| null,/.test(src));
  });

  check('D3 实时引擎 performAllChecks options 透传 platform（faState 优先）', () => {
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    assert.ok(/platform: faState\?\.platform \|\| factorResults\.platform \|\| null,/.test(src));
  });

  check('D4 PreBuyCheckService 三点接线（extraContext 透传/baseResult/context）', () => {
    const src = read('src/trading-engine/pre-check/PreBuyCheckService.js');
    assert.ok(/platform: options\.platform \?\? null,/.test(src), 'performAllChecks extraContext 缺');
    const cnt = (src.match(/platform: extraContext\.platform \?\? null,/g) || []).length;
    assert.strictEqual(cnt, 2, `baseResult+context 应各一处，实际 ${cnt}`);
  });

  check('D5 FA 快照白名单不含 platform（不落 experiment_time_series_data）', () => {
    const src = read('src/trading-engine/core/FactorBuilder.js');
    const m = src.match(/buildFactorValuesForTimeSeries[\s\S]{0,4000}?whitelist/i)
      ? null : null; // 白名单实现形态不定，直接断言 platform 不在白名单字面量里
    const wl = src.match(/buildFactorValuesForTimeSeries[\s\S]{0,6000}/);
    assert.ok(wl && !/['"]platform['"]\s*:/.test(wl[0]), 'platform 不得进时序快照白名单');
  });

  check('D6 SharedTickConsumer registerToken 已带 platform（实时链 FA state.platform 有值的前提，零改动回归）', () => {
    const src = read('src/trading-engine/core/SharedTickConsumer.js');
    assert.ok(/platform:\s*row\.platform/.test(src) || /platform:\s*info\.platform/.test(src)
      || /platform/.test(src.match(/registerToken[\s\S]{0,500}/)[0]));
  });

  check('D7 ConditionEvaluator 字符串分支（parse/evaluate 两处）', () => {
    const src = read('src/strategies/ConditionEvaluator.js');
    assert.ok(/rightString: true/.test(src));
    assert.ok(/node\.rightString === true/.test(src));
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
