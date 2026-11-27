#!/usr/bin/env node
/**
 * T240 做市专属卖腿判臂键单测（零 DB 零网络）：
 *   boughtByPointType = 本仓买入臂 pointType（写一次，买成交点引擎标记）
 * 口径断言（2026-11-27 用户裁定「走这一臂的，一旦明显失去了做市商形态，就得卖出」）：
 *   A. markBoughtByPointType 写一次：首写生效、重复/补买不覆盖（首买臂定终身）
 *   B. 非字符串/空串 no-op（不写脏值）；未标记 → null
 *   C. buildFactorMap 发射 + getFactorKeys 探针（三防线自动认得）
 *   D. 卖腿全条件真值表（== 'market_maker_rhythm_pit' ∧ gapLe1<60 ∧ pp≤-20）
 *   E. null 语义全 fail-closed（臂/gap/pp 任一 null → 恒 false 不触发）
 *   F. 重启回填路径：setBuyState 不覆盖、markBoughtByPointType 补标后生效
 */
'use strict';
const assert = require('assert');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

const T0 = 1700000000000;
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }
const CE = new ConditionEvaluator();
const COND = "boughtByPointType == 'market_maker_rhythm_pit' AND blockGapLe1Pct64 < 60 AND profitPercent <= -20";
const evalCond = (f) => CE.evaluate(COND, f);

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

check('A. 写一次：首写生效、补买/换臂不覆盖', () => {
  const fa = newFA();
  fa.markBoughtByPointType('0xtoken', 'market_maker_rhythm_pit');
  fa.markBoughtByPointType('0xtoken', 'steady_trend_climb'); // 补买换臂 → 不覆盖
  const f = fa.buildFactorMap('0xtoken', T0 + 1000);
  assert.strictEqual(f.boughtByPointType, 'market_maker_rhythm_pit', '首买臂定终身');
});

check('B. 非字符串/空串 no-op；未标记 → null', () => {
  const fa = newFA();
  fa.markBoughtByPointType('0xtoken', 123);
  fa.markBoughtByPointType('0xtoken', '');
  fa.markBoughtByPointType('0xtoken', null);
  let f = fa.buildFactorMap('0xtoken', T0 + 1000);
  assert.strictEqual(f.boughtByPointType, null, '脏值不写');
  fa.markBoughtByPointType('0xtoken', 'market_maker_rhythm_pit');
  f = fa.buildFactorMap('0xtoken', T0 + 1000);
  assert.strictEqual(f.boughtByPointType, 'market_maker_rhythm_pit', '随后合法写生效');
});

check('C. 探针收键（getFactorKeys 自动认得——三防线同款）', () => {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  assert.ok(fa.getFactorKeys().has('boughtByPointType'), 'FA 键域含 boughtByPointType');
});

check('D. 卖腿全条件真值表（臂 ∧ gapLe1<60 ∧ pp≤-20）', () => {
  const MM = { boughtByPointType: 'market_maker_rhythm_pit', blockGapLe1Pct64: 40, profitPercent: -30 };
  assert.strictEqual(evalCond(MM), true, 'D1 三键全过 → 触发');
  assert.strictEqual(evalCond({ ...MM, blockGapLe1Pct64: 60 }), false, 'D2 gap 60 恰线 → 不触发（< 严格）');
  assert.strictEqual(evalCond({ ...MM, blockGapLe1Pct64: 59.9 }), true, 'D3 gap 59.9 → 触发');
  assert.strictEqual(evalCond({ ...MM, profitPercent: -20 }), true, 'D4 pp -20 恰线 → 触发（≤ 语义）');
  assert.strictEqual(evalCond({ ...MM, profitPercent: -19.9 }), false, 'D5 pp -19.9 → 不触发');
  assert.strictEqual(evalCond({ ...MM, profitPercent: -12 }), false, 'D6 pp -12（超级智能案值）→ 不触发=赢家洗盘停顿放行');
  assert.strictEqual(evalCond({ ...MM, boughtByPointType: 'steady_trend_climb' }), false, 'D7 非做市臂 → 惰性');
  assert.strictEqual(evalCond({ ...MM, boughtByPointType: 'normal' }), false, 'D8 normal → 惰性');
});

check('E. null 语义全 fail-closed（任一 null → 恒 false）', () => {
  const MM = { boughtByPointType: 'market_maker_rhythm_pit', blockGapLe1Pct64: 40, profitPercent: -30 };
  assert.strictEqual(evalCond({ ...MM, boughtByPointType: null }), false, 'E1 臂 null（未买/非 pointType 路径）→ 不触发');
  assert.strictEqual(evalCond({ ...MM, blockGapLe1Pct64: null }), false, 'E2 gap null（环不足 2 间隔）→ 不触发');
  assert.strictEqual(evalCond({ ...MM, profitPercent: null }), false, 'E3 pp null（无成本锚）→ 不触发');
});

check('F. 重启回填：setBuyState 不覆盖标记、补标后生效', () => {
  const fa = newFA();
  fa.setBuyState('0xtoken', { buyPriceBnb: 1e-9, buyPriceUsd: 5, buyTime: T0 + 100 });
  let f = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f.boughtByPointType, null, 'F1 setBuyState 本身不写臂');
  fa.markBoughtByPointType('0xtoken', 'market_maker_rhythm_pit'); // 恢复路径回填
  f = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f.boughtByPointType, 'market_maker_rhythm_pit', 'F2 回填生效');
});

// G. 事故反证源码锁（bt-v323 Δ=0 根因：分类只写 DB/buffer，内存 signal 未盖章 →
//    成交挂钩 markBoughtByPointType 恒 null）——两引擎必须有分类后盖章行
check('G. 源码锁：两引擎分类后盖章 signal.metadata.pointType（bt-v323 Δ=0 反证）', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['FourMemeWssTradingEngine.js', 'BacktestEngine.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', f), 'utf8');
    assert.ok(src.includes('signal.metadata.pointType = _ptInfo;'), `${f} 缺盖章行`);
  }
});

console.log(`全部通过 ${passed}/7`);
