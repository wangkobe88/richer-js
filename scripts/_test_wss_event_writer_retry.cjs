#!/usr/bin/env node
/**
 * WssEventWriter per-row 独立重试 + 水位告警单测（批次 4b，2026-10-15）
 *
 * 旧实现事故形状：_flush 队头失败即 throw 整轮中断——队头恒坏行（如 payload 序列化
 * 异常/约束冲突）时其后所有好行永远写不出（堵队）。新实现 per-row try/catch：好行
 * 写出、坏行留队（相对序保持）、绝不丢行；重试队列高水位告警（默认 1000/10min 节流）
 * 同批次 3a tickBuffer 风格。
 *
 * 零 DB 零网络：手写 promise-like supabase 桩（from().insert() 直 resolve，按
 * failTokens 集判失败/可注入延迟），不 require dbManager。
 * 用法：node scripts/_test_wss_event_writer_retry.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { WssEventWriter } = require('../src/collectors/wss-event-writer.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const tick = () => new Promise(r => setImmediate(r));

/** supabase 桩：insert(rows) 按 state.failTokens 判失败；state.onAttempt 回调可注入延迟/副作用 */
function mkState({ failTokens = new Set() } = {}) {
  const state = { failTokens, tries: [], written: [], onAttempt: null };
  state.client = {
    from: () => ({
      insert: (rows) => new Promise((resolve) => {
        const row = rows[0];
        state.tries.push(row.token_address);
        const go = () => resolve(state.failTokens.has(row.token_address)
          ? { error: { message: `mock fail ${row.token_address}` } } : { error: null });
        if (state.onAttempt) state.onAttempt(row, go); else go();
      }),
    }),
  };
  return state;
}
function mkWriter(state, cfg = {}) {
  const logs = { info: [], warn: [], error: [] };
  const w = new WssEventWriter({
    info: (_, c, m) => logs.info.push(m), warn: (_, c, m) => logs.warn.push(m),
    error: (_, c, m) => logs.error.push(m),
  }, cfg);
  w._supabase = state.client; // 不 start（免真 dbManager），直调 _flush
  return { w, logs };
}
const ev = (tok) => ({ token: tok, blockTimeMs: 1 });

(async () => {
  console.log('A. ★队头恒坏行事故现场：好行写出、坏行留队（相对序保持）');
  {
    // 旧实现此形状：bad1 堵头 → good1/bad2/good2 全部写不出，queue 四条全滞留
    const state = mkState({ failTokens: new Set(['0xbad1', '0xbad2']) });
    const { w, logs } = mkWriter(state);
    w._queue = [
      { kind: 'token_create', token_address: '0xbad1', payload: ev('0xbad1') },
      { kind: 'token_create', token_address: '0xgood1', payload: ev('0xgood1') },
      { kind: 'graduation', token_address: '0xbad2', payload: ev('0xbad2') },
      { kind: 'graduation', token_address: '0xgood2', payload: ev('0xgood2') },
    ];
    await w._flush();
    check('A1 好行恰 2 条写出', state.tries.filter(t => t.startsWith('0xgood')).length, 2);
    check('A2 坏行留队（相对序保持）', w._queue.map(r => r.token_address), ['0xbad1', '0xbad2']);
    check('A3 汇总 warn 一条（失败计数+首错）', logs.warn.length, 1);
    check('A4 stats.eventsFailed=2', w.stats.eventsFailed, 2);
    check('A5 eventsWritten=2', w.stats.eventsWritten, 2);

    // A6 survivors 下轮重试成功（DB 恢复形状）
    state.failTokens.clear();
    await w._flush();
    check('A6 下轮全清空', [w._queue.length, state.tries.length], [0, 6]);
  }

  console.log('B. flush 进行中 enqueue push 的行不丢（survivors 覆盖安全反证）');
  {
    const state = mkState({ failTokens: new Set(['0xbad']) });
    const { w } = mkWriter(state);
    w._queue = [{ kind: 'k', token_address: '0xbad', payload: ev('0xbad') }];
    // 注入：第一行尝试的 await 间隙中模拟「另一事件落库失败 push 进队」
    let flushDone;
    const done = new Promise(r => { flushDone = r; });
    state.onAttempt = (row, go) => { if (row.token_address === '0xbad') { w._queue.push({ kind: 'k', token_address: '0xlate', payload: ev('0xlate') }); } go(); };
    (async () => { await w._flush(); flushDone(); })();
    await done;
    check('B1 push 进来的行被同轮消费（不因 survivors 覆盖丢失）',
      [w._queue.length, state.tries.includes('0xlate')], [1, true]);
    check('B2 队里只剩坏行', w._queue.map(r => r.token_address), ['0xbad']);
    state.onAttempt = null;
  }

  console.log('C. enqueue 失败进队 + 全好清空');
  {
    const state = mkState({ failTokens: new Set(['0xf1']) });
    const { w, logs } = mkWriter(state);
    w.enqueue('token_create', 'fourmeme', ev('0xf1'));
    w.enqueue('token_create', 'fourmeme', ev('0xf2'));
    await tick(); await tick();
    check('C1 坏行进队 warn 一条', [w._queue.length, logs.warn.length], [1, 1]);
    check('C2 好行直写成功', w.stats.eventsWritten, 1);
    state.failTokens.clear();
    await w._flush();
    check('C3 重试后清空', w._queue.length, 0);
  }

  console.log('D. 水位告警（超阈节流 error / 回落一次性 info / 再超再告）');
  {
    const state = mkState(); // 全失败形状：手动灌队
    const { w, logs } = mkWriter(state, { eventAlertThresholdRows: 5, eventAlertReAlertMs: 120 });
    const mkRows = (n, pfx) => Array.from({ length: n }, (_, i) =>
      ({ kind: 'k', token_address: `${pfx}${i}`, payload: ev(`${pfx}${i}`) }));
    w._queue = mkRows(4, 'a');
    w._checkQueueWatermark();
    check('D1 未达阈值零告警', [logs.error.length, w.stats.queueAlerts], [0, 0]);
    w._queue.push({ kind: 'k', token_address: 'a9', payload: ev('a9') });
    w._queue.push({ kind: 'k', token_address: 'a10', payload: ev('a10') }); // 6 条 > 5
    w._checkQueueWatermark();
    check('D2 超阈恰一告 + 峰值', [logs.error.length, w.stats.queueAlerts, w.stats.queuePeak], [1, 1, 6]);
    w._checkQueueWatermark();
    w._checkQueueWatermark();
    check('D3 节流窗内不重告', [logs.error.length, w.stats.queueAlerts], [1, 1]);
    w._queue = mkRows(2, 'b'); // 回落
    w._checkQueueWatermark();
    check('D4 回落一次性 info', [logs.info.length, w._queueAlerted], [1, false]);
    w._checkQueueWatermark();
    check('D5 回落后不重复 info', logs.info.length, 1);
    w._queue = mkRows(7, 'c');
    await new Promise(r => setTimeout(r, 130)); // 跨节流窗
    w._checkQueueWatermark();
    check('D6 跨窗再超再告', [logs.error.length, w.stats.queueAlerts, w.stats.queuePeak], [2, 2, 7]);
  }

  console.log('E. stop：残余留痕（kind 去重列表）+ 幂等');
  {
    const state = mkState({ failTokens: new Set(['0xb1', '0xb2']) });
    const { w, logs } = mkWriter(state);
    w._queue = [
      { kind: 'token_create', token_address: '0xb1', payload: ev('0xb1') },
      { kind: 'token_create', token_address: '0xb2', payload: ev('0xb2') },
    ];
    await w.stop();
    const last = logs.error[logs.error.length - 1] || '';
    check('E1 残余 error 留痕含条数与 kind', [logs.error.length, /停机残余 2 条/.test(last), /kind=token_create/.test(last)], [1, true, true]);
    await w.stop();
    check('E2 stop 幂等（二次零日志）', logs.error.length, 1);
  }

  console.log('F. 默认参数与 getStats');
  {
    const state = mkState();
    const { w } = mkWriter(state);
    check('F1 默认阈值 1000 / 节流 10min',
      [w._alertThresholdRows, w._alertReAlertMs], [1000, 600000]);
    w._queue = [{ kind: 'k', token_address: '0xz', payload: ev('0xz') }];
    check('F2 getStats 含 queueLength', w.getStats().queueLength, 1);
    check('F3 stats 四键初值', [w.stats.eventsWritten, w.stats.eventsFailed, w.stats.queuePeak, w.stats.queueAlerts], [0, 0, 0, 0]);
  }

  console.log('G. 源码口径（防回流）');
  {
    const src = fs.readFileSync(path.join(__dirname, '../src/collectors/wss-event-writer.js'), 'utf8');
    check('G1 per-row catch（失败进 survivors 不 throw）',
      /survivors\.push\(row\); \/\/ 失败保留（相对序），下轮重试——绝不丢/.test(src), true);
    check('G2 旧队头 throw 语义零残留', /留在队列头，下轮重试/.test(src), false);
    check('G3 水位告警挂点（enqueue catch + _flush 尾部）',
      [/this\._queue\.push\(row\);\s*\n\s*this\._checkQueueWatermark\(\);/.test(src),
       /this\._writing = false;\s*\n\s*\}\s*\n\s*this\._checkQueueWatermark\(\);/.test(src)].every(Boolean), true);
    check('G4 绝不丢行红线（flush 内零 splice/filter 删行）',
      /async _flush\(\) \{[\s\S]*?\n    \}/.test(src)
      && !/this\._queue\.(splice|shift)\(\s*\d/.test(src.match(/async _flush\(\) \{[\s\S]*?\n    \}/)[0])
      ? ![...src.match(/async _flush\(\) \{[\s\S]*?\n    \}/)[0].matchAll(/_queue\.(\w+)/g)].map(m => m[1]).includes('splice') : false, true);
    check('G5 默认阈值常量', /EVENT_ALERT_THRESHOLD_ROWS_DEFAULT = 1000;/.test(src), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
