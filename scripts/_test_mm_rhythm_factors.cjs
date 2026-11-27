#!/usr/bin/env node
/**
 * T237 做市节奏两键单测（零 DB 零网络）：
 *   tradesPerSecSinceLaunch / blockGapLe1Pct64
 * 口径断言（用户提案「做市痕迹票识别」2026-11-25；做市票=每 block 有交易）：
 *   A. tradesPerSecSinceLaunch 精确值（=全史笔数÷秒龄；龄 0 → null fail-closed）
 *   B. blockGapLe1Pct64 精确值（相邻 tick 块间隔 ≤1 占比；gap=0 同块计 ≤1）
 *   C. 环尾裁剪 64（第 65 个 gap 推入时最旧 gap 滑出）
 *   D. null 语义（环不足 2 个间隔 → null；键族 fail-closed 方向）
 *   E. 乱序回推负间隔钳 0（到达序近似语义；不冒充链序）
 *   F. 探针收键（getFactorKeys 自动认得——三防线同款）
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

console.log('A. tradesPerSecSinceLaunch 精确值 + 龄 0 null');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 2000, block_number: 100 }));   // 1 笔 @2s
  fa.processTick(mkTick({ timestamp: T0 + 4000, block_number: 101 }));   // 2 笔 @4s
  fa.processTick(mkTick({ timestamp: T0 + 6000, block_number: 102 }));   // 3 笔 @6s
  const f = fa.buildFactorMap('0xtoken', T0 + 6000);
  assert.strictEqual(f.tradesPerSecSinceLaunch, 0.5, '3/6s = 0.5');
  assert.strictEqual(f.sinceLaunchTrades, 3, '计数键同源');
  // 龄 0（createdAt 缺失态）：null fail-closed
  const fa2 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa2.registerToken('0xy', { totalSupply: 1e9, symbol: 'Y', creatorAddress: null });
  fa2.processTick(mkTick({ token_address: '0xy', timestamp: T0 + 2000 }));
  const f2 = fa2.buildFactorMap('0xy', T0 + 2000);
  assert.strictEqual(f2.tradesPerSecSinceLaunch, null, 'createdAtMs 缺失 → null');
}

console.log('B. blockGapLe1Pct64 精确值（同块 gap=0 计 ≤1）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, block_number: 100 }));
  fa.processTick(mkTick({ timestamp: T0 + 2000, block_number: 100 })); // gap 0
  fa.processTick(mkTick({ timestamp: T0 + 3000, block_number: 101 })); // gap 1
  fa.processTick(mkTick({ timestamp: T0 + 4000, block_number: 105 })); // gap 4
  fa.processTick(mkTick({ timestamp: T0 + 5000, block_number: 106 })); // gap 1
  const f = fa.buildFactorMap('0xtoken', T0 + 5000);
  // 4 个 gap：[0,1,4,1] → ≤1 占 3/4 = 75
  assert.strictEqual(f.blockGapLe1Pct64, 75, '[0,1,4,1] → 75%');
}

console.log('C. 环尾裁剪 64（65 gap 后最旧滑出）');
{
  const fa = newFA();
  // 先喂 63 个 gap=5 的 tick（64 个 tick），再喂 65 个 gap=0 的 tick
  for (let i = 0; i < 64; i++) fa.processTick(mkTick({ timestamp: T0 + (i + 1) * 1000, block_number: 100 + i * 5 }));
  for (let i = 0; i < 65; i++) fa.processTick(mkTick({ timestamp: T0 + (64 + i + 1) * 1000, block_number: 415 + i }));
  const f = fa.buildFactorMap('0xtoken', T0 + 200000);
  // 环内 64 gap：全部为最近 65 个 tick 间的 gap=0
  assert.strictEqual(f.blockGapLe1Pct64, 100, '旧 gap=5 全滑出 → 100%');
}

console.log('D. null 语义（环不足 2 个间隔）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, block_number: 100 }));
  const f = fa.buildFactorMap('0xtoken', T0 + 1000);
  assert.strictEqual(f.blockGapLe1Pct64, null, '0 gap → null fail-closed');
  fa.processTick(mkTick({ timestamp: T0 + 2000, block_number: 100 }));
  const f2 = fa.buildFactorMap('0xtoken', T0 + 2000);
  assert.strictEqual(f2.blockGapLe1Pct64, null, '1 gap 仍证据不足 → null fail-closed');
  fa.processTick(mkTick({ timestamp: T0 + 3000, block_number: 101 }));
  const f3 = fa.buildFactorMap('0xtoken', T0 + 3000);
  assert.strictEqual(f3.blockGapLe1Pct64, 100, '2 gap=[0,1] → 100%');
}

console.log('E. 乱序回推负间隔钳 0（到达序近似）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 2000, block_number: 105 })); // 先到高块
  fa.processTick(mkTick({ timestamp: T0 + 3000, block_number: 103 })); // 回推低块 → gap -2 钳 0
  fa.processTick(mkTick({ timestamp: T0 + 4000, block_number: 104 })); // gap 1
  const f = fa.buildFactorMap('0xtoken', T0 + 4000);
  assert.strictEqual(f.blockGapLe1Pct64, 100, '[0,1] → 100%（负间隔不冒充大 gap）');
}

console.log('F. 探针收键（getFactorKeys 自动认得）');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  assert.ok(keys.has('tradesPerSecSinceLaunch'), 'tradesPerSecSinceLaunch 在键集');
  assert.ok(keys.has('blockGapLe1Pct64'), 'blockGapLe1Pct64 在键集');
}

console.log("\n全部通过（6 组断言）");

// ── T240 v6 长窗趋势两键（2026-11-27 用户裁定「1 分钟/5 分钟趋势全正」）──
console.log('G. chg60Pct/chg300Pct（前窗回落首可靠价口径）');
{
  const fa = newFA();
  // 0s~70s 每 10s 一笔：逐笔 +25%（buildFactorMap 在每 tick 后调用=FA 契约）
  let base = 4e-9;
  for (let i = 0; i < 4; i++) { // 先喂 4 笔（0~30s）
    fa.processTick(mkTick({ timestamp: T0 + i * 10000, block_number: 100 + i * 3, price_bnb: base }));
    base *= 1.25;
  }
  // 年轻票回落：t=30s 时 chg300 无前窗 → vs 首可靠价 4e-9（第 4 笔 1.25^3 → +95.31%）
  const f30 = fa.buildFactorMap('0xtoken', T0 + 30000);
  const exp300young = (Math.pow(1.25, 3) - 1) * 100;
  assert.ok(Math.abs(f30.chg300Pct - exp300young) < 0.01, `chg300 年轻回落 ${f30.chg300Pct} vs ${exp300young}`);
  // 继续喂到 70s
  for (let i = 4; i < 8; i++) {
    fa.processTick(mkTick({ timestamp: T0 + i * 10000, block_number: 100 + i * 3, price_bnb: base }));
    base *= 1.25;
  }
  // t=70s：chg60 = 末笔(1.25^7) vs t=10s 价(1.25) → +281.47%
  const f70 = fa.buildFactorMap('0xtoken', T0 + 70000);
  const exp60 = (Math.pow(1.25, 7) / 1.25 - 1) * 100;
  assert.ok(Math.abs(f70.chg60Pct - exp60) < 0.01, `chg60 精确值 ${f70.chg60Pct} vs ${exp60}`);
  // 无可靠价 null
  const fa2 = new FourMemeFactorAggregator({}, { info(){}, warn(){}, error(){} });
  fa2.registerToken('0xz', { totalSupply: 1e9, symbol: 'Z', creatorAddress: null });
  const fz = fa2.buildFactorMap('0xz', T0 + 1000);
  assert.strictEqual(fz.chg60Pct, null, '无可靠价 null fail-closed');
  // 探针收键
  assert.ok(fa.getFactorKeys().has('chg60Pct') && fa.getFactorKeys().has('chg300Pct'), '探针收键');
  console.log('  ✓ G 组通过');
}
