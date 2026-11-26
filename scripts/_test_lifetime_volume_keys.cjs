#!/usr/bin/env node
/**
 * FA 跨 prune 全史累计三键单测（2026-11-26 캐시덕 0xe48e 案——用户发现冷寂重启票
 * 买入前交易额显示 1.9B 而全史 27B+）：pruneStaleTokens 30min 无活动整删 state、
 * 复流重建 totalBuyBnb 归零重计 → buyVolumeBnb 只含重启后量。「生命周期结束」
 * 判据需要全史口径 → 新增 lifetimeBuyVolumeBnb/lifetimeSellVolumeBnb/
 * lifetimeTradeVolumeBnb（模块级 _lifetimeVolumes Map，prune 不清、跨 state 生命）。
 *
 * 覆盖：
 *   A. 累积正确性（买卖混排精确值；有证据零值语义=未 tick 时 0 非 null）
 *   B. prune 重建后 lifetime 不回零（事故现场反证：buyVolumeBnb=重启后量、
 *      lifetime*=全史累计）
 *   C. 三键进 getFactorKeys 探针（未知因子三防线自动认得）
 *   D. 源码口径断言（写点与 totalBuyBnb 同位 / 模块级 Map prune 不清）
 *
 * 用法：node scripts/_test_lifetime_volume_keys.cjs（零 DB 零网络）
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
// ⚠模块级 _lifetimeVolumes 跨 FA 实例共享（设计如此，单实验进程常态）——各测试段
// 用独立地址隔离，防跨段污染
const mkTick = (o, addr) => Object.assign({
  token_address: addr, trade_type: 'buy', trader_address: '0xw1', sender_address: '0xw1',
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);
const ADDR_A = '0xaaaa79aba81911fdec13af0173d08c45bc057777';
const ADDR_B = '0xbbbb79aba81911fdec13af0173d08c45bc057777';

function newFA() {
  return new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
}
const feed = (fa, addr, t) => fa.processTick(mkTick(t, addr));

// ═══════════════ A. 累积正确性 + 零值语义 ═══════════════
console.log('A. 累积正确性');
{
  const fa = newFA();
  // 未注册未 tick：三键 0 非 null（有证据零值）
  fa.registerToken(ADDR_A, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  let f = fa.buildFactorMap(ADDR_A, T0 + 60000);
  check('A1 未 tick 三键=0（有证据零值，非 null）', () => {
    assert.strictEqual(f.lifetimeBuyVolumeBnb, 0);
    assert.strictEqual(f.lifetimeSellVolumeBnb, 0);
    assert.strictEqual(f.lifetimeTradeVolumeBnb, 0);
  });
  // 买卖混排
  feed(fa, ADDR_A, { trade_type: 'buy', bnb_amount: 1.5, timestamp: T0 + 1000, block_number: 101 });
  feed(fa, ADDR_A, { trade_type: 'sell', bnb_amount: 0.4, timestamp: T0 + 2000, block_number: 102 });
  feed(fa, ADDR_A, { trade_type: 'buy', bnb_amount: 2.5, timestamp: T0 + 3000, block_number: 103 });
  feed(fa, ADDR_A, { trade_type: 'buy', bnb_amount: 0.6, timestamp: T0 + 4000, block_number: 104 });
  f = fa.buildFactorMap(ADDR_A, T0 + 60000);
  check('A2 lifetimeBuyVolumeBnb = 1.5+2.5+0.6 = 4.6', () => assert.ok(Math.abs(f.lifetimeBuyVolumeBnb - 4.6) < 1e-9));
  check('A3 lifetimeSellVolumeBnb = 0.4', () => assert.ok(Math.abs(f.lifetimeSellVolumeBnb - 0.4) < 1e-9));
  check('A4 lifetimeTradeVolumeBnb = 5.0', () => assert.ok(Math.abs(f.lifetimeTradeVolumeBnb - 5.0) < 1e-9));
  check('A5 与 buyVolumeBnb/sellVolumeBnb 同位一致（无 prune 时两口径相等）', () => {
    assert.ok(Math.abs(f.buyVolumeBnb - 4.6) < 1e-9);
    assert.ok(Math.abs(f.sellVolumeBnb - 0.4) < 1e-9);
  });
}

// ═══════════════ B. prune 重建后 lifetime 不回零（事故现场反证） ═══════════════
console.log('B. prune 重建（캐시덕 案现场）');
{
  const fa = newFA();
  fa.registerToken(ADDR_B, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  // 生命期 1：买入 26.989B（含多笔）
  feed(fa, ADDR_B, { trade_type: 'buy', bnb_amount: 20, timestamp: T0 + 1000, block_number: 101 });
  feed(fa, ADDR_B, { trade_type: 'buy', bnb_amount: 6.989, timestamp: T0 + 2000, block_number: 102 });
  let f = fa.buildFactorMap(ADDR_B, T0 + 60000);
  check('B1 prune 前 buyVolumeBnb = 26.989', () => assert.ok(Math.abs(f.buyVolumeBnb - 26.989) < 1e-9));
  // 冷寂 3 小时 → prune 整删（30min 阈值）
  const pruned = fa.pruneStaleTokens(30 * 60 * 1000, new Set(), T0 + 60000 + 3 * 3600000);
  check('B2 prune 删掉该 state', () => assert.strictEqual(pruned, 1));
  // 复流：重新 register（回测 P17 复流重锚路径同款）+ 重启后仅 1.393B
  fa.registerToken(ADDR_B, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  feed(fa, ADDR_B, { trade_type: 'buy', bnb_amount: 1.393, timestamp: T0 + 60000 + 3 * 3600000 + 1000, block_number: 999 });
  f = fa.buildFactorMap(ADDR_B, T0 + 60000 + 3 * 3600000 + 60000);
  check('B3 buyVolumeBnb 归零重计=1.393（旧键语义保持——现有腿零变化）', () => assert.ok(Math.abs(f.buyVolumeBnb - 1.393) < 1e-9));
  check('B4 lifetimeBuyVolumeBnb=28.382（跨 prune 全史累计不回零——事故现场反证）', () => assert.ok(Math.abs(f.lifetimeBuyVolumeBnb - 28.382) < 1e-9));
  check('B5 lifetimeTradeVolumeBnb=28.382', () => assert.ok(Math.abs(f.lifetimeTradeVolumeBnb - 28.382) < 1e-9));
}

// ═══════════════ C. 探针收键 ═══════════════
console.log('C. getFactorKeys 探针');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('C1 三键进探针（未知因子三防线自动认得）', () => {
    for (const k of ['lifetimeBuyVolumeBnb', 'lifetimeSellVolumeBnb', 'lifetimeTradeVolumeBnb']) {
      assert.ok(keys.has(k), k + ' 缺失（getFactorKeys 返回 Set）');
    }
  });
}

// ═══════════════ D. 源码口径断言 ═══════════════
console.log('D. 源码口径');
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'), 'utf8');
  check('D1 累积写点与 totalBuyBnb 同位（计数段无 skip）', () => {
    const i = src.indexOf('state.totalBuyBnb += isBuy ? bnbAmount : 0;');
    const j = src.indexOf('const lv = _lifetimeVolumes.get(state.tokenAddress)');
    assert.ok(i > 0 && j > 0 && j - i < 400, '写点不在 totalBuyBnb 邻近');
  });
  check('D2 模块级 Map prune 不清（pruneStaleTokens 不引用 _lifetimeVolumes）', () => {
    const p = src.indexOf('pruneStaleTokens(maxAgeMs');
    const lv = src.indexOf('_lifetimeVolumes', p);
    const nextFn = src.indexOf('\n    ', p);
    // _lifetimeVolumes 在 pruneStaleTokens 函数体内不出现
    assert.ok(lv < 0 || lv > nextFn, 'pruneStaleTokens 内引用 _lifetimeVolumes 了');
  });
}

console.log(`\n${failed === 0 ? '✅' : '❌'} lifetime 三键单测：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
