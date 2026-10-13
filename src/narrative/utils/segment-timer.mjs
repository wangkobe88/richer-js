/**
 * 分段计时收集器（N1 探针，2026-10-13 叙事提速案）——analyze 全链分段耗时度量，
 * 零行为变化：调用方（NarrativeDirectCaller.getRating）创建数组传入
 * analyze({ _timing: arr })，各段经 start/end/wrap 落 { seg, ms } 行；
 * 不传 _timing → 旁路模式（wrap 直调 fn，仅一次函数调用开销，不计时）。
 *
 * 口径约定：
 * - 同名段多次发生（dbSaves / accountCollect 三处调用点）push 多行，统计端聚合
 * - N2 并发化后同名段计时可能重叠（各平台桶并行），段耗时记录的是该段自身
 *   耗时而非墙钟占比——分析时以 total 与关键路径为准
 * - 数组由调用方持有（引用共享），settle 后读取即已填充，无需经返回值透传
 */

/**
 * @param {Array|null} sink - 收集数组；null/非数组 → 旁路模式
 * @returns {{active: boolean, start: Function, end: Function, wrap: Function}}
 */
export function createSegmentTimer(sink) {
  const active = Array.isArray(sink);
  const starts = new Map();
  const timer = {
    active,
    /** 段开始（旁路模式空操作） */
    start(seg) {
      if (active) starts.set(seg, Date.now());
    },
    /** 段结束：push { seg, ms }（未 start 过的 end 空操作，防脏） */
    end(seg) {
      if (!active) return;
      const s = starts.get(seg);
      if (s !== undefined) {
        starts.delete(seg);
        sink.push({ seg, ms: Date.now() - s });
      }
    },
    /** 包裹 async 段：异常路径也 end（finally）——失败段耗时同样是探针数据 */
    async wrap(seg, fn) {
      if (!active) return fn();
      timer.start(seg);
      try {
        return await fn();
      } finally {
        timer.end(seg);
      }
    },
  };
  return timer;
}
