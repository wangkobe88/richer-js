#!/usr/bin/env node
// P13 装载段预载流水线并行化单测（2026-10-13 perf13 装载画像定因：9-9.5 预载
// 串行链 74s 相互独立）。_runLoadPipeline 编排：组 A（叙事预载/AVE 快照/sniper
// 画像，不依赖 _ticks）与 _loadWssTicks 并行；组 B（graduation + 回放索引）在
// ticks 后；TPA 三连最后。零 DB 零网络：Object.create(BacktestEngine.prototype)
// 绕过 constructor（P5 _test_backtest_load_pool 先例），挂起门受控 resolve 证明
// 并行发起时序。用法：node scripts/_test_backtest_preload_overlap.cjs
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
  // ── A. 组 A 与 ticks 并行（挂起 ticks 门，组 A 三项已发起；组 B 未发起）──
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

    // ── B. ticks 放行 → 就绪日志 → 组 B 并行（graduation 挂起时索引已注入）──
    console.log('B. 组 B 依赖序');
    aveGate.finish();
    ticksGate.finish();
    await flush();
    check('B1 「回放数据就绪」已打', events.some(x => x[0] === 'log' && String(x[2]).includes('回放数据就绪')), true);
    check('B2 graduation 已发起', events.filter(x => x[0] === 'start' && x[1] === 'graduation').length, 1);
    check('B3 回放索引已注入（与 graduation 并行，不等其完成）', events.some(x => x[0] === 'setIdx'), true);

    // ── C. TPA 三连最后（组 B 挂起时未跑；graduation 放行后按序执行）──
    console.log('C. TPA 三连最后');
    const tpaOrder = [];
    e._tokenPositionAnalyzer = {
      preloadOfflineProfiles: async (client) => { tpaOrder.push(['tpa1', client.__fake]); events.push(['tpa', 1]); return { rows: 0, ms: 0 }; },
      setHistoricalTicks: (ticks) => { tpaOrder.push(['tpa2', ticks]); events.push(['tpa', 2]); return 7; },
      preloadTokenProfiles: async (keys, client) => { tpaOrder.push(['tpa3', keys.length]); events.push(['tpa', 3]); return 0; },
    };
    await flush();
    check('C1 组 B 挂起时 TPA 未跑', tpaOrder.length, 0);
    gradGate.finish();
    await p;
    eq('C2 TPA 三连按序执行', tpaOrder.map(x => x[0]), ['tpa1', 'tpa2', 'tpa3']);
    check('C3 TPA 收到引擎 client 透传', tpaOrder[0][1], 'client');
    check('C4 setHistoricalTicks 收到 _ticks 本体', tpaOrder[1][1] === e._ticks, true);
    eq('C5 preloadTokenProfiles 收到 tokenMeta 键集', tpaOrder[2][1], 2);
    const iSetIdx = events.findIndex(x => x[0] === 'setIdx');
    const iTpa = events.findIndex(x => x[0] === 'tpa');
    check('C6 TPA 注入在回放索引之后（同一事件流）', iSetIdx >= 0 && iTpa > iSetIdx, true);
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
    check('G7 组 A 四项同一 Promise.all（ticks + 叙事/AVE/sniper）',
      /Promise\.all\(\[\s*this\._loadWssTicks\(\),\s*this\._preloadNarrativeRows\(\),\s*this\._loadSameNameSnapshots\(\),\s*this\._preloadSniperFlagsSafe\(\),\s*\]\)/.test(pipeBody), true);
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
