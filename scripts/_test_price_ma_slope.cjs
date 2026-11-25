#!/usr/bin/env node
/**
 * T239 priceMa60SlopePct 单测（零 DB 零网络）：持续趋势类型主键（2026-11-25
 * 用户方法「价格均值回归线往上，拒绝太陡峭也拒绝太平」——MA60 均线 60s 地平线
 * 涨跌 %，校准带 [5,60]）。
 * 口径断言：
 *   A. 精确值：现窗 (末ts-60,末ts] / 前窗 (末ts-120,末ts-60] 各自均值之比
 *   B. 窗边界：恰 ts-60000 归前窗（≤）；略晚归现窗（>）
 *   C. 前窗空/序列空 → null fail-closed（条件串裸比较恒 false 恒不命中）
 *   D. outlier/尘/chainLate 不进原料（可靠价链语义——与 chg 族同源）
 *   E. cutoff 基准=序列末 ts（断流票斜率冻结=无新证据不冒充「趋势还在走」）
 *   F. 探针收键（三防线自动认得）
 */
'use strict';
const assert = require('assert');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

const T0 = 1700000000000;
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

function newFA(factorParams) {
  const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
  const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
let seq = 0;
function mkTick(o) {
  return Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
    price_bnb: 1e-9, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: ++seq, log_index: 0, timestamp: T0,
  }, o);
}

console.log('A. 精确值与窗语义');
{
  const fa = newFA();
  // 前窗 (末-120, 末-60]：ts=10/20/30 价 1.0/1.1/1.2 → 均值 1.1
  fa.processTick(mkTick({ timestamp: T0 + 10000, price_bnb: 1.0e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 20000, price_bnb: 1.1e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 1.2e-9 }));
  // 现窗 (末-60, 末]：ts=70/80/90 价 1.5/1.6/1.7 → 均值 1.6
  fa.processTick(mkTick({ timestamp: T0 + 70000, price_bnb: 1.5e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 80000, price_bnb: 1.6e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 1.7e-9 }));
  const f = fa.buildFactorMap('0xtoken', T0 + 90000);
  check('A1 精确值 (1.6/1.1-1)*100=45.45', () => assert.strictEqual(f.priceMa60SlopePct, 45.45));
  // cutoff 基准=序列末 ts（非调用方 now）——断流票冻结
  const f2 = fa.buildFactorMap('0xtoken', T0 + 990000);
  check('A2 断流冻结：now 推进 15min 键值不变（序列末 ts 基准）', () => assert.strictEqual(f2.priceMa60SlopePct, 45.45));
}
console.log('B. 窗边界（半开闭）');
{
  // 末 ts=90s：恰 ts-60000=30s 归前窗（<=）；略晚归现窗（>）
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 2.0e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 1.0e-9 }));
  const f = fa.buildFactorMap('0xtoken', T0 + 90000);
  check('B1 恰 ts-60000 归前窗（≤）：现窗={ts90 价1}、前窗={ts30 价2} → (1/2-1)*100 = -50', () => assert.strictEqual(f.priceMa60SlopePct, -50));
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 30100, price_bnb: 2.0e-9 }));
  fa2.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 1.0e-9 }));
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 90000);
  check('B2 略晚 ts-60000 归现窗：现窗=(1+2)/2 → (1.5/…前窗空) → null fail-closed', () => assert.strictEqual(f2.priceMa60SlopePct, null));
}
console.log('C. null fail-closed 语义');
{
  const fa = newFA();
  check('C1 零 tick → null', () => {
    const f = fa.buildFactorMap('0xtoken', T0 + 1000);
    assert.strictEqual(f.priceMa60SlopePct, null);
  });
  // 只有现窗 tick（前窗空）→ null
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 10000, price_bnb: 1.0e-9 }));
  fa2.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 1.1e-9 }));
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 30000);
  check('C2 前窗空（序列跨度 <60s）→ null', () => assert.strictEqual(f2.priceMa60SlopePct, null));
}
console.log('D. 原料可靠性（outlier/尘/chainLate 不进）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 10000, price_bnb: 1.0e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 20000, price_bnb: 1.1e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 1.2e-9 }));
  // outlier：FA 自有离群带 _acceptPrice（中位价 ×1000 倍带）——9999e-9 超带被拒
  fa.processTick(mkTick({ timestamp: T0 + 70000, price_bnb: 9999e-9 }));
  // 尘：bnb_amount < minPriceUpdateBnb 0.002 不进可靠价链（99e-9 在带内但尘门拦）
  fa.processTick(mkTick({ timestamp: T0 + 75000, price_bnb: 99e-9, bnb_amount: 0.001 }));
  // 现窗可靠行
  fa.processTick(mkTick({ timestamp: T0 + 80000, price_bnb: 1.6e-9 }));
  fa.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 1.7e-9 }));
  const f = fa.buildFactorMap('0xtoken', T0 + 90000);
  check('D1 outlier/尘不进原料：现窗均值 (1.6+1.7)/2=1.65 → 50.0', () => assert.strictEqual(f.priceMa60SlopePct, 50.0));
  // chainLate：旧块号行迟到 → 不进
  const fa2 = newFA();
  fa2.processTick(mkTick({ timestamp: T0 + 10000, price_bnb: 1.0e-9, block_number: 10 }));
  fa2.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 1.2e-9, block_number: 11 }));
  fa2.processTick(mkTick({ timestamp: T0 + 70000, price_bnb: 1.5e-9, block_number: 12 }));
  fa2.processTick(mkTick({ timestamp: T0 + 80000, price_bnb: 99e-9, block_number: 5 })); // 旧块迟到 → chainLate
  fa2.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 1.7e-9, block_number: 13 }));
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 90000);
  check('D2 chainLate 不进：现窗 (1.5+1.7)/2=1.6、前窗 (1.0+1.2)/2=1.1 → 45.45', () => assert.strictEqual(f2.priceMa60SlopePct, 45.45));
}
console.log('E. 探针收键 + 三防线');
{
  const fa = newFA();
  check('E1 getFactorKeys 含 priceMa60SlopePct（策略库/路由启动防线自动认得）', () => {
    assert.ok(fa.getFactorKeys().has('priceMa60SlopePct'));
  });
  check('E2 ConditionEvaluator 可评估（比较运算符）', () => {
    const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
    const ev = new ConditionEvaluator();
    const ast = ev.parseCondition('priceMa60SlopePct >= 5 AND priceMa60SlopePct <= 60');
    const v = ev.validateCondition(ast, fa.getFactorKeys());
    assert.ok(!v || v.valid !== false, JSON.stringify(v));
    assert.strictEqual(ev.evaluate(ast, { priceMa60SlopePct: 20 }), true);
    assert.strictEqual(ev.evaluate(ast, { priceMa60SlopePct: 4.9 }), false);
    assert.strictEqual(ev.evaluate(ast, { priceMa60SlopePct: 60.1 }), false);
    assert.strictEqual(ev.evaluate(ast, { priceMa60SlopePct: null }), false);
  });
}

console.log(`\n全部通过 ${passed}/${passed}`);
