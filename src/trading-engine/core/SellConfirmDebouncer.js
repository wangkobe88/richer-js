/**
 * SellConfirmDebouncer：卖出条件持续为真的确认去抖（pumpfun 回迁批 2）
 *
 * 与 TickDebouncer（burst 内每 tick 重置）语义相反：touch 只在「无 pending」时
 * 起算，后续 touch 不重置——卖出要的是"条件持续真 N ms"的确认而非静默期，
 * 重置会让持续阴跌的热门票（每 tick 都真）永远等不到 fire。
 *
 * 语义（母版 WssTradingEngine._scheduleSellDebouncer/_cancelSellDebounce 抽出成类）：
 * - touch：首真起计；已 pending → no-op（让首真 tick 满期）
 * - clear：条件变 false（趋势恢复）/ 卖出完成 / 引擎停止时取消（不 fire）
 * - fire：只负责到点回调；「重读因子 + 重评 + 仍真才卖」由消费方 onFire 承担
 *   （窗口内价格可能恢复→不卖，防即时卖砍掉本可拿住的回调）
 * - debounceMs <= 0：touch 即 fire（引擎分流已保证此情形不进 touch，兜底语义）
 *
 * 两种驱动模式（同 TickDebouncer 骨架）：
 * - real：setTimeout 驱动（实时引擎，wall-clock 到点即 fire）
 * - virtual：虚拟时钟驱动（回测引擎，每笔 tick 处理前 advance(tickTs) 推进）
 *
 * 已知 parity 缝隙（与母版同构，文档化保留）：触发后变静的死票，live 的
 * setTimeout 满期仍 fire；virtual 无后续 tick 不推进不 fire（回测侧偏保守）。
 */

class SellConfirmDebouncer {
  /**
   * @param {Object} opts
   * @param {number} opts.debounceMs - 确认窗口（<=0 表示不去抖，touch 即 fire）
   * @param {string} opts.mode - 'real' | 'virtual'
   * @param {Function} opts.onFire - (tokenAddress, tick, fireTs) => void
   */
  constructor({ debounceMs, mode = 'real', onFire }) {
    this._debounceMs = debounceMs;
    this._mode = mode;
    this._onFire = onFire;
    this.pending = new Map(); // tokenAddress → entry
    this.stats = { fired: 0, suppressed: 0 };
  }

  /**
   * 注册一次卖出条件为真（首真起计，后续真 tick 不重置）。
   * @param {string} tokenAddress
   * @param {Object} tick - virtual 模式必须带 timestamp(ms)；real 模式任意（透传给 onFire）
   */
  touch(tokenAddress, tick) {
    if (this._debounceMs <= 0) {
      this.stats.fired++;
      this._onFire(tokenAddress, tick, this._mode === 'virtual' ? tick.timestamp : Date.now());
      return;
    }

    if (this.pending.has(tokenAddress)) {
      this.stats.suppressed++; // 已 pending：不重置（让首真 tick 满期）
      return;
    }

    if (this._mode === 'virtual') {
      this.pending.set(tokenAddress, { startTs: tick.timestamp, tick });
      return;
    }

    // real 模式：timer 驱动
    const fire = () => {
      const e = this.pending.get(tokenAddress);
      if (!e) return;
      this.pending.delete(tokenAddress);
      this.stats.fired++;
      this._onFire(tokenAddress, e.tick, Date.now());
    };
    const timer = setTimeout(fire, this._debounceMs);
    this.pending.set(tokenAddress, { timer, startTs: Date.now(), tick });
  }

  /**
   * 虚拟时钟推进：fire 所有到期项（nowTs - startTs >= debounceMs）。
   * real 模式下由 timer 驱动，no-op。
   * @param {number} nowTs - 推进到的虚拟时刻（ms）
   */
  advance(nowTs) {
    if (this._mode !== 'virtual') return;
    for (const [tokenAddress, e] of [...this.pending]) {
      if (nowTs - e.startTs >= this._debounceMs) {
        this.pending.delete(tokenAddress);
        this.stats.fired++;
        this._onFire(tokenAddress, e.tick, nowTs);
      }
    }
  }

  /** 清除单项（不 fire）——条件变 false / 卖出完成 */
  clear(tokenAddress) {
    const entry = this.pending.get(tokenAddress);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(tokenAddress);
  }

  /** 清空全部（不 fire）——引擎停止时调用 */
  clearAll() {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  get size() {
    return this.pending.size;
  }
}

module.exports = { SellConfirmDebouncer };
