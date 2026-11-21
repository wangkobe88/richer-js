'use strict';

/**
 * T203 FP 拒后门内重试状态机（2026-11-21 用户裁定立法——纯逻辑零 DB 零网络，
 * 时钟注入；引擎只做薄胶水）。
 *
 * 用户原话裁定：
 *  - 「因子过滤不通过之后的重试作为信号触发条件之内的事情（交易策略的一部分，
 *    不作为实验配置的一部分，但是实验引擎要支持）」
 *  - 「冷却机制是信号触发条件之间的」——重试不走 T110 发射冷却、不另落信号行、
 *    不消耗新触发（同一信号的门链延续）
 *  - 「可以不用做太多分析，这相当于是给实验运行打补丁，如果效果不好，只能怪
 *    效果层面没做好」——机制件与效果解耦：fpRetry 归策略包腿定义（缺省 0=零
 *    行为），效果由策略层验证/调整
 *
 * 语义（形状 A 门内挂起重评——案源 bt-v164 0xb6ee…7777 FP28 误拦：触发腿被
 * 点火买单本身引爆，锚落在点火波前部，尾 7s 窗数到的就是点火单 N=2≤2 被拒；
 * 晚 1~2s 同票同形状 N=4 即过——锚相位随机性，重评给证据 2 秒发育时间）：
 *  - register：FP 门 assessed 拒后登记（同 token 旧 pending 覆盖——单仓语义下
 *    同刻至多一个信号在门链，新信号的拒覆盖旧 pending=最新信号接管重试）；
 *    lastEvalAt=登记时刻（首次 FP 评估即第 0 次评估，间隔从它起算）
 *  - tickCheck：距上次评估 ≥ spacingMs 才重评（防同秒连 tick 烧穿预算——点火
 *    第 3 笔买单落地通常 1~5s）；registeredAt 起 > horizonMs 过期（陈旧信号
 *    不复活——案源窗 15s/模拟 δ 中位 5s，30s 上界留余量）
 *  - recordResult：pass=清 pending（引擎续跑 actFront→cheat→BP→执行，入场锚=
 *    重评 tick 现价=重评通过即有效 fire 时刻）；reject=remaining−1，耗尽终态。
 *    attempts 数组全程累积，引擎负责落 signal metadata.fpRetry 段留痕
 *
 * 回测红线遵守：本模块零 Date.now（时钟由引擎注入——实时=Date.now，回测=tick
 * 虚拟时刻）；单测 _test_fp_retry_gate 锁定。
 */
class FpRetryTracker {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.spacingMs=2000] 相邻两次 FP 重评的最小间隔
   * @param {number} [opts.horizonMs=30000] pending 登记起的总寿面（过期即终态）
   */
  constructor({ spacingMs = 2000, horizonMs = 30000 } = {}) {
    this.spacingMs = spacingMs;
    this.horizonMs = horizonMs;
    /** @type {Map<string, {legId:string, signalId:*, budget:number, remaining:number, attempts:Array, registeredAt:number, lastEvalAt:number, strategyName:(string|null)}>} */
    this._pendings = new Map();
  }

  /**
   * FP 拒后登记 pending。budget<=0 / signalId 缺席 = no-op（fpRetry 缺省 0 的
   * 存量腿零行为）。覆盖同 token 旧 pending（最新信号接管）。
   * @returns {Object|null} 登记产物（no-op 返回 null）
   */
  register(token, { legId, signalId, budget, nowMs, strategyName = null }) {
    const n = Number(budget);
    if (!Number.isInteger(n) || n <= 0 || signalId == null) return null;
    const p = {
      legId, signalId, budget: n, remaining: n,
      attempts: [], registeredAt: nowMs, lastEvalAt: nowMs, strategyName,
    };
    this._pendings.set(token, p);
    return p;
  }

  pendingOf(token) { return this._pendings.get(token) || null; }

  /**
   * tick 时刻判定（纯读，不改状态——expired 的清理由引擎确认后调 clear）：
   * - null=无 pending 或 spacing 未到（照常流程）
   * - {kind:'eval'}=到点该重评
   * - {kind:'expired'}=超地平线（引擎留痕后 clear）
   */
  tickCheck(token, nowMs) {
    const p = this._pendings.get(token);
    if (!p) return null;
    if (nowMs - p.registeredAt > this.horizonMs) {
      return { kind: 'expired', budget: p.budget, attempts: p.attempts.slice() };
    }
    if (nowMs - p.lastEvalAt >= this.spacingMs) return { kind: 'eval' };
    return null;
  }

  /**
   * 重评结果记账。
   * @returns {{pass:boolean, exhausted:boolean, remaining:number, attempts:Array}|null}
   * pass=true → pending 已清（引擎续跑门链）；pass=false 且 exhausted=true →
   * 耗尽已清；否则 remaining 递减待下次。
   */
  recordResult(token, pass, reason, nowMs) {
    const p = this._pendings.get(token);
    if (!p) return null;
    p.attempts.push({
      n: p.attempts.length + 1,
      verdict: pass ? 'pass' : 'reject',
      reason: reason || null,
      at: nowMs,
    });
    p.lastEvalAt = nowMs;
    if (pass) {
      this._pendings.delete(token);
      return { pass: true, exhausted: false, remaining: 0, attempts: p.attempts.slice() };
    }
    p.remaining -= 1;
    if (p.remaining <= 0) {
      this._pendings.delete(token);
      return { pass: false, exhausted: true, remaining: 0, attempts: p.attempts.slice() };
    }
    return { pass: false, exhausted: false, remaining: p.remaining, attempts: p.attempts.slice() };
  }

  clear(token) { this._pendings.delete(token); }
  clearAll() { this._pendings.clear(); }
}

module.exports = { FpRetryTracker };
