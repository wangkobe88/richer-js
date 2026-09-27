#!/usr/bin/env node
/**
 * 引擎级止损双腿（时间止损/价格止损）——本地零 DB 单测
 *
 * 背景（2026-09-27 用户裁定，c5945f36 11 买 0 卖冻结实跑触发）：
 *   ① 持有超 60min 仍浮亏（profitPercent < 0）→ 全清
 *   ② 现价跌破买入成本 -50%（profitPercent <= -50）→ 全清
 * 断流 token 无 tick → tick 驱动卖腿全部冻结，扫描（scanIntervalSec）是
 * 唯一触发路径；扫描只判止损双腿，不跑策略腿（P1-P8 断流不评估语义维持）。
 *
 * 覆盖：
 *   A. _stopLossHit 判定矩阵（price/time/双命中/边界/非有限值/未启用）
 *   B. _emitStopLossSell strategy 构造（cards='all' 全清 / sellPercentage=1 /
 *      tick 透传 / id·name 方向）
 *   C. _scanHoldingsStopLoss 扫描链（断流票触发 / 状态门 / Date.now() 传参 /
 *      prune null 跳过 / 未命中不调）
 *   D. _onFactorsUpdated 挂点（命中优先于策略腿 / 未命中走 _evaluateSellPath /
 *      非持有不进卖路径）
 *
 * 用法：node scripts/_test_stop_loss_rules.cjs
 */
'use strict';

const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// 轻量引擎实例：跳过 constructor（重依赖），prototype 直挂 + 手动注入所需字段
function makeEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _stopLossEnabled: false,
    _stopLossTimeSec: null,
    _stopLossPricePct: null,
    _stopLossScanMs: null,
    ...fields,
  });
}

// ═══ A. _stopLossHit 判定矩阵 ═══
console.log('A. _stopLossHit 判定矩阵（time=60min / price=-50）');
{
  const eng = makeEngine({ _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50 });
  check('未启用 → null', makeEngine()._stopLossHit({ profitPercent: -90, holdDuration: 99999 }), null);
  check('价格命中 -51 <= -50', eng._stopLossHit({ profitPercent: -51, holdDuration: 100 }).kind, 'price');
  check('价格边界恰 -50（<= 含等值）', eng._stopLossHit({ profitPercent: -50, holdDuration: 100 }).kind, 'price');
  check('-49 未到价（time 未触发条件）→ null', eng._stopLossHit({ profitPercent: -49, holdDuration: 100 }), null);
  check('时间命中 61min 且亏损', eng._stopLossHit({ profitPercent: -1, holdDuration: 3601 }).kind, 'time');
  check('浅亏 -0.1% 也算亏损（时间腿）', eng._stopLossHit({ profitPercent: -0.1, holdDuration: 3601 }).kind, 'time');
  check('超时但盈利 → null', eng._stopLossHit({ profitPercent: 1, holdDuration: 3700 }), null);
  check('超时但恰 0%（不属亏损）→ null', eng._stopLossHit({ profitPercent: 0, holdDuration: 3700 }), null);
  check('亏损但未超时（59min）→ null', eng._stopLossHit({ profitPercent: -30, holdDuration: 3540 }), null);
  check('双命中取 price（更深的优先标注）', eng._stopLossHit({ profitPercent: -60, holdDuration: 3700 }).kind, 'price');
  check('profit null → null', eng._stopLossHit({ profitPercent: null, holdDuration: 3700 }), null);
  check('hold null 时价格腿仍可判', eng._stopLossHit({ profitPercent: -60, holdDuration: null }).kind, 'price');
  // 仅配单腿
  const onlyTime = makeEngine({ _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: null });
  check('仅时间腿：深亏 -80 不触发价格（未配）', onlyTime._stopLossHit({ profitPercent: -80, holdDuration: 100 }), null);
}

// ═══ B. _emitStopLossSell strategy 构造 ═══
console.log('B. _emitStopLossSell 构造（走 _emitSellSignal 全清链）');
{
  let captured = null;
  const eng = makeEngine({
    _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50,
    _emitSellSignal: async (token, strategy, factors, tick) => { captured = { token, strategy, factors, tick }; return { success: true }; },
  });
  const token = { token: '0xabc', symbol: 'TEST' };

  eng._emitStopLossSell(token, { profitPercent: -55.3 }, { kind: 'price', profitPercent: -55.3 }, null);
  check('价格腿 id/name', [captured.strategy.id, captured.strategy.name], ['stopLossPrice', '止损-价格跌破成本线(-50%)']);
  check('全清语义 cards=all + sellPercentage=1', [captured.strategy.cards, captured.strategy.sellPercentage], ['all', 1]);
  check('bypassDebounce=true（保命腿不等去抖）', captured.strategy.bypassDebounce, true);
  check('tick=null 透传（扫描路径）', captured.tick, null);

  eng._emitStopLossSell(token, { profitPercent: -12 }, { kind: 'time', profitPercent: -12, holdDuration: 3900 }, { ts: 1 });
  check('时间腿 id/name', [captured.strategy.id, captured.strategy.name], ['stopLossTime', '止损-持有超时仍亏损(60min)']);
  check('tick 对象透传（tick 路径）', captured.tick, { ts: 1 });
}

// ═══ C/D 段含 await，CJS 无顶层 await → async IIFE ═══
(async () => {

// ═══ C. _scanHoldingsStopLoss 扫描链 ═══
console.log('C. 持仓扫描（断流兜底路径）');
{
  async function runScan({ holdings, factorsByAddr, tokenByAddr }) {
    const calls = [];
    const buildCalls = [];
    const eng = makeEngine({
      _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50,
      _getAllHoldings: () => holdings,
      _tokenPool: { getToken: (addr) => tokenByAddr[addr] || null },
      _factorAggregator: { buildFactorMap: (addr, now) => { buildCalls.push({ addr, now }); return factorsByAddr[addr]; } },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStopLossSell: async (token, factors, hit, tick) => { calls.push({ addr: token.token, hit, tick }); },
    });
    await eng._scanHoldingsStopLoss();
    return { calls, buildCalls };
  }

  // 断流票：61min 深亏（无 tick 也能判——扫描是唯一路径）
  const dead = await runScan({
    holdings: [{ tokenAddress: '0xdead' }],
    factorsByAddr: { '0xdead': { profitPercent: -55, holdDuration: 3700 } },
    tokenByAddr: { '0xdead': { token: '0xdead', status: 'bought' } },
  });
  check('断流票 price 命中触发', dead.calls.map(c => [c.addr, c.hit.kind, c.tick]), [['0xdead', 'price', null]]);
  check('buildFactorMap 传 Date.now()（非空时钟，断流期 holdDuration 继续走）',
    dead.buildCalls[0].now != null, true);

  // 状态门：已 sold / 执行中 / buying 中 全跳过
  const gated = await runScan({
    holdings: [{ tokenAddress: '0xsold' }, { tokenAddress: '0xselling' }, { tokenAddress: '0xbuying' }],
    factorsByAddr: {
      '0xsold': { profitPercent: -90, holdDuration: 99999 },
      '0xselling': { profitPercent: -90, holdDuration: 99999 },
      '0xbuying': { profitPercent: -90, holdDuration: 99999 },
    },
    tokenByAddr: {
      '0xsold': { token: '0xsold', status: 'sold' },
      '0xselling': { token: '0xselling', status: 'bought' },
      '0xbuying': { token: '0xbuying', status: 'bought' },
    },
  });
  // 0xselling/0xbuying 的执行中门在下述变体注入
  check('sold 状态不触发', gated.calls.filter(c => c.addr === '0xsold'), []);
  const gated2 = await (async () => {
    const calls = [];
    const eng = makeEngine({
      _stopLossEnabled: true, _stopLossPricePct: -50,
      _getAllHoldings: () => [{ tokenAddress: '0xs' }, { tokenAddress: '0xb' }],
      _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
      _factorAggregator: { buildFactorMap: () => ({ profitPercent: -90, holdDuration: 99999 }) },
      _sellingTokens: new Set(['0xs']), _buyingTokens: new Set(['0xb']),
      _emitStopLossSell: async (t) => { calls.push(t.token); },
    });
    await eng._scanHoldingsStopLoss();
    return calls;
  })();
  check('卖出执行中/买入中跳过（不重入）', gated2, []);

  // prune（buildFactorMap null）与未命中不触发
  const quiet = await runScan({
    holdings: [{ tokenAddress: '0xpruned' }, { tokenAddress: '0xfine' }],
    factorsByAddr: { '0xpruned': null, '0xfine': { profitPercent: -10, holdDuration: 600 } },
    tokenByAddr: { '0xpruned': { token: '0xpruned', status: 'bought' }, '0xfine': { token: '0xfine', status: 'bought' } },
  });
  check('prune(null)/未命中 → 零触发零异常', quiet.calls, []);

  // 扫描只判止损、不跑策略腿：_evaluateSellPath 无此方法也不该被调（打桩计数验证）
  const noStrategyLeg = await (async () => {
    let strategyLegCalls = 0;
    const eng = makeEngine({
      _stopLossEnabled: true, _stopLossPricePct: -50,
      _getAllHoldings: () => [{ tokenAddress: '0xhit' }, { tokenAddress: '0xmiss' }],
      _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
      _factorAggregator: { buildFactorMap: (a) => (a === '0xhit' ? { profitPercent: -90, holdDuration: 100 } : { profitPercent: -1, holdDuration: 100 }) },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStopLossSell: async () => {},
      _evaluateSellPath: async () => { strategyLegCalls++; },
    });
    await eng._scanHoldingsStopLoss();
    return strategyLegCalls;
  })();
  check('扫描不触碰策略腿评估（P1-P8 断流不评估语义维持）', noStrategyLeg, 0);
}

// ═══ D. _onFactorsUpdated 挂点（tick 即时路径）═══
console.log('D. tick 路径：止损命中优先于策略腿');
{
  async function runOnFactors({ factors, status = 'bought' }) {
    const stopCalls = []; let strategyCalls = 0; let buyCalls = 0;
    const eng = makeEngine({
      _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50,
      metrics: {},
      _onlineProfileBuilder: { checkAndEnqueue: () => {} },
      _tokenPositionAnalyzer: null,
      _tokenPool: { getToken: () => ({ token: '0xt', symbol: 'TST', status }) },
      _restoreAnchors: new Map(),
      _buyingTokens: new Set(),
      _stopLossHit: FourMemeWssTradingEngine.prototype._stopLossHit,
      _emitStopLossSell: async (token, f, hit, tick) => { stopCalls.push({ hit: hit.kind, tick: !!tick }); },
      _evaluateSellPath: async () => { strategyCalls++; return {}; },
      _scheduleDebouncedBuy: () => { buyCalls++; },
    });
    eng._onFactorsUpdated({ tokenAddress: '0xt', factors, tick: { timestamp: Date.now() }, tokenState: {} });
    await new Promise(r => setImmediate(r)); // 等 fire-and-forget promise 链
    return { stopCalls, strategyCalls, buyCalls };
  }

  const hitRes = await runOnFactors({ factors: { profitPercent: -70, holdDuration: 100 } });
  check('价格命中 → 止损触发（tick 透传）', hitRes.stopCalls, [{ hit: 'price', tick: true }]);
  check('命中时策略腿不被调（保命腿优先）', hitRes.strategyCalls, 0);

  const missRes = await runOnFactors({ factors: { profitPercent: -5, holdDuration: 100 } });
  check('未命中 → 走正常策略腿评估', [missRes.stopCalls.length, missRes.strategyCalls], [0, 1]);

  const notBought = await runOnFactors({ factors: { profitPercent: -70, holdDuration: 100 }, status: 'monitoring' });
  check('非持有状态 → 卖路径整体不进', [notBought.stopCalls.length, notBought.strategyCalls, notBought.buyCalls > 0], [0, 0, true]);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;

})();
