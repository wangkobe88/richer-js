#!/usr/bin/env node
/**
 * replay-observation-factors 口径自测（T74/T76 观察键历史回放，2026-10-27）——
 * 本地零 DB 零网络：只测纯函数 replayToken（脚本 DB 部分在 182 跑）。
 *
 * 断言口径逐条对 FA 源码：尘 tick 门 0.001 / wallet=sender||trader / buyWallets
 * 曾买入即计入清仓不回退 / evenCluster 合格桶 size>=3+尘门 0.01+并集正净持仓 /
 * 比值键=computeGmgnAttentionFactors 单一真相源 / 多 signal 截断点各自 as-of。
 *
 * 用法：node scripts/_test_replay_observation_factors.cjs
 */
'use strict';

const assert = require('assert');
const { replayToken } = require('./replay-observation-factors.cjs');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const tick = (o) => Object.assign({
  trade_type: 'buy', sender_address: null, trader_address: null,
  bnb_amount: 0.1, token_amount: 100, block_time: new Date(1000).toISOString(),
}, o);
const sig = (ms, vc = null, vcCovered = null) => ({
  row: { id: ms, fired_at: new Date(ms).toISOString() }, firedMs: ms, vc, vcCovered,
});

console.log('== A. 基础口径 ==');
check('A1 尘 tick（<0.001 BNB）不进回放域（buyVolume/buyWallets 都不计）', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.0009, token_amount: 5 }),
    tick({ sender_address: 'w2', bnb_amount: 0.1 }),
  ], [sig(5000)]);
  assert.strictEqual(r[0].buyWallets, 1);
  assert.ok(Math.abs(r[0].buyVolumeBnb - 0.1) < 1e-12);
  assert.strictEqual(r[0].circTokens, 100);          // 尘行 token 也不进 circTokens
});
check('A2 wallet=sender||trader：trader 回退行照计（sender NULL）', () => {
  const r = replayToken([
    tick({ trader_address: 'router', bnb_amount: 0.1 }),
  ], [sig(5000)]);
  assert.strictEqual(r[0].buyWallets, 1);
});
check('A3 buyWallets 清仓不回退（w2 卖光仍计入），circTokens/净持仓照减', () => {
  const r = replayToken([
    tick({ sender_address: 'w1' }),
    tick({ sender_address: 'w2' }),
    tick({ trade_type: 'sell', sender_address: 'w2', token_amount: 100 }),
  ], [sig(5000)]);
  assert.strictEqual(r[0].buyWallets, 2);
  assert.strictEqual(r[0].circTokens, 100);
});
check('A4 多 signal 截断点各自 as-of：fire1 只见前两行、fire2 见全部', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', block_time: new Date(1000).toISOString() }),
    tick({ sender_address: 'w2', block_time: new Date(2000).toISOString() }),
    tick({ sender_address: 'w3', block_time: new Date(4000).toISOString() }),
  ], [sig(2500), sig(5000)]);
  assert.strictEqual(r[0].buyWallets, 2);
  assert.strictEqual(r[1].buyWallets, 3);
  assert.strictEqual(r[1].circTokens, 300);
});

console.log('== B. evenCluster 口径（T74 照抄 FA 读点） ==');
check('B1 合格桶 size>=3：三钱包同额 → evenPct=100（并集=全部流通）', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.15 }),
    tick({ sender_address: 'w2', bnb_amount: 0.15 }),
    tick({ sender_address: 'w3', bnb_amount: 0.15 }),
  ], [sig(5000)]);
  assert.strictEqual(r[0].evenClusterHoldCircPct, 100);
  assert.strictEqual(r[0].evenClusterWallets, 3);
  assert.strictEqual(r[0].evenClusterGroups, 1);
});
check('B2 桶 size=2 不合格（<3=常见巧合）；尘门 0.01 以下不入桶', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.15 }),
    tick({ sender_address: 'w2', bnb_amount: 0.15 }),
    tick({ sender_address: 'w3', bnb_amount: 0.009, token_amount: 50 }),  // 尘门下不入桶
  ], [sig(5000)]);
  assert.strictEqual(r[0].evenClusterHoldCircPct, 0);
  assert.strictEqual(r[0].evenClusterGroups, 0);
  assert.strictEqual(r[0].circTokens, 250);          // 尘门只拦桶不拦计量
});
check('B3 正净持仓门：桶内钱包清仓的不计分子（netTokens<=0 剔）', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.15 }),
    tick({ sender_address: 'w2', bnb_amount: 0.15 }),
    tick({ sender_address: 'w3', bnb_amount: 0.15 }),
    tick({ sender_address: 'w4', bnb_amount: 2, token_amount: 200 }),    // 非等额买（对照流通）
    tick({ trade_type: 'sell', sender_address: 'w1', token_amount: 100 }),
  ], [sig(5000)]);
  // 并集 {w1,w2,w3} 正净持仓 = 0+100+100=200；流通=200+200−100=400
  assert.strictEqual(r[0].evenClusterHoldCircPct, 50);
  assert.strictEqual(r[0].evenClusterWallets, 3);   // 并集钱包数照计（清仓不剔）
});
check('B4 复买跨桶只计一份筹码（amountKey=bnb.toFixed(6)，并集去重）', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.1 }),
    tick({ sender_address: 'w1', bnb_amount: 0.2 }),
    tick({ sender_address: 'w2', bnb_amount: 0.1 }),
    tick({ sender_address: 'w3', bnb_amount: 0.1 }),
    tick({ sender_address: 'w4', bnb_amount: 0.2 }),
    tick({ sender_address: 'w5', bnb_amount: 0.2 }),
  ], [sig(5000)]);
  // 两合格桶 0.1{w1,w2,w3} 0.2{w1,w4,w5} 并集 5 钱包；w1 净持仓 200 只计一份
  assert.strictEqual(r[0].evenClusterGroups, 2);
  assert.strictEqual(r[0].evenClusterWallets, 5);
  assert.strictEqual(r[0].evenClusterHoldCircPct, 100);
});

console.log('== C. 比值键（computeGmgnAttentionFactors 单一真相源） ==');
check('C1 vc=37 / 2 买家 / 1.2 BNB → perBuyer 18.5 / perBuyBnb 30.8（round1）', () => {
  const r = replayToken([
    tick({ sender_address: 'w1', bnb_amount: 0.7 }),
    tick({ sender_address: 'w2', bnb_amount: 0.5 }),
  ], [sig(5000, 37, 1)]);
  assert.strictEqual(r[0].visitorsPerBuyer, 18.5);
  assert.strictEqual(r[0].visitorsPerBuyBnb, 30.8);
});
check('C2 零买家上限形状：vc=9 无买盘 → 比值取 vc（T76 语义透传）', () => {
  const r = replayToken([], [sig(5000, 9, 1)]);
  assert.strictEqual(r[0].visitorsPerBuyer, 9);
  assert.strictEqual(r[0].visitorsPerBuyBnb, 9);
  assert.strictEqual(r[0].buyWallets, 0);
});
check('C3 covered=0（fail-open 行）→ 比值 0 不合成（metadata 对照可见）', () => {
  const r = replayToken([tick({ sender_address: 'w1' })], [sig(5000, 88, 0)]);
  assert.strictEqual(r[0].visitorsPerBuyer, 0);
  assert.strictEqual(r[0].vcCovered, 0);
});
check('C4 无 gmgn 快照的老信号（v22-v30 票池）→ 比值 null 不参与分布', () => {
  const r = replayToken([tick({ sender_address: 'w1' })], [sig(5000)]);
  assert.strictEqual(r[0].visitorsPerBuyer, null);
  assert.strictEqual(r[0].vc, null);
});

console.log(`\n${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
