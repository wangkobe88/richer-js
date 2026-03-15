/**
 * 持有者历史缓存
 * 用于存储代币的持有者数量历史数据，支持持有者趋势检测
 * 类似 PriceHistoryCache，但存储持有者数量而非价格
 */
class HolderHistoryCache {
  /**
   * @param {number} maxAge - 数据最大保留时间（毫秒），默认15分钟
   */
  constructor(maxAge = 15 * 60 * 1000) {
    this.history = new Map();  // key: tokenAddress-chain, value: Array<{timestamp, holderCount}>
    this.maxAge = maxAge;
  }

  /**
   * 添加持有者数量记录
   * @param {string} tokenKey - 代币键（address-chain格式）
   * @param {number} holderCount - 持有者数量
   * @param {number} timestamp - 时间戳（毫秒），默认当前时间
   */
  addHolderCount(tokenKey, holderCount, timestamp = Date.now()) {
    if (!tokenKey || holderCount === undefined || holderCount === null) {
      return;
    }

    if (!this.history.has(tokenKey)) {
      this.history.set(tokenKey, []);
    }

    const holderCounts = this.history.get(tokenKey);
    holderCounts.push({ timestamp, holderCount });

    // 移除过期的数据（超过maxAge）
    const cutoffTime = timestamp - this.maxAge;
    const validCounts = holderCounts.filter(h => h.timestamp > cutoffTime);

    if (validCounts.length === 0) {
      this.history.delete(tokenKey);
    } else {
      this.history.set(tokenKey, validCounts);
    }
  }

  /**
   * 获取代币的持有者历史（包含时间戳）
   * @param {string} tokenKey - 代币键
   * @returns {Array<{timestamp: number, holderCount: number}>}
   */
  getHolderCounts(tokenKey) {
    return this.history.get(tokenKey) || [];
  }

  /**
   * 获取代币的持有者历史（仅持有者数量数组）
   * @param {string} tokenKey - 代币键
   * @returns {Array<number>}
   */
  getHolderCountArray(tokenKey) {
    const counts = this.getHolderCounts(tokenKey);
    return counts.map(h => h.holderCount);
  }

  /**
   * 获取数据点数量
   * @param {string} tokenKey - 代币键
   * @returns {number}
   */
  getDataPointCount(tokenKey) {
    return this.getHolderCounts(tokenKey).length;
  }

  /**
   * 检查代币是否有足够的数据点
   * @param {string} tokenKey - 代币键
   * @param {number} minPoints - 最小数据点数
   * @returns {boolean}
   */
  hasEnoughData(tokenKey, minPoints = 6) {
    return this.getDataPointCount(tokenKey) >= minPoints;
  }

  /**
   * 清理代币的历史数据
   * @param {string} tokenKey - 代币键
   * @returns {boolean} 是否成功清理
   */
  clear(tokenKey) {
    return this.history.delete(tokenKey);
  }

  /**
   * 清理所有数据
   */
  clearAll() {
    this.history.clear();
  }

  /**
   * 获取内存使用情况
   * @returns {{tokenCount: number, totalRecords: number}}
   */
  getStats() {
    let totalRecords = 0;
    for (const counts of this.history.values()) {
      totalRecords += counts.length;
    }

    return {
      tokenCount: this.history.size,
      totalRecords
    };
  }

  /**
   * 清理过期的数据（所有代币）
   * @param {number} timestamp - 基准时间戳，默认当前时间
   */
  cleanupExpired(timestamp = Date.now()) {
    const cutoffTime = timestamp - this.maxAge;
    let cleanedCount = 0;

    for (const [tokenKey, counts] of this.history.entries()) {
      const validCounts = counts.filter(h => h.timestamp > cutoffTime);

      if (validCounts.length === 0) {
        this.history.delete(tokenKey);
        cleanedCount++;
      } else if (validCounts.length < counts.length) {
        this.history.set(tokenKey, validCounts);
      }
    }

    return cleanedCount;
  }
}

module.exports = HolderHistoryCache;
