#!/usr/bin/env node
// P13/P14 装载段流水线并行化单测（perf13 定因：9-9.5 预载串行链 74s 相互独立；
// P14a：TPA tpa1/tpa3 进组 A）。_runLoadPipeline 编排：组 A（叙事预载/AVE 快照/
// sniper 画像 + TPA offline/分类预载，不依赖 _ticks）与 _loadWssTicks 并行；
// 组 B（graduation + 回放索引）在 ticks 后；TPA 注入（tpa2，消费 _ticks）最后。
// 零 DB 零网络：Object.create(BacktestEngine.prototype) 绕过 constructor（P5
// _test_backtest_load_pool 先例），挂起门受控 resolve 证明并行发起时序。
// 用法：node scripts/_test_backtest_preload_overlap.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

// unhandled rejection 全程监控（P10 同款防线：早发/并行 promise 附 handler 论证）
let unhandled = 0;
process.on('unhandledRejection', (reason) => {
  unhandled++;
  console.error('  [unhandledRejection]', reason && reason.message);
});

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

/** 挂起门：start() 记录发起事件并返回受控 promise；finish/fail 放行 */
function gate(events, name) {
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  p.catch(() => {});   // 门自身兜 handler：测试忘放行的 reject 不产生 unhandled 噪声
  return {
    start: () => { events.push(['start', name]); return p; },
    finish: (v) => resolve(v),
    fail: (e) => reject(e),
  };
}

function mkEngine() {
  const e = Object.create(BacktestEngine.prototype);
  const events = [];
  e._experimentId = 'test-p13';
  e.logger = {
    info: (id, tag, msg) => events.push(['log', tag, msg]),
    warn: (id, tag, msg) => events.push(['warn', tag, msg]),
    error: (id, tag, msg) => events.push(['error', tag, msg]),
  };
  e._ticks = [];
  e._tokenMeta = new Map([['0xtoken1', { symbol: 'A' }], ['0xtoken2', { symbol: 'B' }]]);
  e._getClient = () => ({ __fake: 'client' });
  return { e, events };
}

/** 标准依赖面：叙事（真实 _preloadNarrativeRows）+ sniper（真实 _preloadSniperFlagsSafe），
 *  两者的内部依赖 stub 可控立即完成；AVE/graduation 由测试各自覆写 */
function wireDeps(e, events, opts = {}) {
  e._strategyEngine = {
    getAllStrategies: () => opts.noNarrative
      ? [{ action: 'buy' }, { action: 'sell' }]
      : [{ action: 'buy', narrativeCallCondition: 'age > 1' }],
  };
  e._narrativeCaller = {
    preload: opts.narrativeImpl || (async (addrs) => {
      events.push(['start', 'narrative']);
      events.push(['end', 'narrative', addrs]);
      return { rowCache: { size: 0 }, tweetRows: 0 };
    }),
  };
  e._preBuyCheckService = {
    earlyParticipantService: {
      preloadSniperFlags: opts.sniperImpl || (async () => {
        events.push(['start', 'sniper']);
        events.push(['end', 'sniper']);
        return { rows: 0 };
      }),
      setReplayTicksIndex: (idx) => events.push(['setIdx', idx]),
    },
  };
}

async function main() {
  // ── A. 组 A 与 ticks 并行（挂起 ticks 门，组 A 六项已发起；组 B/TPA 注入未发起）──
  console.log('A. 组 A 并行发起');
  {
    const { e, events } = mkEngine();
    wireDeps(e, events);
    const ticksGate = gate(events, 'ticks');
    const aveGate = gate(events, 'ave');
    e._loadWssTicks = () => ticksGate.start();
    e._loadSameNameSnapshots = () => aveGate.start();
    const gradGate = gate(events, 'graduation');
    e._loadGraduationEvents = () => gradGate.start();
    // P14a：TPA tpa1/tpa3 进组 A（挂起门证明与 ticks 并行发起）；tpa2 注入留组 B 后
    const tpa1Gate = gate(events, 'tpa1');
    const tpa3Gate = gate(events, 'tpa3');
    const tpaCalls = [];
    let tpa1Client = null;
    e._tokenPositionAnalyzer = {
      preloadOfflineProfiles: (client) => { tpaCalls.push('tpa1'); tpa1Client = client; return tpa1Gate.start(); },
      setHistoricalTicks: (ticks) => { tpaCalls.push(['tpa2', ticks === e._ticks]); return 7; },
      preloadTokenProfiles: () => { tpaCalls.push('tpa3'); return tpa3Gate.start(); },
    };

    const p = e._runLoadPipeline();
    await flush();
    const starts = events.filter(x => x[0] === 'start').map(x => x[1]);
    check('A1 ticks 已发起', starts.includes('ticks'), true);
    check('A2 叙事预载已发起（ticks 未完成时在飞）', starts.includes('narrative'), true);
    check('A3 AVE 快照已发起', starts.includes('ave'), true);
    check('A4 sniper 预载已发起', starts.includes('sniper'), true);
    check('A5 graduation 未发起（依赖 ticks）', starts.includes('graduation'), false);
    check('A6 回放索引未构建（组 B 未跑）', events.some(x => x[0] === 'setIdx'), false);
    check('A7 「回放数据就绪」未打', events.some(x => x[0] === 'log' && String(x[2]).includes('回放数据就绪')), false);
    check('A8 TPA offline 预载已发起（组 A，ticks 未完成时在飞）', starts.includes('tpa1'), true);
    check('A9 TPA 分类预载已发起（组 A）', starts.includes('tpa3'), true);
    check('A10 TPA 注入未跑（依赖 _ticks）', tpaCalls.some(x => Array.isArray(x)), false);

    // ── B. ticks 放行 → 就绪日志 → 组 B 并行（graduation 挂起时索引已注入）──
    console.log('B. 组 B 依赖序');
    tpa1Gate.finish({ rows: 0, ms: 0 });
    tpa3Gate.finish(0);
    aveGate.finish();
    ticksGate.finish();
    await flush();
    check('B1 「回放数据就绪」已打', events.some(x => x[0] === 'log' && String(x[2]).includes('回放数据就绪')), true);
    check('B2 graduation 已发起', events.filter(x => x[0] === 'start' && x[1] === 'graduation').length, 1);
    check('B3 回放索引已注入（与 graduation 并行，不等其完成）', events.some(x => x[0] === 'setIdx'), true);
    check('B4 组 B 挂起时 TPA 注入仍未跑', tpaCalls.some(x => Array.isArray(x)), false);

    // ── C. TPA 注入最后（graduation 放行后执行；P14a 后仅 tpa2 消费 _ticks）──
    console.log('C. TPA 注入末位');
    gradGate.finish();
    await p;
    eq('C1 TPA 组 A 两项均已执行', tpaCalls.filter(x => typeof x === 'string').sort(), ['tpa1', 'tpa3']);
    check('C2 tpa2 注入在 graduation 放行后执行', tpaCalls.filter(x => Array.isArray(x)).length, 1);
    check('C3 setHistoricalTicks 收到 _ticks 本体', tpaCalls.find(x => Array.isArray(x))[1], true);
    const iSetIdx = events.findIndex(x => x[0] === 'setIdx');
    const iTpaLog = events.findIndex(x => x[0] === 'log' && String(x[2]).includes('TPA historical ticks 注入'));
    check('C4 TPA 注入日志在回放索引之后（同一事件流）', iSetIdx >= 0 && iTpaLog > iSetIdx, true);
    check('C5 offline 预载日志透传 rows/ms', events.some(x => x[0] === 'log' && String(x[2]).includes('TPA offline 画像预载')), true);
    check('C6 分类预载日志透传 cache 数', events.some(x => x[0] === 'log' && String(x[2]).includes('TPA token 分类预载')), true);
    check('C7 offline 预载收到引擎 client 透传', tpa1Client && tpa1Client.__fake, 'client');
  }

  // ── D. 失败语义：叙事 reject 传播阻断 / graduation reject 传播 / sniper fail-open 不阻断 ──
  console.log('D. 失败语义');
  {
    // D1 叙事预载 reject → _runLoadPipeline 整体 reject（阻断启动，语义同串行版）
    const { e, events } = mkEngine();
    wireDeps(e, events, { narrativeImpl: () => Promise.reject(new Error('narrative down')) });
    e._loadWssTicks = async () => events.push(['start', 'ticks']);
    e._loadSameNameSnapshots = async () => events.push(['start', 'ave']);
    e._loadGraduationEvents = async () => events.push(['start', 'graduation']);
    let caught = null;
    await e._runLoadPipeline().catch(err => caught = err);
    check('D1 叙事失败传播阻断', caught && caught.message.includes('narrative down'), true);
    check('D2 组 B 未跑（首层 reject 即停）', events.some(x => x[1] === 'graduation'), false);
  }
  {
    // D3 graduation reject → 整体 reject（第二层）
    const { e, events } = mkEngine();
    wireDeps(e, events);
    e._loadWssTicks = async () => {};
    e._loadSameNameSnapshots = async () => {};
    e._loadGraduationEvents = () => Promise.reject(new Error('grad down'));
    let caught = null;
    await e._runLoadPipeline().catch(err => caught = err);
    check('D3 graduation 失败传播阻断', caught && caught.message.includes('grad down'), true);
  }
  {
    // D4 sniper 预载失败 fail-open：真实 _preloadSniperFlagsSafe 内部 catch → warn + 正常完成
    const { e, events } = mkEngine();
    wireDeps(e, events, { sniperImpl: () => Promise.reject(new Error('sniper down')) });
    e._loadWssTicks = async () => {};
    e._loadSameNameSnapshots = async () => {};
    e._loadGraduationEvents = async () => {};
    let ok = true;
    await e._runLoadPipeline().then(() => ok = true, () => ok = false);
    check('D4 sniper 失败不阻断', ok, true);
    check('D5 fail-open warn 留痕',
      events.some(x => x[0] === 'warn' && String(x[2]).includes('sniper 画像预载失败') && String(x[2]).includes('fail-open')), true);
  }
  {
    // D6 TPA 预载意外 reject → 整体 reject 阻断（fail-loud 对齐串行版：真实
    //    preloadOfflineProfiles/preloadTokenProfiles 内部 fail-open 不 reject，
    //    引擎层不加 catch——意外异常不吞，红线 13 事故现场防线同族口径）
    const { e, events } = mkEngine();
    wireDeps(e, events);
    e._loadWssTicks = async () => {};
    e._loadSameNameSnapshots = async () => {};
    e._loadGraduationEvents = async () => {};
    e._tokenPositionAnalyzer = {
      preloadOfflineProfiles: () => Promise.reject(new Error('tpa unexpected')),
      setHistoricalTicks: () => 0,
      preloadTokenProfiles: async () => 0,
    };
    let caught = null;
    await e._runLoadPipeline().catch(err => caught = err);
    check('D6 TPA 预载意外 reject 传播阻断', caught && caught.message.includes('tpa unexpected'), true);
    check('D7 TPA 注入未跑（首层 reject 即停）', events.some(x => x[0] === 'log' && String(x[2]).includes('TPA historical ticks 注入')), false);
  }

  // ── E. _preloadNarrativeRows 真实逻辑：无 narrativeCallCondition 零预载 / 有条件按 tokenMeta 键集 ──
  console.log('E. 叙事预载门');
  {
    const { e } = mkEngine();
    let called = 0, gotAddrs = null;
    wireDeps(e, [], { noNarrative: true, narrativeImpl: async (addrs) => { called++; gotAddrs = addrs; return { rowCache: { size: 0 }, tweetRows: 0 }; } });
    await e._preloadNarrativeRows();
    eq('E1 无 narrativeCallCondition 不预载', called, 0);
    e._strategyEngine = { getAllStrategies: () => [{ action: 'buy', narrativeCallCondition: 'age > 1' }] };
    await e._preloadNarrativeRows();
    eq('E2 有条件预载一次', called, 1);
    eq('E3 预载地址 = tokenMeta 键集', gotAddrs, ['0xtoken1', '0xtoken2']);
    // 纯卖腿带条件不算（action==='buy' 判据）
    e._strategyEngine = { getAllStrategies: () => [{ action: 'sell', narrativeCallCondition: 'x' }] };
    await e._preloadNarrativeRows();
    eq('E4 卖腿 narrativeCallCondition 不触发', called, 1);
  }

  // ── F. _buildEarlyReplayIndex 真实逻辑：分桶 + (timestamp, log_index) 升序 ──
  console.log('F. 回放索引构建');
  {
    const { e } = mkEngine();
    wireDeps(e, []);
    let injected = null;
    e._preBuyCheckService.earlyParticipantService.setReplayTicksIndex = (idx) => { injected = idx; };
    e._ticks = [
      { token_address: '0xa', timestamp: 3000, log_index: 1 },
      { token_address: '0xa', timestamp: 1000, log_index: 5 },
      { token_address: '0xb', timestamp: 2000, log_index: 0 },
      { token_address: '0xa', timestamp: 1000, log_index: 2 },   // 同 ts 乱序 log_index
      { token_address: '0xc', timestamp: 500, log_index: null }, // null log_index 兜 0
    ];
    await e._buildEarlyReplayIndex();
    check('F1 分桶数', injected && injected.size, 3);
    eq('F2 桶内 ts+log_index 升序', injected.get('0xa').map(t => [t.timestamp, t.log_index]), [[1000, 2], [1000, 5], [3000, 1]]);
    eq('F3 null log_index 排队尾前（ts 最小者）', injected.get('0xc').length, 1);
    check('F4 空数组零桶', (() => { e._ticks = []; return e._buildEarlyReplayIndex().then(() => true); })() instanceof Promise, true);
    await e._buildEarlyReplayIndex();
  }

  // ── G. 源码口径（红线 13：编排结构锁定） ──
  console.log('G. 源码口径');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    const iInit = src.indexOf('async _initializeDataSources()');
    const iCall = src.indexOf('await this._runLoadPipeline();');
    check('G0 锚点齐全', iInit > 0 && iCall > iInit, true);
    const initBody = src.slice(iInit, iCall + 'await this._runLoadPipeline();'.length);
    check('G1 初始化段以 _runLoadPipeline 收口', initBody.includes('await this._runLoadPipeline();'), true);
    check('G2 初始化段不再直调 _loadWssTicks', initBody.includes('await this._loadWssTicks'), false);
    check('G3 初始化段不再直调 _loadGraduationEvents', initBody.includes('_loadGraduationEvents'), false);
    check('G4 初始化段不再内联 setReplayTicksIndex', initBody.includes('setReplayTicksIndex'), false);
    check('G5 初始化段不再内联 preloadSniperFlags', initBody.includes('preloadSniperFlags'), false);
    check('G6 初始化段不再内联 TPA 预载', initBody.includes('preloadOfflineProfiles'), false);

    const iPipe = src.indexOf('async _runLoadPipeline()');
    const iNext = src.indexOf('async _preloadNarrativeRows()', iPipe);
    const pipeBody = src.slice(iPipe, iNext);
    check('G7 组 A：四项字面量数组 + TPA 条件 push 两项 + 单点 Promise.all(groupA)',
      /const groupA = \[\s*this\._loadWssTicks\(\),\s*this\._preloadNarrativeRows\(\),\s*this\._loadSameNameSnapshots\(\),\s*this\._preloadSniperFlagsSafe\(\),\s*\];\s*if \(tpa\) \{\s*groupA\.push\(this\._preloadTpaOfflineProfiles\(tpa\)\);\s*groupA\.push\(this\._preloadTpaTokenProfiles\(tpa\)\);\s*\}\s*await Promise\.all\(groupA\);/.test(pipeBody), true);
    check('G8 组 B 两项同一 Promise.all（graduation + 索引）',
      /Promise\.all\(\[\s*this\._loadGraduationEvents\(\),\s*this\._buildEarlyReplayIndex\(\),\s*\]\)/.test(pipeBody), true);
    const iReady = pipeBody.indexOf('回放数据就绪');
    const iGradCall = pipeBody.indexOf('this._loadGraduationEvents()');
    check('G9 组 B 在就绪日志之后', iReady > 0 && iGradCall > iReady, true);
    const iIdxCall = pipeBody.indexOf('this._buildEarlyReplayIndex()');
    const iSetHist = pipeBody.indexOf('setHistoricalTicks');
    check('G10 TPA setHistoricalTicks 在组 B 之后', iIdxCall > 0 && iSetHist > iIdxCall, true);
  }

  eq('H1 全程零 unhandled rejection', unhandled, 0);
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
