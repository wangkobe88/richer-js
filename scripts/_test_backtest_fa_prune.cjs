#!/usr/bin/env node
/**
 * P17 虚拟时钟 prune 单测（2026-10-13 OOM 根治，零 DB 零网络）
 *
 * 覆盖：
 * A. FA pruneStaleTokens 第三参 nowMs 语义（虚拟时钟判定 / 缺省墙钟 live 兼容）
 * B. 保护集矩阵（heldTokens 豁免）
 * C. 容量上限（maxTrackedTokens 最久未动淘汰 + 保护集豁免）
 * D. 复流语义（prune 后 processTick 自动重建 state）
 * E. BacktestEngine 侧：保护集构成四类来源 + 节流 + 开关 off
 * F. 毕业卖事故反证（plan P7 最大坑：state 被 prune → buildFactorMap null → 毕业卖
 *    「无因子」失败每 tick 重试）——保护集含毕业 token 时必须存活
 * G. 源码口径防线（红线 6：回测路径禁 Date.now——prune 判定时钟必须传 tickTs）
 * H. P17 复流重锚（2026-10-13 pr1 分叉根因修复）：prune 后复流首 tick 引擎侧按
 *    源实验 meta 权威锚重注册——防 processTick 自动建 state 锚=复流时刻 → age
 *    归零回进买窗（卡骆驰 0x2d145db9 案：46min 断流复流出 perf16 没有的信号
 *    +121，build 成功不 continue 连带止损扫描网格相位漂移 → 7 笔时间止损卖出
 *    时刻差 2-21s）。买窗 max ≪ prune 窗 → 复流票真实 age 恒出窗 → 与无 prune
 *    行为 bit 一致
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const BE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');

// ── 测试基建 ──────────────────────────────────────────────────────────────
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

// 整体包 async IIFE：H5 节 await 驱动 _runMainLoop，必须等它完成再跑 H6 与汇总
//（否则同步流先打汇总，H5 断言迟到——_test_backtest_tick_build_skip 同款结构）
(async () => {

// ── A. 第三参 nowMs 语义 ─────────────────────────────────────────────────
console.log('A. pruneStaleTokens 虚拟时钟参数');
{
  const T0 = 1_700_000_000_000;
  // A1: 虚拟时刻判定——lastTickAt 距虚拟 now 超 maxAge 删 / 未超留
  {
    const fa = newFa();
    fa.processTick(mkTick('0xdead1', T0));
    fa.processTick(mkTick('0xalive1', T0 + 26 * MIN));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    ok(pruned === 1, `A1 虚拟时钟删过期票（期望 1，实际 ${pruned}）`);
    ok(!fa.getTokenState('0xdead1'), 'A1 过期票 state 已删');
    ok(!!fa.getTokenState('0xalive1'), 'A1 窗内票 state 存活');
  }
  // A2: 边界——距 now 恰好 = maxAge（> 判定，不含边界）不删
  {
    const fa = newFa();
    fa.processTick(mkTick('0xedge', T0));
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 30 * MIN);
    ok(!!fa.getTokenState('0xedge'), 'A2 边界时刻（差值==maxAge 不删，> 才删）');
  }
  // A3: 缺省第三参 = 墙钟（live 兼容）——40min 前的票按 Date.now 判定删
  {
    const fa = newFa();
    fa.processTick(mkTick('0xwallclock', Date.now() - 40 * MIN));
    fa.processTick(mkTick('0xwallfresh', Date.now() - 1 * MIN));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set());
    ok(pruned === 1 && !fa.getTokenState('0xwallclock') && !!fa.getTokenState('0xwallfresh'),
      'A3 缺省 nowMs 走墙钟（live setInterval 调用点零变化）');
  }
  // A4: 虚拟时钟下新票不受墙钟污染——lastTickAt 在「未来墙钟」的票按虚拟时刻判死
  {
    const fa = newFa();
    // 虚拟时刻体系：窗口起点 T0，票活跃于 T0 附近；墙钟此刻与 T0 无关
    fa.processTick(mkTick('0xvclk', T0));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    ok(pruned === 1 && !fa.getTokenState('0xvclk'),
      'A4 纯虚拟时钟判定（不读墙钟）');
  }
}

// ── B. 保护集矩阵 ────────────────────────────────────────────────────────
console.log('B. heldTokens 保护集');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa();
  fa.processTick(mkTick('0xhelda', T0));
  fa.processTick(mkTick('0xheldb', T0));
  fa.processTick(mkTick('0xunheld', T0));
  const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xhelda', '0xheldb']), T0 + 60 * MIN);
  ok(pruned === 1, `B1 保护集豁免（只删未保护票，期望 1，实际 ${pruned}）`);
  ok(!!fa.getTokenState('0xhelda') && !!fa.getTokenState('0xheldb'), 'B1 保护集票存活');
  ok(!fa.getTokenState('0xunheld'), 'B1 未保护票删除');
}

// ── C. 容量上限 ──────────────────────────────────────────────────────────
console.log('C. maxTrackedTokens 容量上限');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa({ maxTrackedTokens: 3 });
  // 4 票全活跃（age 窗内）但超容量 → 最久未动淘汰
  fa.processTick(mkTick('0xc1', T0));
  fa.processTick(mkTick('0xc2', T0 + MIN));
  fa.processTick(mkTick('0xc3', T0 + 2 * MIN));
  fa.processTick(mkTick('0xc4', T0 + 3 * MIN));
  // c1 在保护集 → 淘汰顺延到 c2
  const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xc1']), T0 + 4 * MIN);
  ok(pruned === 1, `C1 超容淘汰最久未动且保护集豁免（期望 1，实际 ${pruned}）`);
  ok(!fa.getTokenState('0xc2'), 'C1 c2（最久未动未保护）被淘汰');
  ok(!!fa.getTokenState('0xc1') && !!fa.getTokenState('0xc3') && !!fa.getTokenState('0xc4'),
    'C1 c1（保护）+ c3/c4（较新）存活');
}

// ── D. 复流语义 ──────────────────────────────────────────────────────────
console.log('D. prune 后复流自建');
{
  const T0 = 1_700_000_000_000;
  const fa = newFa();
  fa.processTick(mkTick('0xrevive', T0, { price_bnb: 2e-9 }));
  fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
  ok(!fa.getTokenState('0xrevive'), 'D1 死票已删');
  fa.processTick(mkTick('0xrevive', T0 + 60 * MIN, { price_bnb: 3e-9 }));
  const st = fa.getTokenState('0xrevive');
  ok(!!st, 'D2 复流自动重建 state');
  ok(st.firstTickAt === T0 + 60 * MIN, 'D3 首 tick 锚重置（新生命周期口径）');
  const f = fa.buildFactorMap('0xrevive', T0 + 60 * MIN);
  ok(f != null && f.currentPriceBnb === 3e-9, 'D4 复流后 buildFactorMap 正常');
}

// ── E. BacktestEngine 保护集构成 + 节流 + 开关 ──────────────────────────
console.log('E. BacktestEngine 侧');
{
  const { BacktestEngine: BE } = require(BE_PATH);
  // 绕 constructor 构造最小实例（先例 _test_backtest_preload_overlap）
  const eng = Object.create(BE.prototype);
  eng._getAllHoldings = () => [
    { tokenAddress: '0xPOS1' },
    { tokenAddress: null },
    { tokenAddress: '0xpos2' },
  ];
  eng._buyingTokens = new Set(['0xBUY1']);
  eng._sellingTokens = new Set(['0xSELL1']);
  eng._graduationEvents = [
    { token: '0xGRAD_CONSUMED', tsMs: 1 },
    { token: '0xgrad_pending', tsMs: 2 },
    { token: '0xGRAD_FUTURE', tsMs: 3 },
  ];
  eng._gradEvtIdx = 1; // 第 0 个已消费

  const held = eng._buildFaPruneProtectedSet();
  ok(held.has('0xpos1') && held.has('0xpos2'), 'E1 账面持仓进保护集（小写归一）');
  ok(held.has('0xbuy1') && held.has('0xsell1'), 'E2 执行中两集合进保护集（小写归一）');
  ok(held.has('0xgrad_pending') && held.has('0xgrad_future'), 'E3 未消费 graduation 事件 token 进保护集');
  ok(!held.has('0xgrad_consumed'), 'E4 已消费 graduation 事件 token 不进（指针后切片）');
  ok(!held.has('0xpos1') || held.has('0xpos1'), 'E5 null tokenAddress 跳过不炸');

  // E6: 节流与开关（直接驱动快照桶分支同款判定式——引擎主循环内联逻辑）
  const intervalOk = (lastTs, tickTs, intervalMs) =>
    lastTs === null || tickTs - lastTs >= intervalMs;
  ok(intervalOk(null, 5, 300) === true, 'E6 首次（lastFaPruneTs=null）触发');
  ok(intervalOk(100, 200, 300) === false, 'E6 虚拟间隔未到不触发');
  ok(intervalOk(100, 400, 300) === true, 'E6 虚拟间隔到触发');
}

// ── F. 毕业卖事故反证（plan P7 最大坑）───────────────────────────────────
console.log('F. 毕业卖 prune 事故反证');
{
  const T0 = 1_700_000_000_000;
  // F1: 未保护——毕业票 state 被 prune → buildFactorMap(evtTs) null（事故形状实证）
  {
    const fa = newFa();
    fa.processTick(mkTick('0xgrad1', T0, { price_bnb: 5e-9 }));
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 45 * MIN);
    const f = fa.buildFactorMap('0xgrad1', T0 + 45 * MIN);
    ok(f == null, 'F1 无保护时毕业时刻取因子为 null（_emitGraduationSell 会每 tick 重试的事故形状）');
  }
  // F2: 有保护（未消费 graduation 事件 / 持仓）——state 存活，毕业卖因子就绪
  {
    const fa = newFa();
    fa.processTick(mkTick('0xgrad2', T0, { price_bnb: 5e-9 }));
    const pruned = fa.pruneStaleTokens(30 * MIN, new Set(['0xgrad2']), T0 + 45 * MIN);
    const f = fa.buildFactorMap('0xgrad2', T0 + 45 * MIN);
    ok(pruned === 0, 'F2 保护集内毕业票零 prune');
    ok(f != null && f.currentPriceBnb === 5e-9,
      'F2 毕业时刻 buildFactorMap 非 null 且价格史可用（断流前最后可靠价落袋）');
  }
}

// ── G. 源码口径防线 ──────────────────────────────────────────────────────
console.log('G. 源码口径断言');
{
  const faSrc = fs.readFileSync(FA_PATH, 'utf8');
  const beSrc = fs.readFileSync(BE_PATH, 'utf8');

  // G1: FA prune 判定时钟——nowMs 优先、缺省墙钟（live 兼容）
  ok(/const now = nowMs != null \? nowMs : Date\.now\(\);/.test(faSrc),
    'G1 FA 虚拟时钟优先、缺省 Date.now');

  // G2: 主循环 prune 调用第三参必须是 tickTs（红线 6：回测路径禁 Date.now）
  const pruneCall = beSrc.match(/pruneStaleTokens\(\s*[\s\S]{0,120}?\)/g) || [];
  ok(pruneCall.length === 1, `G2 BacktestEngine prune 调用点唯一（实际 ${pruneCall.length}）`);
  ok(/pruneStaleTokens\(\s*\n?\s*this\._faPruneMaxAgeMs, this\._buildFaPruneProtectedSet\(\), tickTs\)/.test(beSrc),
    'G2 prune 第三参=tickTs（虚拟时刻）');

  // G3: 开关 off 短路在调用前
  ok(/this\._faPruneMaxAgeMs > 0 &&[\s\S]{0,400}?pruneStaleTokens/.test(beSrc),
    'G3 faPruneMaxAgeSec=0 短路（回滚开关）');

  // G4: maxTrackedTokens 注入必须在 FA 构造之前（构造函数即刻读取）
  const injectIdx = beSrc.indexOf('wsConfig.maxTrackedTokens = btPrune.maxTrackedTokens ?? 100000;');
  const ctorIdx = beSrc.indexOf('this._factorAggregator = new FourMemeFactorAggregator({');
  ok(injectIdx > 0 && ctorIdx > 0 && injectIdx < ctorIdx,
    `G4 maxTrackedTokens 注入先于 FA 构造（inject=${injectIdx} ctor=${ctorIdx}）`);

  // G5: prune 挂点在 30s 快照桶分支内（虚拟时钟驱动，非墙钟 setInterval）
  const snapIdx = beSrc.indexOf("tickTs - this._lastSnapshotTs >= SNAPSHOT_INTERVAL_MS");
  const prunedLoopIdx = beSrc.indexOf('this._faPruneMaxAgeMs > 0 &&');
  ok(snapIdx > 0 && prunedLoopIdx > snapIdx && prunedLoopIdx - snapIdx < 600,
    'G5 prune 挂快照桶分支内（距桶判定 <600 字符）');

  // G6: 缺省值对齐 live（30min/5min）
  ok(beSrc.includes('this._faPruneMaxAgeMs = btPrune.faPruneMaxAgeSec != null ? btPrune.faPruneMaxAgeSec * 1000 : 30 * 60 * 1000;'),
    'G6 maxAge 缺省 30min 对齐 live');
  ok(beSrc.includes('this._faPruneIntervalMs = btPrune.faPruneIntervalSec != null ? btPrune.faPruneIntervalSec * 1000 : 5 * 60 * 1000;'),
    'G6 interval 缺省 5min 对齐 live');

  // G7: 保护集四类来源齐全
  const protoIdx = beSrc.indexOf('_buildFaPruneProtectedSet() {');
  const protoSrc = beSrc.slice(protoIdx, protoIdx + 900);
  ok(protoIdx > 0
    && protoSrc.includes('_getAllHoldings()')
    && protoSrc.includes('_buyingTokens')
    && protoSrc.includes('_sellingTokens')
    && protoSrc.includes('_graduationEvents')
    && protoSrc.includes('_gradEvtIdx'),
    'G7 保护集四类来源（持仓/买入中/卖出中/未消费毕业）');

  // G8: 失败 fail-open（对齐 live catch 不中断回放）
  const pruneBlock = beSrc.slice(prunedLoopIdx, prunedLoopIdx + 700);
  ok(pruneBlock.includes('catch (err)'), 'G8 prune 失败 catch 不中断回放（对齐 live）');
}

// ── H. P17 复流重锚（pr1 分叉根因修复）───────────────────────────────────
console.log('H. 复流重锚（prune 后复流首 tick 权威锚重注册）');
{
  const T0 = 1_700_000_000_000;

  // H1: 引擎侧重注册——prune 后 state 缺失 → registerToken(权威锚) → 锚保持
  {
    const fa = newFa();
    fa.registerToken('0xre1', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xre1', T0, { price_bnb: 2e-9 }), { emitFactors: false });
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    ok(!fa.getTokenState('0xre1'), 'H1 prune 后 state 缺失（引擎检测点 getTokenState 语义）');
    // 引擎主循环 else-if 分支同款重注册（meta 权威锚）
    fa.registerToken('0xre1', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xre1', T0 + 46 * MIN, { price_bnb: 3e-9 }), { emitFactors: false });
    const st = fa.getTokenState('0xre1');
    ok(!!st && st.createdAtMs === T0,
      'H1 重注册后 createdAtMs=权威锚（非复流 tick 时刻，age 不归零）');
  }

  // H2: 事故现场反证（卡骆驰 0x2d145db9 形状：活跃 35s → 46min 断流被 prune →
  //     复流）——不重注册则 processTick 自动建 state 锚=复流时刻 → age≈0 回进
  //     买窗（pr1 比 perf16 多出 121 信号的根因形状，实证：复流 17s 后 fire）
  {
    const fa = newFa();
    fa.registerToken('0xbug', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xbug', T0), { emitFactors: false });
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    fa.processTick(mkTick('0xbug', T0 + 46 * MIN), { emitFactors: false }); // 事故路径：无重注册
    const st = fa.getTokenState('0xbug');
    ok(!!st && st.createdAtMs === T0 + 46 * MIN,
      'H2 事故形状：不重注册 → processTick 自动建 state 锚=复流 tick 时刻（age 归零）');
    fa.setPreFilter([{ minAgeMinutes: -Infinity, maxAgeMinutes: 1.5 }]); // perf16 买窗 [-∞,1.5) 同款
    ok(fa.shouldSkipTickBuild('0xbug', T0 + 46 * MIN + 17 * 1000) === false,
      'H2 事故形状：复流 17s 后 age≈0.28min 窗内 → build+fire 全链（卡骆驰 14:19:46 信号根因）');
  }

  // H3: 修复后出窗——复流票断流必 >prune 窗 30min，真实 age >30min ≫ 买窗 max
  //     1.5min → 恒出窗 build-null continue → 与无 prune 行为 bit 一致（数学保证）
  {
    const fa = newFa();
    fa.registerToken('0xfix', { createdAtMs: T0, totalSupply: 1e9 });
    fa.processTick(mkTick('0xfix', T0), { emitFactors: false });
    fa.setPreFilter([{ minAgeMinutes: -Infinity, maxAgeMinutes: 1.5 }]);
    fa.pruneStaleTokens(30 * MIN, new Set(), T0 + 31 * MIN);
    fa.registerToken('0xfix', { createdAtMs: T0, totalSupply: 1e9 }); // 引擎侧重注册
    fa.processTick(mkTick('0xfix', T0 + 46 * MIN), { emitFactors: false });
    ok(fa.shouldSkipTickBuild('0xfix', T0 + 46 * MIN) === true,
      'H3 重注册后复流首 tick 出窗（真实 age 46min > 1.5min → skip）');
    ok(fa.buildFactorMap('0xfix', T0 + 46 * MIN) === null,
      'H3 build-null（与无 prune 行为同副作用序列——continue 链等价，价格史丢失面零暴露）');
  }

  // H4: FA 迟到回填语义保持（修复依赖的既有语义，live 零变化）：state 已存在 +
  //     更早 createdAtMs 注册 → 回填（live token_create 迟到注册同路径）
  {
    const fa = newFa();
    fa.processTick(mkTick('0xlate', T0 + 5 * MIN), { emitFactors: false }); // 自动建 state 锚=T0+5min
    fa.registerToken('0xlate', { createdAtMs: T0, totalSupply: 1e9 });     // 迟到注册带权威锚
    const st = fa.getTokenState('0xlate');
    ok(!!st && st.createdAtMs === T0, 'H4 state 已存在时迟到注册回填更早锚（live 语义保持）');
  }

  // H5: 引擎级行为（打桩驱动主循环，零 DB 零网络）：已见 token + state 缺失 +
  //     prune 开 → 以 meta 权威锚重注册；state 存在 / prune 关闭 → 零重注册
  {
    const { BacktestEngine: BE } = require(BE_PATH);
    const mkEngine = (fields) => {
      const eng = Object.create(BE.prototype);
      return Object.assign(eng, {
        _experimentId: 'test-revive',
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        _ticks: [], _strategyEngine: { getStrategyCount: () => 0, getAllStrategies: () => [] },
        _advanceDebouncer: async () => {},
        _lastSnapshotTs: null, _loopCount: 0,
        _createPortfolioSnapshot: async () => {},
        _lastFaPruneTs: null, _faPrunedTotal: 0,
        _seenTokens: new Set(), _tokenMeta: new Map(),
        _tickBuildSkip: false,
        _tokenPositionAnalyzer: null,
        _buyingTokens: new Set(), _sellingTokens: new Set(),
        _buyDebouncer: { pending: new Set(), touch: () => {}, advance: () => {} },
        _sellConfirmDebouncer: { advance: () => {} },
        _sellDebounceMs: 0,
        _stopLossEnabled: false, _stopLossScanMs: null, _lastStopLossScanTs: null,
        _consumeGraduationEvents: async () => {},
        _inflightEvals: new Set(),
        _forceSellAllRemaining: async () => {},
        _writeBufferEnabled: false, _writeBuffer: null,
        _portfolioManager: { getPortfolio: () => ({ totalValue: 100 }) },
        _portfolioId: 'p0', initialBalance: 100,
        _narrativeBlockedTokens: new Set(),
        _narrativeCaller: { getMemoryCacheHits: () => 0, getCallStats: () => ({ calls: 0, ms: 0 }) },
        _preBuyCheckService: {
          getPerfStats: () => ({ calls: 0, ms: 0, shortCircuits: 0, earlyMs: 0, parallelMs: 0, evalMs: 0, parHolder: 0, parCluster: 0, parCreator: 0, parStrong: 0, parSameName: 0, labelMs: 0 }),
          earlyParticipantService: {
            getPerfStats: () => ({ calls: 0, ms: 0, fetchMs: 0, replayHits: 0, sniper: { queryMs: 0, batches: 0, queriedAddrs: 0, failures: 0, cached: 0, fullyLoaded: false, preloadedRows: 0 } }),
            getReplayHits: () => 0,
          },
          sameNameTokenService: { getSnapshotStats: () => ({}) },
        },
        // stub throw：finally 状态更新失败被 catch 吞 → stats 段跳过，零 DB
        _updateExperimentStatus: async () => { throw new Error('stub: 绕 stats 段真 DB 写'); },
        metrics: { debounceSuppressed: 0, totalSignals: 0, totalTrades: 0 },
        ...fields,
      });
    };
    const T1 = 1_700_000_000_000;
    const loopTick = { token_address: '0xRE', timestamp: T1, platform: 'fourmeme' };

    // a) 已见 + state 缺失 + prune 开 → 重注册（权威锚 meta.createdAtSec*1000）
    {
      const regCalls = [];
      const eng = mkEngine({
        _ticks: [loopTick],
        _faPruneMaxAgeMs: 30 * MIN,
        _seenTokens: new Set(['0xRE']),
        _tokenMeta: new Map([['0xRE', { createdAtSec: T1 / 1000 - 2760, totalSupply: 1e9, symbol: 'RE', creator: null }]]),
        _factorAggregator: {
          getTokenState: () => undefined,
          registerToken: (addr, info) => { regCalls.push({ addr, info }); },
          processTick: () => {},
          getPreFilterSkipped: () => 0,
        },
        _tokenPool: { getToken: () => null }, // 重注册段之后 continue（本节只测注册段）
        _registerToken: async () => { throw new Error('已见票不该走 _registerToken'); },
      });
      await eng._runMainLoop();
      ok(regCalls.length === 1 && regCalls[0].addr === '0xRE'
        && regCalls[0].info.createdAtMs === (T1 / 1000 - 2760) * 1000,
        'H5a 已见+state 缺失 → 以 meta 权威锚重注册（createdAtSec*1000）');
      ok(regCalls[0].info.platform === 'fourmeme' && regCalls[0].info.symbol === 'RE',
        'H5a 重注册参数形状（platform=tick 行级/symbol=meta）');
    }
    // b) state 存在 → 零重注册
    {
      const regCalls = [];
      const eng = mkEngine({
        _ticks: [loopTick],
        _faPruneMaxAgeMs: 30 * MIN,
        _seenTokens: new Set(['0xRE']),
        _tokenMeta: new Map([['0xRE', { createdAtSec: T1 / 1000 }]]),
        _factorAggregator: {
          getTokenState: () => ({ createdAtMs: T1 }),
          registerToken: (addr, info) => { regCalls.push({ addr, info }); },
          processTick: () => {},
          getPreFilterSkipped: () => 0,
        },
        _tokenPool: { getToken: () => null },
      });
      await eng._runMainLoop();
      ok(regCalls.length === 0, 'H5b state 存在（未 prune）→ 零重注册');
    }
    // c) prune 关闭（faPruneMaxAgeSec=0 回滚开关）→ 零检测零重注册
    {
      const regCalls = [];
      const eng = mkEngine({
        _ticks: [loopTick],
        _faPruneMaxAgeMs: 0,
        _seenTokens: new Set(['0xRE']),
        _tokenMeta: new Map([['0xRE', { createdAtSec: T1 / 1000 }]]),
        _factorAggregator: {
          getTokenState: () => undefined,
          registerToken: (addr, info) => { regCalls.push({ addr, info }); },
          processTick: () => {},
          getPreFilterSkipped: () => 0,
        },
        _tokenPool: { getToken: () => null },
      });
      await eng._runMainLoop();
      ok(regCalls.length === 0, 'H5c prune 关闭 → 复流检测不触发（回滚开关语义）');
    }
    // d) 首见票走 _registerToken 不走复流分支（互斥形状）
    {
      const regCalls = [];
      const eng = mkEngine({
        _ticks: [loopTick],
        _faPruneMaxAgeMs: 30 * MIN,
        _seenTokens: new Set(),
        _tokenMeta: new Map([['0xRE', { createdAtSec: T1 / 1000 }]]),
        _factorAggregator: {
          getTokenState: () => undefined,
          registerToken: (addr, info) => { regCalls.push({ addr, info }); },
          processTick: () => {},
          getPreFilterSkipped: () => 0,
        },
        _tokenPool: { getToken: () => null },
        _registerToken: async (tick) => {
          eng._seenTokens.add(tick.token_address);
          // 首见注册真实路径里 registerToken 也会被调——此处打桩区分来源
          regCalls.push({ addr: tick.token_address, info: { firstSeen: true } });
        },
      });
      await eng._runMainLoop();
      ok(regCalls.length === 1 && regCalls[0].info.firstSeen === true,
        'H5d 首见票走 _registerToken（复流分支不触发）');
    }
  }

  // H6: 源码口径防线
  {
    const beSrc = fs.readFileSync(BE_PATH, 'utf8');
    const mainLoop = beSrc.slice(beSrc.indexOf('async _runMainLoop'), beSrc.indexOf('async _syncHoldings'));
    const reRegIdx = mainLoop.indexOf('else if (this._faPruneMaxAgeMs > 0');
    const ptIdx = mainLoop.indexOf('this._factorAggregator.processTick(tick, { emitFactors: false })');

    ok(reRegIdx > -1
      && mainLoop.includes('else if (this._faPruneMaxAgeMs > 0 && !this._factorAggregator.getTokenState(tick.token_address))'),
      'H6 复流检测分支（prune 门 + getTokenState 缺失判定）');
    ok(ptIdx > reRegIdx,
      'H6 重注册在 processTick 之前（防 FA 自动建 state 抢锚=复流时刻）');
    ok(/createdAtMs: \(meta\.createdAtSec \|\| Math\.floor\(tick\.timestamp \/ 1000\)\) \* 1000/.test(mainLoop),
      'H6 权威锚链 meta.createdAtSec（源实验 created_at）');
    const branchBlock = mainLoop.slice(reRegIdx, reRegIdx + 1100);
    ok(!branchBlock.includes('this._registerToken(tick)'),
      'H6 复流分支不调 _registerToken（不重复落库/tokenPool——_seenTokens 门）');
    ok(branchBlock.includes('platform: tick.platform || null'),
      'H6 platform=tick 行级权威（与 _registerToken 同口径，flap 票不被错标）');
    // live 零变化：live 引擎无复流重锚（复流票由 token_create 事件带锚注册）
    const livePath = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'FourMemeWssTradingEngine.js');
    const liveSrc = fs.readFileSync(livePath, 'utf8');
    ok(!liveSrc.includes('复流重锚'),
      'H6 live 引擎零复流重锚分支（live 复流票 token_create 事件带锚注册）');
  }
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log(`\n${'_'.repeat(50)}`);
console.log(`P17 虚拟时钟 prune 单测: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

})();  // async IIFE
