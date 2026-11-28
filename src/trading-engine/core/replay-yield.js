'use strict';

/**
 * 回放主循环·事件循环协同让出（T253 写库挂起事故修复，2026-11-28）
 *
 * 事故现场（182 case 集合对拍，bt-v350 基底 + 统一门层）：写缓冲第一条 INSERT
 * （strategy_signals 31 行/592KB）发出后挂 107.9s 报「请求超时（超过 72 秒）」；
 * 同轮 1784 条信号 UPDATE 389 条 fetch failed、146 条因子卖出过滤拦截行落库失败
 * ——每轮丢约 142 条信号行（成交不受影响）。关掉统一门层（走旧门链）0 错误。
 *
 * 根因=回放主循环把事件循环饿死：`for (const tick of this._ticks)` 每 tick 只 await
 * 微任务链（debounce 推进/drain inflight 评估/止损扫描/毕业消费——写缓冲路径下全是
 * 同步入队）。自延续的微任务链永不清空，Node 回不到 timers/poll 相：挂起的 fetch
 * （建连/握手/读写）与超时定时器全部排不上，等回放主循环让出时集中超时。
 * 旧门链每票首个信号有 `_loadCreateMeta` 读 wss_events 的真实 I/O（偶然让出）才
 * 掩盖了这一点；统一门层零 I/O（T253 取数裁定）后密集成交段整段不让出。
 * （227b78c1「批量 500 行太大」的归因不成立——100 行/批挂在同一位置。）
 *
 * 修复=主循环每 tick 顶部按墙钟时间片显式让出一轮事件循环。
 * - 调度器=setImmediate：timers → pending → poll → check 完整一轮（setTimeout 至少
 *   多等 1ms，按 8ms 片算是 11% 空转）。
 * - **决策中性**：回放决策只读内存 tick/FA 状态与虚拟时钟（禁 Date.now 红线），
 *   墙钟只决定「何时让出」。让出点在宏任务边界——此前排队的微任务（in-flight 评估的
 *   纯计算续体）全部先跑完，「下一笔 tick 前 drain」的回放串行语义不变。
 * - 未到时间片返回 undefined（零 await 开销——每 tick 只多一次 Date.now 比较）。
 */

const REPLAY_YIELD_SLICE_MS = 8;

/**
 * @param {object} [opts]
 * @param {number} [opts.sliceMs] 时间片（墙钟 ms，>0）；相邻两次让出的最小间隔
 * @param {() => number} [opts.now]        时钟注入（单测桩）
 * @param {(cb: () => void) => unknown} [opts.schedule] 调度器注入（单测桩）
 * @returns {{ tick(): Promise<void>|undefined, stats(): {sliceMs:number, yields:number, maxGapMs:number} }}
 */
function createReplayYielder({ sliceMs = REPLAY_YIELD_SLICE_MS, now = Date.now, schedule = setImmediate } = {}) {
  if (!(Number.isFinite(sliceMs) && sliceMs > 0)) {
    throw new Error(`createReplayYielder: sliceMs 须为正数（收到 ${sliceMs}）`);
  }
  let lastYieldMs = null;
  const stats = { yields: 0, maxGapMs: 0 };

  return {
    /** 每 tick 顶部调用：未到片=undefined（调用方不必 await）；到片=让出一轮事件循环的 Promise */
    tick() {
      const t = now();
      if (lastYieldMs !== null && t - lastYieldMs < sliceMs) return undefined;
      const gapMs = lastYieldMs === null ? 0 : t - lastYieldMs;
      return new Promise((resolve) => {
        schedule(() => {
          lastYieldMs = now();
          stats.yields++;
          if (gapMs > stats.maxGapMs) stats.maxGapMs = gapMs;
          resolve();
        });
      });
    },
    stats() {
      return { sliceMs, yields: stats.yields, maxGapMs: stats.maxGapMs };
    },
  };
}

module.exports = { REPLAY_YIELD_SLICE_MS, createReplayYielder };
