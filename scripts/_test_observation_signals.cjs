#!/usr/bin/env node
/**
 * 观察信号机制单测（2026-10-23 ₿DOG 案 0x85cd…7777）
 *
 * 机制：叙事评级==2|3 或 市值>阈值（严格大于）→ 每票最多 maxPerToken 行 OBSERVE
 * 观察信号（action='hold' 恒不触发交易）；事件首记+intervalMs 间隔补采；重启经
 * init() DB 重建续接（实验级全局上限不变量）。
 *
 * 零 DB 零网络：TradeSignal.prototype.save 打桩（捕获 toDatabaseFormat 不真写库）、
 * db client 手写链式桩（init 分页拉全）、logger 打桩。不 require dbManager。
 * 用法：node scripts/_test_observation_signals.cjs
 */
'use strict';

const path = require('path');
const { TradeSignal } = require('../src/trading-engine/entities/TradeSignal');
const { ObservationSignalService } = require('../src/trading-engine/core/ObservationSignalService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const fakeLogger = { info() {}, warn() {}, error() {} };
const CFG = { maxPerToken: 3, intervalMs: 60000, marketCapThreshold: 16 };
const tok = (t = 'tokA') => ({ token: t, symbol: t.toUpperCase(), chain: 'bsc', status: 'monitoring' });
const tick = () => new Promise(r => setImmediate(r));

// ── TradeSignal.save 打桩：捕获落库行形状 ──
const savedRows = [];
let saveError = null;
TradeSignal.prototype.save = async function () {
  if (saveError) throw saveError;
  savedRows.push(this.toDatabaseFormat());
  return 'sig-id';
};

/** db 桩：init 分页拉全（rows 按 1000/页切；short page 终止） */
function mkDb(rows) {
  let rangeCalls = 0;
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                range: (lo, hi) => {
                  rangeCalls++;
                  const page = rows.slice(lo, hi + 1);
                  return Promise.resolve({ data: page, error: null });
                },
              }),
            }),
          }),
        }),
      };
    },
    _rangeCalls: () => rangeCalls,
  };
}

function mkSvc(db = mkDb([]), cfg = {}) {
  return new ObservationSignalService({
    experimentId: 'exp-1', logger: fakeLogger, db,
    maxPerToken: cfg.maxPerToken, intervalMs: cfg.intervalMs, marketCapThreshold: cfg.marketCapThreshold,
  });
}

// ══ A. evaluateCore 纯函数真值表 ══
console.log('A. evaluateCore 真值表');
{
  const core = (factors, state, cfg = CFG, nowMs = 1000000, alreadyBought = false) =>
    ObservationSignalService.evaluateCore({ factors, state, cfg, nowMs, alreadyBought });
  const S0 = { count: 0, lastAt: 0 };

  // A1 叙事臂：rating 2/3 记（mcap=0 不碍事）
  check('A1a rating=2 记 narrative', core({ narrativeRating: 2, marketCap: 0 }, S0),
    { shouldRecord: true, trigger: 'narrative', rating: 2, marketCap: 0, index: 1 });
  check('A1b rating=3 记 narrative', core({ narrativeRating: 3, marketCap: 0 }, S0).trigger, 'narrative');
  // A2 rating∈{null,1,9,undefined} 且市值不达标 → 不记
  for (const r of [null, 1, 9, undefined]) {
    check(`A2 rating=${r} 不记`, core({ narrativeRating: r, marketCap: 16 }, S0),
      { shouldRecord: false, reason: 'conditions' });
  }
  // A3 市值臂：rating=null、mcap 刚过阈 → 记
  check('A3 市值臂记', core({ narrativeRating: null, marketCap: 16.01 }, S0).trigger, 'marketcap');
  // A4 边界：mcap 恰等阈值 → 不记（严格大于）
  check('A4 mcap=16 恰等不记', core({ narrativeRating: null, marketCap: 16 }, S0),
    { shouldRecord: false, reason: 'conditions' });
  // A5 两臂同真 → both
  check('A5 both', core({ narrativeRating: 3, marketCap: 20000 }, S0),
    { shouldRecord: true, trigger: 'both', rating: 3, marketCap: 20000, index: 1 });
  // A6 计数上限
  check('A6 count=3 停', core({ narrativeRating: 3, marketCap: 0 }, { count: 3, lastAt: 0 }),
    { shouldRecord: false, reason: 'cap' });
  // A7 间隔：count>0 且 now-lastAt<intervalMs → 不记；=intervalMs → 记
  check('A7a 间隔未到不记', core({ narrativeRating: 3, marketCap: 0 }, { count: 1, lastAt: 950000 }),
    { shouldRecord: false, reason: 'interval' });
  check('A7b 间隔恰到记', core({ narrativeRating: 3, marketCap: 0 }, { count: 1, lastAt: 940000 }).shouldRecord, true);
  // A8 首行无视间隔（lastAt 紧邻也记）
  check('A8 首行立即记', core({ narrativeRating: 3, marketCap: 0 }, { count: 0, lastAt: 999999 }).shouldRecord, true);
  // A9 alreadyBought 恒不记（优先于一切）
  check('A9 bought 恒不记', core({ narrativeRating: 3, marketCap: 99999 }, S0, CFG, 1000000, true),
    { shouldRecord: false, reason: 'bought' });
  // marketCap 非有限数（NaN/null）不触发市值臂
  check('A10 mcap=NaN 市值臂不触发', core({ narrativeRating: null, marketCap: NaN }, S0),
    { shouldRecord: false, reason: 'conditions' });
}

// ══ B. 服务状态机 ══
console.log('B. 服务状态机');
{
  savedRows.length = 0;
  const svc = mkSvc();
  const f = { narrativeRating: 3, marketCap: 5000 };
  const t = tok();
  svc.evaluate(t, f, 1000);
  svc.evaluate(t, f, 2000);           // 间隔未到 → 不记
  svc.evaluate(t, f, 1000 + 60000);   // 间隔到 → 第 2 行
  svc.evaluate(t, f, 2000 + 60000);   // 第 3 行
  svc.evaluate(t, f, 999999999);      // 已达上限 3 → 不记
  await_tick: {
  }
  (async () => {
    await tick();
    check('B1 恰产 3 行', savedRows.length, 3);
    check('B2 index 递增', savedRows.map(r => r.metadata.observation.index), [1, 2, 3]);
    check('B3 全 OBSERVE/hold', savedRows.map(r => [r.signal_type, r.action]),
      [['OBSERVE', 'hold'], ['OBSERVE', 'hold'], ['OBSERVE', 'hold']]);
    check('B4 executed 恒 false', savedRows.map(r => r.executed), [false, false, false]);

    // B5 bought 门：status='bought' 跳过
    savedRows.length = 0;
    const svc2 = mkSvc();
    svc2.evaluate({ token: 'tokB', symbol: 'B', chain: 'bsc', status: 'bought' },
      { narrativeRating: 3, marketCap: 99999 }, 1000);
    await tick();
    check('B5 bought 不记', savedRows.length, 0);

    // B6 save 抛错：evaluate 不 throw、计数不回滚（3 次失败后 cap）
    savedRows.length = 0;
    saveError = new Error('mock db down');
    const svc3 = mkSvc();
    const t3 = tok('tokC');
    let threw = false;
    try {
      svc3.evaluate(t3, { narrativeRating: 3, marketCap: 0 }, 1000);
      svc3.evaluate(t3, { narrativeRating: 3, marketCap: 0 }, 1000 + 60000);
      svc3.evaluate(t3, { narrativeRating: 3, marketCap: 0 }, 1000 + 120000);
      svc3.evaluate(t3, { narrativeRating: 3, marketCap: 0 }, 1000 + 999999);
    } catch (e) { threw = true; }
    await tick();
    check('B6a save 抛错 evaluate 不 throw', threw, false);
    check('B6b 零行落库', savedRows.length, 0);
    check('B6c 计数不回滚（第 4 次 cap）',
      ObservationSignalService.evaluateCore({
        factors: { narrativeRating: 3, marketCap: 0 },
        state: svc3._states.get('tokC'), cfg: svc3._cfg, nowMs: 99999999, alreadyBought: false,
      }).reason, 'cap');
    saveError = null;

    // B7 非法配置构造 throw
    for (const [name, cfg] of [
      ['intervalMs=4999', { intervalMs: 4999 }],
      ['maxPerToken=0', { maxPerToken: 0 }],
      ['maxPerToken=11', { maxPerToken: 11 }],
      ['marketCapThreshold=-1', { marketCapThreshold: -1 }],
      ['intervalMs 非整数', { intervalMs: 60000.5 }],
    ]) {
      let threw = false;
      try { mkSvc(mkDb([]), cfg); } catch (e) { threw = true; }
      check(`B7 ${name} throw`, threw, true);
    }
    // B8 缺省回落
    const svc8 = mkSvc(mkDb([]));
    check('B8 缺省 3/60000/16', [svc8._cfg.maxPerToken, svc8._cfg.intervalMs, svc8._cfg.marketCapThreshold],
      [3, 60000, 16]);

    // ══ C. init DB 重建 ══
    console.log('C. init 重建');
    const now = Date.now();
    const dbRows = [
      // tokD 已 3 行（上限满）+ tokE 1 行（续记，lastAt=max created_at）
      { token_address: 'tokD', created_at: new Date(now - 5000).toISOString() },
      { token_address: 'tokD', created_at: new Date(now - 4000).toISOString() },
      { token_address: 'tokD', created_at: new Date(now - 3000).toISOString() },
      { token_address: 'tokE', created_at: new Date(now - 20000).toISOString() },
    ];
    const svcC = mkSvc(mkDb(dbRows));
    await svcC.init();
    check('C1 tokD 重建 count=3', svcC._states.get('tokD').count, 3);
    check('C2 tokE 重建 count=1', svcC._states.get('tokE').count, 1);
    check('C3 tokE lastAt=max(created_at)', svcC._states.get('tokE').lastAt, now - 20000);
    savedRows.length = 0;
    svcC.evaluate(tok('tokD'), { narrativeRating: 3, marketCap: 0 }, now);
    svcC.evaluate(tok('tokE'), { narrativeRating: 3, marketCap: 0 }, now);          // 间隔未到
    svcC.evaluate(tok('tokE'), { narrativeRating: 3, marketCap: 0 }, now + 60000);  // 间隔到 → 第 2 行
    await tick();
    check('C4 tokD 不再记 tokE 续记', savedRows.map(r => r.token_address), ['tokE']);

    // C5 init 查询失败 throw（调用方降级）
    const badDb = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  range: () => Promise.resolve({ data: null, error: { message: 'mock fail' } }),
                }),
              }),
            }),
          }),
        };
      },
    };
    let initThrew = false;
    try { await mkSvc(badDb).init(); } catch (e) { initThrew = true; }
    check('C5 init 失败 throw', initThrew, true);

    // ══ D. 行形状 ══
    console.log('D. 行形状');
    savedRows.length = 0;
    const svcD = mkSvc();
    svcD.evaluate(tok('tokF'), { narrativeRating: 2, marketCap: 15000 }, 1000);
    await tick();
    const row = savedRows[0];
    check('D1 signal_type=OBSERVE action=hold', [row.signal_type, row.action], ['OBSERVE', 'hold']);
    check('D2 executed=false', row.executed, false);
    check('D3 metadata 无 execution_status', 'execution_status' in row.metadata, false);
    check('D4 observation 五键', Object.keys(row.metadata.observation).sort(),
      ['index', 'marketCap', 'marketCapThreshold', 'maxPerToken', 'rating', 'trigger'].sort());
    check('D5 observation 值', [row.metadata.observation.trigger, row.metadata.observation.rating, row.metadata.observation.marketCap],
      ['both', 2, 15000]);
    check('D6 trendFactors.narrativeRating 透传', row.metadata.trendFactors.narrativeRating, 2);
    check('D7 strategyName=观察信号', row.metadata.strategyName, '观察信号');
    check('D8 reason 含触发原因', /叙事评级 2/.test(row.reason) && /市值/.test(row.reason), true);

    // D9 validate 放行 OBSERVE+hold（实体层）
    const v = new TradeSignal({
      experimentId: 'e', tokenAddress: '0x1', tokenSymbol: 'X',
      signalType: 'OBSERVE', action: 'hold', metadata: {},
    }).validate();
    check('D9a TradeSignal.validate 放行 OBSERVE', v.valid, true);
    const v2 = new TradeSignal({
      experimentId: 'e', tokenAddress: '0x1', tokenSymbol: 'X',
      signalType: 'UNKNOWN', action: 'hold', metadata: {},
    }).validate();
    check('D9b 仍拒 UNKNOWN', v2.valid, false);

    console.log(`\n结果: ${pass} pass, ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
  })();
}
