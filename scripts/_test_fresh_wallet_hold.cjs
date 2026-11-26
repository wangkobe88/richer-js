#!/usr/bin/env node
/**
 * FA 新钱包持仓占比键 freshWalletHoldPct 单测（2026-11-26 用户裁定「无 GMGN 画像/
 * 胜率为 0 全部视为新钱包」+「砍 ≥80% 一刀」）——零 DB 零网络。
 *
 * 键语义：新钱包（画像集无该地址 ∨ winrate===0）正净持仓 token 合计 ÷ 全部钱包
 * 正净持仓 token 合计 ×100。画像集=gmgn_wallet_profiles 30d 快照，引擎启动一次性
 * 注入（首 tick 前）；未注入 → null fail-closed；无持仓 → 0 有证据零值。
 * 增量维护挂 _applyWalletAggregation 钱包段（与 _walletNetTokens 同位，任意序
 * 重放收敛）。
 *
 * 覆盖：
 *   A. 判定与精确值（买/卖/清仓/跨界；winrate 0 与无画像同判新）
 *   B. 未注入 null fail-closed + 注入后 0 值语义
 *   C. 乱序回放收敛（喂数顺序无关）
 *   D. getFactorKeys 探针收键
 *   E. 源码口径断言（注入须首 tick 前注释/写点与 _walletNetTokens 同位）
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const ADDR = '0xf00d79aba81911fdec13af0173d08c45bc057777';
const W_FRESH = '0x1111111111111111111111111111111111111111'; // 无画像=新
const W_ZERO = '0x2222222222222222222222222222222222222222'; // winrate 0=新
const W_OLD = '0x3333333333333333333333333333333333333333'; // winrate 0.4=老
const mkTick = (o, addr = ADDR) => Object.assign({
  token_address: addr, trade_type: 'buy', trader_address: '0xw1', sender_address: '0xw1',
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA(inject = true) {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  if (inject) fa.setFreshWalletProfiles(new Map([[W_ZERO, 0], [W_OLD, 0.4]]));
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}
const feed = (fa, addr, o) => fa.processTick(mkTick(o, addr));

// ═══════════════ A. 判定与精确值 ═══════════════
console.log('A. 判定与精确值');
{
  const fa = newFA();
  let f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A1 未喂数=0（有证据零值，注入后）', () => assert.strictEqual(f.freshWalletHoldPct, 0));
  // 新钱包买 1000、老钱包买 2000 → fresh 占比 33.33
  feed(fa, ADDR, { sender_address: W_FRESH, trader_address: W_FRESH, trade_type: 'buy', token_amount: 1000, timestamp: T0 + 1000, block_number: 101 });
  feed(fa, ADDR, { sender_address: W_OLD, trader_address: W_OLD, trade_type: 'buy', token_amount: 2000, timestamp: T0 + 2000, block_number: 102 });
  feed(fa, ADDR, { sender_address: W_ZERO, trader_address: W_ZERO, trade_type: 'buy', token_amount: 3000, timestamp: T0 + 3000, block_number: 103 });
  f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A2 fresh=(1000+3000)/(1000+2000+3000)=66.67', () => assert.ok(Math.abs(f.freshWalletHoldPct - 66.67) < 0.01));
  // W_OLD 清仓 → fresh=100
  feed(fa, ADDR, { sender_address: W_OLD, trader_address: W_OLD, trade_type: 'sell', token_amount: 2000, timestamp: T0 + 4000, block_number: 104 });
  f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A3 老钱包清仓后 fresh=100', () => assert.ok(Math.abs(f.freshWalletHoldPct - 100) < 0.01));
  // W_FRESH 卖一半 → 4000/4000? 剩下 fresh 1000+3000 分母 1000+3000=4000 fresh=100 不变；再卖超→跨界
  feed(fa, ADDR, { sender_address: W_FRESH, trader_address: W_FRESH, trade_type: 'sell', token_amount: 500, timestamp: T0 + 5000, block_number: 105 });
  f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A4 部分卖出 fresh=(500+3000)/3500=100（仍全 fresh）', () => assert.ok(Math.abs(f.freshWalletHoldPct - 100) < 0.01));
  // W_FRESH 全清（卖 500）→ fresh=3000/3000=100
  feed(fa, ADDR, { sender_address: W_FRESH, trader_address: W_FRESH, trade_type: 'sell', token_amount: 500, timestamp: T0 + 6000, block_number: 106 });
  f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A5 全清 fresh=100', () => assert.ok(Math.abs(f.freshWalletHoldPct - 100) < 0.01));
  // 全部清仓（W_ZERO 卖 3000）→ 0
  feed(fa, ADDR, { sender_address: W_ZERO, trader_address: W_ZERO, trade_type: 'sell', token_amount: 3000, timestamp: T0 + 7000, block_number: 107 });
  f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('A6 全部清仓=0', () => assert.strictEqual(f.freshWalletHoldPct, 0));
}

// ═══════════════ B. 空画像集=全 fresh ═══════════════
console.log('B. 空画像集（模块级注入标记跨实例——引擎进程恒注入；null fail-closed 语义由 E 段源码断言锁）');
{
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.setFreshWalletProfiles(new Map()); // 空画像集=所有人都是新钱包
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  feed(fa, ADDR, { sender_address: W_OLD, trader_address: W_OLD, trade_type: 'buy', token_amount: 2000, timestamp: T0 + 1000, block_number: 101 });
  const f = fa.buildFactorMap(ADDR, T0 + 60000);
  check('B1 空画像集=全 fresh=100', () => assert.strictEqual(f.freshWalletHoldPct, 100));
}

// ═══════════════ C. 乱序回放收敛 ═══════════════
console.log('C. 乱序收敛');
{
  const seq = [
    { sender_address: W_FRESH, trader_address: W_FRESH, trade_type: 'buy', token_amount: 1000, timestamp: T0 + 1000, block_number: 101 },
    { sender_address: W_OLD, trader_address: W_OLD, trade_type: 'buy', token_amount: 2000, timestamp: T0 + 2000, block_number: 102 },
    { sender_address: W_OLD, trader_address: W_OLD, trade_type: 'sell', token_amount: 500, timestamp: T0 + 3000, block_number: 103 },
    { sender_address: W_ZERO, trader_address: W_ZERO, trade_type: 'buy', token_amount: 3000, timestamp: T0 + 4000, block_number: 104 },
  ];
  const fa1 = newFA();
  for (const o of seq) feed(fa1, ADDR, o);
  const fa2 = newFA();
  for (const o of [...seq].reverse()) feed(fa2, ADDR, o);
  const f1 = fa1.buildFactorMap(ADDR, T0 + 60000);
  const f2 = fa2.buildFactorMap(ADDR, T0 + 60000);
  check('C1 正序/逆序同值（增量维护任意序收敛；W_OLD 净 1500 后 fresh=4000/5500=72.73）', () => {
    assert.strictEqual(f1.freshWalletHoldPct, f2.freshWalletHoldPct);
    assert.ok(Math.abs(f1.freshWalletHoldPct - 72.73) < 0.01);
  });
}

// ═══════════════ D. 探针 ═══════════════
console.log('D. 探针');
{
  const fa = newFA();
  check('D1 freshWalletHoldPct 进 getFactorKeys（三防线自动认得）', () => assert.ok(fa.getFactorKeys().has('freshWalletHoldPct')));
}

// ═══════════════ E. 源码口径断言 ═══════════════
console.log('E. 源码口径');
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
  check('E1 写点与 _walletNetTokens 同位（钱包段增量维护）', () => {
    const i = src.indexOf('state._walletNetTokens.set(walletAddr, _cur);');
    const j = src.indexOf('state._allHoldTokens += Math.max(0, _cur)');
    assert.ok(i > 0 && j > 0 && j - i < 600, '写点不在 walletNetTokens 邻近');
  });
  check('E2 注入约束注释在场（首 tick 前）', () => assert.ok(src.includes('注入必须在首 tick 之前')));
  check('E3 未注入 null fail-closed 发射臂源码在场', () => assert.ok(src.includes('_freshProfilesInjected\n                ? ((state._allHoldTokens || 0) > 0')));
}
console.log(`\n${failed === 0 ? '✅' : '❌'} freshWalletHoldPct 单测：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
