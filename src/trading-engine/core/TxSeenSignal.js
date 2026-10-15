/**
 * TxSeenSignal —— WSS tick 快速回执信号（2026-10-15 live 提速案 ①，뮤오23 案：
 * tx 上链后 0.32s 自家 collector 已见成交 tick，provider.waitForTransaction 却因
 * ethers v6 4s 轮询 + ANKR receipt 索引滞后等了 8.2s）。
 *
 * collector `_emitTick` 开头对每条成交 tick 的 tx_hash 发信号（先于 sender 回查，
 * 恒同步零延迟）；trader `_awaitReceipt` 用它做 Promise.race 快路径——seen 后立刻
 * getTransactionReceipt 短间隔轮询，拿真 receipt（绝不用「WSS 见过」冒充回执：
 * revert tx 无事件 log 永不 seen，走原路径）。
 *
 * virtual/backtest 不构造（引擎 live 才建实例）；无 waiter 的 notify 零成本。
 */

class TxSeenSignal {
  constructor() {
    /** @type {Map<string, Array<(seen: boolean) => void>>} txHash → 待唤醒 waiter 列表 */
    this._waiters = new Map();
    /** @type {number} 累计让位/命中计数（观测用：notify 总数 vs waiter 唤醒数） */
    this.notifyCount = 0;
    this.wakeCount = 0;
  }

  /**
   * tick 到达即发信号：唤醒该 hash 全部 waiter 并清条目。
   * 无 waiter 时零成本（一笔 Map miss）。
   * @param {string} txHash
   */
  notify(txHash) {
    if (!txHash) return;
    this.notifyCount++;
    const key = String(txHash).toLowerCase();   // tx.hash 与 log 解码 txHash 来自两个 ethers 对象，归一防形状漂移
    const waiters = this._waiters.get(key);
    if (!waiters || waiters.length === 0) return;
    this._waiters.delete(key);
    this.wakeCount += waiters.length;
    for (const wake of waiters) wake(true);
  }

  /**
   * 等待该 hash 的成交 tick 出现（交易发出后、WSS 尚未见到它时调用）。
   * 超时/已 seen 由 resolve 布尔表达，绝不 reject；超时自清理（waiters 不留死条目）。
   * @param {string} txHash
   * @param {number} timeoutMs 与外层 waitForTransaction 相同的超时
   * @returns {Promise<boolean>} true=WSS 已见该 tx 的成交事件
   */
  waitFor(txHash, timeoutMs) {
    return new Promise((resolve) => {
      const key = String(txHash).toLowerCase();
      const entry = this._waiters.get(key) || [];
      const onTimeout = () => {
        // 自清理：从 entry 移除自身；空列表删 key（迟到 notify 对已超时 waiter 无害——
        // entry 里已没有它，绝不会再被唤醒）
        const idx = entry.indexOf(wake);
        if (idx >= 0) entry.splice(idx, 1);
        if (entry.length === 0) this._waiters.delete(key);
        resolve(false);
      };
      const timer = setTimeout(onTimeout, timeoutMs);
      const wake = (seen) => {
        clearTimeout(timer);
        resolve(seen);
      };
      entry.push(wake);
      this._waiters.set(key, entry);
    });
  }

  /** 当前挂起 waiter 数（单测/观测用） */
  get pendingCount() {
    let n = 0;
    for (const list of this._waiters.values()) n += list.length;
    return n;
  }
}

module.exports = { TxSeenSignal };
