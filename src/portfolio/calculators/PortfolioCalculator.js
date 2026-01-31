/**
 * 投资组合计算器
 * 负责投资组合的价值计算和性能指标计算
 */

const Decimal = require('decimal.js');

/**
 * 投资组合计算器类
 * @class
 */
class PortfolioCalculator {
  /**
   * 构造函数
   * @param {Object} [config] - 配置选项
   */
  constructor(config = {}) {
    /** @type {Decimal} 零值 */
    this.ZERO = new Decimal(0);

    /** @type {Object} 配置 */
    this.config = {
      enablePriceHistory: config.enablePriceHistory || false,
      enablePerformanceMetrics: config.enablePerformanceMetrics || true,
      priceUpdateInterval: config.priceUpdateInterval || 60000, // 1分钟
      maxHistoryDays: config.maxHistoryDays || 365,
      includeGasFees: config.includeGasFees || true,
      includeSlippage: config.includeSlippage || true,
      ...config
    };

    /** @type {Map<string, Object>} 价格缓存 */
    this.priceCache = new Map();

    /** @type {Map<string, Object>} 历史价格数据 */
    this.priceHistory = new Map();
  }

  /**
   * 计算持仓价值
   * @param {Object} position - 持仓信息
   * @param {Decimal} currentPrice - 当前价格
   * @returns {Object} 更新后的持仓信息
   */
  calculatePositionValue(position, currentPrice) {
    const amount = new Decimal(position.amount);
    const averagePrice = new Decimal(position.averagePrice);
    const price = new Decimal(currentPrice);

    const currentValue = amount.mul(price);

    // ❌ 删除：本地PNL计算，使用AVE PNL数据
    // valueChange, valueChangePercent, unrealizedPnL, totalPnL

    return {
      ...position,
      currentPrice: price,
      value: currentValue,
      lastUpdated: Date.now()
    };
  }

  /**
   * 计算投资组合总价值
   * @param {Map} positions - 持仓映射
   * @param {Decimal} cashBalance - 现金余额
   * @returns {Decimal} 总价值
   */
  calculateTotalPortfolioValue(positions, cashBalance) {
    let totalValue = new Decimal(cashBalance);

    for (const [address, position] of positions) {
      totalValue = totalValue.add(new Decimal(position.value || 0));
    }

    return totalValue;
  }

  /**
   * 计算资产配置
   * @param {Map} positions - 持仓映射
   * @param {Decimal} totalValue - 总价值
   * @param {Object} targetAllocation - 目标配置
   * @returns {Array<Object>} 资产配置数组
   */
  calculateAssetAllocation(positions, totalValue, targetAllocation = {}) {
    const allocation = [];

    for (const [address, position] of positions) {
      const positionValue = new Decimal(position.value || 0);
      const currentPercentage = totalValue.gt(0) ? positionValue.div(totalValue).mul(100) : this.ZERO;
      const targetPercentage = new Decimal(targetAllocation[address] || 0);
      const deviation = currentPercentage.sub(targetPercentage);

      let action = 'hold';
      if (deviation.abs().gt(5)) { // 5%的偏差阈值
        action = deviation.gt(0) ? 'sell' : 'buy';
      }

      allocation.push({
        tokenAddress: address,
        tokenSymbol: position.tokenSymbol,
        targetPercentage,
        currentPercentage,
        value: positionValue,
        deviation,
        action
      });
    }

    return allocation.sort((a, b) => b.deviation.abs().sub(a.deviation.abs()).toNumber());
  }

  /**
   * 计算性能指标
   * @param {Array} snapshots - 快照数组
   * @param {Array} trades - 交易记录
   * @param {Object} timeframe - 时间框架
   * @returns {Object} 性能指标
   */
  calculatePerformanceMetrics(snapshots, trades, timeframe = {}) {
    if (!snapshots || snapshots.length < 2) {
      return this.getDefaultMetrics();
    }

    const sortedSnapshots = snapshots.sort((a, b) => a.timestamp - b.timestamp);
    const initialSnapshot = sortedSnapshots[0];
    const currentSnapshot = sortedSnapshots[sortedSnapshots.length - 1];

    const initialValue = new Decimal(initialSnapshot.totalValue);
    const currentValue = new Decimal(currentSnapshot.totalValue);
    const totalReturn = currentValue.sub(initialValue);
    const totalReturnPercent = initialValue.gt(0) ? totalReturn.div(initialValue).mul(100) : this.ZERO;

    // 计算时间框架变化
    const dailyChange = this.calculateTimeframeChange(sortedSnapshots, 1);
    const weeklyChange = this.calculateTimeframeChange(sortedSnapshots, 7);
    const monthlyChange = this.calculateTimeframeChange(sortedSnapshots, 30);

    // 计算波动率
    const dailyReturns = this.calculateDailyReturns(sortedSnapshots);
    const volatility = this.calculateVolatility(dailyReturns);

    // 计算最大回撤
    const maxDrawdown = this.calculateMaxDrawdown(sortedSnapshots);

    // 计算夏普比率
    const sharpeRatio = this.calculateSharpeRatio(totalReturnPercent, volatility);

    // 计算索提诺比率
    const sortinoRatio = this.calculateSortinoRatio(dailyReturns, totalReturnPercent);

    // 计算交易相关指标
    const tradeMetrics = this.calculateTradeMetrics(trades);

    return {
      totalReturn,
      totalReturnPercent,
      dailyReturn: dailyChange,
      weeklyReturn: weeklyChange,
      monthlyReturn: monthlyChange,
      yearlyReturn: totalReturnPercent.mul(365 / Math.max(1, (currentSnapshot.timestamp - initialSnapshot.timestamp) / (24 * 60 * 60 * 1000))),
      volatility,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio,
      ...tradeMetrics
    };
  }

  /**
   * 计算风险指标
   * @param {Array} positions - 持仓数组
   * @param {Array} snapshots - 快照数组
   * @param {Array} priceHistory - 价格历史
   * @returns {Object} 风险指标
   */
  calculateRiskMetrics(positions, snapshots, priceHistory = []) {
    const positionValues = positions.map(p => new Decimal(p.value || 0));
    const totalValue = positionValues.reduce((sum, value) => sum.add(value), this.ZERO);

    // 计算VaR (Value at Risk) - 95%置信度
    const dailyReturns = this.calculateDailyReturns(snapshots);
    const var95 = this.calculateVaR(dailyReturns, 0.95);

    // 计算Expected Shortfall (CVaR)
    const expectedShortfall = this.calculateExpectedShortfall(dailyReturns, 0.95);

    // 计算集中度风险
    const concentrationRisk = this.calculateConcentrationRisk(positionValues, totalValue);

    // 计算相关性矩阵（简化版）
    const correlationMatrix = this.calculateCorrelationMatrix(priceHistory);

    // 计算多样化评分
    const diversificationScore = this.calculateDiversificationScore(positionValues, totalValue);

    return {
      valueAtRisk: var95,
      expectedShortfall,
      beta: this.ZERO, // 需要市场数据计算
      alpha: this.ZERO, // 需要市场数据计算
      standardDeviation: this.calculateVolatility(dailyReturns),
      correlationMatrix,
      concentrationRisk,
      positionCount: positions.length,
      maxPositionSize: positionValues.length > 0 ? positionValues.reduce((max, value) => Decimal.max(max, value), this.ZERO) : this.ZERO,
      diversificationScore
    };
  }

  /**
   * 计算时间框架变化
   * @private
   * @param {Array} snapshots - 快照数组
   * @param {number} days - 天数
   * @returns {Decimal} 变化百分比
   */
  calculateTimeframeChange(snapshots, days) {
    const now = Date.now();
    const targetTime = now - (days * 24 * 60 * 60 * 1000);

    let targetSnapshot = null;
    let currentSnapshot = snapshots[snapshots.length - 1];

    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].timestamp <= targetTime) {
        targetSnapshot = snapshots[i];
        break;
      }
    }

    if (!targetSnapshot) return this.ZERO;

    const targetValue = new Decimal(targetSnapshot.totalValue);
    const currentValue = new Decimal(currentSnapshot.totalValue);

    return targetValue.gt(0) ? currentValue.sub(targetValue).div(targetValue).mul(100) : this.ZERO;
  }

  /**
   * 计算日收益率
   * @private
   * @param {Array} snapshots - 快照数组
   * @returns {Decimal[]} 日收益率数组
   */
  calculateDailyReturns(snapshots) {
    const dailyReturns = [];

    for (let i = 1; i < snapshots.length; i++) {
      const currentValue = new Decimal(snapshots[i].totalValue);
      const previousValue = new Decimal(snapshots[i - 1].totalValue);

      if (previousValue.gt(0)) {
        const dailyReturn = currentValue.sub(previousValue).div(previousValue);
        dailyReturns.push(dailyReturn);
      }
    }

    return dailyReturns;
  }

  /**
   * 计算波动率
   * @private
   * @param {Decimal[]} returns - 收益率数组
   * @returns {Decimal} 波动率
   */
  calculateVolatility(returns) {
    if (returns.length < 2) return this.ZERO;

    const mean = returns.reduce((sum, ret) => sum.add(ret), this.ZERO).div(returns.length);
    const squaredDiffs = returns.map(ret => ret.sub(mean).pow(2));
    const variance = squaredDiffs.reduce((sum, diff) => sum.add(diff), this.ZERO).div(returns.length);

    return variance.sqrt();
  }

  /**
   * 计算最大回撤
   * @private
   * @param {Array} snapshots - 快照数组
   * @returns {Decimal} 最大回撤百分比
   */
  calculateMaxDrawdown(snapshots) {
    if (snapshots.length < 2) return this.ZERO;

    let maxDrawdown = this.ZERO;
    let peakValue = new Decimal(snapshots[0].totalValue);

    for (let i = 1; i < snapshots.length; i++) {
      const currentValue = new Decimal(snapshots[i].totalValue);

      if (currentValue.gt(peakValue)) {
        peakValue = currentValue;
      } else {
        const drawdown = peakValue.sub(currentValue).div(peakValue);
        if (drawdown.gt(maxDrawdown)) {
          maxDrawdown = drawdown;
        }
      }
    }

    return maxDrawdown.mul(100); // 转换为百分比
  }

  /**
   * 计算夏普比率
   * @private
   * @param {Decimal} returnPercent - 回报率
   * @param {Decimal} volatility - 波动率
   * @param {number} riskFreeRate - 无风险利率（年化）
   * @returns {Decimal} 夏普比率
   */
  calculateSharpeRatio(returnPercent, volatility, riskFreeRate = 0.02) {
    if (volatility.eq(0)) return this.ZERO;

    const annualizedReturn = returnPercent;
    const excessReturn = annualizedReturn.minus(riskFreeRate * 100);

    return excessReturn.div(volatility);
  }

  /**
   * 计算索提诺比率
   * @private
   * @param {Decimal[]} returns - 收益率数组
   * @param {Decimal} returnPercent - 回报率
   * @param {number} riskFreeRate - 无风险利率（年化）
   * @returns {Decimal} 索提诺比率
   */
  calculateSortinoRatio(returns, returnPercent, riskFreeRate = 0.02) {
    if (returns.length === 0) return this.ZERO;

    const negativeReturns = returns.filter(ret => ret.lt(0));
    if (negativeReturns.length === 0) return returnPercent.gt(0) ? new Decimal(999) : this.ZERO;

    const mean = returns.reduce((sum, ret) => sum.add(ret), this.ZERO).div(returns.length);
    const downsideSquaredDiffs = negativeReturns.map(ret => ret.sub(mean).pow(2));
    const downsideVariance = downsideSquaredDiffs.reduce((sum, diff) => sum.add(diff), this.ZERO).div(negativeReturns.length);
    const downsideDeviation = downsideVariance.sqrt();

    if (downsideDeviation.eq(0)) return this.ZERO;

    const annualizedReturn = returnPercent;
    const excessReturn = annualizedReturn.minus(riskFreeRate * 100);

    return excessReturn.div(downsideDeviation);
  }

  /**
   * 计算交易指标
   * @private
   * @param {Array} trades - 交易记录
   * @returns {Object} 交易指标
   */
  calculateTradeMetrics(trades = []) {
    if (trades.length === 0) {
      return {
        winRate: 0,
        profitFactor: this.ZERO,
        totalTrades: 0,
        winningTrades: 0,
        averageWin: this.ZERO,
        averageLoss: this.ZERO,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        averageHoldingPeriod: 0
      };
    }

    const completedTrades = trades.filter(trade => trade.pnl !== undefined);
    const winningTrades = completedTrades.filter(trade => trade.pnl > 0);
    const losingTrades = completedTrades.filter(trade => trade.pnl < 0);

    const winRate = completedTrades.length > 0 ? (winningTrades.length / completedTrades.length) * 100 : 0;

    const totalWinAmount = winningTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl || 0), 0);
    const totalLossAmount = losingTrades.reduce((sum, trade) => sum + Math.abs(trade.pnl || 0), 0);
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : (totalWinAmount > 0 ? 999 : 0);

    const averageWin = winningTrades.length > 0 ? totalWinAmount / winningTrades.length : 0;
    const averageLoss = losingTrades.length > 0 ? totalLossAmount / losingTrades.length : 0;

    // 计算连续盈亏次数
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of completedTrades) {
      if (trade.pnl > 0) {
        currentWins++;
        currentLosses = 0;
        consecutiveWins = Math.max(consecutiveWins, currentWins);
      } else if (trade.pnl < 0) {
        currentLosses++;
        currentWins = 0;
        consecutiveLosses = Math.max(consecutiveLosses, currentLosses);
      }
    }

    // 计算平均持仓周期
    const holdingPeriods = completedTrades
      .filter(trade => trade.buyTime && trade.sellTime)
      .map(trade => (trade.sellTime - trade.buyTime) / (24 * 60 * 60 * 1000)); // 转换为天数

    const averageHoldingPeriod = holdingPeriods.length > 0
      ? holdingPeriods.reduce((sum, period) => sum + period, 0) / holdingPeriods.length
      : 0;

    return {
      winRate,
      profitFactor: new Decimal(profitFactor),
      totalTrades: completedTrades.length,
      winningTrades: winningTrades.length,
      averageWin: new Decimal(averageWin),
      averageLoss: new Decimal(averageLoss),
      consecutiveWins,
      consecutiveLosses,
      averageHoldingPeriod
    };
  }

  /**
   * 计算VaR
   * @private
   * @param {Decimal[]} returns - 收益率数组
   * @param {number} confidence - 置信度
   * @returns {Decimal} VaR值
   */
  calculateVaR(returns, confidence) {
    if (returns.length === 0) return this.ZERO;

    const sortedReturns = returns.slice().sort((a, b) => a.toNumber() - b.toNumber());
    const index = Math.floor((1 - confidence) * sortedReturns.length);

    return sortedReturns[index] || this.ZERO;
  }

  /**
   * 计算Expected Shortfall
   * @private
   * @param {Decimal[]} returns - 收益率数组
   * @param {number} confidence - 置信度
   * @returns {Decimal} Expected Shortfall值
   */
  calculateExpectedShortfall(returns, confidence) {
    if (returns.length === 0) return this.ZERO;

    const varValue = this.calculateVaR(returns, confidence);
    const tailReturns = returns.filter(ret => ret.lt(varValue));

    if (tailReturns.length === 0) return varValue;

    return tailReturns.reduce((sum, ret) => sum.add(ret), this.ZERO).div(tailReturns.length);
  }

  /**
   * 计算集中度风险
   * @private
   * @param {Decimal[]} positionValues - 持仓价值数组
   * @param {Decimal} totalValue - 总价值
   * @returns {Decimal} 集中度风险
   */
  calculateConcentrationRisk(positionValues, totalValue) {
    if (totalValue.eq(0) || positionValues.length === 0) return this.ZERO;

    // 使用Herfindahl-Hirschman指数计算集中度
    const squares = positionValues.map(value => value.div(totalValue).pow(2));
    const hhi = squares.reduce((sum, square) => sum.add(square), this.ZERO);

    return hhi;
  }

  /**
   * 计算相关性矩阵（简化版）
   * @private
   * @param {Array} priceHistory - 价格历史
   * @returns {Object} 相关性矩阵
   */
  calculateCorrelationMatrix(priceHistory = []) {
    // 简化实现，返回空矩阵
    // 在实际应用中，应该基于价格历史计算各资产间的相关性
    return {};
  }

  /**
   * 计算多样化评分
   * @private
   * @param {Decimal[]} positionValues - 持仓价值数组
   * @param {Decimal} totalValue - 总价值
   * @returns {number} 多样化评分 (0-100)
   */
  calculateDiversificationScore(positionValues, totalValue) {
    if (totalValue.eq(0) || positionValues.length === 0) return 0;

    // 基于持仓数量和权重分布计算多样性评分
    const equalWeight = totalValue.div(positionValues.length);
    const deviations = positionValues.map(value => value.sub(equalWeight).abs().div(equalWeight));
    const avgDeviation = deviations.reduce((sum, dev) => sum.add(dev), this.ZERO).div(positionValues.length);

    // 将偏差转换为多样性评分 (偏差越小，多样性越好)
    const diversificationScore = Math.max(0, 100 - avgDeviation.mul(100).toNumber());

    // 考虑持仓数量的影响
    const countBonus = Math.min(20, positionValues.length * 4);

    return Math.min(100, diversificationScore + countBonus);
  }

  /**
   * 获取默认指标
   * @private
   * @returns {Object} 默认指标
   */
  getDefaultMetrics() {
    return {
      totalReturn: this.ZERO,
      totalReturnPercent: this.ZERO,
      dailyReturn: this.ZERO,
      weeklyReturn: this.ZERO,
      monthlyReturn: this.ZERO,
      yearlyReturn: this.ZERO,
      volatility: this.ZERO,
      maxDrawdown: this.ZERO,
      sharpeRatio: this.ZERO,
      sortinoRatio: this.ZERO,
      winRate: 0,
      profitFactor: this.ZERO,
      totalTrades: 0,
      winningTrades: 0,
      averageWin: this.ZERO,
      averageLoss: this.ZERO,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      averageHoldingPeriod: 0
    };
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.priceCache.clear();
  }

  /**
   * 更新价格缓存
   * @param {string} tokenAddress - 代币地址
   * @param {Decimal} price - 价格
   * @param {number} [ttl] - 生存时间（毫秒）
   */
  updatePriceCache(tokenAddress, price, ttl = 60000) {
    this.priceCache.set(tokenAddress, {
      price,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * 从缓存获取价格
   * @param {string} tokenAddress - 代币地址
   * @returns {Decimal|null} 价格或null
   */
  getPriceFromCache(tokenAddress) {
    const cached = this.priceCache.get(tokenAddress);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.priceCache.delete(tokenAddress);
      return null;
    }

    return cached.price;
  }
}

module.exports = {
  PortfolioCalculator
};