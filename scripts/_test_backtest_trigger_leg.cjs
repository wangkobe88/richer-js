#!/usr/bin/env node
/**
 * C84 回测触发腿单测（2026-10-17 买腿链路重构）——本地零 DB 零网络。
 *
 * 回测无发起/重试轮状态机（实时引擎语义）：narrativeRating 门由 FA 预载常量承担
 * （_preloadNarrativeRows 注入，categoryToRating(resolveFinalRating(row)) 数值链，
 * 非 1/2/3 归 9；token 级全局快照=已知时序穿越，结论只看相对增量）；fire 链不评
 * 触发条件直接 getRating（预载后 memoryCache≈0ms）仅为取 gmgnRisk 供 GMGN 快照
 * 层；刻意不登记拉黑/不算 lag/不跑 P4b 与同叙事龙头检查。
 *
 * 覆盖：
 *   A. preload 门扩（trigger-only 腿也预载；无叙事字段不预载；legacy-only 预载但不注入）
 *   B. FA 常量注入（mid→2 / unrated→9 / 缺行不注入 fail-closed / 形状 rounds=1）
 *   C. fire 链（直调不评触发条件 / 不进拉黑 / 不算 lag / gmgnRisk 供 GMGN 第二层拒买）
 *   D. ctor 锁死（Infinity/0 → retryDue 恒 0，回测无重试轮）
 *
 * 用法：node scripts/_test_backtest_trigger_leg.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { BacktestEngine } = require(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator.js'));
const { shouldBlockOnNarrative } = require(path.join(ROOT, 'src/trading-engine/pre-check/NarrativeDirectCaller.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const ISO = '2026-10-17T00:00:00.000Z';

// ── preload 桩 ──
function makePreloadStub({ strategies, rows = new Map(), tokens = ['0xpre1', '0xpre2'] } = {}) {
  const calls = { preloadAddrs: null };
  const stub = {
    _experimentId: 'bt-c84',
    logger: { info() {}, warn() {}, error() {} },
    _strategyEngine: { getAllStrategies: () => strategies },
    _tokenMeta: new Map(tokens.map(t => [t, {}])),
    _narrativeCaller: {
      preload: async (addrs) => { calls.preloadAddrs = addrs; return { rowCache: rows, tweetRows: 0 }; },
    },
  };
  return { stub, calls };
}
const PRELOAD = BacktestEngine.prototype._preloadNarrativeRows;

(async () => {
  // ═══════════════ A. preload 门扩 ═══════════════
  console.log('A. preload 门');
  await checkAsync('A1 无叙事字段腿 → 不预载（无直调=预载白拉）', async () => {
    const { stub, calls } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x' }, { action: 'sell', condition: 'y', narrativeCallCondition: 'z' }],
    });
    await PRELOAD.call(stub);
    assert.strictEqual(calls.preloadAddrs, null);
  });
  await checkAsync('A2 trigger-only 腿 → 预载（C84 门扩证明）', async () => {
    const { stub, calls } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: 'buyVolumeBnb >= 0.5' }],
    });
    await PRELOAD.call(stub);
    assert.deepStrictEqual(calls.preloadAddrs, ['0xpre1', '0xpre2']);
  });
  await checkAsync('A3 legacy-only 腿 → 预载但零 FA 注入（注入门=存在 trigger 腿）', async () => {
    const { stub } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x', narrativeCallCondition: 'age > 1' }],
      rows: new Map([['0xpre1'.toLowerCase(), { final_result: { rating: 'mid' }, analyzed_at: ISO }]]),
    });
    await PRELOAD.call(stub);
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors('0xpre1'), null,
      'legacy-only 不应注入 FA 常量');
  });

  // ═══════════════ B. FA 常量注入 ═══════════════
  console.log('B. FA 常量注入');
  await checkAsync('B1 mid 行 → rating=2 / rounds=1 / completedAt=Date.parse(analyzed_at) / category 透传', async () => {
    const { stub } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: 'c' }],
      rows: new Map([['0xb1', { final_result: { rating: 'mid' }, analyzed_at: ISO, token_category: 'project' }]]),
      tokens: ['0xB1'], // 键用 _tokenMeta 原键，rowCache 小写查表
    });
    await PRELOAD.call(stub);
    const g = FourMemeFactorAggregator.getNarrativeFactors('0xB1');
    assert.strictEqual(g.rating, 2);
    assert.strictEqual(g.rounds, 1);
    assert.strictEqual(g.completedAt, Date.parse(ISO));
    assert.strictEqual(g.accountOnly, false);
    assert.strictEqual(g.inFlight, false);
    assert.strictEqual(g.category, 'project'); // Nightshift 案第四键：row.token_category 透传
    FourMemeFactorAggregator.clearNarrativeFactors('0xB1');
  });
  await checkAsync('B2 unrated 行 → 归 9（非 1/2/3 fail 归一）；缺 token_category 列 → category null', async () => {
    const { stub } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: 'c' }],
      rows: new Map([['0xb2', { final_result: { rating: 'unrated' } }]]),
      tokens: ['0xB2'],
    });
    await PRELOAD.call(stub);
    const g2 = FourMemeFactorAggregator.getNarrativeFactors('0xB2');
    assert.strictEqual(g2.rating, 9);
    assert.strictEqual(g2.category, null); // 缺列 null（IS NULL 臂放行语义）
    FourMemeFactorAggregator.clearNarrativeFactors('0xB2');
  });
  await checkAsync('B3 缺行 token 不注入 → null → 条件恒 false 不买（fail-closed 同向）', async () => {
    const { stub } = makePreloadStub({
      strategies: [{ action: 'buy', condition: 'x', narrativeTriggerCondition: 'c' }],
      rows: new Map(),
      tokens: ['0xB3'],
    });
    await PRELOAD.call(stub);
    assert.strictEqual(FourMemeFactorAggregator.getNarrativeFactors('0xB3'), null);
  });

  // ═══════════════ C. fire 链 ═══════════════
  console.log('C. fire 链（prototype.call 驱动 _evaluateBuyPath）');
  const TOKEN = '0xC84Test00000000000000000000000000000001';
  const TOKEN_OBJ = { token: TOKEN, chain: 'bsc', symbol: 'C84', platform: 'fourmeme', strategyExecutions: { preset: 1 } };
  function baseRating(over = {}) {
    return Object.assign({
      numericRating: 2, rating: 'mid', reason: null, fromCache: false,
      durationMs: 1, timedOut: false, error: null,
      sourceTweetId: null, gmgnRisk: null, precheckStage: null,
    }, over);
  }
  function makeFireStub({ strategy, ratingResult }) {
    const logs = [];
    const evalConds = [];
    return {
      __logs: logs, __evalConds: evalConds,
      _experimentId: 'bt-c84',
      _buyingTokens: new Set(),
      _narrativeBlockedTokens: new Set(),
      _shouldBlockOnNarrative: shouldBlockOnNarrative,
      _strategyEngine: {
        evaluate: () => strategy,
        evaluateCondition: (cond) => { evalConds.push(String(cond)); return true; },
        getAllStrategies: () => [],
      },
      _tokenPool: {
        initStrategyExecutions: () => {},
        getCurrentRound: () => 0,
        getLastPairReturnRate: () => 0,
      },
      _factorAggregator: { getTokenState: () => null, markBuyFire: () => {}, clearBuyFire: () => {} },
      logger: {
        info: (id, tag, msg) => logs.push(msg),
        warn: () => {}, error: () => {},
      },
      _narrativeCaller: {
        getRatingCalls: 0,
        async getRating() { this.getRatingCalls++; return ratingResult; },
      },
      _sameNarrativeLeaderService: { check: async () => { throw new Error('龙头检查不应触达'); } },
      _preBuyCheckService: null,
      _tokenBlacklist: new Map(),
      _permanentBlockCondition: null,
      _tokenMeta: new Map(),
      _writeBufferEnabled: true,
      _writeBuffer: { signalInserts: 0, addSignalInsert() { this.signalInserts++; } },
      metrics: { totalSignals: 0, executedSignals: 0 },
      _loopCount: 0,
      _calculateBuyAmount: () => 0.1,
      _executeBuy: async () => ({ success: false, reason: 'stub-no-buy' }),
      _bufferSignalUpdate: () => {},
      _mapGmgnRiskFactors: (r) => r, // 已映射形状直评（映射链归 _test_gmgn_check_layer）
    };
  }
  const TRIG_STRATEGY = {
    id: 'buy_trig', name: '触发腿', priority: 1,
    narrativeTriggerCondition: 'buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1',
    narrativeCallCondition: null,
    preBuyCheckCondition: null, repeatBuyCheckCondition: null, gmgnCheckCondition: null,
  };
  const runFire = (stub) => BacktestEngine.prototype._evaluateBuyPath.call(
    stub, TOKEN_OBJ, { currentPrice: 1e-6, age: 10 }, { platform: 'fourmeme' }, Date.now());

  await checkAsync('C1 trigger 腿：直调发生且不评触发条件（条件串零出现）', async () => {
    const stub = makeFireStub({ strategy: { ...TRIG_STRATEGY }, ratingResult: baseRating() });
    await runFire(stub);
    assert.strictEqual(stub._narrativeCaller.getRatingCalls, 1);
    assert.ok(!stub.__evalConds.some(c => c.includes('narrativeRetryDue')),
      `触发条件被评估: ${stub.__evalConds.join(' | ')}`);
    assert.ok(stub.__logs.some(l => l.includes('叙事直调(触发腿,回放)')), '触发腿直调日志缺失');
  });
  await checkAsync('C2 rating=1 非豁免 → 不登记拉黑（拉黑语义=条件即门，回测无对应物）', async () => {
    const stub = makeFireStub({
      strategy: { ...TRIG_STRATEGY },
      ratingResult: baseRating({ numericRating: 1, rating: 'low', precheckStage: null }),
    });
    await runFire(stub);
    assert.strictEqual(stub._narrativeBlockedTokens.has(TOKEN), false,
      '触发腿不应登记 _narrativeBlockedTokens');
  });
  await checkAsync('C3 直调不算 lag（narrativeCorpusLagSec 留 null 语义——源码零 lag 赋值）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    const seg = src.slice(src.indexOf('if (preCheckPassed && narrativeTriggerCondition) {'),
      src.indexOf('} else if (narrativeCallCondition && preCheckPassed'));
    assert.ok(seg.length > 0, '触发腿分支缺失');
    assert.ok(!/narrativeCorpusLagSec\s*=/.test(seg), '触发腿分支不应算 lag');
    assert.ok(!/_narrativeBlockedTokens\.add/.test(seg), '触发腿分支不应登记拉黑');
    assert.ok(!/_shouldBlockOnNarrative/.test(seg), '触发腿分支不应评拉黑');
  });
  await checkAsync('C4 gmgnRisk 供 GMGN 第二层：bundler 80>75 → 拒买 reason=GMGN', async () => {
    const stub = makeFireStub({
      strategy: { ...TRIG_STRATEGY, gmgnCheckCondition: 'gmgnBundlerWalletRatio <= 75' },
      ratingResult: baseRating({ gmgnRisk: {
        gmgnBundlerWalletRatio: 80, gmgnIssuerTokenCount: 2, gmgnRiskCovered: 1, gmgnVisitingCount: 5,
      } }),
    });
    const r = await runFire(stub);
    assert.strictEqual(r.success, false);
    assert.ok(String(r.reason).includes('GMGN 条件未过'), r.reason);
    assert.strictEqual(stub._narrativeCaller.getRatingCalls, 1); // gmgnRisk 来自触发腿直调
  });
  await checkAsync('C5 bundler 50 → GMGN 过 → 走到执行段（非 GMGN 拒）', async () => {
    const stub = makeFireStub({
      strategy: { ...TRIG_STRATEGY, gmgnCheckCondition: 'gmgnBundlerWalletRatio <= 75' },
      ratingResult: baseRating({ gmgnRisk: {
        gmgnBundlerWalletRatio: 50, gmgnIssuerTokenCount: 2, gmgnRiskCovered: 1, gmgnVisitingCount: 5,
      } }),
    });
    const r = await runFire(stub);
    assert.ok(!String(r.reason).includes('GMGN'), r.reason);
  });

  // ═══════════════ D. ctor 锁死 retryDue ═══════════════
  console.log('D. retryDue 锁死');
  {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xD1', { createdAtMs: 1e12, totalSupply: 1e9, symbol: 'D', creatorAddress: null });
    fa.processTick({
      token_address: '0xD1', trade_type: 'buy', trader_address: 'w', sender_address: null,
      price_bnb: 1e-5, price_usd: 5, bnb_amount: 1, token_amount: 1000,
      block_number: 1, timestamp: 1e12 + 1000, tx_hash: '0x', log_index: 0,
    }, {});
    FourMemeFactorAggregator.setNarrativeFactorConfig({ intervalMs: Infinity, maxAnalyses: 0 }); // ctor 同款
    FourMemeFactorAggregator.setNarrativeFactors('0xD1', {
      rating: 1, rounds: 1, completedAt: Date.now(), accountOnly: true, inFlight: false,
    });
    check('D1 Infinity/0 锁死下 rating=1+账号型+到期 → retryDue 仍 0（回测无重试轮）', () => {
      assert.strictEqual(fa.buildFactorMap('0xD1', Date.now() + 1e7).narrativeRetryDue, 0);
    });
    FourMemeFactorAggregator.clearNarrativeFactors('0xD1');
    FourMemeFactorAggregator.setNarrativeFactorConfig(
      FourMemeFactorAggregator.getNarrativeFactorDefaults()); // 复位防串台
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})();
