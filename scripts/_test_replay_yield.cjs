#!/usr/bin/env node

/**
 * 回放主循环事件循环协同让出单测（T253 写库挂起事故修复，2026-11-28）。零 DB 零网络：
 * 事故机制用真实事件循环 + 定时器替身复现（I/O 完成=setImmediate 三跳，超时=setTimeout）。
 *
 * 事故现场：182 case 集合对拍（统一门层开启）写缓冲第一条 INSERT 发出后挂 107.9s 报
 * 「请求超时（超过 72 秒）」，同轮 1784 条信号 UPDATE 389 条 fetch failed、146 条卖出
 * 过滤拦截行落库失败；关掉统一门层 0 错误。根因=回放主循环每 tick 只 await 微任务链
 * （写缓冲路径下零真实 I/O），自延续微任务链不清空 → 事件循环回不到 timers/poll 相 →
 * 挂起的 fetch 与超时定时器排不上。227b78c1「批量 500 行太大」的归因不成立。
 *
 * 覆盖面：
 *  A 事故现场反证：A1 纯微任务循环内定时器/immediate 一个都不跑；A2 饿死时「请求」
 *    输给超时定时器（=请求超时），加让出点后请求在超时前完成
 *  B 让出器语义（注入 now/schedule 桩）：首让出/片内零让出/片到让出/maxGap/非法片
 *  C 决策中性：让出点在宏任务边界——已排队的微任务续体先跑完（回放串行语义不变）；
 *    同一批 tick 开/关让出处理序与虚拟时钟逐位相同，墙钟只影响让出次数
 *  D 引擎源码锁：主循环 tick 体最顶（先于首个 await 与首个 continue）恰一处调用；
 *    调度器=setImmediate；收尾日志带让出观测
 */

const fs = require('fs');
const path = require('path');
const {
  REPLAY_YIELD_SLICE_MS, createReplayYielder,
} = require('../src/trading-engine/core/replay-yield.js');

let passed = 0, failed = 0;
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// 可控时钟 + 可控调度：schedule 把回调压入队列，flush() 逐个执行并在执行时刻读 clock
function makeHarness(sliceMs) {
  let clock = 1000;
  const queue = [];
  const y = createReplayYielder({
    sliceMs,
    now: () => clock,
    schedule: (cb) => { queue.push(cb); },
  });
  return {
    y,
    set: (t) => { clock = t; },
    queued: () => queue.length,
    runScheduled: () => { while (queue.length) queue.shift()(); },
  };
}

(async () => {
  // ═══════════════ A 事故现场反证（真实事件循环） ═══════════════
  {
    console.log('\n[A] 事故现场反证：纯微任务 async 循环饿死事件循环');

    // A1：循环体只 await 已 resolve 的 promise（= 写缓冲路径下每 tick 的 await 链）
    {
      const t0 = Date.now();
      let timerFiredAt = null;
      let immediateFiredAt = null;
      setTimeout(() => { timerFiredAt = Date.now() - t0; }, 0);
      setImmediate(() => { immediateFiredAt = Date.now() - t0; });
      let iterations = 0;
      while (Date.now() - t0 < 150) { await null; iterations++; }
      assert('A1 纯微任务循环跑满 150ms：0ms 定时器一次都没跑（饿死复现）', timerFiredAt === null,
        `timerFiredAt=${timerFiredAt}`);
      assert('A1 immediate 同样没跑', immediateFiredAt === null, `immediateFiredAt=${immediateFiredAt}`);
      assert('A1 循环确实在推进（非空转结论）', iterations > 100000, `iterations=${iterations}`);
      await new Promise((r) => setImmediate(r));
      assert('A1 首次让出后两者即刻执行（说明挂起的原因只是排不上队）',
        timerFiredAt !== null && immediateFiredAt !== null,
        `timerFiredAt=${timerFiredAt} immediateFiredAt=${immediateFiredAt}`);
    }

    // A2：事故形状缩比——「请求」要过三个事件循环轮次才完成（建连→握手→响应，替身=
    // 三跳 setImmediate），与超时定时器（60ms，替身=72s fetch 超时）赛跑；回放主循环
    // 跑 150ms 墙钟。请求完成即撤自己的超时定时器（真实 fetch 语义）；主循环跑完让出
    // 一轮（=现场的收尾/首个真实 I/O 让出点）再看结局。
    const TIMEOUT_MS = 60;
    const LOOP_MS = 150;
    const runRace = async (withYield) => {
      const t0 = Date.now();
      const out = { timedOut: false, completedAt: null, timedOutAt: null };
      const timer = setTimeout(() => { out.timedOut = true; out.timedOutAt = Date.now() - t0; }, TIMEOUT_MS);
      setImmediate(() => setImmediate(() => setImmediate(() => {
        if (!out.timedOut) { out.completedAt = Date.now() - t0; clearTimeout(timer); }
      })));
      const y = createReplayYielder();
      while (Date.now() - t0 < LOOP_MS) {
        const yp = y.tick();
        if (yp && withYield) await yp;
        await null; // tick 体的微任务 await 链
      }
      await new Promise((r) => setImmediate(r));
      clearTimeout(timer);
      return out;
    };
    const starved = await runRace(false);
    assert('A2 无让出：请求输给超时定时器（=「请求超时（超过 72 秒）」事故形状）',
      starved.timedOut === true && starved.completedAt === null, JSON.stringify(starved));
    assert('A2 无让出：超时被压到主循环让出后才触发（挂了整个回放段——现场 107.9s）',
      starved.timedOutAt >= LOOP_MS - 5, JSON.stringify(starved));
    const yielded = await runRace(true);
    assert('A2 加让出点：请求在超时前完成并撤掉超时（恢复落库）',
      yielded.timedOut === false && yielded.completedAt !== null && yielded.completedAt < TIMEOUT_MS,
      JSON.stringify(yielded));
  }

  // ═══════════════ B 让出器语义（桩时钟/桩调度） ═══════════════
  {
    console.log('\n[B] 让出器语义：时间片/让出次数/maxGap');
    const h = makeHarness(8);
    const p1 = h.y.tick();
    assert('B1 首次调用即让出（返回 Promise，排一个调度）', p1 instanceof Promise && h.queued() === 1);
    assert('B1 调度回调执行前 Promise 仍 pending', (() => { let s = false; p1.then(() => { s = true; }); return s === false; })());
    h.runScheduled();
    await p1;
    assert('B1 让出完成：yields=1、首让出不计 gap', JSON.stringify(h.y.stats()) === JSON.stringify({ sliceMs: 8, yields: 1, maxGapMs: 0 }),
      JSON.stringify(h.y.stats()));

    const q0 = h.queued();
    const r7 = h.y.tick();
    assert('B2 片内（+0ms）返回 undefined 且零调度', r7 === undefined && h.queued() === q0);
    h.set(1007);
    assert('B2 片内（+7ms，严格小于）返回 undefined', h.y.tick() === undefined && h.queued() === q0);
    assert('B2 片内 stats 不变', h.y.stats().yields === 1);
    h.set(1008);
    const p2 = h.y.tick();
    assert('B3 片到（恰 +8ms）让出', p2 instanceof Promise && h.queued() === q0 + 1);
    h.runScheduled();
    await p2;
    assert('B3 让出后 gap=8、yields=2', h.y.stats().yields === 2 && h.y.stats().maxGapMs === 8, JSON.stringify(h.y.stats()));

    // maxGap 取相邻让出间最大占用；让出时刻戳在回调执行时（=让出结束点）而非请求时
    h.set(1015);
    assert('B4 +7ms 未到片（上一让出 1008）', h.y.tick() === undefined);
    h.set(1028);
    const p3 = h.y.tick();          // gap=20（1028-1008）
    h.set(1400);                    // 回调执行时墙钟已走到 1400：下一次时间片从这里起算
    h.runScheduled();
    await p3;
    assert('B4 gap=20 记入 maxGap', h.y.stats().maxGapMs === 20 && h.y.stats().yields === 3, JSON.stringify(h.y.stats()));
    h.set(1407);
    assert('B4 片起点=回调执行时刻（1400）而非请求时刻（1028）：1407 未到片', h.y.tick() === undefined);
    h.set(1408);
    const p4 = h.y.tick();
    h.runScheduled();
    await p4;
    assert('B4 yields=4', h.y.stats().yields === 4);
    assert('B4 stats() 每次返回新对象（外部改动不污染）', (() => { const s = h.y.stats(); s.yields = 999; return h.y.stats().yields === 4; })());

    let threw = 0;
    for (const bad of [0, -1, NaN, Infinity, '8', null]) {
      try { createReplayYielder({ sliceMs: bad }); } catch { threw++; }
    }
    assert('B5 非法时间片 fail-loud（0/负/NaN/Infinity/字符串/null 全 throw）', threw === 6, `threw=${threw}`);
    assert('B5 缺省时间片=8ms', REPLAY_YIELD_SLICE_MS === 8 && createReplayYielder().stats().sliceMs === 8);
  }

  // ═══════════════ C 决策中性 ═══════════════
  {
    console.log('\n[C] 决策中性：让出点在宏任务边界，回放串行语义与处理序不变');

    // C1：让出返回前，此前排队的微任务续体（in-flight 评估的纯计算续体）全部跑完
    {
      const order = [];
      const y = createReplayYielder();
      const p = y.tick();
      (async () => { await null; order.push('eval-a-1'); await null; order.push('eval-a-2'); })();
      (async () => { await null; await null; order.push('eval-b-done'); })();
      await p;
      order.push('tick-resumed');
      assert('C1 三跳微任务续体先于主循环恢复全部完成',
        JSON.stringify(order) === JSON.stringify(['eval-a-1', 'eval-a-2', 'eval-b-done', 'tick-resumed']),
        JSON.stringify(order));
    }

    // C2：主循环骨架（让出 → advance/drain inflight → 处理 tick）开/关让出，处理序与
    // 虚拟时钟逐位相同；墙钟只体现在让出次数上
    const runSkeleton = async (withYield) => {
      const y = createReplayYielder({ sliceMs: 1 });
      const ticks = Array.from({ length: 4000 }, (_, i) => ({ timestamp: 1_700_000_000_000 + i * 37 }));
      const inflight = new Set();
      const log = [];
      let virtualNow = null;
      for (const tick of ticks) {
        const yp = y.tick();
        if (yp && withYield) await yp;
        virtualNow = tick.timestamp; // 回放唯一时钟：虚拟 tickTs（让出不触碰）
        // 模拟 _advanceDebouncer：drain 此前派发的 fire-and-forget 评估
        if (inflight.size) await Promise.all([...inflight]);
        for (let k = 0; k < 12; k++) await null; // tick 体的微任务 await 链
        // 每 50 tick 派发一个 in-flight 评估（纯计算续体），由后续 tick 的 advance drain
        if (tick.timestamp % 50 === 37 % 50) {
          const q = (async () => { await null; await null; log.push(`eval@${virtualNow}`); })();
          inflight.add(q);
          q.finally(() => inflight.delete(q));
        }
        log.push(`tick@${virtualNow}`);
      }
      if (inflight.size) await Promise.all([...inflight]);
      return { log, stats: y.stats() };
    };
    const off = await runSkeleton(false);
    const on = await runSkeleton(true);
    assert('C2 开/关让出：处理序（tick ×4000 + 评估 ×80）逐位相同',
      JSON.stringify(off.log) === JSON.stringify(on.log) && off.log.length === 4080, `len=${off.log.length}/${on.log.length}`);
    assert('C2 虚拟时钟值不因让出改变', on.log[on.log.length - 1] === `tick@${1_700_000_000_000 + 3999 * 37}`);
    assert('C2 关让出=零次；开让出=有让出（墙钟只决定让出次数）',
      off.stats.yields === 0 && on.stats.yields > 0, JSON.stringify({ off: off.stats, on: on.stats }));
  }

  // ═══════════════ D 引擎源码锁 ═══════════════
  {
    console.log('\n[D] 引擎源码锁：主循环 tick 体最顶恰一处让出');
    const ROOT = path.join(__dirname, '..', 'src', 'trading-engine');
    const BT = path.join(ROOT, 'implementations', 'BacktestEngine.js');
    const YJ = path.join(ROOT, 'core', 'replay-yield.js');
    const bt = fs.readFileSync(BT, 'utf8');
    const yj = fs.readFileSync(YJ, 'utf8');

    assert('D1 引擎 require createReplayYielder', /const \{ createReplayYielder \} = require\('\.\.\/core\/replay-yield'\);/.test(bt));
    assert('D1 构造器建让出器', /this\._replayYield = createReplayYielder\(\);/.test(bt));
    assert('D1 让出器调用点恰一处（不让任何人把让出塞进逐信号评估链）',
      (bt.match(/this\._replayYield\.tick\(\)/g) || []).length === 1);

    const body = bt.slice(bt.indexOf('async _runMainLoop()'));
    const forIdx = body.indexOf('for (const tick of this._ticks) {');
    const tickCallIdx = body.indexOf('this._replayYield.tick()', forIdx);
    const awaitIdx = body.indexOf('if (_yieldP) await _yieldP;', tickCallIdx);
    const advanceIdx = body.indexOf('await this._advanceDebouncer(tickTs);', forIdx);
    const firstContinueIdx = body.indexOf('continue;', forIdx);
    assert('D2 调用点在主循环 for 内', forIdx > 0 && tickCallIdx > forIdx && awaitIdx > tickCallIdx);
    assert('D2 让出先于本 tick 首个 await（_advanceDebouncer）与首个 continue 路径',
      advanceIdx > awaitIdx && firstContinueIdx > awaitIdx, JSON.stringify({ advanceIdx, awaitIdx, firstContinueIdx }));
    const between = body.slice(forIdx + 'for (const tick of this._ticks) {'.length, tickCallIdx)
      .replace(/\/\/[^\n]*/g, ''); // 去行注释（注释里点名 await/continue 不算代码）
    assert('D2 for 到让出之间无 await/continue（tick 体最顶）', !/\bawait\b|\bcontinue\b/.test(between));
    assert('D2 保留 await 形状（未到片返回 undefined 零 await 开销）', /const _yieldP = this\._replayYield\.tick\(\);\s*\n\s*if \(_yieldP\) await _yieldP;/.test(body));

    assert('D3 调度器=setImmediate（setTimeout 至少多等 1ms）', /schedule = setImmediate\b/.test(yj) && !/setTimeout\(/.test(yj));
    assert('D3 让出器模块零 DB 零网络零第三方依赖', !/require\(/.test(yj));
    assert('D4 收尾日志带让出观测量（次数+最长占用）', bt.includes('事件循环让出=${_ry.yields}次(最长占用${_ry.maxGapMs}ms)')
      && /const _ry = this\._replayYield\.stats\(\);/.test(bt));
  }

  console.log('\n══════════════════════════════');
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('单测异常:', e); process.exit(1); });
