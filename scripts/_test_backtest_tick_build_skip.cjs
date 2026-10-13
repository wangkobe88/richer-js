#!/usr/bin/env node
/**
 * P18 tick 路径 build 条件化单测（2026-10-13 回测性能案，零 DB 零网络）
 *
 * 背景：buildFactorMap 段主体 = ~49 万次「买窗内未持仓票」的全量构建（179 键）。
 * 主循环改为：未持仓票先过 FA.shouldSkipTickBuild 纯谓词——出窗票 continue（与
 * 现状 build-null 的副作用序列等价：TPA/touch/止损扫描/graduation 消费全跳），
 * 窗内票（C 类）不再全量 build（TPA 唯一 factors 消费是 currentPriceBnb 可选链
 * → 喂最小 factors；touch 不读 factors；fire 时 _runBuyEvaluation 独立全量重建）。
 * C 类票现状也走 touch/止损扫描/毕业消费（三段不读 factors），主循环保留防分叉。
 * 开关 backtest.tickBuildSkip：tb0 对拍收口（2026-10-13，trades/signals bit 一致
 * + 回放段 808.6→316.0s）后**默认开**，显式 false 才关；与 tokenCycle.enforce
 * 启动互斥（cycle latch 推进是 tick build 的读取副作用，skip 窗内票 = fire 时
 * tokenCycle 档位漂移）——fail-fast 拒启（unknown-factor fail-fast 同族裁定）；
 * 默认开后存量 cycle 耦合实验重跑撞拒启，显式 tickBuildSkip:false 走老口径
 * （不加自动降级兜底，2026-10-13 裁定）。
 *
 * 覆盖：
 *   A. FA.shouldSkipTickBuild 谓词矩阵（无 preFilter/state 缺失/持仓/出窗计数/
 *      窗内/负 age -Infinity 边界/createdAtMs 缺失/闭区间边界）
 *      + A8 谓词⇔build-null 全采样对拍（含 held 生命周期）
 *   B. 主循环行为（打桩驱动 _runMainLoop）：held 恒 build / 出窗 skip 全跳 /
 *      窗内 minimal factors+touch / 开关关默认全量 / buying 中 C 类不 touch /
 *      held build-null continue
 *   C. 源码口径防线：互斥 throw / cycleTag factors 门 / skip continue 在 TPA 前 /
 *      fire 等重建点零谓词引用 / 默认 === true 形状 / C 类三段保留
 *   D. _preFilterSkipped 计数口径（谓词与 build 内部同点累计）+ 判定式两处同形
 */

const fs = require('fs');
const path = require('path');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const BE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function newFa(overrides = {}) {
  const FA = require(FA_PATH);
  return new FA({
    fourmemeWs: { ...overrides },
    maintainClassifierTracks: false,
    maintainTpaTracks: false,
  }, noopLogger);
}

function mkTick(addr, ts, extra = {}) {
  return {
    token_address: addr,
    timestamp: ts,
    trade_type: 'buy',
    bnb_amount: 0.5,
    price_bnb: 1e-9,
    token_amount: 5e8,
    block_number: 100,
    trader_address: '0xabc0000000000000000000000000000000000001',
    ...extra,
  };
}

const MIN = 60 * 1000;

// 整体包 async main：B 节 await 驱动 _runMainLoop，必须等它完成再跑 C/D 与汇总
//（否则同步流先打汇总，B 断言迟到——首版事故）
(async () => {

// ── A. FA.shouldSkipTickBuild 谓词矩阵 ───────────────────────────────────
console.log('A. FA.shouldSkipTickBuild 谓词矩阵');
{
  const T0 = 1_700_000_000_000;

  // A1 无 preFilter（faPreFilter=false / 无可提取区间的实验形状）→ false 不计数
  {
    const fa = newFa();
    fa.registerToken('0xa1', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa1', T0 + 10 * MIN), { emitFactors: false });
    ok(fa.shouldSkipTickBuild('0xa1', T0 + 10 * MIN) === false, 'A1 无 preFilter → false');
    ok(fa.getPreFilterSkipped() === 0, 'A1 无 preFilter 不计数');
  }

  // A2 state 缺失（未注册地址）→ false 不计数（交回 buildFactorMap 现状路径）
  {
    const fa = newFa();
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    ok(fa.shouldSkipTickBuild('0xghost', T0) === false, 'A2 state 缺失 → false');
    ok(fa.getPreFilterSkipped() === 0, 'A2 state 缺失不计数');
  }

  // A3 持仓票 → false（setBuyState 建立 _positions，与 build 内部 positions 门同判据）
  {
    const fa = newFa();
    fa.registerToken('0xa3', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa3', T0), { emitFactors: false });
    fa.setBuyState('0xa3', { buyPriceBnb: 1e-9, buyPriceUsd: 6e-7, buyTime: T0 });
    ok(fa.shouldSkipTickBuild('0xa3', T0 + 10 * MIN) === false, 'A3 持仓票出窗也 → false（恒全量 build）');
    ok(fa.getPreFilterSkipped() === 0, 'A3 持仓票不计数');
  }

  // A4 出窗 → true + 计数（与 build-null 路径同点累计）
  {
    const fa = newFa();
    fa.registerToken('0xa4', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa4', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    ok(fa.shouldSkipTickBuild('0xa4', T0 + 3 * MIN) === true, 'A4 age=3min 出窗 [0.5,2] → true');
    ok(fa.getPreFilterSkipped() === 1, 'A4 skip 时计数（探针口径不变）');
  }

  // A5 窗内 → false 不计数
  {
    const fa = newFa();
    fa.registerToken('0xa5', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa5', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    ok(fa.shouldSkipTickBuild('0xa5', T0 + 1 * MIN) === false, 'A5 age=1min 窗内 → false');
    ok(fa.getPreFilterSkipped() === 0, 'A5 窗内不计数');
  }

  // A6 闭区间边界：age=min 含 / age=max 含 / 出窗仅界外（!(age<min||age>max) 口径）
  {
    const fa = newFa();
    fa.registerToken('0xa6', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa6', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    ok(fa.shouldSkipTickBuild('0xa6', T0 + 0.5 * MIN) === false, 'A6 age=0.5（min 边界含）→ 窗内');
    ok(fa.shouldSkipTickBuild('0xa6', T0 + 2 * MIN) === false, 'A6 age=2（max 边界含）→ 窗内');
    ok(fa.shouldSkipTickBuild('0xa6', T0 + 0.49 * MIN) === true, 'A6 age=0.49（min 界外）→ 出窗');
  }

  // A7 负 age + -Infinity 下界（17da408e 裁定：无下界子句缺省 -Infinity，
  // 宣告竞态负 age 不误拦）；有下界区间负 age 出窗
  {
    const fa = newFa();
    fa.registerToken('0xa7', { createdAtMs: T0 + 60 * 1000, totalSupply: 1e9 }); // 创建锚在未来 60s
    fa.processTick(mkTick('0xa7', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: -Infinity, maxAgeMinutes: 5 }]);
    ok(fa.shouldSkipTickBuild('0xa7', T0) === false, 'A7 负 age + -∞ 下界 → 窗内不拦');
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 5 }]);
    ok(fa.shouldSkipTickBuild('0xa7', T0) === true, 'A7 负 age + [0.5,5] → 出窗');
  }

  // A8 createdAtMs 缺失 → age=0（build 内部同算式）
  {
    const fa = newFa();
    fa.registerToken('0xa8', { createdAtMs: null, totalSupply: 1e9 });
    fa.processTick(mkTick('0xa8', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: -Infinity, maxAgeMinutes: 2 }]);
    ok(fa.shouldSkipTickBuild('0xa8', T0) === false, 'A8 createdAtMs 缺失 → age=0 窗内');
  }

  // A9 谓词⇔build-null 全采样对拍：合成序列跨窗前/窗内/窗后 + held 生命周期，
  // 每个采样点断言 谓词true ⇔ buildFactorMap null（等价性的机器证明）
  {
    const fa = newFa();
    fa.registerToken('0xpar', { createdAtMs: T0, totalSupply: 1e9 });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    let mismatches = 0;
    const sampleTs = [0.1, 0.4, 0.5, 1, 1.9, 2, 2.01, 3, 5].map(m => T0 + m * MIN);
    sampleTs.forEach((ts, i) => {
      fa.processTick(mkTick('0xpar', ts, { price_bnb: 1e-9 + i }), { emitFactors: false });
      if (i === 3) { // 中途持仓（出窗时刻的 held 行为）
        fa.setBuyState('0xpar', { buyPriceBnb: 1e-9, buyPriceUsd: 6e-7, buyTime: ts });
      }
      if (i === 5) fa.clearBuyState('0xpar');
      const pred = fa.shouldSkipTickBuild('0xpar', ts);
      const built = fa.buildFactorMap('0xpar', ts);
      if (pred !== (built === null)) mismatches++;
    });
    ok(mismatches === 0, `A9 谓词⇔build-null 全采样一致（9 点含 held 生命周期，失配 ${mismatches}）`);
  }
}

// ── B. 主循环行为（打桩驱动 _runMainLoop）─────────────────────────────────
console.log('B. 主循环行为（打桩驱动）');
{
  const { BacktestEngine: BE } = require(BE_PATH);

  function makeLoopEngine(fields = {}) {
    const eng = Object.create(BE.prototype);
    return Object.assign(eng, {
      _experimentId: 'test-tbs',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      _ticks: [],
      _strategyEngine: { getStrategyCount: () => 0, getAllStrategies: () => [] },
      _advanceDebouncer: async () => {},
      _lastSnapshotTs: null,
      _loopCount: 0,
      _createPortfolioSnapshot: async () => {},
      _faPruneMaxAgeMs: 0,
      _lastFaPruneTs: null,
      _faPrunedTotal: 0,
      _seenTokens: new Set(),
      _tickBuildSkip: true,
      _cycleEnforce: false,
      _tokenPositionAnalyzer: null,
      _buyingTokens: new Set(),
      _sellingTokens: new Set(),
      _buyDebouncer: { pending: new Set(), touch: () => {}, advance: () => {} },
      _sellConfirmDebouncer: { advance: () => {} },
      _sellDebounceMs: 0,
      _stopLossEnabled: false,
      _stopLossScanMs: null,
      _lastStopLossScanTs: null,
      _stopLossHit: () => null,
      _consumeGraduationEvents: async () => {},
      _inflightEvals: new Set(),
      _forceSellAllRemaining: async () => {},
      _writeBufferEnabled: false,
      _writeBuffer: null,
      _portfolioManager: { getPortfolio: () => ({ totalValue: 100 }) },
      _portfolioId: 'p0',
      initialBalance: 100,
      _narrativeBlockedTokens: new Set(),
      _narrativeCaller: { getMemoryCacheHits: () => 0, getCallStats: () => ({ calls: 0, ms: 0 }) },
      _preBuyCheckService: {
        getPerfStats: () => ({ calls: 0, ms: 0, shortCircuits: 0, earlyMs: 0, parallelMs: 0, evalMs: 0, parHolder: 0, parCluster: 0, parCreator: 0, parStrong: 0, parSameName: 0, labelMs: 0 }),
        earlyParticipantService: {
          getPerfStats: () => ({
            calls: 0, ms: 0, fetchMs: 0, replayHits: 0,
            sniper: { queryMs: 0, batches: 0, queriedAddrs: 0, failures: 0, cached: 0, fullyLoaded: false, preloadedRows: 0 },
          }),
          getReplayHits: () => 0,
        },
        sameNameTokenService: { getSnapshotStats: () => ({}) },
      },
      // stub throw：finally 的 stats 段会 _getClient() 真写 experiments 表——
      // 状态更新失败被 catch 吞（_finalStatusSet 保持 false → stats 段跳过），零 DB
      _updateExperimentStatus: async () => { throw new Error('stub: 绕 stats 段真 DB 写'); },
      metrics: { debounceSuppressed: 0, totalSignals: 0, totalTrades: 0 },
      ...fields,
    });
  }

  const T0 = 1_700_000_000_000;
  const mkLoopTick = (addr, i) => ({
    token_address: addr, timestamp: T0 + i * 100, platform: 'fourmeme',
  });

  // B1-B5：开关开。五票五形状：
  //   0xHELD bought（build→factors）→ 恒全量 + 卖腿
  //   0xOUT  monitoring + 谓词 true  → skip 全跳（build/TPA/touch/毕业消费全不达）
  //   0xIN   monitoring + 谓词 false → C 类：build 不调、TPA minimal、touch 调
  //   0xBUSY monitoring + buying 中   → C 类：TPA 调、touch 不调（buying 门）
  //   0xHNUL bought（build→null）    → continue（卖腿/毕业消费不达，现状等价）
  const order = ['0xHELD', '0xOUT', '0xIN', '0xBUSY', '0xHNUL'];
  const buildFactors = { currentPrice: 1e-9, profitPercent: 5, holdDuration: 60 };
  const state0 = { currentPriceBnb: 5e-9 };
  const buildAddrs = [], skipAddrs = [], tpaCalls = [], touchAddrs = [], sellAddrs = [], consumeTs = [];
  const eng = makeLoopEngine({
    _ticks: order.map((a, i) => mkLoopTick(a, i)),
    _seenTokens: new Set(order),
    _tokenPool: { getToken: (a) => ({ token: a, symbol: a.slice(2, 6), status: (a === '0xHELD' || a === '0xHNUL') ? 'bought' : 'monitoring' }) },
    _factorAggregator: {
      processTick: () => {},
      buildFactorMap: (a) => { buildAddrs.push(a); return a === '0xHNUL' ? null : buildFactors; },
      shouldSkipTickBuild: (a) => { skipAddrs.push(a); return a === '0xOUT'; },
      getTokenState: () => state0,
      getPreFilterSkipped: () => 0,
    },
    _tokenPositionAnalyzer: {
      checkAndTrigger: async (...args) => { tpaCalls.push(args); },
      destroy() {},
      getStats: () => ({}),
      getProfileStats: () => null,
    },
    _buyingTokens: new Set(['0xBUSY']),
    _buyDebouncer: {
      pending: new Set(),
      touch: (a) => { touchAddrs.push(a); },
      advance: () => {},
    },
    _evaluateSellPath: async (token) => { sellAddrs.push(token.token); return {}; },
    _consumeGraduationEvents: async (upTo) => { consumeTs.push(upTo); },
  });
  await eng._runMainLoop();

  ok(JSON.stringify(buildAddrs) === JSON.stringify(['0xHELD', '0xHNUL']),
    `B1 held 票恒 build / 未持仓票 build 不调（实际 ${JSON.stringify(buildAddrs)}）`);
  ok(JSON.stringify(skipAddrs) === JSON.stringify(['0xOUT', '0xIN', '0xBUSY']),
    `B1 谓词只对未持仓票调用（实际 ${JSON.stringify(skipAddrs)}）`);
  ok(JSON.stringify(tpaCalls.map(c => c[0])) === JSON.stringify(['0xHELD', '0xIN', '0xBUSY']),
    `B2/B3 TPA：held 照走、出窗 skip 掉、C 类照走（实际 ${JSON.stringify(tpaCalls.map(c => c[0]))}）`);
  ok(tpaCalls[0][1] === buildFactors, 'B1 held 票 TPA 收全量 factors');
  ok(tpaCalls[1][1] !== buildFactors
    && Object.keys(tpaCalls[1][1]).length === 1
    && tpaCalls[1][1].currentPriceBnb === 5e-9
    && tpaCalls[1][2] === state0,
    'B3 C 类票 TPA 收最小 factors {currentPriceBnb} + state 第三参（TokenPositionAnalyzer :780 唯一消费）');
  ok(JSON.stringify(touchAddrs) === JSON.stringify(['0xIN']),
    `B3/B5 touch：C 类调、出窗不调、buying 中不调（实际 ${JSON.stringify(touchAddrs)}）`);
  ok(JSON.stringify(sellAddrs) === JSON.stringify(['0xHELD']),
    `B1/B6 卖腿：held 走、build-null 的 held continue（实际 ${JSON.stringify(sellAddrs)}）`);
  const tickConsumes = consumeTs.filter(t => t !== Infinity);
  ok(JSON.stringify(tickConsumes) === JSON.stringify([T0, T0 + 200, T0 + 300]),
    `B2/B6 毕业消费：skip/build-null 的 tick 不消费，C 类照走（实际 ${JSON.stringify(tickConsumes)}）`);
  ok(consumeTs.includes(Infinity), 'B2 尾部 drain 存在（Infinity）');

  // B4：开关关（默认）→ 全部票走 buildFactorMap 现状路径
  {
    const buildAddrs2 = [], touchAddrs2 = [], sellAddrs2 = [];
    const eng2 = makeLoopEngine({
      _tickBuildSkip: false,
      _ticks: order.map((a, i) => mkLoopTick(a, i)),
      _seenTokens: new Set(order),
      _tokenPool: { getToken: (a) => ({ token: a, status: (a === '0xHELD' || a === '0xHNUL') ? 'bought' : 'monitoring' }) },
      _factorAggregator: {
        processTick: () => {},
        // 0xOUT 现状下 build 内部 preFilter 判定出窗 → null（谓词未注入时引擎不调它）
        buildFactorMap: (a) => { buildAddrs2.push(a); return (a === '0xHNUL' || a === '0xOUT') ? null : buildFactors; },
        shouldSkipTickBuild: () => { throw new Error('开关关时谓词不该被调'); },
        getTokenState: () => state0,
        getPreFilterSkipped: () => 0,
      },
      _buyDebouncer: { pending: new Set(), touch: (a) => { touchAddrs2.push(a); }, advance: () => {} },
      _buyingTokens: new Set(['0xBUSY']),
      _evaluateSellPath: async (token) => { sellAddrs2.push(token.token); return {}; },
    });
    await eng2._runMainLoop();
    ok(buildAddrs2.length === 5,
      `B4 开关关（默认）：五票全部全量 build（实际 ${buildAddrs2.length}）`);
    ok(JSON.stringify(touchAddrs2) === JSON.stringify(['0xIN']),
      `B4 现状路径 touch：窗内 C 类照 touch（OUT build-null continue / BUSY 被 buying 门挡）——实际 ${JSON.stringify(touchAddrs2)}`);
    ok(JSON.stringify(sellAddrs2) === JSON.stringify(['0xHELD']),
      `B4 现状路径卖腿仅 held（实际 ${JSON.stringify(sellAddrs2)}）`);
  }
}

// ── C. 源码口径防线 ──────────────────────────────────────────────────────
console.log('C. 源码口径防线');
{
  const beSrc = fs.readFileSync(BE_PATH, 'utf8');
  const mainLoop = beSrc.slice(beSrc.indexOf('async _runMainLoop'), beSrc.indexOf('async _syncHoldings'));

  // C1 互斥 throw（cycle latch 是 tick build 的读取副作用 → skip 窗内票 = fire 时档位漂移）
  ok(beSrc.includes('this._tickBuildSkip = backtestConfig.tickBuildSkip !== false;'),
    'C1 开关默认开（tb0 对拍收口 2026-10-13 翻默认；显式 false 才关）');
  ok(beSrc.includes('if (this._tickBuildSkip && this._cycleEnforce)')
    && beSrc.includes('不可同启'),
    'C1 tickBuildSkip × cycleEnforce 启动互斥 throw');
  ok(beSrc.includes('this._assertNoCycleKeyReference(this._strategyEngine.getAllStrategies());'),
    'C1 防线 2 调用点（condition 直引 cycle 键扫描挂在 enforce 互斥后）');

  // C1b 防线 2 行为矩阵：直引 cycle 族键（condition/narrativeCall、string/AST、
  // IS NULL 形状）→ throw；无关键/null → 放行（perf16 形状=直引+enforce 双有，
  // 直引无 enforce 段的 config 靠防线 2 拦，2026-10-13 建臂时实测发现）
  {
    const { BacktestEngine: BE2 } = require(BE_PATH);
    const guard = (strategies) => BE2.prototype._assertNoCycleKeyReference.call({}, strategies);
    const throwsWith = (strategies, label) => {
      try { guard(strategies); ok(false, label); }
      catch (e) { ok(e.message.includes('不可同启') && /cycle/.test(e.message), label); }
    };
    throwsWith([{ condition: { type: 'BinaryExpression', left: { type: 'Identifier', name: 'tokenCycle' }, operator: '!=', right: { type: 'Literal', value: 1 } } }],
      'C1b AST condition 引 tokenCycle → throw');
    throwsWith([{ condition: 'tokenCycleRaw > 2' }], 'C1b string condition 引 tokenCycleRaw → throw');
    throwsWith([{ condition: 'buyVolumeBnb >= 1.5', narrativeCallCondition: 'cycleTps30s >= 0.5' }],
      'C1b narrativeCallCondition 引 cycleTps30s → throw');
    throwsWith([{ condition: '(tokenCycle != 1 OR tokenCycle IS NULL)' }],
      'C1b IS NULL 形状（perf16 cycle 冷档门原句）→ throw');
    let passClean = true;
    try { guard([{ condition: 'buyVolumeBnb >= 1.5 AND holders > 5', narrativeCallCondition: 'earlyReturn >= 100' }]); }
    catch { passClean = false; }
    ok(passClean, 'C1b 无 cycle 键 → 放行');
    let passNull = true;
    try { guard([{ condition: null }, { condition: '' }]); }
    catch { passNull = false; }
    ok(passNull, 'C1b null/空条件 → 放行');
  }

  // C2 cycleTag 行 factors 门（C 类票 factors=null 防线；互斥下双保险）
  ok(mainLoop.includes('if (this._cycleEnforce && factors) token.cycleTag'),
    'C2 cycleTag 写入有 factors 门');

  // C3 skip continue 在 TPA/touch 之前（等价性关键顺序：现状 build-null 连 TPA 一起跳过）
  const skipIdx = mainLoop.indexOf('shouldSkipTickBuild(tick.token_address, tick.timestamp)');
  const buildIdx = mainLoop.indexOf('buildFactorMap(tick.token_address, tick.timestamp)');
  const tpaIdx = mainLoop.indexOf('this._tokenPositionAnalyzer.checkAndTrigger');
  const touchIdx = mainLoop.indexOf('this._buyDebouncer.touch(tick.token_address, tick)');
  ok(skipIdx > buildIdx && tpaIdx > skipIdx && touchIdx > skipIdx,
    'C3 顺序：build 分支 → skip 谓词 → TPA → touch（skip continue 全跳）');
  ok(mainLoop.includes('if (heldTick || !this._tickBuildSkip) {')
    && mainLoop.includes('const heldTick = token.status === \'bought\';')
    && mainLoop.includes('if (heldTick && !this._buyingTokens.has(tick.token_address)) {'),
    'C3 heldTick 判定与分腿路由形状');

  // C4 五处恒全量重建点零谓词引用（fire/扫描/卖去抖/毕业卖/强平）。
  // 锚点带「) {」后缀防命中 _initializeDataSources 的 debouncer onFire 箭头回调
  //（行尾是「),」）；endMarker 从 si 起找防命中主循环里更早的同名调用
  //（_buildFaPruneProtectedSet 主循环 :1073 先于定义 :2116）
  const sliceMethod = (src, s, e) => {
    const si = src.indexOf(s);
    const ei = si > -1 ? src.indexOf(e, si) : -1;
    return si > -1 && ei > si ? src.slice(si, ei) : '';
  };
  const zones = [
    ['fire 重建', sliceMethod(beSrc, '_runBuyEvaluation(tokenAddress, tick, fireTs) {', 'async _evaluateBuyPath')],
    ['止损扫描', sliceMethod(beSrc, 'async _scanHoldingsStopLoss', '_buildFaPruneProtectedSet')],
    ['卖去抖 fire', sliceMethod(beSrc, '_onSellDebounceFire(tokenAddress, tick, fireTs) {', 'async _reconfirmAndSell')],
    ['毕业卖', sliceMethod(beSrc, 'async _emitGraduationSell', 'async stop()')],
    ['强平', sliceMethod(beSrc, 'async _forceSellAllRemaining', 'async _createPortfolioSnapshot')],
  ];
  ok(zones.every(([, z]) => z.length > 0 && !z.includes('shouldSkipTickBuild')),
    `C4 fire/扫描/卖去抖/毕业卖/强平五点零谓词引用（${zones.map(([n, z]) => `${n}:${z.length}`).join(' ')}）`);
  ok((mainLoop.match(/shouldSkipTickBuild\(tick\.token_address, tick\.timestamp\)/g) || []).length === 1,
    'C4 主循环内谓词调用恰 1 处（P18 注释里的名称不计）');

  // C5 C 类三段保留（touch/止损扫描/毕业消费在 build 判定后共享段，不嵌 held 分支）
  const scanIdx = mainLoop.indexOf('this._scanHoldingsStopLoss(tickTs)');
  const consumeIdx = mainLoop.indexOf('await this._consumeGraduationEvents(tickTs)');
  const sellLegIdx = mainLoop.indexOf('await this._evaluateSellPath(token, factors, tick)');
  ok(touchIdx > -1 && scanIdx > touchIdx && consumeIdx > scanIdx,
    'C5 C 类票三段保留：touch → 扫描 → 毕业消费顺序');
  ok(sellLegIdx > -1 && Math.abs(sellLegIdx - touchIdx) < 400,
    'C5 卖腿/touch 是 if/else-if 分腿形状（相邻）');

  // C6 TPA minimal factors 形状
  ok(mainLoop.includes('factors || { currentPriceBnb: _st?.currentPriceBnb || 0 }'),
    'C6 TPA minimal factors 形状（factors 空 → currentPriceBnb 单键）');
}

// ── D. _preFilterSkipped 计数口径 + 判定式两处同形 ────────────────────────
console.log('D. 计数口径与判定式同形');
{
  const T0 = 1_700_000_000_000;

  // D1 开关开路径：谓词 skip 计数（与现状 build-null 路径同点）
  {
    const fa = newFa();
    fa.registerToken('0xd1', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xd1', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    fa.shouldSkipTickBuild('0xd1', T0 + 3 * MIN);
    fa.shouldSkipTickBuild('0xd1', T0 + 4 * MIN);
    ok(fa.getPreFilterSkipped() === 2, 'D1 谓词 skip 两次 → 计数 2（探针口径不变）');
  }

  // D2 开关关（现状）路径：build 内部计数
  {
    const fa = newFa();
    fa.registerToken('0xd2', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xd2', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: 0.5, maxAgeMinutes: 2 }]);
    const b1 = fa.buildFactorMap('0xd2', T0 + 3 * MIN);
    ok(b1 === null && fa.getPreFilterSkipped() === 1, 'D2 build-null 路径计数（现状不变）');
  }

  // D3 源码两处判定式逐字同形（谓词 vs _buildFactorMap 内部——防漂移）
  const faSrc = fs.readFileSync(FA_PATH, 'utf8');
  const rangeMatches = faSrc.match(/this\._preFilter\.some\(r => !\(age < r\.minAgeMinutes \|\| age > r\.maxAgeMinutes\)\)/g) || [];
  ok(rangeMatches.length === 2,
    `D3 inAnyRange 判定式两处同形（实际 ${rangeMatches.length}）`);
  const ageMatches = faSrc.match(/const age = state\.createdAtMs \? \(now - state\.createdAtMs\) \/ 60000 : 0;/g) || [];
  ok(ageMatches.length === 2,
    `D3 age 算式两处同形（实际 ${ageMatches.length}）`);
  const predZone = faSrc.slice(faSrc.indexOf('shouldSkipTickBuild(tokenAddress, now)'), faSrc.indexOf('shouldSkipTickBuild(tokenAddress, now)') + 800);
  ok(predZone.includes('this._preFilterSkipped++;'),
    'D3 谓词 skip 计数同点累计');
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log(`\n${'_'.repeat(50)}`);
console.log(`P18 tick 路径 build 条件化单测: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

})();  // async main
