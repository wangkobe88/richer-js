#!/usr/bin/env node
/**
 * 回测叙事否决拉黑（P0-1，bc4f756e 性能案 2026-09-28）——本地零 DB 单测
 *
 * BacktestEngine._evaluateBuyPath 两挂点（镜像实时引擎 FourMemeWssTradingEngine
 * L986-994/L1080-1092），以 prototype.call(stub) 方式驱动，全部 this.* 成员打桩：
 *
 *   A. 挂点一短路：blocked token + 腿带 narrativeCallCondition → 无 signal 行 /
 *      无叙事直调 / 无 pre-buy，reason=叙事否决短路
 *   B. 挂点二登记：rating=1 非豁免形状 → 登记（首个 signal 已落=镜像实时引擎
 *      「代价一条 signal 行」语义）
 *   C. address 豁免：rating=1 + precheckStage='address' + age<5min → 不登记
 *      （宣告竞态重试窗内，等 PrecheckFailRetryService 重析翻正）
 *   D. 门关语义：腿不带 narrativeCallCondition → blocked 集不生效，链路完整走通
 *      （存量策略零影响，opt-in）
 *   E. rating=2（PASS 终态）→ 不登记；rating=1 + address 出窗(age≥5min) → 登记
 *
 * 用法：node scripts/_test_backtest_narrative_gate.cjs
 */

'use strict';

const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');
const { shouldBlockOnNarrative } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

/**
 * 构造 _evaluateBuyPath 的 stub this（字段清单与该方法体逐一对应）
 * @param {Object} opts - { strategy, blockedPreset, ratingResult, age }
 */
function makeStub(opts) {
  const stub = {
    _experimentId: 'test-exp',
    _buyingTokens: new Set(),
    _narrativeBlockedTokens: new Set(opts.blockedPreset || []),
    // 判定函数挂真实现（与生产同源：require 导出，非测试复刻）
    _shouldBlockOnNarrative: shouldBlockOnNarrative,
    _strategyEngine: {
      evaluate: () => opts.strategy,
      evaluateCondition: () => true,
      getAllStrategies: () => [],
    },
    _tokenPool: {
      initStrategyExecutions: () => {},
      getCurrentRound: () => 0,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    _narrativeCaller: {
      getRatingCalls: 0,
      async getRating() {
        this.getRatingCalls++;
        return opts.ratingResult;
      },
    },
    _sameNarrativeLeaderService: { check: async () => { throw new Error('不应触达（sourceTweetId=null）'); } },
    _preBuyCheckService: null, // 场景策略均不带 preBuyCheckCondition → 不触达
    _tokenBlacklist: new Map(),
    _permanentBlockCondition: null,
    _tokenMeta: new Map(),
    // 信号落库走 buffer 分支（else 直写 tradeSignal.save() 会打真 DB）
    _writeBufferEnabled: true,
    _writeBuffer: {
      signalInserts: 0,
      addSignalInsert() { this.signalInserts++; },
    },
    metrics: { totalSignals: 0, executedSignals: 0 },
    _loopCount: 0,
    _calculateBuyAmount: () => 0.1,
    _executeBuy: async () => ({ success: false, reason: 'stub-no-buy' }),
    _bufferSignalUpdate: () => {},
    _mapGmgnRiskFactors: (r) => r,
  };
  return stub;
}

const BASE_STRATEGY = {
  id: 'buy_0_1', name: '测试买腿', priority: 1,
  narrativeCallCondition: 'age > 1',
  preBuyCheckCondition: null, repeatBuyCheckCondition: null,
};

function baseRating(over = {}) {
  return Object.assign({
    numericRating: 9, rating: 'unrated', reason: null, fromCache: false,
    durationMs: 1, timedOut: false, error: null,
    sourceTweetId: null, gmgnRisk: null, precheckStage: null,
  }, over);
}

const TOKEN = '0xTestToken0000000000000000000000000000001';
const TOKEN_OBJ = { token: TOKEN, chain: 'bsc', symbol: 'TST', strategyExecutions: { preset: 1 } };

async function runPath(stub, age = 10) {
  return BacktestEngine.prototype._evaluateBuyPath.call(
    stub, TOKEN_OBJ, { currentPrice: 1e-6, age }, { platform: 'fourmeme' }, Date.now());
}

async function main() {
  console.log('A. 挂点一：blocked token 短路（不写 signal / 不调叙事 / 不跑 pre-buy）');
  {
    const stub = makeStub({
      strategy: { ...BASE_STRATEGY },
      blockedPreset: [TOKEN],
      ratingResult: baseRating(),
    });
    const r = await runPath(stub);
    check('返回 reason=叙事否决短路', r.success === false && r.reason.includes('叙事否决短路'), JSON.stringify(r));
    check('无 signal 行（totalSignals=0 且 buffer 未收到 insert）',
      stub.metrics.totalSignals === 0 && stub._writeBuffer.signalInserts === 0);
    check('叙事直调零次', stub._narrativeCaller.getRatingCalls === 0);
  }

  console.log('B. 挂点二：rating=1 非豁免 → 登记（首 signal 保留）');
  {
    const stub = makeStub({
      strategy: { ...BASE_STRATEGY },
      ratingResult: baseRating({ numericRating: 1, rating: 'low', precheckStage: null }),
    });
    const r = await runPath(stub, 10);
    check('登记进 _narrativeBlockedTokens', stub._narrativeBlockedTokens.has(TOKEN));
    check('首个 signal 已落（镜像实时引擎：代价一条 signal 行）',
      stub.metrics.totalSignals === 1 && stub._writeBuffer.signalInserts === 1);
    check('链路正常走完（executeBuy stub 失败收尾，非异常路径）', r.success === false && !r.reason.includes('叙事否决'));
  }

  console.log('C. address 豁免：rating=1 + precheckStage=address + age<5min → 不登记');
  {
    const stub = makeStub({
      strategy: { ...BASE_STRATEGY },
      ratingResult: baseRating({ numericRating: 1, rating: 'low', precheckStage: 'address' }),
    });
    await runPath(stub, 3);
    check('未登记（重试窗内可翻正）', !stub._narrativeBlockedTokens.has(TOKEN));
    check('signal 照常落库（豁免≠拦截，本腿继续走条件裁决）', stub.metrics.totalSignals === 1);
  }

  console.log('D. 门关：腿不带 narrativeCallCondition → blocked 集不生效');
  {
    const stub = makeStub({
      strategy: { ...BASE_STRATEGY, narrativeCallCondition: null },
      blockedPreset: [TOKEN],
      ratingResult: baseRating(),
    });
    const r = await runPath(stub);
    check('不短路（signal 落库 + 走到 executeBuy）',
      stub.metrics.totalSignals === 1 && r.reason === 'stub-no-buy');
    check('叙事直调零次（无 narrativeCallCondition 不触发直调）', stub._narrativeCaller.getRatingCalls === 0);
  }

  console.log('E. 边界补充：rating=2 不登记 / address 出窗(age=5min) 登记');
  {
    const s1 = makeStub({
      strategy: { ...BASE_STRATEGY },
      ratingResult: baseRating({ numericRating: 2, rating: 'medium' }),
    });
    await runPath(s1, 10);
    check('rating=2（PASS 终态）不登记', !s1._narrativeBlockedTokens.has(TOKEN));

    const s2 = makeStub({
      strategy: { ...BASE_STRATEGY },
      ratingResult: baseRating({ numericRating: 1, rating: 'low', precheckStage: 'address' }),
    });
    await runPath(s2, 5);
    check('address + age=5min 恰出窗（300s）→ 登记', s2._narrativeBlockedTokens.has(TOKEN));
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exitCode = 1;
});
