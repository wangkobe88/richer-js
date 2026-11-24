#!/usr/bin/env node
/**
 * T218 多粒度冷窗五键单测（零 DB 零网络）：
 *   actTotalBnb15s/30s/60s/90s/300s（买卖合计金额，窗口半开 [now-W, now)）
 * 口径断言（用户提案「分时间活跃度因子」2026-11-23；PT7 加 90s 窗）：
 *   A. 窗口边界精确值（半开区间：恰在 now-W 的行不计入、略晚计入）
 *   B. 五窗嵌套自洽（15s ≤ 30s ≤ 60s ≤ 90s ≤ 300s）与 act 10s 窗同环同源
 *   C. defer 乱序回推无害（求和交换律——环按 ts 过滤非到达序）
 *   D. 裁剪保留窗扩到 activityWinLongMs（300s 窗不因 10s 裁剪穿窗）
 *   E. 探针收键（三防线自动认得）；now 注入防前视（读点无 Date.now）
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
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, o, { log_index: o.log_index ?? (seq++) });
}

console.log('A. 窗口边界精确值');
{
  const fa = newFA();
  const NOW = T0 + 300000;
  // 边界：恰 now-15000 计入（闭区间 [now-W, now)——与 act 10s 窗 `ts < cutoff` 跳过
  // 的对称语义一致；now-300001 在 300s 窗外不计入）
  fa.processTick(mkTick({ timestamp: NOW - 15000, trader_address: 'wA', bnb_amount: 0.5 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 14999, trader_address: 'wB', bnb_amount: 0.3 }), {});
  // 30s 窗专属：now-25000
  fa.processTick(mkTick({ timestamp: NOW - 25000, trader_address: 'wC', bnb_amount: 0.7 }), {});
  // 60s 窗专属：now-45000
  fa.processTick(mkTick({ timestamp: NOW - 45000, trader_address: 'wD', bnb_amount: 1.1 }), {});
  // 90s 窗专属：now-75000（PT7 冷窗线 ≤1.0 载体）
  fa.processTick(mkTick({ timestamp: NOW - 75000, trader_address: 'wG', bnb_amount: 0.9 }), {});
  // 300s 窗专属：now-200000
  fa.processTick(mkTick({ timestamp: NOW - 200000, trader_address: 'wE', bnb_amount: 2.0 }), {});
  // 300s 窗外：now-300001
  fa.processTick(mkTick({ timestamp: NOW - 300001, trader_address: 'wF', bnb_amount: 9.0 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('A1 15s 窗闭区间（恰 now-15000 计入）', () => assert.strictEqual(f.actTotalBnb15s, 0.8));
  check('A2 30s 窗=15s+专属', () => assert.strictEqual(f.actTotalBnb30s, 1.5));
  check('A3 60s 窗=30s+专属', () => assert.strictEqual(f.actTotalBnb60s, 2.6));
  check('A3b 90s 窗=60s+专属（PT7）', () => assert.strictEqual(f.actTotalBnb90s, 3.5));
  check('A4 300s 窗=60s+专属（now-300001 窗外不计）', () => assert.strictEqual(f.actTotalBnb300s, 5.5));
  check('A5 嵌套自洽 15s≤30s≤60s≤90s≤300s', () => {
    assert.ok(f.actTotalBnb15s <= f.actTotalBnb30s && f.actTotalBnb30s <= f.actTotalBnb60s
      && f.actTotalBnb60s <= f.actTotalBnb90s && f.actTotalBnb90s <= f.actTotalBnb300s);
  });
  check('A5b 90s 窗闭区间边界（恰 now-90000 计入）', () => {
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: NOW - 90000, trader_address: 'wX', bnb_amount: 0.2 }), {});
    fa2.processTick(mkTick({ timestamp: NOW - 90001, trader_address: 'wY', bnb_amount: 0.3 }), {});
    const f2 = fa2.buildFactorMap('0xtoken', NOW);
    assert.strictEqual(f2.actTotalBnb90s, 0.2); // -90001 在 90s 窗外不计
  });
}

console.log('A+. T223 锚点买盘存在两键');
{
  const fa = newFA();
  const NOW = T0 + 300000;
  // 15s 窗内两笔买（0.05/0.08）+ 一笔卖；max ts 行=卖（NOW-9000）→ 锚是卖
  fa.processTick(mkTick({ timestamp: NOW - 14000, trader_address: 'wA', bnb_amount: 0.05 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 10000, trader_address: 'wB', bnb_amount: 0.08 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 9000, trader_address: 'wC', trade_type: 'sell', bnb_amount: 0.1 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('A+1 anchor15sMaxBuyBnb=窗内最大单笔买 0.08', () => assert.strictEqual(f.anchor15sMaxBuyBnb, 0.08));
  check('A+2 锚 tick（max ts 行）是卖 → anchorTickIsBuy=0', () => assert.strictEqual(f.anchorTickIsBuy, 0));
  // 更晚一笔买 → 锚是买
  fa.processTick(mkTick({ timestamp: NOW - 8000, trader_address: 'wD', bnb_amount: 0.2 }), {});
  const f2 = fa.buildFactorMap('0xtoken', NOW);
  check('A+3 锚 tick 换成买 → 1', () => assert.strictEqual(f2.anchorTickIsBuy, 1));
  // 无行 → 两键 0（fail-closed）
  const fa3 = newFA();
  const f3 = fa3.buildFactorMap('0xtoken', T0 + 1000);
  check('A+4 无行 → anchorTickIsBuy=0 / maxBuy=0', () => {
    assert.strictEqual(f3.anchorTickIsBuy, 0);
    assert.strictEqual(f3.anchor15sMaxBuyBnb, 0);
  });
  // 乱序回推序无关（max ts / 最大值聚合）
  const fa4 = newFA();
  fa4.processTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wX', bnb_amount: 0.04 }), {});
  fa4.processTick(mkTick({ timestamp: NOW - 14000, trader_address: 'wY', bnb_amount: 0.03 }), {});
  fa4.processTick(mkTick({ timestamp: NOW - 10000, trader_address: 'wZ', trade_type: 'sell', bnb_amount: 0.1 }), {});
  const f4 = fa4.buildFactorMap('0xtoken', NOW);
  check('A+5 乱序喂入同结论（maxBuy=0.04/锚买）', () => {
    assert.strictEqual(f4.anchor15sMaxBuyBnb, 0.04);
    assert.strictEqual(f4.anchorTickIsBuy, 1);
  });
}

console.log('B. 与 act 10s 窗同环同源');
{
  const fa = newFA();
  const NOW = T0 + 60000;
  fa.processTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wA', bnb_amount: 0.4 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 12000, trader_address: 'wB', bnb_amount: 0.6 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('B1 10s 窗 0.4（12s 行在外）/ 15s 窗 1.0（12s 行在内）——窗宽语义精确', () => {
    assert.strictEqual(f.actTotalBnb, 0.4);
    assert.strictEqual(f.actTotalBnb15s, 1.0);
    assert.strictEqual(f.actTotalBnb30s, 1.0);
  });
  check('B2 买卖合计口径（卖也计）', () => {
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: NOW - 1000, trader_address: 'wA', trade_type: 'sell', bnb_amount: 0.5 }), {});
    const f2 = fa2.buildFactorMap('0xtoken', NOW);
    assert.strictEqual(f2.actTotalBnb15s, 0.5);
  });
}

console.log('C. defer 乱序回推无害（求和交换律）');
{
  const fa = newFA();
  const NOW = T0 + 300000;
  const ticks = [
    mkTick({ timestamp: NOW - 3000, trader_address: 'wA', bnb_amount: 0.1 }),
    mkTick({ timestamp: NOW - 2000, trader_address: 'wB', bnb_amount: 0.2 }),
    mkTick({ timestamp: NOW - 1000, trader_address: 'wC', bnb_amount: 0.4 }),
  ];
  // 到达序 3→1→2（block 乱序回推）
  fa.processTick(ticks[2], {}); fa.processTick(ticks[0], {}); fa.processTick(ticks[1], {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('C1 乱序喂食四窗终态=正序终态', () => {
    assert.strictEqual(f.actTotalBnb15s, 0.7);
    assert.strictEqual(f.actTotalBnb30s, 0.7);
  });
}

console.log('D. 裁剪保留窗扩长（300s 窗不因 10s 裁剪穿窗）');
{
  const fa = newFA();
  const st = fa._states.get('0xtoken');
  const NOW = T0 + 600000;
  // 塞 80 笔 500s 前的老行 + 10 笔近窗行——老行应被保留（floor 保底+长窗 cutoff）
  for (let i = 0; i < 80; i++) {
    st._activityEvents.push({ ts: NOW - 500000 - i * 10, w: 'w' + i, buy: true, bnb: 0.01 });
  }
  for (let i = 0; i < 10; i++) {
    st._activityEvents.push({ ts: NOW - 10000 + i * 100, w: 'n' + i, buy: true, bnb: 0.05 });
  }
  fa._pruneActivityEvents(st, NOW);
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('D1 500s 前行不被裁（300s 窗外正确计 0）', () => {
    assert.ok(Math.abs(f.actTotalBnb300s - 0.5) < 1e-9, '浮点容差'); // 只有 10 笔近窗 0.05×10
  });
  check('D2 环未空（长窗保留生效——老行仍在环但被 ts 过滤）', () => {
    assert.ok(st._activityEvents.length > 10);
  });
}

console.log('F. 差额段值键（T232 60Ex15/90Ex60）');
{
  const fa = newFA();
  const NOW = T0 + 400000;
  // 四笔：now-70s 0.1 / now-50s 0.2 / now-20s 0.3 / now-5s 0.4
  //   t15=0.4（now-5s）t30=0.7 t60=0.9 t90=1.0 → 60Ex15=0.5、90Ex60=0.1
  fa.processTick(mkTick({ timestamp: NOW - 70000, bnb_amount: 0.1, sender_address: 'w1' }), {});
  fa.processTick(mkTick({ timestamp: NOW - 50000, bnb_amount: 0.2, sender_address: 'w2' }), {});
  fa.processTick(mkTick({ timestamp: NOW - 20000, bnb_amount: 0.3, sender_address: 'w3' }), {});
  fa.processTick(mkTick({ timestamp: NOW - 5000, bnb_amount: 0.4, sender_address: 'w4' }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('F1 60Ex15 = t60−t15 精确值（0.9−0.4=0.5）', () => {
    assert.ok(Math.abs(f.actTotalBnb60Ex15 - 0.5) < 1e-9, String(f.actTotalBnb60Ex15));
  });
  check('F2 90Ex60 = t90−t60 精确值（1.0−0.9=0.1）', () => {
    assert.ok(Math.abs(f.actTotalBnb90Ex60 - 0.1) < 1e-9, String(f.actTotalBnb90Ex60));
  });
  // 边界：恰 now-60000 的行按闭区间语义同进 60s/90s 两窗（[now-W, now)，A5b 同款）
  fa.processTick(mkTick({ timestamp: NOW - 60000, bnb_amount: 0.08, sender_address: 'w5' }), {});
  const f2 = fa.buildFactorMap('0xtoken', NOW);
  check('F3 恰 now-60s 行同进两窗：差额不变（t90/t60 同 +0.08）、60Ex15 +0.08', () => {
    assert.ok(Math.abs(f2.actTotalBnb90Ex60 - 0.1) < 1e-9, String(f2.actTotalBnb90Ex60));
    assert.ok(Math.abs(f2.actTotalBnb60Ex15 - 0.58) < 1e-9, String(f2.actTotalBnb60Ex15));
  });
}

console.log('E. 探针收键 + now 注入防前视');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('E1 四键在 getFactorKeys（三防线自动认得）', () => {
    for (const k of ['actTotalBnb15s', 'actTotalBnb30s', 'actTotalBnb60s', 'actTotalBnb90s', 'actTotalBnb60Ex15', 'actTotalBnb90Ex60', 'actTotalBnb300s']) {
      assert.ok(keys.has(k), `缺 ${k}`);
    }
  });
  check('E2 读点源码无 Date.now（now 由 buildFactorMap 传入）', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/services/FourMemeFactorAggregator.js'), 'utf8');
    // 提取 _activityFactors 函数体（粗略：方法名到下一个方法）
    const m = src.match(/_activityFactors\(state, now\) \{[\s\S]{0,4000}?\n    \}/);
    assert.ok(m && !m[0].includes('Date.now'), '_activityFactors 内禁 Date.now');
  });
}
console.log(`\n全部通过 ${passed}/${passed}`);
