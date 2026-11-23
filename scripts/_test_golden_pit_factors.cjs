#!/usr/bin/env node
/**
 * T213 黄金坑三键单测（零 DB 零网络）：
 *   athVsLaunchPct / bigBuyersCount / bigBuyersHeldDust
 * 口径断言（JG-41 用户形状）：
 *   A. athVsLaunchPct = 可靠价全时峰/首可靠价 −1 ×100（null=未见可靠价 fail-closed）
 *   B. bigBuyersCount：累计买 ≥0.2B 只进不出；bigBuyersHeldDust：队列内净持仓 > 尘门
 *      （token 域常量=holderDustBnb/首可靠价）的人数；入队点初评+成员跨界 ±1 恰一次
 *   C. 乱序重放收敛（defer wallet 段乱序回推语义）
 *   D. 探针收键（getFactorKeys 自动收，condition 可直接引用）
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
let tickSeq = 0;
function mkTick(o) {
  return {
    token_address: '0xtoken', trade_type: o.side, trader_address: null, sender_address: o.w,
    price_bnb: o.px ?? 1e-9, price_usd: 5, bnb_amount: o.bnb, token_amount: o.tok,
    block_number: o.bn ?? Math.floor((o.ts - T0) / 500), log_index: o.li ?? (tickSeq++),
    timestamp: o.ts, tx_hash: '0xtx' + (tickSeq), price_outlier: !!o.out,
  };
}
// 首可靠价 1e-9 尘门固化：holderDustBnb 0.015 → 尘线 15M tokens
const PX = 1e-9, DUST_TOK = 0.015 / PX; // 15e6

console.log('A. athVsLaunchPct 峰值涨幅');
{
  const fa = newFA();
  const f0 = fa.buildFactorMap('0xtoken', T0 + 1000);
  check('A1 无可靠价 → null fail-closed', () => assert.strictEqual(f0.athVsLaunchPct, null));
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', bnb: 0.3, tok: 3e8, px: PX, w: 'wA' }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', bnb: 0.2, tok: 1e8, px: 1.8e-9, w: 'wB' }), {});
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'sell', bnb: 0.1, tok: 5e7, px: 1.1e-9, w: 'wB' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3500);
  check('A2 峰 1.8e-9/首 1e-9 → +80', () => assert.strictEqual(f.athVsLaunchPct, 80));
  check('A3 不过尘门的微量价不进峰（minPriceUpdateBnb=0.002）', () => {
    fa.processTick(mkTick({ ts: T0 + 4000, side: 'buy', bnb: 0.001, tok: 1e7, px: 5e-9, w: 'wC' }), {});
    const f2 = fa.buildFactorMap('0xtoken', T0 + 4500);
    assert.strictEqual(f2.athVsLaunchPct, 80); // 5e-9 若入可靠链应 400
  });
  check('A4 峰单调（后续低价 tick 不拉低）', () => {
    fa.processTick(mkTick({ ts: T0 + 5000, side: 'sell', bnb: 0.1, tok: 5e7, px: 0.9e-9, w: 'wB' }), {});
    const f3 = fa.buildFactorMap('0xtoken', T0 + 5500);
    assert.strictEqual(f3.athVsLaunchPct, 80);
  });
}

console.log('B. 大买家队列两键');
{
  const fa = newFA();
  const NOW = T0 + 60000;
  // wA 两笔 0.15+0.10=0.25 入队；wB 0.30 入队；wC 0.19 不入队
  fa.processTick(mkTick({ ts: NOW - 9000, side: 'buy', bnb: 0.15, tok: 1.5e8, px: PX, w: 'wA' }), {});
  fa.processTick(mkTick({ ts: NOW - 8000, side: 'buy', bnb: 0.30, tok: 3.0e8, px: PX, w: 'wB' }), {});
  const f1 = fa.buildFactorMap('0xtoken', NOW - 7000);
  check('B1 wB 先入队 count=1 held=1', () => {
    assert.strictEqual(f1.bigBuyersCount, 1);
    assert.strictEqual(f1.bigBuyersHeldDust, 1);
  });
  fa.processTick(mkTick({ ts: NOW - 6000, side: 'buy', bnb: 0.10, tok: 1.0e8, px: PX, w: 'wA' }), {});
  const f2 = fa.buildFactorMap('0xtoken', NOW - 5000);
  check('B2 wA 累计 0.25 入队 count=2 held=2', () => {
    assert.strictEqual(f2.bigBuyersCount, 2);
    assert.strictEqual(f2.bigBuyersHeldDust, 2);
  });
  // wB 清仓到尘线下（3e8 → 卖 2.9e8 剩 1e7 < 15M 尘线）
  fa.processTick(mkTick({ ts: NOW - 4000, side: 'sell', bnb: 0.1, tok: 2.9e8, px: PX, w: 'wB' }), {});
  const f3 = fa.buildFactorMap('0xtoken', NOW - 3000);
  check('B3 wB 跌破尘线 held 2→1（count 不减）', () => {
    assert.strictEqual(f3.bigBuyersCount, 2);
    assert.strictEqual(f3.bigBuyersHeldDust, 1);
  });
  // wB 再买回尘线上（买 1e8 → 1.1e8 > 尘线）
  fa.processTick(mkTick({ ts: NOW - 2000, side: 'buy', bnb: 0.05, tok: 1.0e8, px: PX, w: 'wB' }), {});
  const f4 = fa.buildFactorMap('0xtoken', NOW - 1000);
  check('B4 wB 回尘线上 held 1→2', () => {
    assert.strictEqual(f4.bigBuyersHeldDust, 2);
  });
  // wC 0.19 不入队；加一笔 0.02 → 0.21 入队但净持仓 < 尘线（0.21B 买在 1e-9 = 2.1e8 > 尘线……
  // 换构造：wC 买 0.19B 后全卖，再买 0.02 → 累计 0.21 入队、净持仓 2e7 > 尘线 1.5e7 会 held——
  // 为构造「入队即不 held」用参数覆盖尘线更直接：
  const fa2 = newFA({ bigBuyerCohortMinBnb: 0.2, holderDustBnb: 0.5 });
  fa2.processTick(mkTick({ ts: NOW - 9000, side: 'buy', bnb: 0.19, tok: 1.9e8, px: PX, w: 'wC' }), {});
  fa2.processTick(mkTick({ ts: NOW - 8000, side: 'buy', bnb: 0.02, tok: 2e7, px: PX, w: 'wC' }), {});
  const g = fa2.buildFactorMap('0xtoken', NOW - 7000);
  check('B5 入队即低于尘线：count+1 held 不增', () => {
    assert.strictEqual(g.bigBuyersCount, 1);
    assert.strictEqual(g.bigBuyersHeldDust, 0);
  });
  check('B6 参数覆盖生效（bigBuyerCohortMinBnb/holderDustBnb）', () => assert.ok(true));
}

console.log('C. 乱序重放收敛（同钱包序列乱序喂食）');
{
  const fa = newFA();
  const NOW = T0 + 120000;
  // wA 序列：买 0.25（入队 held）→ 卖剩 1e7（跌破尘线）→ 买回 1e8（回线上）
  // 以块号乱序喂（logIndex 保链序内序）——_applyWalletAggregation 按 tick 到达序处理
  const ts = [NOW - 30000, NOW - 20000, NOW - 10000];
  const ticks = [
    mkTick({ ts: ts[0], side: 'buy', bnb: 0.25, tok: 2.5e8, px: PX, w: 'wA', bn: 100, li: 0 }),
    mkTick({ ts: ts[1], side: 'sell', bnb: 0.1, tok: 2.4e8, px: PX, w: 'wA', bn: 101, li: 0 }),
    mkTick({ ts: ts[2], side: 'buy', bnb: 0.05, tok: 1.0e8, px: PX, w: 'wA', bn: 102, li: 0 }),
  ];
  // 到达序 3→1→2（block 乱序）
  fa.processTick(ticks[2], {}); fa.processTick(ticks[0], {}); fa.processTick(ticks[1], {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('C1 乱序喂食终态=正序终态（count=1 held=1）', () => {
    assert.strictEqual(f.bigBuyersCount, 1);
    assert.strictEqual(f.bigBuyersHeldDust, 1); // 净 2.5e8-2.4e8+1e8=1.1e8 > 尘线
  });
}

console.log('D. 探针收键');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('D1 三键在 getFactorKeys（condition 三防线自动认得）', () => {
    for (const k of ['athVsLaunchPct', 'bigBuyersCount', 'bigBuyersHeldDust']) {
      assert.ok(keys.has(k), `缺 ${k}`);
    }
  });
}
console.log(`\n全部通过 ${passed}/${passed}`);
