/**
 * 钱包集中度分析服务
 *
 * 分析早期交易中钱包的参与分布，检测交易被少数钱包控制的模式：
 * - 高集中度（少数钱包占大部分交易量/次数）→ 可能是操控/拉砸
 * - 高多样性（大量独立钱包均匀参与）→ 自然的市场兴趣
 *
 * 核心指标：
 * 1. walletTop3VolumeRatio - 前3钱包交易量占比
 * 2. walletTop3TradeRatio - 前3钱包交易次数占比
 * 3. walletDiversityIndex - 钱包多样性指数
 * 4. oneShotBuyerRatio - 一次性买家占比（正面信号）
 * 5. maxBlockBuyRatio - 单区块集中买入占比
 */

class WalletClusterService {
  /**
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象（保留兼容，当前不使用）
   */
  constructor(logger, config = {}) {
    this.logger = logger;
  }

  /**
   * 执行钱包集中度分析
   * @param {Array} trades - 早期交易数据（必须按时间升序排列）
   * @param {string} tokenAddress - 代币地址（用于区分买入/卖出）
   * @returns {Object} 分析结果
   */
  performClusterAnalysis(trades, tokenAddress = null) {
    if (!trades || trades.length === 0) {
      return this._getEmptyResult();
    }

    // 1. 计算钱包集中度
    const concentration = this._calculateWalletConcentration(trades, tokenAddress);

    // 2. 计算单区块集中买入（保留，对 Pump.fun 仍有价值）
    const blockBuyStats = this._calculateBlockBuyStats(trades, tokenAddress);

    const result = {
      // 钱包集中度因子
      walletTop3VolumeRatio: concentration.top3VolumeRatio,
      walletTop1VolumeRatio: concentration.top1VolumeRatio,
      walletTop3TradeRatio: concentration.top3TradeRatio,
      walletTop1TradeRatio: concentration.top1TradeRatio,
      walletDiversityIndex: concentration.diversityIndex,
      oneShotBuyerRatio: concentration.oneShotBuyerRatio,

      // 区块集中买入因子
      maxBlockBuyRatio: blockBuyStats.maxBlockBuyRatio,
      maxBlockNumber: blockBuyStats.maxBlockNumber,
      maxBlockBuyAmount: blockBuyStats.maxBlockBuyTokenAmount,
    };

    this.logger.debug('[WalletClusterService] 钱包集中度分析完成', {
      trades_count: trades.length,
      unique_wallets: concentration.uniqueWallets,
      top3_volume_ratio: concentration.top3VolumeRatio.toFixed(1) + '%',
      top3_trade_ratio: concentration.top3TradeRatio.toFixed(1) + '%',
      diversity_index: concentration.diversityIndex.toFixed(3),
      one_shot_buyer_ratio: concentration.oneShotBuyerRatio.toFixed(1) + '%',
      max_block_buy_ratio: result.maxBlockBuyRatio,
    });

    return result;
  }

  /**
   * 计算钱包集中度指标
   * @private
   */
  _calculateWalletConcentration(trades, tokenAddress) {
    const tokenAddressLower = (tokenAddress || '').toLowerCase();

    // 按钱包汇总交易量和交易次数
    const walletVolume = {};
    const walletTradeCount = {};
    const walletBuyCount = {};

    for (const t of trades) {
      const w = t.wallet_address || t.from_address;
      if (!w) continue;

      walletVolume[w] = (walletVolume[w] || 0) + (t.from_usd || 0);
      walletTradeCount[w] = (walletTradeCount[w] || 0) + 1;

      // 统计买入次数（用于 oneShotBuyer 识别）
      if (tokenAddressLower && (t.to_token || '').toLowerCase() === tokenAddressLower) {
        walletBuyCount[w] = (walletBuyCount[w] || 0) + 1;
      }
    }

    const uniqueWallets = Object.keys(walletTradeCount).length;
    const totalTrades = trades.length;
    const totalVolume = Object.values(walletVolume).reduce((s, v) => s + v, 0);

    if (uniqueWallets === 0 || totalTrades === 0) {
      return {
        top3VolumeRatio: 0, top1VolumeRatio: 0,
        top3TradeRatio: 0, top1TradeRatio: 0,
        diversityIndex: 0, oneShotBuyerRatio: 0,
        uniqueWallets: 0,
      };
    }

    // 交易量排序
    const volSorted = Object.values(walletVolume).sort((a, b) => b - a);
    const top1VolumeRatio = totalVolume > 0 ? (volSorted[0] / totalVolume) * 100 : 0;
    const top3VolumeRatio = totalVolume > 0
      ? (volSorted.slice(0, 3).reduce((s, v) => s + v, 0) / totalVolume) * 100
      : 0;

    // 交易次数排序
    const tradeSorted = Object.values(walletTradeCount).sort((a, b) => b - a);
    const top1TradeRatio = (tradeSorted[0] / totalTrades) * 100;
    const top3TradeRatio = (tradeSorted.slice(0, 3).reduce((s, v) => s + v, 0) / totalTrades) * 100;

    // 多样性指数
    const diversityIndex = uniqueWallets / totalTrades;

    // 一次性买家：只买1次且没有卖出的钱包
    let oneShotBuyers = 0;
    for (const w of Object.keys(walletTradeCount)) {
      const totalTradesForWallet = walletTradeCount[w];
      const buys = walletBuyCount[w] || 0;
      const sells = totalTradesForWallet - buys;
      if (totalTradesForWallet === 1 && buys === 1 && sells === 0) {
        oneShotBuyers++;
      }
    }
    const oneShotBuyerRatio = (oneShotBuyers / uniqueWallets) * 100;

    return {
      top3VolumeRatio: parseFloat(top3VolumeRatio.toFixed(1)),
      top1VolumeRatio: parseFloat(top1VolumeRatio.toFixed(1)),
      top3TradeRatio: parseFloat(top3TradeRatio.toFixed(1)),
      top1TradeRatio: parseFloat(top1TradeRatio.toFixed(1)),
      diversityIndex: parseFloat(diversityIndex.toFixed(4)),
      oneShotBuyerRatio: parseFloat(oneShotBuyerRatio.toFixed(1)),
      uniqueWallets,
    };
  }

  /**
   * 计算区块内连续购买代币数量统计
   * @private
   */
  _calculateBlockBuyStats(trades, tokenAddress) {
    if (!trades || trades.length === 0 || !tokenAddress) {
      return { maxBlockBuyRatio: 0, maxBlockNumber: null, maxBlockBuyTokenAmount: 0 };
    }

    const tokenAddressLower = tokenAddress.toLowerCase();

    // 按区块分组
    const blockGroups = new Map();
    for (const t of trades) {
      const block = t.block_number;
      if (block == null) continue;
      if (!blockGroups.has(block)) blockGroups.set(block, []);
      blockGroups.get(block).push(t);
    }

    // 找出最大连续购买簇
    let maxClusterAmount = 0;
    let maxBlockNumber = null;

    for (const [blockNumber, blockTrades] of blockGroups.entries()) {
      const clusterAmount = this._findMaxContinuousBuyCluster(blockTrades, tokenAddressLower);
      if (clusterAmount > maxClusterAmount) {
        maxClusterAmount = clusterAmount;
        maxBlockNumber = blockNumber;
      }
    }

    // 代币总供应量 10 亿
    const TOTAL_SUPPLY = 1_000_000_000;
    const maxBlockBuyRatio = maxClusterAmount / TOTAL_SUPPLY;

    return {
      maxBlockBuyRatio: parseFloat(maxBlockBuyRatio.toFixed(6)),
      maxBlockNumber: maxBlockNumber,
      maxBlockBuyTokenAmount: parseFloat(maxClusterAmount.toFixed(2)),
    };
  }

  /**
   * 找出单个区块内最大的连续购买簇的代币数量
   * @private
   */
  _findMaxContinuousBuyCluster(blockTrades, tokenAddressLower) {
    let maxAmount = 0;
    let currentAmount = 0;
    const sortedTrades = [...blockTrades].sort((a, b) => (a.time || 0) - (b.time || 0));

    for (const trade of sortedTrades) {
      const toToken = (trade.to_token || '').toLowerCase();
      const fromToken = (trade.from_token || '').toLowerCase();
      const toAmount = trade.to_amount || 0;

      if (toToken === tokenAddressLower) {
        currentAmount += toAmount;
      } else if (fromToken === tokenAddressLower) {
        maxAmount = Math.max(maxAmount, currentAmount);
        currentAmount = 0;
      }
    }
    maxAmount = Math.max(maxAmount, currentAmount);
    return maxAmount;
  }

  /**
   * 获取空结果
   * @private
   */
  _getEmptyResult() {
    return {
      walletTop3VolumeRatio: 0,
      walletTop1VolumeRatio: 0,
      walletTop3TradeRatio: 0,
      walletTop1TradeRatio: 0,
      walletDiversityIndex: 0,
      oneShotBuyerRatio: 0,
      maxBlockBuyRatio: 0,
      maxBlockNumber: null,
      maxBlockBuyAmount: 0,
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      walletTop3VolumeRatio: 0,
      walletTop1VolumeRatio: 0,
      walletTop3TradeRatio: 0,
      walletTop1TradeRatio: 0,
      walletDiversityIndex: 0,
      oneShotBuyerRatio: 0,
      maxBlockBuyRatio: 0,
      maxBlockNumber: null,
      maxBlockBuyAmount: 0,
      // 钱包累积集中度因子（与 EarlyParticipantCheckService 保持一致）
      earlyTradesTop1BuyRatio: 0,
      earlyTradesTop3BuyRatio: 0,
      earlyTradesTop1NetHoldingRatio: 0,
    };
  }
}

module.exports = { WalletClusterService };
