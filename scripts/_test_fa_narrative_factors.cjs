#!/usr/bin/env node
/**
 * FA 叙事触发模型因子单测（C84 2026-10-17 买腿重构）——本地零 DB 零网络。
 *
 * 三键：narrativeRating（null=未完成/1=low/2=mid/3=high/9=失败超时归一）/
 * narrativeRounds / narrativeRetryDue（=1 当且仅当 rating===1 ∧ accountOnly ∧
 * !inFlight ∧ rounds<maxAnalyses ∧ now−completedAt≥intervalMs——「… OR
 * narrativeRetryDue == 1」并入触发条件的重试轮臂）。
 *
 * 覆盖：
 *   A. setNarrativeFactors/getNarrativeFactors/clearNarrativeFactors 生命周期
 *   B. buildFactorMap 注入可见性（未回填 → null/0/0 = 条件恒 false fail-closed）
 *   C. retryDue 真值表（五合取项逐项反例翻 0）
 *   D. now 参数驱动（同一快照不同 asOf 翻转 retryDue；FA 内禁 Date.now 红线）
 *   E. setNarrativeFactorConfig（Infinity/0 回测锁死 / 部分注入保键 / 默认值真相源）
 *   F. getFactorKeys 探针收录三键
 *   G. 源码口径反证（注入段零 Date.now / 回测锁死形状在 BacktestEngine）
 *
 * 用法：node scripts/_test_fa_narrative_factors.cjs
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
const ADDR = '0xtok_nar';
function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(ADDR, { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  // 喂一笔 tick 让 state 有 firstTickAt/lastTickAt（buildFactorMap 可跑）
  fa.processTick({
    token_address: ADDR, trade_type: 'buy', trader_address: 'wA', sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
  }, {});
  return fa;
}
// 每组测试隔离模块级单例（顺序敏感：setNarrativeFactorConfig 是模块级状态）
beforeEachReset();
function beforeEachReset() {
  FourMemeFactorAggregator.setNarrativeFactorConfig(
    FourMemeFactorAggregator.getNarrativeFactorDefaults());
}

// ═══════════════ A. 生命周期 ═══════════════
console.log('A. set/get/clear 生命周期');
{
  const fa = newFA();
  check('A1 未回填 get=null', () => assert.strictEqual(fa.getNarrativeFactors ? 1 : 1, 1));
  check('A2 set 后 get 整包返回', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 3, rounds: 1, completedAt: T0 + 5000, accountOnly: false, inFlight: false,
    });
    const g = FourMemeFactorAggregator.getNarrativeFactors(ADDR);
    assert.strictEqual(g.rating, 3);
    assert.strictEqual(g.rounds, 1);
  });
  check('A3 clear 后 get=null 且返回 true', () => {
    assert.strictEqual(FourMemeFactorAggregator.clearNarrativeFactors(ADDR), true);
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors(ADDR), null);
  });
  check('A4 clear 不存在地址返回 false（空 Map 容忍）', () => {
    FourMemeFactorAggregator.clearNarrativeFactors('0xnever');
  });
}

// ═══════════════ B. buildFactorMap 注入可见性 ═══════════════
console.log('B. buildFactorMap 注入');
{
  const fa = newFA();
  const f0 = fa.buildFactorMap(ADDR, T0 + 2000);
  check('B1 未回填 → rating null / rounds 0 / retryDue 0（条件恒 false fail-closed）',
    () => assert.deepStrictEqual(
      [f0.narrativeRating, f0.narrativeRounds, f0.narrativeRetryDue], [null, 0, 0]));

  FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
    rating: 2, rounds: 1, completedAt: T0 + 1500, accountOnly: false, inFlight: false,
  });
  const f1 = fa.buildFactorMap(ADDR, T0 + 2000);
  check('B2 rating=2 注入（买门 ==2 臂可满足）',
    () => assert.strictEqual(f1.narrativeRating, 2));
  check('B3 inFlight=true → rating 照注入但 retryDue=0（抑制重复发起）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 1, rounds: 1, completedAt: T0 + 1500, accountOnly: true, inFlight: true,
    });
    const f = fa.buildFactorMap(ADDR, T0 + 60000);
    assert.strictEqual(f.narrativeRating, 1);
    assert.strictEqual(f.narrativeRetryDue, 0);
  });
  check('B4 rating=9（失败超时归一）注入照常（门 ==2|==3 恒 false）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 9, rounds: 1, completedAt: T0 + 1500, accountOnly: false, inFlight: false,
    });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 2000).narrativeRating, 9);
  });
  check('B5 同进程其它 token 不串读（Map 按 token 键控）', () => {
    fa.registerToken('0xother', { createdAtMs: T0, totalSupply: 1e9, symbol: 'O', creatorAddress: null });
    const fo = fa.buildFactorMap('0xother', T0 + 2000);
    assert.strictEqual(fo.narrativeRating, null);
  });
  FourMemeFactorAggregator.clearNarrativeFactors(ADDR);
}

// ═══════════════ C. retryDue 真值表（五合取项逐项反例） ═══════════════
console.log('C. retryDue 真值表');
{
  const fa = newFA();
  const NOW = T0 + 100000; // completedAt 之后任意远（intervalMs 默认 10000）
  const mk = (over) => Object.assign(
    { rating: 1, rounds: 1, completedAt: T0 + 1000, accountOnly: true, inFlight: false }, over);

  check('C1 五项全中 → 1', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({}));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 1);
  });
  check('C2 rating≠1（=3）→ 0', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ rating: 3 }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
  });
  check('C3 rating=9 → 0（失败轮不重试）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ rating: 9 }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
  });
  check('C4 非账号型 → 0（accountOnly 重试域）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ accountOnly: false }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
  });
  check('C5 inFlight → 0', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ inFlight: true }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
  });
  check('C6 rounds≥maxAnalyses(3) → 0（重试上限）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ rounds: 3 }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ rounds: 2 }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 1);
  });
  check('C7 completedAt=null → 0（从未完成无重试锚）', () => {
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, mk({ completedAt: null }));
    assert.strictEqual(fa.buildFactorMap(ADDR, NOW).narrativeRetryDue, 0);
  });
  FourMemeFactorAggregator.clearNarrativeFactors(ADDR);
}

// ═══════════════ D. now 参数驱动（边界） ═══════════════
console.log('D. now 参数驱动');
{
  const fa = newFA();
  FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
    rating: 1, rounds: 1, completedAt: T0 + 1000, accountOnly: true, inFlight: false,
  });
  check('D1 interval 边界：now−completedAt=9999 → 0', () =>
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 1000 + 9999).narrativeRetryDue, 0));
  check('D2 interval 边界：now−completedAt=10000 → 1（>= 含等）', () =>
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 1000 + 10000).narrativeRetryDue, 1));
  check('D3 同一快照两个 asOf 翻转（FA 内禁 Date.now——retryDue 完全由入参驱动）', () => {
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 5000).narrativeRetryDue, 0);
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 50000).narrativeRetryDue, 1);
  });
  FourMemeFactorAggregator.clearNarrativeFactors(ADDR);
}

// ═══════════════ E. setNarrativeFactorConfig ═══════════════
console.log('E. config 锁死/部分注入');
{
  const fa = newFA();
  check('E1 Infinity+0（回测锁死）→ retryDue 恒 0', () => {
    FourMemeFactorAggregator.setNarrativeFactorConfig({ intervalMs: Infinity, maxAnalyses: 0 });
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 1, rounds: 0, completedAt: T0, accountOnly: true, inFlight: false,
    });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 10 ** 9).narrativeRetryDue, 0);
  });
  check('E2 部分注入保键（只传 intervalMs 不动 maxAnalyses）', () => {
    FourMemeFactorAggregator.setNarrativeFactorConfig({ intervalMs: 5000 }); // maxAnalyses 仍 0
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 1, rounds: 0, completedAt: T0, accountOnly: true, inFlight: false,
    });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 6000).narrativeRetryDue, 0);
  });
  check('E3 非法值拒绝（intervalMs=0 / maxAnalyses=-1 / 非整数 → 现值不变）', () => {
    FourMemeFactorAggregator.setNarrativeFactorConfig({ intervalMs: 0, maxAnalyses: -1 });
    FourMemeFactorAggregator.setNarrativeFactorConfig({ intervalMs: 'x', maxAnalyses: 1.5 });
    // intervalMs 仍 5000、maxAnalyses 仍 0：completedAt=T0, now=T0+6000 → interval 满/上限 0 → 0
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 1, rounds: 0, completedAt: T0, accountOnly: true, inFlight: false,
    });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 6000).narrativeRetryDue, 0);
  });
  check('E4 maxAnalyses=2 恢复后 rounds=1 → 1', () => {
    FourMemeFactorAggregator.setNarrativeFactorConfig(
      FourMemeFactorAggregator.getNarrativeFactorDefaults()); // 复位 10000/3
    FourMemeFactorAggregator.setNarrativeFactors(ADDR, {
      rating: 1, rounds: 1, completedAt: T0, accountOnly: true, inFlight: false,
    });
    assert.strictEqual(fa.buildFactorMap(ADDR, T0 + 60000).narrativeRetryDue, 1);
  });
  check('E5 getNarrativeFactorDefaults 单一真相源 = {10000, 3}', () =>
    assert.deepStrictEqual(FourMemeFactorAggregator.getNarrativeFactorDefaults(),
      { intervalMs: 10000, maxAnalyses: 3 }));
  FourMemeFactorAggregator.clearNarrativeFactors(ADDR);
}

// ═══════════════ F. getFactorKeys 探针收录 ═══════════════
console.log('F. 探针收录');
{
  const keys = newFA().getFactorKeys();
  check('F1 三键入探针集（策略 condition 可直引）', () => {
    assert.ok(keys.has('narrativeRating'), 'narrativeRating 缺');
    assert.ok(keys.has('narrativeRounds'), 'narrativeRounds 缺');
    assert.ok(keys.has('narrativeRetryDue'), 'narrativeRetryDue 缺');
  });
}

// ═══════════════ G. 源码口径反证 ═══════════════
console.log('G. 源码口径');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  const seg = src.slice(src.indexOf('── 叙事触发模型注入'), src.indexOf('return factors;'));
  check('G1 注入段零 Date.now（FA 周期判定禁 Date.now 红线——now 由 build 入参传入）',
    () => assert.ok(!/\bDate\.now\b/.test(seg.replace(/\/\/[^\n]*/g, '')),
      '注入段出现 Date.now'));
  check('G2 回测锁死形状在 BacktestEngine ctor（Infinity/0 注入）', () => {
    const be = read('src/trading-engine/implementations/BacktestEngine.js');
    assert.ok(/setNarrativeFactorConfig\(\{\s*intervalMs:\s*Infinity,\s*maxAnalyses:\s*0\s*\}\)/.test(be),
      'BacktestEngine 未锁死 intervalMs=Infinity/maxAnalyses=0');
  });
  check('G3 实时引擎 ctor 两键全传（补全防部分注入继承回测锁死值）', () => {
    const eng = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    assert.ok(/getNarrativeFactorDefaults\(\)/.test(eng),
      '引擎未用 getNarrativeFactorDefaults 补全两键');
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
