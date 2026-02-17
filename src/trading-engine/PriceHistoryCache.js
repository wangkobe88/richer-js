/**
 * 价格历史缓存
 * 用于存储代币的历史价格数据，支持趋势检测
 */
class PriceHistoryCache {
  /**
   * @param {number} maxAge - 价格数据最大保留时间（毫秒），默认15分钟
   */
  constructor(maxAge = 15 * 60 * 1000) {
    this.history = new Map();  // key: tokenAddress-chain, value: Array<{timestamp, price}>
    this.maxAge = maxAge;
  }

  /**
   * 添加价格记录
   * @param {string} tokenKey - 代币键（address-chain格式）
   * @param {number} price - 价格
   * @param {number} timestamp - 时间戳（毫秒），默认当前时间
   */
  addPrice(tokenKey, price, timestamp = Date.now()) {
    if (!tokenKey || price === undefined || price === null) {
      return;
    }

    if (!this.history.has(tokenKey)) {
      this.history.set(tokenKey, []);
    }

    const prices = this.history.get(tokenKey);
    prices.push({ timestamp, price });

    // 移除过期的价格数据（超过maxAge）
    const cutoffTime = timestamp - this.maxAge;
    const validPrices = prices.filter(p => p.timestamp > cutoffTime);

    if (validPrices.length === 0) {
      this.history.delete(tokenKey);
    } else {
      this.history.set(tokenKey, validPrices);
    }
  }

  /**
   * 获取代币的价格历史（包含时间戳）
   * @param {string} tokenKey - 代币键
   * @returns {Array<{timestamp: number, price: number}>}
   */
  getPrices(tokenKey) {
    return this.history.get(tokenKey) || [];
  }

  /**
   * 获取代币的价格历史（仅价格数组）
   * @param {string} tokenKey - 代币键
   * @returns {Array<number>}
   */
  getPriceArray(tokenKey) {
    const prices = this.getPrices(tokenKey);
    return prices.map(p => p.price);
  }

  /**
   * 获取数据点数量
   * @param {string} tokenKey - 代币键
   * @returns {number}
   */
  getDataPointCount(tokenKey) {
    return this.getPrices(tokenKey).length;
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
   * @returns {{tokenCount: number, totalPriceRecords: number}}
   */
  getStats() {
    let totalPriceRecords = 0;
    for (const prices of this.history.values()) {
      totalPriceRecords += prices.length;
    }

    return {
      tokenCount: this.history.size,
      totalPriceRecords
    };
  }

  /**
   * 清理过期的价格数据（所有代币）
   * @param {number} timestamp - 基准时间戳，默认当前时间
   */
  cleanupExpired(timestamp = Date.now()) {
    const cutoffTime = timestamp - this.maxAge;
    let cleanedCount = 0;

    for (const [tokenKey, prices] of this.history.entries()) {
      const validPrices = prices.filter(p => p.timestamp > cutoffTime);

      if (validPrices.length === 0) {
        this.history.delete(tokenKey);
        cleanedCount++;
      } else if (validPrices.length < prices.length) {
        this.history.set(tokenKey, validPrices);
      }
    }

    return cleanedCount;
  }
}

module.exports = PriceHistoryCache;
