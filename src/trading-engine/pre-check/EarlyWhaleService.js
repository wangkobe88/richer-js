/**
 * 早期大户分析服务
 *
 * 检测拉砸代币的"早期大户抛售"特征：
 * - 拉砸代币：早期大户大量卖出（卖出率高）
 * - 正常代币：早期大户持有（持有率高）
 *
 * 使用混合方案：
 * - 如果信号时间 - 代币创建时间 <= 120s：使用真实早期数据
 * - 否则：使用相对交易位置方法（观察窗口的前30%交易）
 *
 * 核心特征：
 * 1. earlyWhaleHoldRatio - 早期大户持有率（未卖出的比例）
 * 2. earlyWhaleSellRatio - 早期大户卖出率（总卖出/总买入）
 * 3. earlyWhaleCount - 早期大户数量
 */

class EarlyWhaleService {
  /**
   * @param {Object} logger - Logger实例
   */
  constructor(logger) {
    this.logger = logger;

    // 配置参数
    this.earlyWhaleAmountThreshold = 200;  // 早期大户金额阈值（USD）
    this.realEarlyTimeThreshold = 120;     // 真实早期数据时间阈值（秒）
    this.relativeEarlyRatio = 0.3;         // 相对早期比例（前30%交易）
  }

  /**
   * 执行早期大户分析
   * @param {Array} trades - 交易数据（必须按时间升序排列）
   * @param {Object} options - 可选配置
   * @param {number} options.tokenCreateTime - 代币创建时间（秒）
   * @param {number} options.checkTime - 检查时间/信号时间（秒）
   * @param {number} options.windowStart - 观察窗口起始时间（秒，用于相对方法）
   * @returns {Object} 分析结果
   */
  performEarlyWhaleAnalysis(trades, options = {}) {
    const startTime = Date.now();
    const { tokenCreateTime, checkTime, windowStart } = options;

    this.logger.debug('[EarlyWhaleService] 开始早期大户分析', {
      trades_count: trades?.length || 0,
      token_create_time: tokenCreateTime,
      check_time: checkTime,
      window_start: windowStart
    });

    if (!trades || trades.length === 0) {
      return this._getEmptyResult(startTime);
    }

    // 全部使用 relative 方法，保持语义一致
    return this._analyzeWithRelativePosition(trades, windowStart || trades[0]?.time, startTime);
  }

  /**
   * 判断是否应该使用真实早期数据方法
   * @private
   */
  _shouldUseRealEarlyMethod(tokenCreateTime, checkTime, windowStart) {
    // 如果没有代币创建时间，使用相对方法
    if (!tokenCreateTime || !checkTime) {
      return false;
    }

    const timeGap = checkTime - tokenCreateTime;
    return timeGap <= this.realEarlyTimeThreshold;
  }

  /**
   * 使用真实早期数据方法（能回溯到代币创建时间）
   * @private
   */
  _analyzeWithRealEarlyData(trades, tokenCreateTime, startTime) {
    this.logger.debug('[EarlyWhaleService] 使用真实早期数据方法', {
      earliest_trade_time: trades[0]?.time,
      token_create_time: tokenCreateTime
    });

    const earliestTime = trades[0].time;
    const earlyTradeCount = Math.min(30, Math.floor(trades.length * 0.2));
    const earlyTradeEndTime = trades[earlyTradeCount - 1]?.time || earliestTime;

    // 分析钱包行为
    const walletMap = this._buildWalletMap(trades, earliestTime);

    // 识别早期大户：在前N笔交易入场，买入金额>阈值
    const earlyWhales = this._identifyEarlyWhales(
      walletMap,
      earlyTradeEndTime - earliestTime,
      earliestTime
    );

    // 计算统计指标
    const metrics = this._calculateWhaleMetrics(earlyWhales);

    const result = {
      checkTimestamp: startTime,
      checkDuration: Date.now() - startTime,
      method: 'real_early',

      // 核心因子
      earlyWhaleHoldRatio: metrics.holdRatio,
      earlyWhaleSellRatio: metrics.sellRatio,
      earlyWhaleCount: earlyWhales.length,

      // 调试信息
      earlyWhaleMethod: 'real_early',
      earlyWhaleTotalTrades: trades.length,
      earlyWhaleEarlyThreshold: earlyTradeCount
    };

    this.logger.debug('[EarlyWhaleService] 真实早期数据方法分析完成', {
      whale_count: earlyWhales.length,
      hold_ratio: metrics.holdRatio,
      sell_ratio: metrics.sellRatio
    });

    return result;
  }

  /**
   * 使用相对交易位置方法（无法回溯到代币创建时间）
   * @private
   */
  _analyzeWithRelativePosition(trades, windowStart, startTime) {
    this.logger.debug('[EarlyWhaleService] 使用相对交易位置方法', {
      window_start: windowStart,
      trades_count: trades.length
    });

    // 早期定义：前30%交易
    const earlyThreshold = Math.floor(trades.length * this.relativeEarlyRatio);
    const earlyTradeEndTime = trades[earlyThreshold - 1]?.time || windowStart;

    // 分析钱包行为（时间相对于窗口起始）
    const walletMap = this._buildWalletMap(trades, windowStart);

    // 识别早期大户：在观察窗口的前30%交易入场
    const earlyWhales = this._identifyEarlyWhales(
      walletMap,
      earlyTradeEndTime - windowStart,
      windowStart
    );

    // 计算统计指标
    const metrics = this._calculateWhaleMetrics(earlyWhales);

    const result = {
      checkTimestamp: startTime,
      checkDuration: Date.now() - startTime,
      method: 'relative',

      // 核心因子
      earlyWhaleHoldRatio: metrics.holdRatio,
      earlyWhaleSellRatio: metrics.sellRatio,
      earlyWhaleCount: earlyWhales.length,

      // 调试信息
      earlyWhaleMethod: 'relative',
      earlyWhaleTotalTrades: trades.length,
      earlyWhaleEarlyThreshold: earlyThreshold
    };

    this.logger.debug('[EarlyWhaleService] 相对交易位置方法分析完成', {
      whale_count: earlyWhales.length,
      hold_ratio: metrics.holdRatio,
      sell_ratio: metrics.sellRatio
    });

    return result;
  }

  /**
   * 构建钱包交易映射
   * @private
   */
  _buildWalletMap(trades, timeBase) {
    const baseCurrencies = ['WBNB', 'USDT', 'BUSD', 'USDC', 'ETH', 'USD1'];
    const walletMap = new Map();

    for (const trade of trades) {
      const wallet = trade.wallet_address?.toLowerCase();
      if (!wallet) continue;

      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, {
          wallet,
          firstBuyTime: null,
          totalBuyAmount: 0,
          totalBuyTokens: 0,
          sellTrades: []
        });
      }

      const walletData = walletMap.get(wallet);
      const fromToken = trade.from_token_symbol;
      const toToken = trade.to_token_symbol;
      const fromUsd = trade.from_usd || 0;
      const toAmount = trade.to_amount || 0;
      const toUsd = trade.to_usd || 0;
      const fromAmount = trade.from_amount || 0;
      const relTime = trade.time - timeBase;

      const isBuy = fromToken && baseCurrencies.includes(fromToken);
      const isSell = toToken && baseCurrencies.includes(toToken);

      if (isBuy) {
        if (walletData.firstBuyTime === null || relTime < walletData.firstBuyTime) {
          walletData.firstBuyTime = relTime;
        }
        walletData.totalBuyAmount += fromUsd;
        walletData.totalBuyTokens += toAmount;
      }

      if (isSell) {
        walletData.sellTrades.push({ toUsd, fromAmount });
        walletData.totalSellAmount = (walletData.totalSellAmount || 0) + toUsd;
        walletData.totalSellTokens = (walletData.totalSellTokens || 0) + fromAmount;
      }
    }

    return walletMap;
  }

  /**
   * 识别早期大户
   * @private
   */
  _identifyEarlyWhales(walletMap, earlyTimeThreshold, timeBase) {
    const whales = [];

    for (const [wallet, data] of walletMap) {
      if (data.firstBuyTime !== null &&
          data.totalBuyAmount > this.earlyWhaleAmountThreshold &&
          data.firstBuyTime <= earlyTimeThreshold) {
        whales.push(data);
      }
    }

    return whales;
  }

  /**
   * 计算早期大户统计指标
   * @private
   */
  _calculateWhaleMetrics(whales) {
    if (whales.length === 0) {
      return {
        holdRatio: 1.0,  // 没有大户时，认为持有率100%
        sellRatio: 0
      };
    }

    // 计算持有率（未卖出的比例）
    const holdingWhales = whales.filter(w => w.sellTrades.length === 0);
    const holdRatio = holdingWhales.length / whales.length;

    // 计算卖出率（总卖出代币数/总买入代币数）
    let totalSellRatio = 0;
    for (const whale of whales) {
      let sellRatio = 0;
      if (whale.sellTrades.length > 0) {
        sellRatio = whale.totalSellTokens / whale.totalBuyTokens;
      }
      totalSellRatio += sellRatio;
    }
    const sellRatio = totalSellRatio / whales.length;

    return { holdRatio, sellRatio };
  }

  /**
   * 获取空结果
   * @private
   */
  _getEmptyResult(startTime) {
    return {
      checkTimestamp: startTime || Date.now(),
      checkDuration: 0,
      method: 'none',

      // 核心因子（数据缺失时，设置为拒绝状态）
      // 使用 holdRatio=0, sellRatio=1 来触发拒绝（sellRatio > 0.7 时拒绝）
      earlyWhaleHoldRatio: 0,    // 没有数据时，认为持有率0%
      earlyWhaleSellRatio: 1,    // 没有数据时，认为卖出率100%（触发拒绝）
      earlyWhaleCount: 0,

      // 调试信息
      earlyWhaleMethod: 'none',
      earlyWhaleTotalTrades: 0,
      earlyWhaleEarlyThreshold: 0
    };
  }

  /**
   * 获取空因子值（用于错误时的默认返回）
   */
  getEmptyFactorValues() {
    return {
      earlyWhaleHoldRatio: 0,      // 数据缺失时，认为持有率0%
      earlyWhaleSellRatio: 1,      // 数据缺失时，认为卖出率100%（触发拒绝）
      earlyWhaleCount: 0,
      earlyWhaleMethod: 'error',
      earlyWhaleTotalTrades: 0,
      earlyWhaleEarlyThreshold: 0
    };
  }
}

module.exports = { EarlyWhaleService };
