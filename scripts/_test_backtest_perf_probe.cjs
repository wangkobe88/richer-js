#!/usr/bin/env node
// P1 回放分段计时探针单测（2026-10-12 回测性能案）：主循环六段累计器 +
// 直调/preBuy 子计数器。零 DB 零网络：子服务全打桩（Object.create(prototype)
// 实例覆盖先例 = PreBuyCheckService.getConditionFactorKeys）。
// 用法：node scripts/_test_backtest_perf_probe.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { NarrativeDirectCaller } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

async function main() {
  // ── A. NarrativeDirectCaller 直调计时（三路径计数） ──
  console.log('A. NarrativeDirectCaller 直调子计数器');
  {
    const FakeAnalyzer = {
      analyze: async (addr) => {
        if (addr === '0xslow') { const t = Date.now(); while (Date.now() - t < 3) {} // ≥3ms
          return { numericRating: 3, rating: 'high', meta: {} }; }
        if (addr === '0xerr') throw new Error('boom');
        return { numericRating: 3, rating: 'high', meta: {} };
      },
    };
    const c = new NarrativeDirectCaller({ memoryCacheResults: true });
    c._getAnalyzer = async () => FakeAnalyzer;

    eq('A1 初始计数 0', c.getCallStats(), { calls: 0, ms: 0, dbCacheHits: 0, realRuns: 0 });
    await c.getRating('0xabc');
    await c.getRating('0xslow');
    await c.getRating('0xerr');
    const s = c.getCallStats();
    eq('A2 三路径（成功/慢/异常）全计数', s.calls, 3);
    check('A3 耗时累计含慢调用（≥3ms）与异常路径', s.ms >= 3, true);
    // 内存缓存命中（_isCacheableRatingResult：rating3+无 precheckStage → 可缓存）
    await c.getRating('0xabc');
    eq('A4 内存缓存命中也计数（零开销 durationMs=0）', c.getCallStats().calls, 4);
  }

  // ── B. PreBuyCheckService performAllChecks finally 计时（成功/失败两路径） ──
  console.log('B. PreBuyCheckService preBuy 子计数器');
  {
    const mkSvc = (failEarly) => {
      const svc = Object.create(PreBuyCheckService.prototype);
      svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
      svc._performEarlyParticipantCheck = failEarly
        ? async () => { throw new Error('prebuy boom'); }
        : async () => ({ _trades: [] });
      svc._performHolderCheck = async () => null;
      svc._performWalletClusterCheck = async () => null;
      svc._checkCreatorIsNotBadDevWallet = async () => null;
      svc._performStrongTraderPositionCheck = async () => null;
      svc._performSameNameCheck = async () => null;
      svc.holderService = { checkEarlyTradersRisk: async () => ({}) };
      svc.walletLabelService = { calculateLabelFactors: () => ({}) };
      svc.earlyParticipantService = { getEmptyFactorValues: () => ({}) };
      svc.walletClusterService = { getEmptyFactorValues: () => ({}) };
      svc.strongTraderPositionService = { getEmptyFactorValues: () => ({}) };
      svc._safeGetErrorMessage = (e) => e.message;
      svc._evaluateWithCondition = () => ({ canBuy: true, checkDuration: 0 });
      return svc;
    };
    const ok = mkSvc(false);
    const r1 = await ok.performAllChecks('0xa', null, 'exp', null);
    eq('B1 成功路径结果透传', r1.canBuy, true);
    eq('B2 成功路径计数', ok.getPerfStats().calls, 1);
    check('B3 成功路径耗时 ≥0', ok.getPerfStats().ms >= 0, true);

    const bad = mkSvc(true);
    const r2 = await bad.performAllChecks('0xb', null, 'exp', null);
    eq('B4 失败路径 fail-closed canBuy=false', r2.canBuy, false);
    eq('B5 失败路径 finally 同样计数', bad.getPerfStats().calls, 1);
  }

  // ── C. BacktestEngine 主循环六段源码口径 ──
  console.log('C. BacktestEngine 六段探针源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    eq('C1 六段累计器键集',
      /const perf = this\._perf = \{ advance: 0, processTick: 0, buildFactorMap: 0, sell: 0, tpa: 0, other: 0 \};/.test(src), true);
    // 六段每段都有配对的计时对（perf.X += Date.now() - _p0）
    for (const seg of ['advance', 'processTick', 'buildFactorMap', 'sell', 'tpa', 'other']) {
      eq(`C2 段 ${seg} 累计点存在`, new RegExp(`perf\\.${seg} \\+= Date\\.now\\(\\) - _p0;`).test(src), true);
    }
    eq('C3 finally 汇总打印（直调/preBuy 子计数器接入）',
      /⏱️ 回放耗时分布/.test(src) && /this\._narrativeCaller\.getCallStats\(\)/.test(src)
      && /this\._preBuyCheckService\.getPerfStats\(\)/.test(src), true);
    eq('C4 buildFactorMap 后 continue 不丢段（计时先于 continue）',
      /perf\.buildFactorMap \+= Date\.now\(\) - _p0;\n        if \(!factors\) continue;/.test(src), true);
    eq('C5 无 token continue 同样先结算 other',
      /if \(!token\) \{ perf\.other \+= Date\.now\(\) - _p0; continue; \}/.test(src), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
