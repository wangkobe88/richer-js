/**
 * 实验统计数据服务
 * 用于计算和存储实验的统计数据
 */

const { dbManager } = require('../../services/dbManager');

class ExperimentStatsService {
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 计算单个实验的统计数据
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 统计数据
   */
  async calculateExperimentStats(experimentId) {
    try {
      // 获取交易数据
      const tradesData = await this.getTrades(experimentId);

      if (!tradesData || tradesData.length === 0) {
        return {
          tokenCount: 0,
          profitCount: 0,
          lossCount: 0,
          winRate: 0,
          totalReturn: 0,
          bnbChange: 0,
          totalSpent: 0,
          totalReceived: 0
        };
      }

      // 获取所有有交易的代币
      const tokenAddresses = [...new Set(tradesData.map(t => t.token_address))];

      // 计算每个代币的盈亏
      const tokenReturns = tokenAddresses.map(tokenAddress => {
        return this.calculateTokenPnL(tokenAddress, tradesData);
      }).filter(pnl => pnl !== null);

      // 计算统计数据
      const stats = this.calculateStatsFromReturns(tokenReturns);

      return {
        tokenCount: stats.totalTokens,
        profitCount: stats.profitCount,
        lossCount: stats.lossCount,
        winRate: stats.winRate,
        totalReturn: stats.totalReturn,
        bnbChange: stats.bnbChange,
        totalSpent: stats.totalSpent,
        totalReceived: stats.totalReceived,
        calculatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`计算实验统计数据失败 ${experimentId}:`, error);
      throw error;
    }
  }

  /**
   * 获取实验的交易数据
   */
  async getTrades(experimentId) {
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    let allData = [];

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', experimentId)
        .range(offset, offset + pageSize - 1)
        .order('created_at', { ascending: true });

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST116') {
          return []; // 表不存在
        }
        throw new Error(`查询交易数据失败: ${error.message}`);
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        offset += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    return allData;
  }

  /**
   * 计算单个代币的盈亏（复用交易页面的计算方法）
   */
  calculateTokenPnL(tokenAddress, tradesData) {
    // 获取该代币的所有成功交易，按时间排序
    const tokenTrades = tradesData
      .filter(t => t.token_address === tokenAddress && (t.status === 'success' || t.trade_status === 'success'))
      .sort((a, b) => new Date(a.created_at || a.executed_at) - new Date(b.created_at || b.executed_at));

    if (tokenTrades.length === 0) {
      return null;
    }

    // FIFO 队列跟踪买入成本
    const buyQueue = [];
    let totalBNBSpent = 0;
    let totalBNBReceived = 0;

    tokenTrades.forEach(trade => {
      const direction = trade.trade_direction || trade.direction || trade.action;
      const isBuy = direction === 'buy' || direction === 'BUY';

      if (isBuy) {
        const inputAmount = parseFloat(trade.input_amount || 0);
        const outputAmount = parseFloat(trade.output_amount || 0);
        const unitPrice = parseFloat(trade.unit_price || 0);

        if (outputAmount > 0) {
          buyQueue.push({
            amount: outputAmount,
            cost: inputAmount,
            price: unitPrice
          });
          totalBNBSpent += inputAmount;
        }
      } else {
        const inputAmount = parseFloat(trade.input_amount || 0);
        const outputAmount = parseFloat(trade.output_amount || 0);

        let remainingToSell = inputAmount;
        let costOfSold = 0;

        while (remainingToSell > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const sellAmount = Math.min(remainingToSell, oldestBuy.amount);

          const unitCost = oldestBuy.cost / oldestBuy.amount;
          costOfSold += unitCost * sellAmount;
          remainingToSell -= sellAmount;

          oldestBuy.amount -= sellAmount;
          oldestBuy.cost -= unitCost * sellAmount;

          if (oldestBuy.amount <= 0.00000001) {
            buyQueue.shift();
          }
        }

        totalBNBReceived += outputAmount;
      }
    });

    // 计算剩余持仓成本
    let remainingCost = 0;
    buyQueue.forEach(buy => {
      remainingCost += buy.cost;
    });

    // 计算收益率
    const totalCost = totalBNBSpent || 1;
    const totalValue = totalBNBReceived + remainingCost;
    const returnRate = ((totalValue - totalCost) / totalCost) * 100;

    return {
      returnRate,
      totalSpent: totalBNBSpent,
      totalReceived: totalBNBReceived,
      remainingCost
    };
  }

  /**
   * 从代币收益计算统计数据
   */
  calculateStatsFromReturns(tokenReturns) {
    const totalTokens = tokenReturns.length;
    const profitCount = tokenReturns.filter(t => t.returnRate > 0).length;
    const lossCount = tokenReturns.filter(t => t.returnRate < 0).length;
    const winRate = totalTokens > 0 ? (profitCount / totalTokens * 100) : 0;

    let totalSpent = 0;
    let totalReceived = 0;
    tokenReturns.forEach(t => {
      totalSpent += t.totalSpent;
      totalReceived += t.totalReceived + t.remainingCost;
    });

    const totalReturn = totalSpent > 0 ? ((totalReceived - totalSpent) / totalSpent * 100) : 0;
    const bnbChange = totalReceived - totalSpent;

    return {
      totalTokens,
      profitCount,
      lossCount,
      winRate,
      totalReturn,
      bnbChange,
      totalSpent,
      totalReceived
    };
  }
}

module.exports = { ExperimentStatsService };
