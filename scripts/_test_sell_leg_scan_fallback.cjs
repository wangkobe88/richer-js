#!/usr/bin/env node
/**
 * 持仓卖腿兜底扫描 + 买锚口径统一——本地零 DB 零网络单测（2026-10-13 用户裁定）
 *
 * 背景（2026-10-13 三指令）：
 *   1. 引擎级 stopLoss 双腿迁移为卖出策略腿（「所有卖出归卖出策略管」）；
 *      删 stopLoss 段的实验断流票（无 tick → tick 驱动卖腿冻结）由扫描兜底评估卖腿
 *   2. 买锚口径统一：FA buyPriceBnb 定在信号 fire 时刻（어피치案：叙事直调 17s 内
 *      对倒拉盘 +20%，执行时刻锚漂移成本）；profitPercent/peakProfitPct 全程按
 *      fire 价起算
 *
 * 覆盖：
 *   A. 扫描卖腿兜底分流（断流评 / 活跃跳过 / lastTickAt null 保守评 /
 *      stopLoss 命中保命优先不评卖腿 / 纯卖腿实验形状）
 *   B. 集成链：真实 _evaluateSellPath（bypass 止损臂立即卖 / 默认腿 touch 去抖）
 *   C. fire 锚源码口径（捕获点先于叙事直调与执行 / setBuyState 回落链 /
 *      扫描启用条件 / 卖腿扫描周期解析）
 *   D. FA 锚行为（真实 FA：fire 价成本 → preBuy 窗冲高后 profitPercent/
 *      peakProfitPct 相对 fire 价；highest 初始化含 preBuy 冲高）
 *
 * 用法：node scripts/_test_sell_leg_scan_fallback.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// 轻量引擎实例：跳过 constructor（重依赖），prototype 直挂 + 手动注入所需字段
//（模式同 _test_stop_loss_rules.makeEngine）
function makeEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-scan',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _stopLossEnabled: false,
    _stopLossTimeSec: null,
    _stopLossPricePct: null,
    _stopLossScanMs: null,
    _sellLegScanEnabled: true,             // 本测默认开启（被测新机制）
    _sellLegStallMs: 60 * 1000,
    _graduationSoldTokens: new Set(),
    _isLive: false,
    ...fields,
  });
}

(async () => {

// ═══ A. 扫描卖腿兜底分流 ═══
console.log('A. 扫描卖腿兜底分流（断流判据=60s 无 tick）');
{
  async function runScan({ lastTickAgoByAddr = {}, factorsByAddr = {}, sellLegScan = true, stopLoss = null }) {
    const sellPathCalls = [], stopCalls = [];
    const now = Date.now();
    const eng = makeEngine({
      _sellLegScanEnabled: sellLegScan,
      _stopLossEnabled: !!(stopLoss), _stopLossPricePct: stopLoss ? stopLoss.pricePct : null,
      _getAllHoldings: () => Object.keys(factorsByAddr).map(a => ({ tokenAddress: a })),
      _tokenPool: { getToken: (a) => ({ token: a, status: 'bought' }) },
      _factorAggregator: {
        buildFactorMap: (a) => factorsByAddr[a],
        getTokenState: (a) => ({ lastTickAt: lastTickAgoByAddr[a] === undefined ? null : now - lastTickAgoByAddr[a] }),
      },
      _sellingTokens: new Set(), _buyingTokens: new Set(),
      _emitStopLossSell: async (t) => { stopCalls.push(t.token); },
      _evaluateSellPath: async (a) => { sellPathCalls.push(a); return {}; },
    });
    await eng._scanHoldingsStopLoss();
    return { sellPathCalls, stopCalls };
  }

  // A1 断流票（90s 无 tick）→ 评估；活跃票（2s 前）→ 跳过
  const r1 = await runScan({
    lastTickAgoByAddr: { '0xstalled': 90 * 1000, '0xactive': 2 * 1000 },
    factorsByAddr: { '0xstalled': { profitPercent: -60, holdDuration: 100 }, '0xactive': { profitPercent: -60, holdDuration: 100 } },
  });
  check('A1 断流票（90s 无 tick）评卖腿', r1.sellPathCalls, ['0xstalled']);
  check('A1 活跃票（2s 前有 tick）不评（tick 路径已实时评估）', r1.sellPathCalls.includes('0xactive'), false);

  // A2 lastTickAt null（FA 无 tick 记录）→ 保守评估
  const r2 = await runScan({
    factorsByAddr: { '0xnoTick': { profitPercent: -60, holdDuration: 100 } },
  });
  check('A2 lastTickAt null 保守评（fail-closed 方向）', r2.sellPathCalls, ['0xnoTick']);

  // A3 引擎级止损命中 → 保命腿触发且不评卖腿（continue 语义）
  const r3 = await runScan({
    stopLoss: { pricePct: -50 },
    lastTickAgoByAddr: { '0xhit': 90 * 1000 },
    factorsByAddr: { '0xhit': { profitPercent: -90, holdDuration: 100 } },
  });
  check('A3 stopLoss 命中 → 保命腿触发', r3.stopCalls, ['0xhit']);
  check('A3 命中票不再评卖腿（卖出执行中/已清仓）', r3.sellPathCalls, []);

  // A4 纯卖腿形状（stopLoss 段删除后的 2ad6a39b 形状）：止损臂由卖腿承担
  const r4 = await runScan({
    lastTickAgoByAddr: { '0xmig': 120 * 1000 },
    factorsByAddr: { '0xmig': { profitPercent: -60, holdDuration: 4000 } },
  });
  check('A4 无 stopLoss 段：断流票仍进卖腿评估（迁移实验覆盖）', r4.sellPathCalls, ['0xmig']);
  check('A4 引擎级止损零触发（段已删）', r4.stopCalls, []);

  // A5 卖腿扫描关闭（无卖腿引擎）→ 零触碰（存量语义）
  const r5 = await runScan({
    sellLegScan: false,
    lastTickAgoByAddr: { '0xoff': 90 * 1000 },
    factorsByAddr: { '0xoff': { profitPercent: -90, holdDuration: 100 } },
  });
  check('A5 卖腿扫描关闭 → 断流票也不评（存量语义）', r5.sellPathCalls, []);
}

// ═══ B. 集成链：真实 _evaluateSellPath ═══
console.log('B. 集成链（真实 _evaluateSellPath：bypass 止损臂立即卖 / 默认腿进确认去抖）');
{
  // B1 bypass 止损臂（迁移后的价格止损臂形状）：断流票扫描 → 立即全清
  const sellCalls = [];
  const eng1 = makeEngine({
    _strategyEngine: {
      evaluate: (factors, addr, now, token, action) => action === 'sell' && factors.profitPercent <= -50
        ? { id: 'sell_5_0', name: '卖出策略 P0', bypassDebounce: true, sellPercentage: 1, cards: 'all' }
        : null,
    },
    _tokenPool: { getToken: (a) => ({ token: a, symbol: 'TST', status: 'bought' }) },
    _sellingTokens: new Set(),
    _sellConfirmDebouncer: { clear: () => {}, touch: () => {} },
    _emitSellSignal: async (token, strategy) => { sellCalls.push({ addr: token.token, id: strategy.id }); return { success: true }; },
  });
  await eng1._evaluateSellPath('0xb1', { profitPercent: -60, holdDuration: 100, currentPrice: 1e-9 }, null);
  check('B1 bypass 止损臂立即卖（迁移臂等价引擎止损即时性）', sellCalls, [{ addr: '0xb1', id: 'sell_5_0' }]);

  // B2 默认腿（非 bypass）：touch 卖出确认去抖不立即卖（扫描路径同 tick 路径语义）
  let touches = 0; const sellCalls2 = [];
  const eng2 = makeEngine({
    _sellDebounceMs: 200,
    _strategyEngine: {
      evaluate: () => ({ id: 'sell_6_11', name: '卖出策略 P11', bypassDebounce: false, sellPercentage: 1, cards: 'all' }),
    },
    _tokenPool: { getToken: (a) => ({ token: a, symbol: 'TST', status: 'bought' }) },
    _sellingTokens: new Set(),
    _sellConfirmDebouncer: { clear: () => {}, touch: () => { touches++; } },
    _emitSellSignal: async () => { sellCalls2.push(1); return { success: true }; },
  });
  const r2 = await eng2._evaluateSellPath('0xb2', { profitPercent: -60, currentPrice: 1e-9 }, null);
  check('B2 默认腿 touch 去抖（real 模式 setTimeout fire 重评）', [touches, sellCalls2.length, r2.reason], [1, 0, '卖出确认去抖中']);
}

// ═══ C. fire 锚源码口径（어피치案反证锁定）═══
console.log('C. fire 锚 + 扫描启用源码口径');
{
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const buyEval = src.slice(src.indexOf('_runBuyEvaluation(tokenAddress, tick) {'), src.indexOf('async processSignal(signal, existingSignalId'));

  // C1 firePriceBnb 捕获自 fire 时刻因子，先于叙事直调与执行（17s 延迟窗内市场移动不进成本锚）
  const captureIdx = buyEval.indexOf('const firePriceBnb = Number.isFinite(factorResults.currentPriceBnb)');
  const narrativeIdx = buyEval.indexOf('this._narrativeCaller.getRating');
  const execIdx = buyEval.indexOf('await this.processSignal(signal, signalId)');
  check('C1 fire 价捕获行存在且先于叙事直调与执行',
    captureIdx > -1 && captureIdx < narrativeIdx && captureIdx < execIdx, true);

  // C2 setBuyState 锚=fire 价，缺失回落执行时刻价（quote 映射未就绪等旧口径兜底）
  check('C2 setBuyState buyPriceBnb = firePriceBnb || 执行时刻价',
    buyEval.includes('buyPriceBnb: firePriceBnb || faState?.currentPriceBnb || 0'), true);

  // C3 扫描启用条件：引擎级止损（配 scanIntervalSec 才扫）或 卖腿存在
  const loopSrc = src.slice(src.indexOf('async _runMainLoop'), src.indexOf('async _captureMarketRegimeSnapshot'));
  check('C3 扫描启用 = (stopLoss && scanMs) || sellLegScan',
    loopSrc.includes('(this._stopLossEnabled && this._stopLossScanMs != null) || this._sellLegScanEnabled'), true);

  // C4 周期解析：stopLoss.scanIntervalSec ?? sellScanIntervalSec ?? 30s 缺省
  // （切片终点原锚 '6.6 行为周期分桶' 已随 cycle 机制删除，2026-10-15 改锚 '7. live 执行层'）
  const cfgStart = src.indexOf('6.5b 持仓卖腿兜底扫描');
  const cfgEnd = src.indexOf('7. live 执行层');
  check('C4 切片锚点健康（起止均在位）', cfgStart > 0 && cfgEnd > cfgStart, true);
  const cfgSrc = src.slice(cfgStart, cfgEnd);
  check('C4 周期三级回落（stopLoss 段优先 → sellScanIntervalSec → 30s）',
    cfgSrc.includes('this._stopLossScanMs != null ? this._stopLossScanMs') &&
    cfgSrc.includes('experimentConfig.sellScanIntervalSec') && cfgSrc.includes(': 30000'), true);

  // C5 卖腿扫描来自策略引擎卖腿过滤（非配置开关——有卖腿才兜底）
  check('C5 _sellLegScanEnabled = 卖腿存在',
    cfgSrc.includes("getAllStrategies().filter(s => s.action === 'sell')"), true);

  // C6 扫描内断流门（60s 无 tick 才评卖腿——活跃票 tick 路径已覆盖）
  const scanSrc = src.slice(src.indexOf('async _scanHoldingsStopLoss'), src.indexOf('async _evaluateSellPath'));
  check('C6 扫描卖腿评估带断流门（lastTickAt > stallMs）',
    scanSrc.includes('Date.now() - lastTickAt > this._sellLegStallMs'), true);
}

// ═══ D. FA 锚行为（真实 FA：fire 价成本）═══
console.log('D. FA 锚行为（fire 价成本 → preBuy 窗冲高的因子口径）');
{
  const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
  const FA = require('../src/services/FourMemeFactorAggregator.js');
  const fa = new FA({ fourmemeWs: {}, maintainClassifierTracks: false, maintainTpaTracks: false }, noopLogger);

  const T0 = 1_700_000_000_000;
  fa.registerToken('0xd1', { createdAtMs: T0, totalSupply: 1e9 });
  // fire 时刻：市价 100（BNB 计价 1e-7 量级放大便于阅读——用比例数即可）
  fa.processTick({ token_address: '0xd1', timestamp: T0, trade_type: 'buy', bnb_amount: 0.5, price_bnb: 100, token_amount: 5e6, block_number: 1, trader_address: '0xabc0000000000000000000000000000000000001' }, { emitFactors: false });
  // 买锚 = fire 价 100（引擎新口径传 firePriceBnb；此处模拟 _runBuyEvaluation 成功分支）
  fa.setBuyState('0xd1', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 1000 });
  // preBuy 窗（17s）内对倒拉盘 +20% → 执行时刻市价 120（旧行为锚 120 / 新口径锚 100）
  fa.processTick({ token_address: '0xd1', timestamp: T0 + 17 * 1000, trade_type: 'buy', bnb_amount: 0.5, price_bnb: 120, token_amount: 5e6, block_number: 2, trader_address: '0xabc0000000000000000000000000000000000001' }, { emitFactors: false });

  const f = fa.buildFactorMap('0xd1', T0 + 20 * 1000);
  check('D1 profitPercent 相对 fire 价（120 vs 100 → +20%，非旧口径 0%）', f.profitPercent.toFixed(0), '20');
  check('D2 peakProfitPct 含 preBuy 冲高（highest 初始化 max(fire, 执行价)）', f.peakProfitPct.toFixed(0), '20');
  check('D3 drawdownFromHighestSinceLastBuy 峰值回撤 0（现价=峰）', f.drawdownFromHighestSinceLastBuy.toFixed(0), '0');

  // D4 回落：现价再涨到 150 → profitPercent +50（fire 锚全程不变）
  fa.processTick({ token_address: '0xd1', timestamp: T0 + 60 * 1000, trade_type: 'buy', bnb_amount: 0.5, price_bnb: 150, token_amount: 5e6, block_number: 3, trader_address: '0xabc0000000000000000000000000000000000001' }, { emitFactors: false });
  const f2 = fa.buildFactorMap('0xd1', T0 + 61 * 1000);
  check('D4 后续走势仍按 fire 锚（150 → +50%）', f2.profitPercent.toFixed(0), '50');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;

})();
