/**
 * Strong Trader Position Service
 * Analyzes strong trader positions in early trading window (1.5min before buy signal)
 *
 * Measures how much the identified "strong traders" are participating in each token
 * High participation tends to correlate with LOWER quality tokens
 */

const { AveTxAPI } = require('../../core/ave-api');
const { STRONG_TRADERS } = require('./STRONG_TRADERS');
const config = require('../../../config/default.json');

class StrongTraderPositionService {
  constructor() {
    this.txApi = new AveTxAPI(
      config.ave?.apiUrl || 'https://prod.ave-api.com',
      config.ave?.timeout || 30000,
      process.env.AVE_API_KEY
    );
    this.WINDOW_SECONDS = 90; // 回溯1.5分钟
    this.TOTAL_SUPPLY = 1000000000; // fourmeme总供应量10亿
  }

  /**
   * 从已有的交易数据中分析强势交易者持仓情况
   * 复用早期参与者检查已获取的交易数据，避免重复API调用
   * @param {string} tokenAddress - 代币地址
   * @param {Array} trades - 交易数据数组
   * @returns {Object} 持仓分析结果
   */
  analyzeFromTrades(tokenAddress, trades) {
    if (!trades || trades.length === 0) {
      return {
        ...this.getEmptyFactorValues(),
        _meta: {
          total_trades_analyzed: 0
        }
      };
    }

    // 分析强势交易者行为
    const analysis = this._analyzeStrongTraders(trades, tokenAddress);

    return {
      ...analysis,
      _meta: {
        total_trades_analyzed: trades.length
      }
    };
  }

  /**
   * 分析强势交易者在指定代币中的持仓情况（通过API获取数据）
   * 注意：此方法会调用API，建议使用 analyzeFromTrades 复用已有数据
   * @param {string} tokenAddress - 代币地址
   * @param {string} pairAddress - 交易对地址
   * @param {number} checkTime - 检查时间戳（购买信号时间）
   * @returns {Promise<Object>} 持仓分析结果
   */
  async analyzePosition(tokenAddress, pairAddress, checkTime) {
    const targetFromTime = checkTime - this.WINDOW_SECONDS;

    // 获取交易数据（循环获取直到覆盖完整窗口）
    const trades = await this._fetchTrades(pairAddress, targetFromTime, checkTime);

    // 分析强势交易者行为
    const analysis = this._analyzeStrongTraders(trades, tokenAddress);

    return {
      ...analysis,
      _meta: {
        window_seconds: this.WINDOW_SECONDS,
        from_time: targetFromTime,
        to_time: checkTime,
        total_trades_analyzed: trades.length
      }
    };
  }

  /**
   * 循环获取交易数据，确保覆盖完整时间窗口
   * @private
   */
  async _fetchTrades(pairAddress, fromTime, toTime) {
    const allTrades = [];
    let currentToTime = toTime;
    const maxLoops = 10;

    for (let i = 0; i < maxLoops; i++) {
      try {
        const trades = await this.txApi.getSwapTransactions(
          `${pairAddress}-bsc`,
          300,
          fromTime,
          currentToTime,
          'asc'
        );

        if (!trades || trades.length === 0) break;

        allTrades.push(...trades);

        const batchFirstTime = trades[0].time;

        // 检查是否已覆盖到目标起始时间
        if (batchFirstTime <= fromTime) {
          break;
        }

        // 如果返回了300条数据，可能还有更早的数据
        if (trades.length === 300) {
          currentToTime = batchFirstTime - 1;
        } else {
          break;
        }
      } catch (error) {
        console.error(`StrongTraderPositionService: Fetch error (loop ${i}):`, error.message);
        break;
      }
    }

    return this._deduplicateTrades(allTrades);
  }

  /**
   * 分析强势交易者的买卖行为
   * @private
   */
  _analyzeStrongTraders(trades, tokenAddress) {
    let buyAmount = 0;
    let sellAmount = 0;
    let tradeCount = 0;
    const wallets = new Set();

    const tokenAddressLower = tokenAddress.toLowerCase();

    for (const trade of trades) {
      // 获取钱包地址
      const wallet = trade.wallet_address?.toLowerCase() ||
                     trade.from_address?.toLowerCase();

      if (!wallet) continue;

      // 检查是否是强势交易者
      if (!STRONG_TRADERS.has(wallet)) continue;

      const toToken = trade.to_token?.toLowerCase();
      const fromToken = trade.from_token?.toLowerCase();

      const isBuy = toToken === tokenAddressLower;
      const isSell = fromToken === tokenAddressLower;

      if (isBuy) {
        const amount = parseFloat(trade.to_amount) || 0;
        buyAmount += amount;
        wallets.add(wallet);
        tradeCount++;
      }

      if (isSell) {
        const amount = parseFloat(trade.from_amount) || 0;
        sellAmount += amount;
        wallets.add(wallet);
        tradeCount++;
      }
    }

    const netAmount = Math.abs(buyAmount - sellAmount);
    const totalVolume = buyAmount + sellAmount;

    return {
      // 核心因子：净持仓比例（最强负相关）
      strongTraderNetPositionRatio: (netAmount / this.TOTAL_SUPPLY * 100),
      // 辅助因子
      strongTraderTotalBuyRatio: (buyAmount / this.TOTAL_SUPPLY * 100),
      strongTraderTotalSellRatio: (sellAmount / this.TOTAL_SUPPLY * 100),
      strongTraderWalletCount: wallets.size,
      strongTraderTradeCount: tradeCount,
      strongTraderSellIntensity: totalVolume > 0 ? (sellAmount / totalVolume) : 0,
      // 原始数据（供调试）
      _raw: {
        buy_amount: buyAmount,
        sell_amount: sellAmount,
        net_amount: buyAmount - sellAmount,
        wallets: Array.from(wallets)
      }
    };
  }

  /**
   * 去重交易数据
   * @private
   */
  _deduplicateTrades(trades) {
    if (!trades || trades.length === 0) return [];

    const seen = new Set();
    const unique = [];

    // 先按时间排序
    const sorted = trades.sort((a, b) => a.time - b.time);

    for (const trade of sorted) {
      // 使用tx_id或时间+from_address作为唯一标识
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(trade);
      }
    }

    return unique;
  }

  /**
   * 获取空因子值（用于初始化）
   */
  getEmptyFactorValues() {
    return {
      strongTraderNetPositionRatio: 0,
      strongTraderTotalBuyRatio: 0,
      strongTraderTotalSellRatio: 0,
      strongTraderWalletCount: 0,
      strongTraderTradeCount: 0,
      strongTraderSellIntensity: 0
    };
  }
}

module.exports = StrongTraderPositionService;
