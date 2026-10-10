#!/usr/bin/env node
/**
 * 引擎级止损双腿（时间止损/价格止损）——本地零 DB 单测
 *
 * 背景（2026-09-27 用户裁定，c5945f36 11 买 0 卖冻结实跑触发；2026-09-28 盘古案改 <=0）：
 *   ① 持有超 60min 仍浮亏或持平（profitPercent <= 0）→ 全清（断流冻结票 profit 恒 0）
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

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

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
    _cycleEnforce: false,                 // 周期路由未启用（扫描内 cycleTag 同步分支跳过）
    _graduationSoldTokens: new Set(),     // 毕业兜底分支（virtual）读取
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
  check('超时 + 恰 0% → time 命中（<=0，断流冻结票盘古案盲区）', eng._stopLossHit({ profitPercent: 0, holdDuration: 3700 }).kind, 'time');
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
      _factorAggregator: { buildFactorMap: (addr, now) => { buildCalls.push({ addr, now }); return factorsByAddr[addr]; }, getTokenState: () => null },
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
      _factorAggregator: { buildFactorMap: () => ({ profitPercent: -90, holdDuration: 99999 }), getTokenState: () => null },
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
      _factorAggregator: { buildFactorMap: (a) => (a === '0xhit' ? { profitPercent: -90, holdDuration: 100 } : { profitPercent: -1, holdDuration: 100 }), getTokenState: () => null },
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

// ═══ E. BacktestEngine 止损双腿（虚拟↔回测一致性 2026-10-10 对齐）═══
// 覆盖：判定矩阵（与实时引擎同款语义）/ nowTs 签名 / 扫描虚拟时钟 / 主循环挂点源码口径
console.log('E. BacktestEngine 止损双腿（回测版，虚拟时钟）');
{

  function makeBacktestEngine(fields = {}) {
    const eng = Object.create(BacktestEngine.prototype);
    return Object.assign(eng, {
      _experimentId: 'test-bt',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      _stopLossEnabled: false,
      _stopLossTimeSec: null,
      _stopLossPricePct: null,
      _stopLossScanMs: null,
      _lastStopLossScanTs: null,
      _cycleEnforce: false,
      ...fields,
    });
  }

  // E1 判定矩阵（与实时引擎逐字一致）
  const btEng = makeBacktestEngine({ _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50 });
  check('回测·价格命中 -51', btEng._stopLossHit({ profitPercent: -51, holdDuration: 100 }).kind, 'price');
  check('回测·时间命中 61min 亏 0%（<=0 盘古案）', btEng._stopLossHit({ profitPercent: 0, holdDuration: 3700 }).kind, 'time');
  check('回测·超时盈利 null', btEng._stopLossHit({ profitPercent: 5, holdDuration: 3700 }), null);
  check('回测·未启用 null', makeBacktestEngine()._stopLossHit({ profitPercent: -90, holdDuration: 99999 }), null);
  check('回测·双命中取 price', btEng._stopLossHit({ profitPercent: -60, holdDuration: 3700 }).kind, 'price');

  // E2 _emitStopLossSell：nowTs 签名（5 参）+ 全清语义
  let captured = null;
  const eng2 = makeBacktestEngine({
    _stopLossEnabled: true, _stopLossTimeSec: 3600, _stopLossPricePct: -50,
    _emitSellSignal: async (token, strategy, factors, nowTs, tick) => { captured = { strategy, nowTs, tick }; return { success: true }; },
  });
  const tok = { token: '0xbbb', symbol: 'BT' };
  eng2._emitStopLossSell(tok, { profitPercent: -45 }, { kind: 'time', profitPercent: -45, holdDuration: 3800 }, 12345, { ts: 1 });
  check('回测·时间腿 id/name', [captured.strategy.id, captured.strategy.name], ['stopLossTime', '止损-持有超时仍亏损(60min)']);
  check('回测·nowTs 透传 + tick 透传', [captured.nowTs, captured.tick], [12345, { ts: 1 }]);
  check('回测·全清 cards=all/sellPct=1/bypass', [captured.strategy.cards, captured.strategy.sellPercentage, captured.strategy.bypassDebounce], ['all', 1, true]);

  // E3 扫描：虚拟时钟 nowTs 传参 + 断流票触发
  let scanNow = null; const scanCalls = [];
  const eng3 = makeBacktestEngine({
    _stopLossEnabled: true, _stopLossPricePct: -50,
    _getAllHoldings: () => [{ tokenAddress: '0xdead' }],
    _tokenPool: { getToken: () => ({ token: '0xdead', status: 'bought' }) },
    _factorAggregator: { buildFactorMap: (addr, now) => { scanNow = now; return { profitPercent: -70, holdDuration: 99999 }; } },
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _emitStopLossSell: async (t, f, hit, nowTs) => { scanCalls.push({ hit: hit.kind, nowTs }); },
  });
  eng3._scanHoldingsStopLoss(98765);
  check('回测·扫描断流票触发 price', scanCalls.map(c => c.hit), ['price']);
  check('回测·扫描传虚拟时钟 nowTs（非 Date.now）', [scanNow, scanCalls[0].nowTs], [98765, 98765]);

  // E4 源码口径：主循环挂点 + 扫描节流 + 构造解析
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  const mainLoop = src.slice(src.indexOf('_runMainLoop'), src.indexOf('_forceSellAllRemaining'));
  const hookIdx = mainLoop.indexOf('_stopLossHit(factors)');
  const sellIdx = mainLoop.indexOf('await this._evaluateSellPath(token, factors, tick)');
  check('回测·主循环止损判定存在且先于策略腿', hookIdx > -1 && hookIdx < sellIdx, true);
  check('回测·主循环扫描节流块存在（_scanHoldingsStopLoss(tickTs)）', mainLoop.includes('this._scanHoldingsStopLoss(tickTs)'), true);
  check('回测·构造解析 stopLoss 段（timeStopMinutes/priceStopPercent/scanIntervalSec）',
    ['timeStopMinutes', 'priceStopPercent', 'scanIntervalSec'].every(k => src.includes(k)), true);
  check('回测·graduation 事件流已嵌（2026-10-10 对齐，旧「不嵌」口径废除）',
    src.includes('不嵌实时版的毕业兜底段'), false);
}

// ═══ F. BacktestEngine graduation 事件回放（虚拟↔回测一致性 2026-10-10）═══
// 覆盖：_loadGraduationEvents 窗口过滤/时间锚/排序 / _consumeGraduationEvents
// 消费指针·失败重试·未持仓仅标记 / _emitGraduationSell 等价 strategy·幂等后置 /
// 主循环消费点·尾部 drain·买入成功点补卖源码口径
console.log('F. BacktestEngine graduation 事件回放');
{
  function makeGradEngine(fields = {}) {
    const eng = Object.create(BacktestEngine.prototype);
    return Object.assign(eng, {
      _experimentId: 'test-grad',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      _graduationEvents: [],
      _gradEvtIdx: 0,
      _graduationSoldTokens: new Set(),
      _graduatedTokens: new Set(),
      _sellingTokens: new Set(),
      ...fields,
    });
  }
  const mkStubClient = (rows) => ({
    from: (table) => {
      if (table !== 'wss_events') throw new Error('非预期表: ' + table);
      return {
        select: () => ({ eq: () => ({ in: async () => ({ data: rows }) }) }),
      };
    },
  });

  // F1 事件装载：时间锚优先级（payload.blockTimeMs > block_time 列）+ 窗口过滤 + 缺锚跳过 + 升序
  const eng = makeGradEngine({
    _startTimeFilter: new Date('2026-10-09T00:00:00Z').getTime(),
    _endTimeFilter: new Date('2026-10-10T00:00:00Z').getTime(),
    _tokenMeta: new Map([['0xa', {}], ['0xb', {}], ['0xc', {}], ['0xd', {}]]),
  });
  const warns = [];
  eng.logger.warn = (id, tag, msg) => warns.push(msg);
  eng._getClient = () => mkStubClient([
    { token_address: '0xa', payload: { blockTimeMs: new Date('2026-10-09T10:00:00Z').getTime(), fundsBnb: 72.5 }, block_time: '2026-10-09T23:00:00Z' },
    { token_address: '0xb', payload: { blockTimeMs: new Date('2026-10-08T10:00:00Z').getTime() }, block_time: null },
    { token_address: '0xc', payload: {}, block_time: '2026-10-10T05:00:00Z' },
    { token_address: '0xd', payload: {}, block_time: null },
  ]);
  await eng._loadGraduationEvents();
  check('F1 窗口过滤后仅留 a（b 窗口前/c 窗口后）', eng._graduationEvents.map(e => e.token), ['0xa']);
  check('F1 payload.blockTimeMs 优先于 block_time 列（tsMs=10:00 非 23:00）',
    eng._graduationEvents[0].tsMs === new Date('2026-10-09T10:00:00Z').getTime(), true);
  check('F1 fundsBnb 透传', eng._graduationEvents[0].fundsBnb, 72.5);
  check('F1 缺锚跳过留 WARN', warns.some(m => m.includes('缺时间锚')), true);
  check('F1 装载后 _graduatedTokens 为空（消费点填充，74444a0c 数据点 B 前视事故）', eng._graduatedTokens.size, 0);

  const eng2 = makeGradEngine({
    _startTimeFilter: null, _endTimeFilter: null,
    _tokenMeta: new Map([['0x1', {}], ['0x2', {}]]),
  });
  eng2._getClient = () => mkStubClient([
    { token_address: '0x2', payload: {}, block_time: '2026-10-09T12:00:00Z' },
    { token_address: '0x1', payload: { blockTimeMs: new Date('2026-10-09T08:00:00Z').getTime() }, block_time: null },
  ]);
  await eng2._loadGraduationEvents();
  check('F1 升序排序 + block_time 列兜底锚',
    [eng2._graduationEvents[0].token, eng2._graduationEvents[1].token], ['0x1', '0x2']);

  // F2 消费指针：未到期不动 / 到期未持仓仅标记推进 / 卖出失败不推进（重试语义）
  const mkConsume = (over = {}) => makeGradEngine({
    _graduationEvents: [
      { token: '0xA', tsMs: 1000, fundsBnb: 70 },
      { token: '0xB', tsMs: 2000, fundsBnb: 80 },
    ],
    _factorAggregator: { markGraduated: () => {} },
    _tokenPool: { getToken: (a) => (a === '0xA' ? { token: a, status: 'bought', symbol: 'A' } : null) },
    _emitGraduationSell: async () => ({ success: true }),
    ...over,
  });

  const c1 = mkConsume();
  await c1._consumeGraduationEvents(999);
  check('F2 未到期零消费', c1._gradEvtIdx, 0);
  await c1._consumeGraduationEvents(1500);
  check('F2 到期未持仓（getToken null）仅标记推进', c1._gradEvtIdx, 1);
  check('F2 消费点填充 _graduatedTokens（0xA 事件已到达）', c1._graduatedTokens.has('0xA'), true);
  await c1._consumeGraduationEvents(Infinity);
  check('F2 后续事件继续消费（持仓卖成功推进）', c1._gradEvtIdx, 2);
  check('F2 消费两个事件后集合含 0xA/0xB', [c1._graduatedTokens.has('0xA'), c1._graduatedTokens.has('0xB')], [true, true]);

  const c2 = mkConsume({
    _tokenPool: { getToken: (a) => ({ token: a, status: 'bought', symbol: 'A' }) },
    _emitGraduationSell: async () => ({ success: false, reason: '卖出执行中' }),
  });
  await c2._consumeGraduationEvents(5000);
  check('F2 卖出失败不推进指针（下轮重试=虚拟扫描兜底等价）', c2._gradEvtIdx, 0);

  // F3 _emitGraduationSell：等价 strategy + evtTs 虚拟时钟 + 幂等后置
  let sellCall = null;
  const e3 = makeGradEngine({
    _factorAggregator: { buildFactorMap: () => ({ graduationProgress: 0.98, currentPrice: 1 }) },
    _emitSellSignal: async (token, strategy, factors, nowTs, tick) => { sellCall = { strategy, nowTs, tick }; return { success: true }; },
  });
  const r3 = await e3._emitGraduationSell({ token: '0xA', symbol: 'A' }, { token: '0xA', tsMs: 7777, fundsBnb: 70 });
  check('F3 等价 strategy（id/name/cards/sellPct/bypass）',
    [sellCall.strategy.id, sellCall.strategy.name, sellCall.strategy.cards, sellCall.strategy.sellPercentage, sellCall.strategy.bypassDebounce],
    ['graduationSell', '毕业事件全清', 'all', 1, true]);
  check('F3 evtTs 虚拟时钟传入 _emitSellSignal（断流前最后可靠价）', sellCall.nowTs, 7777);
  check('F3 tick=null（事件路径无 tick）', sellCall.tick, null);
  check('F3 幂等标记后置到成功', [r3.success, e3._graduationSoldTokens.has('0xA')], [true, true]);

  const e3b = makeGradEngine({ _factorAggregator: { buildFactorMap: () => null } });
  const r3b = await e3b._emitGraduationSell({ token: '0xB', symbol: 'B' }, { token: '0xB', tsMs: 1 });
  check('F3b 无因子（价格史空）→ success:false 不标记', [r3b.success, e3b._graduationSoldTokens.size], [false, 0]);

  const e3c = makeGradEngine({
    _graduationSoldTokens: new Set(['0xC']),
    _emitSellSignal: async () => { throw new Error('不应到达'); },
  });
  const r3c = await e3c._emitGraduationSell({ token: '0xC', symbol: 'C' }, { token: '0xC', tsMs: 1 });
  check('F3c 幂等标记命中直接返回（事件重复派发）', r3c.success, true);

  // F4 源码口径：主循环消费点 + 尾部 drain + 买入成功点补卖 + 装载挂点
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  const mainLoop = src.slice(src.indexOf('_runMainLoop'), src.indexOf('_forceSellAllRemaining'));
  const consumeIdx = mainLoop.indexOf('await this._consumeGraduationEvents(tickTs)');
  const scanIdx = mainLoop.indexOf('this._scanHoldingsStopLoss(tickTs)');
  check('F4 主循环消费点存在且在扫描块之后（tick 处理尾部）', consumeIdx > -1 && consumeIdx > scanIdx, true);
  check('F4 尾部 drain 存在（强平前，毕业后 ticks 停止的兜底）',
    mainLoop.includes('await this._consumeGraduationEvents(Infinity)'), true);
  const buyPath = src.slice(src.indexOf('async _evaluateBuyPath'), src.indexOf('async _stopLossHit'));
  check('F4 买入成功点补卖存在（三挂点竞态修复，盘古案）',
    buyPath.includes('_graduatedTokens.has(token.token)') && buyPath.includes('_emitGraduationSell'), true);
  const initSrc = src.slice(src.indexOf('async _initializeDataSources'), src.indexOf('async _loadTokenMetadata'));
  check('F4 装载挂点在 ticks 装载后', initSrc.includes('await this._loadGraduationEvents();'), true);
  // 74444a0c 首启事故：.in() 走 URL，批 500 → 21.5KB 超网关 8KB 限制 fetch failed
  const gradSrc = src.slice(src.indexOf('async _loadGraduationEvents'), src.indexOf('async _consumeGraduationEvents'));
  check('F4 装载批大小 ≤ 50（URL 长度防线，74444a0c 首启事故）',
    /const BATCH = (\d+)/.exec(gradSrc) && Number(/const BATCH = (\d+)/.exec(gradSrc)[1]) <= 50, true);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;

})();
