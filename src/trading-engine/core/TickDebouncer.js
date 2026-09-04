/**
 * TickDebouncer：买评估 slot 级去抖（实时与回放共享一份语义）
 *
 * burst 内每 tick 重置；maxWait 自 burst 起点强制触发（持续拉升的热门票全程连续
 * tick 时不会被无限推迟）。fire 时回调拿到的是 burst 末笔 tick——消费方必须以
 * fire 时刻的最新状态重读因子（窗口内 token 可能已被 prune/买入/卖出）。
 *
 * 两种驱动模式：
 * - real：setTimeout 驱动（实时引擎，burst 静默 debounceMs 后真实时钟触发）
 * - virtual：虚拟时钟驱动（回测引擎，每笔 tick 处理前 advance(tickTs) 推进，
 *   到期即 fire；fireTs 为推进时刻）
 */

class TickDebouncer {
  /**
   * @param {Object} opts
   * @param {number} opts.debounceMs - 静默去抖窗口（<=0 表示不去抖，touch 即 fire）
   * @param {number} opts.maxWaitMs - burst 最大等待（自首 tick 起算；<=0 关闭）
   * @param {string} opts.mode - 'real' | 'virtual'
   * @param {Function} opts.onFire - (tokenAddress, tick, fireTs) => void
   */
  constructor({ debounceMs, maxWaitMs, mode = 'real', onFire }) {
    this._debounceMs = debounceMs;
    this._maxWaitMs = maxWaitMs;
    this._mode = mode;
    this._onFire = onFire;
    this.pending = new Map(); // tokenAddress → entry
    this.stats = { fired: 0, suppressed: 0 };
  }

  /**
   * 注册/重置一笔 tick 的买评估去抖。
   * @param {string} tokenAddress
   * @param {Object} tick - virtual 模式必须带 timestamp(ms)；real 模式任意（透传给 onFire）
   */
  touch(tokenAddress, tick) {
    if (this._debounceMs <= 0) {
      this.stats.fired++;
      this._onFire(tokenAddress, tick, this._mode === 'virtual' ? tick.timestamp : Date.now());
      return;
    }

    if (this._mode === 'virtual') {
      let entry = this.pending.get(tokenAddress);
      if (entry) {
        this.stats.suppressed++;
        entry.lastTouch = tick.timestamp;
        entry.tick = tick;
      } else {
        this.pending.set(tokenAddress, {
          burstStart: tick.timestamp,
          lastTouch: tick.timestamp,
          tick,
        });
      }
      return;
    }

    // real 模式：timer 驱动
    let entry = this.pending.get(tokenAddress);
    if (entry) {
      clearTimeout(entry.timer);
      this.stats.suppressed++;
    } else {
      entry = { burstStart: Date.now(), maxTimer: null };
    }
    entry.tick = tick;

    const fire = () => {
      const e = this.pending.get(tokenAddress);
      if (!e) return;
      clearTimeout(e.timer);
      if (e.maxTimer) clearTimeout(e.maxTimer);
      this.pending.delete(tokenAddress);
      this.stats.fired++;
      this._onFire(tokenAddress, e.tick, Date.now());
    };
    entry.timer = setTimeout(fire, this._debounceMs);
    if (this._maxWaitMs > 0 && !entry.maxTimer) {
      entry.maxTimer = setTimeout(fire, this._maxWaitMs);
    }
    this.pending.set(tokenAddress, entry);
  }

  /**
   * 虚拟时钟推进：fire 所有到期项（nowTs - lastTouch >= debounceMs 或
   * nowTs - burstStart >= maxWaitMs）。real 模式下由 timer 驱动，no-op。
   * @param {number} nowTs - 推进到的虚拟时刻（ms）
   */
  advance(nowTs) {
    if (this._mode !== 'virtual') return;
    for (const [tokenAddress, e] of [...this.pending]) {
      const silent = nowTs - e.lastTouch;
      const sinceBurst = nowTs - e.burstStart;
      if (silent >= this._debounceMs || (this._maxWaitMs > 0 && sinceBurst >= this._maxWaitMs)) {
        this.pending.delete(tokenAddress);
        this.stats.fired++;
        this._onFire(tokenAddress, e.tick, nowTs);
      }
    }
  }

  /** 清除单项（不 fire） */
  clear(tokenAddress) {
    const entry = this.pending.get(tokenAddress);
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    this.pending.delete(tokenAddress);
  }

  /** 清空全部（不 fire）——引擎停止时调用 */
  clearAll() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      if (entry.maxTimer) clearTimeout(entry.maxTimer);
    }
    this.pending.clear();
  }

  get size() {
    return this.pending.size;
  }
}

module.exports = { TickDebouncer };
