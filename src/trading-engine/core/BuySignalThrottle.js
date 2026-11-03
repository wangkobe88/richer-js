'use strict';

/**
 * 买信号发射节流（T110，2026-11-03 用户裁定「全局买信号机制」）：
 * per-token 冷却双门 + 发射次数帽——**所有实验生效**（不限作弊门实验），
 * live/backtest 同步（backtest 用 fireTs 虚拟时钟——本类禁 Date.now，now
 * 全部入参，回测前视红线同源）。
 *
 * 语义（用户原话）：「3 秒之前生成过信号，无论最后是否通过，3 秒以内
 * 不允许再次发出购买信号」「买入信号发出有个数量限制，无论是否通过，
 * 每个代币不得超过一定数量，默认 5 次」+ 2026-11-03 追裁定「3 秒改为
 * 3 秒 + 10 个 ticks」——冷却解除须**时间与 tick 双门同时满足**（担心纯
 * 时间窗在高频 tick 流下快速烧光次数帽，后续好机会上不了车；tick 计数
 * =FA state.tradeCount 全量链上交易数，live/回测同源 processTick）。
 * 计数与冷却锚=**发射检查点**（admit 即记；后续门拒/执行失败/信号 save
 * 失败均不退还——「无论是否通过」的最直读，也防 save 失败循环空转）。
 *
 * 配置（fourmemeWs 段，flap/gang 经 _mergedWsConfig 同键）：
 * - buySignalCooldownMs 缺省 3000；0/负=关时间门
 * - buySignalCooldownTicks 缺省 10；0/负=关 tick 门
 * - buySignalMaxPerToken 缺省 5；0/负=不限
 *
 * 纯内存 per-process 态（重启归零——叙事触发状态机 _narrativeTriggerStates
 * 同款先例）。与既有节流层的层次：腿级 cooldownSec/maxExecutions（成交
 * 口径，StrategyEngine）→ 引擎 signalDebounceMs（tick 合并）→ 本类（信号
 * 发射口径，无论成败，token 级跨腿共享）。
 */
class BuySignalThrottle {
  /**
   * @param {number} cooldownMs 冷却窗毫秒（0/负=关；非数值=缺省 3000）
   * @param {number} maxPerToken 每 token 发射上限（0/负=不限；非数值=缺省 5）
   * @param {number} cooldownTicks 冷却 tick 增量门（0/负=关；非数值=缺省 10）
   */
  constructor(cooldownMs, maxPerToken, cooldownTicks) {
    this._cooldownMs = Number.isFinite(cooldownMs) ? Math.max(0, Math.floor(cooldownMs)) : 3000;
    this._maxPerToken = Number.isFinite(maxPerToken) ? Math.max(0, Math.floor(maxPerToken)) : 5;
    this._cooldownTicks = Number.isFinite(cooldownTicks) ? Math.max(0, Math.floor(cooldownTicks)) : 10;
    /** @type {Map<string, {lastFireAt: number, lastFireTicks: number, fireCount: number}>} token → 发射状态 */
    this._states = new Map();
    // 观测计数（metrics/单测断言用；引擎侧聚合进日志）
    this.cooldownDropped = 0;
    this.tickDropped = 0;
    this.capDropped = 0;
  }

  get cooldownMs() { return this._cooldownMs; }
  get maxPerToken() { return this._maxPerToken; }
  get cooldownTicks() { return this._cooldownTicks; }
  get size() { return this._states.size; }

  /**
   * 发射准入（检查+记账一体）：允许 → 记 lastFireAt/lastFireTicks/fireCount
   * 并返回 {ok:true, fireCount}；冷却双门任一未满足或超帽 → {ok:false,
   * reason}（**不记账**——被拦的发射既不重置冷却锚也不追加计数）。边界：
   * 距上次发射恰等于 cooldownMs / tick 增量恰等于 cooldownTicks → 放行
   * （半开窗，卖腿确认窗/买入点位窗同款口径）。
   *
   * tickCount 缺失（非有限数）→ tick 门跳过只看时间门：tradeCount 是 FA
   * 基础因子（全量 tick 无 skip 计数），live/回测评估点恒有值；缺席只可能
   * 来自接线异常形状，退化方向=放行（不吞发射机会——用户立法本意「好机会
   * 上不了车」是最大风险，宁可短暂退化纯时间窗）。
   * @param {string} token
   * @param {number} now 发射时刻（live=Date.now()；backtest=fireTs）
   * @param {number} [tickCount] 该 token 当前累计 tick 数（FA state.tradeCount）
   */
  admit(token, now, tickCount) {
    const st = this._states.get(token) || { lastFireAt: -Infinity, lastFireTicks: -Infinity, fireCount: 0 };
    if (this._maxPerToken > 0 && st.fireCount >= this._maxPerToken) {
      this.capDropped++;
      return { ok: false, reason: `买信号次数上限（已发 ${st.fireCount}/${this._maxPerToken}）` };
    }
    if (this._cooldownMs > 0 && now - st.lastFireAt < this._cooldownMs) {
      this.cooldownDropped++;
      return { ok: false, reason: `买信号冷却中（距上次发射 ${Math.max(0, Math.round(now - st.lastFireAt))}ms < ${this._cooldownMs}ms）` };
    }
    if (this._cooldownTicks > 0 && Number.isFinite(tickCount)
      && tickCount - st.lastFireTicks < this._cooldownTicks) {
      this.tickDropped++;
      return { ok: false, reason: `买信号冷却中（距上次发射仅 ${Math.max(0, Math.round(tickCount - st.lastFireTicks))} ticks < ${this._cooldownTicks}）` };
    }
    st.lastFireAt = now;
    if (Number.isFinite(tickCount)) st.lastFireTicks = tickCount;
    st.fireCount += 1;
    this._states.set(token, st);
    return { ok: true, fireCount: st.fireCount };
  }

  /** 进程内清空（引擎 stop——main.js 同进程接续实验不继承计数） */
  clear() {
    this._states.clear();
  }
}

module.exports = { BuySignalThrottle };
