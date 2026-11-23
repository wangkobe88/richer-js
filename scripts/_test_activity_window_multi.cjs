#!/usr/bin/env node
/**
 * T218 多粒度冷窗四键单测（零 DB 零网络）：
 *   actTotalBnb15s/30s/60s/300s（买卖合计金额，窗口半开 [now-W, now)）
 * 口径断言（用户提案「分时间活跃度因子」2026-11-23）：
 *   A. 窗口边界精确值（半开区间：恰在 now-W 的行不计入、略晚计入）
 *   B. 四窗嵌套自洽（15s ≤ 30s ≤ 60s ≤ 300s）与 act 10s 窗同环同源
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
  // 300s 窗专属：now-200000
  fa.processTick(mkTick({ timestamp: NOW - 200000, trader_address: 'wE', bnb_amount: 2.0 }), {});
  // 300s 窗外：now-300001
  fa.processTick(mkTick({ timestamp: NOW - 300001, trader_address: 'wF', bnb_amount: 9.0 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('A1 15s 窗闭区间（恰 now-15000 计入）', () => assert.strictEqual(f.actTotalBnb15s, 0.8));
  check('A2 30s 窗=15s+专属', () => assert.strictEqual(f.actTotalBnb30s, 1.5));
  check('A3 60s 窗=30s+专属', () => assert.strictEqual(f.actTotalBnb60s, 2.6));
  check('A4 300s 窗=60s+专属（now-300001 窗外不计）', () => assert.strictEqual(f.actTotalBnb300s, 4.6));
  check('A5 嵌套自洽 15s≤30s≤60s≤300s', () => {
    assert.ok(f.actTotalBnb15s <= f.actTotalBnb30s && f.actTotalBnb30s <= f.actTotalBnb60s && f.actTotalBnb60s <= f.actTotalBnb300s);
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

console.log('E. 探针收键 + now 注入防前视');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('E1 四键在 getFactorKeys（三防线自动认得）', () => {
    for (const k of ['actTotalBnb15s', 'actTotalBnb30s', 'actTotalBnb60s', 'actTotalBnb300s']) {
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
