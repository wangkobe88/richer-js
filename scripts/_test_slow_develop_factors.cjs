#!/usr/bin/env node
/**
 * T236 缓慢发育点位 FA 两键单测（2026-11-24 用户提案「前期币没涨过，慢速的相对
 * 大额交易」pointType slow_develop_early 三刀之②③）——零 DB 零网络。
 *
 * 键：sinceLaunchTrades（全史总笔数，买+卖，0=有证据零值）/
 *     bundledAvgTradeBnb300（300s 窗捆绑口径平均交易额：Σ买入 BNB ÷ 有效实体数——
 *     捆绑=同 block+金额 2% 带宽+≥2 钱包并一个实体〔D3.53 等额簇同参数：0.0001
 *     舍入格+2% 邻格合并〕，<0.001 尘买不进簇检测算独立实体；0=空窗有证据零值）/
 *     bundledEffBuyers300（观察键=有效实体数，下限 1）。
 *
 * 覆盖：
 *   A. 一姐形状精确值（26 行=15 买+11 卖；4 簇成员并 2 簇 → eff=13；avg=Σ买/13）
 *   B. 2% 带宽邻格合并（0.1481/0.1484 两钱包同块 → 1 实体；差 3% → 2 实体）
 *   C. 尘买 <0.001 不进簇检测（独立实体）
 *   D. 复购同钱包（分子计两行、实体计一个）
 *   E. defer 乱序 parity（乱序喂 == 链序喂 三键 bit 一致）
 *   F. 窗口裁剪（>300s 旧买滑出 avg 分母分子；sinceLaunchTrades 全史不减）
 *   G. 卖行计入总笔数；纯卖票 avg=0 非 null
 *   H. 空 state 零值 + getFactorKeys 探针含三键
 *   I. 源码口径断言（读点无 Date.now/写点在 _applyWalletAggregation/裁剪 2×余量）
 *
 * 用法：node scripts/_test_slow_develop_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  platform: 'flap',
}, o);

// 一姐 0xfc23…7777 形状：15 买（4 簇成员 + 11 单户）+ 11 卖 = 26 行
const YIJIE_BUYS = [
  { w: 'w1', bnb: 0.1481, blk: 100, li: 1 },
  { w: 'w2', bnb: 0.1481, blk: 100, li: 2 },   // 簇 A（同块等额 ×2）
  { w: 'w3', bnb: 0.3257, blk: 101, li: 1 },
  { w: 'w4', bnb: 0.3257, blk: 101, li: 2 },   // 簇 B（同块等额 ×2）
  { w: 'w5', bnb: 0.6961, blk: 102, li: 1 },
  { w: 'w6', bnb: 0.2000, blk: 103, li: 1 },
  { w: 'w7', bnb: 0.1500, blk: 104, li: 1 },
  { w: 'w8', bnb: 0.1200, blk: 105, li: 1 },
  { w: 'w9', bnb: 0.1000, blk: 106, li: 1 },
  { w: 'w10', bnb: 0.0800, blk: 107, li: 1 },
  { w: 'w11', bnb: 0.0500, blk: 108, li: 1 },
  { w: 'w12', bnb: 0.0985, blk: 109, li: 1 },
  { w: 'w13', bnb: 0.0876, blk: 110, li: 1 },
  { w: 'w14', bnb: 0.0777, blk: 111, li: 1 },
  { w: 'w15', bnb: 0.0601, blk: 112, li: 1 },
];
const SUM_BUY = YIJIE_BUYS.reduce((s, x) => s + x.bnb, 0);
// effBuyers = 15 钱包 − 4 簇成员 + 2 簇 = 13
const EXPECT_AVG = Number((SUM_BUY / 13).toFixed(4));

function feedYijie(fa, tsBase = T0 + 1000) {
  for (const b of YIJIE_BUYS) {
    fa.processTick(mkTick({
      trade_type: 'buy', sender_address: b.w, bnb_amount: b.bnb,
      block_number: b.blk, log_index: b.li, timestamp: tsBase + (b.li - 1) * 200,
    }), {});
  }
  for (let i = 0; i < 11; i++) {
    fa.processTick(mkTick({
      trade_type: 'sell', sender_address: 's' + i, bnb_amount: 0.05 + i * 0.01,
      block_number: 200 + i, log_index: 1, timestamp: tsBase + 5000 + i * 200,
    }), {});
  }
}

console.log('A. 一姐形状精确值');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  feedYijie(fa);
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('A1 sinceLaunchTrades=26（15 买+11 卖全史单调计数）', () => {
    assert.strictEqual(f.sinceLaunchTrades, 26);
  });
  check(`A2 bundledAvgTradeBnb300=Σ买/13=${EXPECT_AVG}（4 簇成员并 2 簇）`, () => {
    assert.strictEqual(f.bundledAvgTradeBnb300, EXPECT_AVG);
  });
  check('A3 bundledEffBuyers300=13（观察键）', () => {
    assert.strictEqual(f.bundledEffBuyers300, 13);
  });
}

console.log('B. 2% 带宽邻格合并');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  // 0.1481 / 0.1484（差 0.2% <2% 带）同块两钱包 → 1 实体
  fa.processTick(mkTick({ sender_address: 'a1', bnb_amount: 0.1481, block_number: 100, log_index: 1, timestamp: T0 + 1000 }), {});
  fa.processTick(mkTick({ sender_address: 'a2', bnb_amount: 0.1484, block_number: 100, log_index: 2, timestamp: T0 + 1200 }), {});
  // 0.1530（差 3.3% >2%）同块第三钱包 → 独立实体
  fa.processTick(mkTick({ sender_address: 'a3', bnb_amount: 0.153, block_number: 100, log_index: 3, timestamp: T0 + 1400 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('B1 2% 带内并簇 / 带外独立：eff=2（1 簇 + 1 单户）', () => {
    assert.strictEqual(f.bundledEffBuyers300, 2);
  });
  check('B2 avg=(0.1481+0.1484+0.153)/2 精确 4dp', () => {
    assert.strictEqual(f.bundledAvgTradeBnb300, Number(((0.1481 + 0.1484 + 0.153) / 2).toFixed(4)));
  });
}

console.log('C. 尘买不进簇检测');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  // 同块同额 0.0005 ×2（<0.001 尘线）→ 不进簇检测，各算独立实体
  fa.processTick(mkTick({ sender_address: 'd1', bnb_amount: 0.0005, block_number: 100, log_index: 1, timestamp: T0 + 1000 }), {});
  fa.processTick(mkTick({ sender_address: 'd2', bnb_amount: 0.0005, block_number: 100, log_index: 2, timestamp: T0 + 1200 }), {});
  fa.processTick(mkTick({ sender_address: 'd3', bnb_amount: 0.15, block_number: 101, log_index: 1, timestamp: T0 + 1400 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('C1 尘对不成簇：eff=3', () => {
    assert.strictEqual(f.bundledEffBuyers300, 3);
  });
}

console.log('D. 复购同钱包');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  fa.processTick(mkTick({ sender_address: 'r1', bnb_amount: 0.1, block_number: 100, log_index: 1, timestamp: T0 + 1000 }), {});
  fa.processTick(mkTick({ sender_address: 'r1', bnb_amount: 0.1, block_number: 101, log_index: 1, timestamp: T0 + 2000 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('D1 分子计两行、实体计一个：avg=0.2/1', () => {
    assert.strictEqual(f.bundledAvgTradeBnb300, Number((0.2 / 1).toFixed(4)));
    assert.strictEqual(f.bundledEffBuyers300, 1);
  });
}

console.log('E. defer 乱序 parity');
{
  const ticks = YIJIE_BUYS.map(b => mkTick({
    trade_type: 'buy', sender_address: b.w, bnb_amount: b.bnb,
    block_number: b.blk, log_index: b.li, timestamp: T0 + 1000 + (b.li - 1) * 200,
  }));
  const fa1 = new FourMemeFactorAggregator({});
  fa1.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  for (const t of ticks) fa1.processTick(t, {});
  const f1 = fa1.buildFactorMap('0xtoken', T0 + 60000);

  const fa2 = new FourMemeFactorAggregator({});
  fa2.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  const shuffled = ticks.slice().reverse();
  for (const t of shuffled) fa2.processTick(t, {});
  const f2 = fa2.buildFactorMap('0xtoken', T0 + 60000);
  check('E1 乱序喂 == 链序喂（三键 bit 一致）', () => {
    assert.strictEqual(f1.sinceLaunchTrades, f2.sinceLaunchTrades);
    assert.strictEqual(f1.bundledAvgTradeBnb300, f2.bundledAvgTradeBnb300);
    assert.strictEqual(f1.bundledEffBuyers300, f2.bundledEffBuyers300);
  });
}

console.log('F. 窗口裁剪');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  // 早期一笔 0.5 买（ts=T0+1000），读点 T0+600000（>300s 出窗）
  fa.processTick(mkTick({ sender_address: 'old1', bnb_amount: 0.5, block_number: 100, log_index: 1, timestamp: T0 + 1000 }), {});
  const fOld = fa.buildFactorMap('0xtoken', T0 + 600000);
  check('F1 出窗后 avg 分母分子均滑出：avg=0（空窗零值非 null）、总笔数=1 不减', () => {
    assert.strictEqual(fOld.bundledAvgTradeBnb300, 0);
    assert.strictEqual(fOld.sinceLaunchTrades, 1);
  });
  // 窗内再补一笔 0.2 → avg=0.2
  fa.processTick(mkTick({ sender_address: 'new1', bnb_amount: 0.2, block_number: 200, log_index: 1, timestamp: T0 + 590000 }), {});
  const fNew = fa.buildFactorMap('0xtoken', T0 + 600000);
  check('F2 窗内新买单独成 avg', () => {
    assert.strictEqual(fNew.bundledAvgTradeBnb300, 0.2);
    assert.strictEqual(fNew.sinceLaunchTrades, 2);
  });
}

console.log('G. 卖行/纯卖票');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  fa.processTick(mkTick({ trade_type: 'sell', sender_address: 's1', bnb_amount: 0.3, block_number: 100, log_index: 1, timestamp: T0 + 1000 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('G1 纯卖票：总笔数=1、avg=0 非 null（有证据零值）', () => {
    assert.strictEqual(f.sinceLaunchTrades, 1);
    assert.strictEqual(f.bundledAvgTradeBnb300, 0);
    assert.strictEqual(f.bundledEffBuyers300, 1);
  });
}

console.log('H. 空 state 零值 + 探针');
{
  const fa = new FourMemeFactorAggregator({});
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  const f = fa.buildFactorMap('0xtoken', T0 + 1000);
  check('H1 空 state：三键 0/0/1', () => {
    assert.strictEqual(f.sinceLaunchTrades, 0);
    assert.strictEqual(f.bundledAvgTradeBnb300, 0);
    assert.strictEqual(f.bundledEffBuyers300, 1);
  });
  check('H2 getFactorKeys 探针含三键', () => {
    const keys = new Set(fa.getFactorKeys());
    for (const k of ['sinceLaunchTrades', 'bundledAvgTradeBnb300', 'bundledEffBuyers300']) {
      assert.ok(keys.has(k), `getFactorKeys 缺 ${k}`);
    }
  });
}

console.log('I. 源码口径断言');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  const readFn = src.slice(src.indexOf('_bundledAvgTradeFactors(state, now)'), src.indexOf('_bundleClusterFactors(state, now'));
  check('I1 读点纯函数禁 Date.now（now 由 buildFactorMap(state, asOf) 传入防前视）', () => {
    assert.ok(!readFn.includes('Date.now'), '读点函数出现 Date.now');
  });
  const writeSeg = src.slice(src.indexOf('_applyWalletAggregation(state, tick, vars)'), src.indexOf('_applyWalletAggregation(state, tick, vars)') + 4000);
  check('I2 写点在 _applyWalletAggregation 体内（两路径汇合点恰计一次）', () => {
    assert.ok(writeSeg.includes('state._totalTrades++'), '总笔数写点缺失');
    assert.ok(writeSeg.includes('state._slowDevBuyRing.push'), '买环写点缺失');
  });
  check('I3 裁剪 2× 余量 + 长度阈值 128（摊销同款）', () => {
    assert.ok(writeSeg.includes('2 * this._fp.slowDevAvgWinMs'), '2× 余量缺失');
    assert.ok(writeSeg.includes('> 128'), '长度阈值缺失');
  });
  check('I4 读点 2% 带宽常量 0.02 + 尘线 0.001（D3.53 同参数）', () => {
    assert.ok(readFn.includes('<= 0.02'), '2% 带宽缺失');
    assert.ok(readFn.includes('< 0.001'), '尘线缺失');
  });
}

console.log(`\n通过 ${passed}/${passed + failed}${failed ? `（失败 ${failed}）` : ''}`);
process.exit(failed ? 1 : 0);
