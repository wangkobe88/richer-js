#!/usr/bin/env node
/**
 * T221 famous 跟单拥挤键单测（零 DB 零网络）：
 *   famousFollowSlotMaxWallets = 每个 famous 买入事件开 2s 闭窗（含同块同行 ts），
 *   窗内非 famous 买入钱包数（去重）的全 famous 买点 max；0=无 famous 买/名单未启用
 *   fail-open（famousCopyWalletCircPct 同 0 语义）。
 * 口径断言（0x2a05…7777 同块 16 钱包挤爆案用户裁定「跟单算 famous 买入后 1-2 个
 * slot，远期的买入算是健康的，可以不管」）：
 *   A. 名单未启用（null/空 Set）→ 0 fail-open
 *   B. 闭窗口径：同块（同 ts）/ +1s / +2s 计入，+2.5s 出窗不计
 *   C. 全 famous 买点取 max（后一个 famous 买跟单更多 → max 跟进）
 *   D. famous 自身买不计入跟单数（famous 挤 famous 非风险）；卖行不计
 *   E. 乱序回推序无关（读点全量扫；defer 晚到行同结果）
 *   F. 大小写归一（roster 小写；wallet 原样进环，读点 toLowerCase 对齐）
 *   G. 探针收键（getFactorKeys 自动收，condition 可直接引用）
 */
'use strict';
const assert = require('assert');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

const T0 = 1700000000000;
let passed = 0;
function check(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exit(1); } }

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
let seq = 0;
function mkTick(o) {
  return {
    token_address: '0xtoken', trade_type: o.side, trader_address: null, sender_address: o.w,
    price_bnb: 1e-9, price_usd: 5, bnb_amount: o.bnb ?? 0.05, token_amount: 5e7,
    block_number: 100, log_index: (seq++),
    timestamp: o.ts, tx_hash: '0xtx' + seq, price_outlier: false,
  };
}
function inject(fa, roster) { FourMemeFactorAggregator.setFamousCopyWalletsForTest(roster); }

console.log('A. 名单未启用 fail-open');
{
  const fa = newFA();
  FourMemeFactorAggregator.setFamousCopyWalletsForTest(null); // 未加载态
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'wA' }), {});
  fa.processTick(mkTick({ ts: T0 + 1100, side: 'buy', w: 'wB' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 1200);
  check('A1 roster null → 0', () => assert.strictEqual(f.famousFollowSlotMaxWallets, 0));
  FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set()); // 空 Set=已加载未启用
  const f2 = fa.buildFactorMap('0xtoken', T0 + 1300);
  check('A2 空 Set → 0', () => assert.strictEqual(f2.famousFollowSlotMaxWallets, 0));
  FourMemeFactorAggregator.setFamousCopyWalletsForTest(null); // 还原
}

console.log('B. 闭窗口径（同块/1s/2s 计入，2.5s 出窗）');
{
  const fa = newFA();
  inject(fa, new Set(['FAMA']));
  // famous 买 t+1000；跟单：同块 w1、+1s w2、+2s w3（含=窗右端）、+2.5s w4（出窗）；
  // w0 早于 famous 500ms 不在窗内（更早买不计——「远期的买入算健康」同源判据）
  fa.processTick(mkTick({ ts: T0 + 500, side: 'buy', w: 'w0', bnb: 0.05 }), {});
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'w1' }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', w: 'w2' }), {});
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'buy', w: 'w3' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('B1 同块 w1/+1s w2/+2s w3 三钱包 → 3', () => assert.strictEqual(f.famousFollowSlotMaxWallets, 3));
  fa.processTick(mkTick({ ts: T0 + 3500, side: 'buy', w: 'w4' }), {});
  const f2 = fa.buildFactorMap('0xtoken', T0 + 3500);
  check('B2 +2.5s 出窗不追回 → 仍 3', () => assert.strictEqual(f2.famousFollowSlotMaxWallets, 3));
}

console.log('C. 全 famous 买点取 max + 同窗内 famous 自身不计');
{
  const fa = newFA();
  inject(fa, new Set(['FAMA']));
  // 第一个 famous 买：1 跟单；第二个 famous 买：4 跟单 → max=4
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 1100, side: 'buy', w: 'w1' }), {});
  const f1 = fa.buildFactorMap('0xtoken', T0 + 1500);
  check('C1 首窗 → 1', () => assert.strictEqual(f1.famousFollowSlotMaxWallets, 1));
  fa.processTick(mkTick({ ts: T0 + 5000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 5000, side: 'buy', w: 'w2' }), {});
  fa.processTick(mkTick({ ts: T0 + 5500, side: 'buy', w: 'w3' }), {});
  fa.processTick(mkTick({ ts: T0 + 6000, side: 'buy', w: 'w4' }), {});
  fa.processTick(mkTick({ ts: T0 + 6500, side: 'buy', w: 'w5' }), {});
  const f2 = fa.buildFactorMap('0xtoken', T0 + 6500);
  check('C2 第二窗 4 跟单 → max 4', () => assert.strictEqual(f2.famousFollowSlotMaxWallets, 4));
  // famous 在自家窗内再买不计（D 一并锁）
  fa.processTick(mkTick({ ts: T0 + 9000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 9500, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  const f3 = fa.buildFactorMap('0xtoken', T0 + 9500);
  check('C3 窗内 famous 自身买不计跟单 → 仍 4', () => assert.strictEqual(f3.famousFollowSlotMaxWallets, 4));
}

console.log('D. 卖行不计跟单（挤爆=买入压力口径）');
{
  const fa = newFA();
  inject(fa, new Set(['FAMA']));
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 1100, side: 'sell', w: 'wS1' }), {});
  fa.processTick(mkTick({ ts: T0 + 1200, side: 'sell', w: 'wS2' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 1300);
  check('D1 窗内纯卖钱包不计 → 0', () => assert.strictEqual(f.famousFollowSlotMaxWallets, 0));
}

console.log('E. 乱序回推序无关（defer 晚到行）');
{
  const fa = newFA();
  inject(fa, new Set(['FAMA']));
  // 乱序喂：先 +2s、后同块、再 famous 本尊晚到——读点全量扫结果一致
  fa.processTick(mkTick({ ts: T0 + 3000, side: 'buy', w: 'w3' }), {});
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'w1' }), {});
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'FAMA', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 2000, side: 'buy', w: 'w2' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 3000);
  check('E1 乱序喂入同结论 → 3', () => assert.strictEqual(f.famousFollowSlotMaxWallets, 3));
}

console.log('F. 大小写归一（roster 小写 vs 环内原样）');
{
  const fa = newFA();
  inject(fa, new Set(['fama']));
  fa.processTick(mkTick({ ts: T0 + 1000, side: 'buy', w: 'FaMa', bnb: 0.3 }), {});
  fa.processTick(mkTick({ ts: T0 + 1100, side: 'buy', w: 'W1' }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 1200);
  check('F1 混合大小写 famous 识别 + 跟单计数 → 1', () => assert.strictEqual(f.famousFollowSlotMaxWallets, 1));
}

console.log('G. 探针收键');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('G1 famousFollowSlotMaxWallets 在键集', () => assert.ok(keys.has('famousFollowSlotMaxWallets')));
  check('G2 famousCopyWalletSupplyPct 在键集（观察键）', () => assert.ok(keys.has('famousCopyWalletSupplyPct')));
  check('G3 actTotalBnb90s 在键集', () => assert.ok(keys.has('actTotalBnb90s')));
}

console.log(`\n全部通过 ${passed} 断言`);
