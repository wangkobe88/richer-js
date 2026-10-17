/**
 * SellConfirmDebouncer：卖出条件持续为真的确认去抖（pumpfun 回迁批 2）
 *
 * 与 TickDebouncer（burst 内每 tick 重置）语义相反：touch 只在「无 pending」时
 * 起算，后续 touch 不重置——卖出要的是"条件持续真 N ms"的确认而非静默期，
 * 重置会让持续阴跌的热门票（每 tick 都真）永远等不到 fire。
 *
 * 语义（母版 WssTradingEngine._scheduleSellDebouncer/_cancelSellDebounce 抽出成类）：
 * - touch：首真起计；已 pending → ticksSeen++（凑证据）+ 满足双门即时 fire
 * - clear：条件变 false（趋势恢复）/ 卖出完成 / 引擎停止时取消（不 fire）
 * - fire：只负责到点回调；「重读因子 + 重评 + 仍真才卖」由消费方 onFire 承担
 *   （窗口内价格可能恢复→不卖，防即时卖砍掉本可拿住的回调）
 * - debounceMs <= 0：touch 即 fire（引擎分流已保证此情形不进 touch，兜底语义）
 *
 * 双门槛确认（2026-10-16 蓝筹蛙/RIBBIT 断流案用户裁定）：minTicks > 0 时
 * fire = 时间窗（debounceMs）AND 窗后新 tick 数（ticksSeen >= minTicks）——
 * 断流票在时间窗内零 tick 时不得按陈旧快照卖，须等新证据凑齐；逃生门
 * maxWaitMs（首真起计绝对上限，缺省 120s）到点强制走 fire 路径（onFire 仍
 * 重读因子重评，条件翻假依旧不卖）。minTicks=0（缺省）纯时间语义，存量
 * 行为 bit-identical。
 *
 * 两种驱动模式（同 TickDebouncer 骨架）：
 * - real：setTimeout 驱动（实时引擎，wall-clock 到点即 fire）
 * - virtual：虚拟时钟驱动（回测引擎，每笔 tick 处理前 advance(tickTs) 推进）
 *
 * 已知 parity 缝隙（与母版同构，文档化保留）：触发后变静的死票，virtual 无后续
 * tick 不推进不 fire（回测侧偏保守，maxWaitMs 强制门在 virtual 因时钟静止同样
 * 无法触发）；real 的 maxWait timer 兜底强制 fire——两模式的死票处置刻意不同。
 */

class SellConfirmDebouncer {
  /**
   * @param {Object} opts
   * @param {number} opts.debounceMs - 确认窗口（<=0 表示不去抖，touch 即 fire）
   * @param {number} [opts.minTicks=0] - 确认所需的窗后新 tick 数（<=0 纯时间语义）
   * @param {number} [opts.maxWaitMs=120000] - minTicks>0 时的强制逃生上限（<=0 无上限）
   * @param {string} opts.mode - 'real' | 'virtual'
   * @param {Function} opts.onFire - (tokenAddress, tick, fireTs) => void
   */
  constructor({ debounceMs, minTicks = 0, maxWaitMs = 120000, mode = 'real', onFire }) {
    this._debounceMs = debounceMs;
    this._minTicks = minTicks;
    this._maxWaitMs = maxWaitMs;
    this._mode = mode;
    this._onFire = onFire;
    this.pending = new Map(); // tokenAddress → entry
    this.stats = { fired: 0, suppressed: 0, forceFired: 0 };
  }

  /** 强制门是否武装（仅 minTicks 生效时有意义） */
  get _armed() {
    return this._minTicks > 0;
  }

  /**
   * 注册一次卖出条件为真（首真起计，后续真 tick 不重置、只凑证据数）。
   * @param {string} tokenAddress
   * @param {Object} tick - virtual 模式必须带 timestamp(ms)；real 模式任意（透传给 onFire）
   */
  touch(tokenAddress, tick) {
    if (this._debounceMs <= 0) {
      this.stats.fired++;
      this._onFire(tokenAddress, tick, this._mode === 'virtual' ? tick.timestamp : Date.now());
      return;
    }

    const existing = this.pending.get(tokenAddress);
    if (existing) {
      this.stats.suppressed++; // 已 pending：不重置（让首真 tick 满期）
      existing.ticksSeen++;
      if (this._mode === 'real') {
        // 双门即时检查：时间窗已过且证据凑齐 → fire（debounce timer 到点但证据
        // 不足转等待后的唯一补 fire 路径；时间未到则等 debounce timer）
        this._tryFire(tokenAddress, existing, Date.now(), false);
      }
      return;
    }

    if (this._mode === 'virtual') {
      this.pending.set(tokenAddress, { startTs: tick.timestamp, ticksSeen: 0, tick });
      return;
    }

    // real 模式：timer 驱动
    const now = Date.now();
    const entry = { startTs: now, ticksSeen: 0, tick, debounceTimer: null, maxTimer: null };
    entry.debounceTimer = setTimeout(() => {
      // 时间窗到点：证据已凑齐 → fire；不足 → 转等待（后续 touch 补 fire，maxTimer 兜底）
      this._tryFire(tokenAddress, entry, Date.now(), false);
    }, this._debounceMs);
    if (this._armed && this._maxWaitMs > 0) {
      entry.maxTimer = setTimeout(() => {
        this._fire(tokenAddress, entry, Date.now(), true);
      }, this._maxWaitMs);
    }
    this.pending.set(tokenAddress, entry);
  }

  /**
   * 双门检查：时间窗已过 AND 证据凑齐才 fire（minTicks=0 时等价纯时间门）。
   * fire 前清两个 timer（fire 与 pending 删除原子成对）。
   */
  _tryFire(tokenAddress, entry, now, force) {
    const elapsed = now - entry.startTs;
    const timeOk = elapsed >= this._debounceMs;
    const ticksOk = !this._armed || entry.ticksSeen >= this._minTicks;
    if (force || (timeOk && ticksOk)) {
      this._fire(tokenAddress, entry, now, force);
    }
  }

  _fire(tokenAddress, entry, now, force) {
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.maxTimer);
    this.pending.delete(tokenAddress);
    this.stats.fired++;
    if (force) this.stats.forceFired++;
    this._onFire(tokenAddress, entry.tick, now);
  }

  /**
   * 虚拟时钟推进：fire 所有「时间窗已过 AND 证据凑齐」项；强制门在此同样
   * 检查（时钟只在 tick 到达时推进，死票不推进=不强制，见头部 parity 注释）。
   * @param {number} nowTs - 推进到的虚拟时刻（ms）
   */
  advance(nowTs) {
    if (this._mode !== 'virtual') return;
    for (const [tokenAddress, e] of [...this.pending]) {
      this._tryFire(tokenAddress, e, nowTs,
        this._armed && this._maxWaitMs > 0 && (nowTs - e.startTs) >= this._maxWaitMs);
    }
  }

  /** 清除单项（不 fire）——条件变 false / 卖出完成 */
  clear(tokenAddress) {
    const entry = this.pending.get(tokenAddress);
    if (!entry) return;
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.maxTimer);
    this.pending.delete(tokenAddress);
  }

  /** 清空全部（不 fire）——引擎停止时调用 */
  clearAll() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.debounceTimer);
      clearTimeout(entry.maxTimer);
    }
    this.pending.clear();
  }

  get size() {
    return this.pending.size;
  }
}

module.exports = { SellConfirmDebouncer };
