/**
 * 钱包簇分析服务
 *
 * 检测拉砸代币的"钱包簇"特征：
 * - 拉砸代币：少数大型簇，第2簇远小于第1簇
 * - 非拉砸代币：多个小簇，簇大小分布更均匀
 *
 * 支持两种聚簇方法（通过配置选择）：
 * - time: 时间戳聚簇（2秒阈值）- 已验证有效，81.8%拉砸拒绝率
 * - block: 区块号聚簇（1区块阈值）- 精度更高，但需重新优化阈值
 *
 * 核心特征：
 * 1. secondToFirstRatio - 第2簇/第1簇比值（拉砸 < 0.3）
 * 2. megaClusterRatio - 超大簇占比（>平均簇大小×2）
 * 3. top2ClusterRatio - 前2簇占比
 * 4. maxBlockBuyRatio - 最大区块买入金额占比（检测第一区块集中购买）
 */

class WalletClusterService {
  /**
   * @param {Object} logger - Logger实例
   */
  constructor(logger) {
    this.logger = logger;
    // 使用时间戳聚簇（2秒阈值）
    this.clusterTimeThreshold = 2;
  }

  /**
   * 执行钱包簇分析
   * @param {Array} trades - 早期交易数据（必须按时间升序排列）
   * @returns {Object} 分析结果
   */
  performClusterAnalysis(trades) {
    const startTime = Date.now();

    this.logger.debug('[WalletClusterService] 开始钱包簇分析', {
      trades_count: trades?.length || 0,
      clustering_method: 'time',
      threshold: this.clusterTimeThreshold + ' seconds'
    });

    if (!trades || trades.length === 0) {
      return this._getEmptyResult();
    }

    // 1. 识别交易簇（使用时间戳）
    const clusters = this._detectClusters(trades);

    if (clusters.length === 0) {
      return this._getEmptyResult();
    }

    // 2. 计算基础统计
    const clusterSizes = clusters.map(c => c.length);
    const sortedSizes = [...clusterSizes].sort((a, b) => b - a);

    // 3. 计算簇间时间间隔
    const clusterIntervals = this._calculateClusterIntervals(trades, clusters);

    // 4. 计算钱包数
    const walletStats = this._calculateWalletStats(trades, clusters);

    // 5. 计算核心特征
    // 动态计算megaCluster阈值：平均簇大小的2倍，且至少为5
    const avgClusterSize = clusterSizes.reduce((a, b) => a + b, 0) / clusters.length;
    const megaClusterThreshold = Math.max(5, Math.floor(avgClusterSize * 2));

    const megaClusters = clusterSizes.filter(s => s >= megaClusterThreshold);
    const megaClusterTradeCount = megaClusters.reduce((sum, s) => sum + s, 0);

    const secondToFirstRatio = sortedSizes.length >= 2
      ? sortedSizes[1] / sortedSizes[0]
      : 0;

    const top2ClusterRatio = sortedSizes.length >= 2
      ? (sortedSizes[0] + sortedSizes[1]) / trades.length
      : sortedSizes[0] / trades.length;

    // 6. 判断是否为拉砸代币（仅用于日志）
    const isPumpDump =
      secondToFirstRatio < 0.3 ||
      (megaClusterTradeCount / trades.length) > 0.4;

    // 计算最大簇占比（新增：用于检测超级簇拉砸）
    const maxClusterRatio = trades.length > 0
      ? (sortedSizes[0] || 0) / trades.length
      : 0;

    // 7. 计算最大区块买入金额占比（检测第一区块集中购买）
    const blockBuyStats = this._calculateBlockBuyStats(trades);

    const result = {
      // 基础信息
      walletClusterThreshold: this.clusterTimeThreshold,
      walletClusterMethod: 'time',

      // 簇数量
      walletClusterCount: clusters.length,

      // 簇规模
      walletClusterMaxSize: sortedSizes[0] || 0,
      walletClusterSecondSize: sortedSizes[1] || 0,
      walletClusterAvgSize: clusterSizes.reduce((a, b) => a + b, 0) / clusters.length,
      walletClusterMinSize: Math.min(...clusterSizes),

      // 核心特征（原始数据，不包含判断结论）
      walletClusterSecondToFirstRatio: secondToFirstRatio,
      walletClusterTop2Ratio: top2ClusterRatio,
      walletClusterMegaCount: megaClusters.length,
      walletClusterMegaRatio: megaClusterTradeCount / trades.length,

      // 最大簇占比（用于检测超级簇拉砸）
      walletClusterMaxClusterRatio: maxClusterRatio,

      // 最大簇钱包集中度
      walletClusterMaxClusterWallets: walletStats.maxClusterWallets,

      // 簇间时间间隔
      walletClusterIntervalMean: clusterIntervals.length > 0
        ? clusterIntervals.reduce((a, b) => a + b, 0) / clusterIntervals.length
        : null,

      // 最大区块买入金额占比（检测第一区块集中购买）
      walletClusterMaxBlockBuyRatio: blockBuyStats.maxBlockBuyRatio,
      walletClusterMaxBlockNumber: blockBuyStats.maxBlockNumber,
      walletClusterMaxBlockBuyAmount: blockBuyStats.maxBlockBuyAmount,
      walletClusterTotalBuyAmount: blockBuyStats.totalBuyAmount
    };

    this.logger.debug('[WalletClusterService] 钱包簇分析完成', {
      cluster_count: result.walletClusterCount,
      max_cluster_size: result.walletClusterMaxSize,
      second_to_first_ratio: result.walletClusterSecondToFirstRatio,
      mega_cluster_ratio: result.walletClusterMegaRatio,
      clustering_method: result.walletClusterMethod,
      threshold: result.walletClusterThreshold + ' seconds',
      is_pump_dump: isPumpDump,
      max_block_buy_ratio: result.walletClusterMaxBlockBuyRatio,
      max_block_number: result.walletClusterMaxBlockNumber
    });

    return result;
  }

  /**
   * 识别交易簇（基于时间戳）
   * 相邻交易时间间隔不超过阈值则归为同一簇
   * @private
   */
  _detectClusters(trades) {
    if (!trades || trades.length === 0) return [];

    const clusters = [];
    let clusterStartIdx = 0;

    for (let i = 1; i <= trades.length; i++) {
      if (i === trades.length || (trades[i].time - trades[i - 1].time) > this.clusterTimeThreshold) {
        const clusterSize = i - clusterStartIdx;
        const cluster = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
        clusters.push(cluster);
        clusterStartIdx = i;
      }
    }

    return clusters;
  }

  /**
   * 计算簇间时间间隔
   * @private
   */
  _calculateClusterIntervals(trades, clusters) {
    const intervals = [];

    for (let i = 1; i < clusters.length; i++) {
      const prevClusterLastIdx = clusters[i - 1][clusters[i - 1].length - 1];
      const currClusterFirstIdx = clusters[i][0];
      const interval = trades[currClusterFirstIdx].time - trades[prevClusterLastIdx].time;
      intervals.push(interval);
    }

    return intervals;
  }

  /**
   * 计算钱包统计
   * @private
   */
  _calculateWalletStats(trades, clusters) {
    // 总钱包数
    const allWallets = new Set();
    trades.forEach(t => {
      if (t.from_address) allWallets.add(t.from_address.toLowerCase());
      if (t.to_address) allWallets.add(t.to_address.toLowerCase());
    });

    // 最大簇的钱包数
    const clusterSizes = clusters.map(c => c.length);
    const maxClusterIdx = clusterSizes.indexOf(Math.max(...clusterSizes));

    const maxClusterWallets = new Set();
    clusters[maxClusterIdx].forEach(idx => {
      const t = trades[idx];
      if (t.from_address) maxClusterWallets.add(t.from_address.toLowerCase());
      if (t.to_address) maxClusterWallets.add(t.to_address.toLowerCase());
    });

    return {
      totalWallets: allWallets.size,
      maxClusterWallets: maxClusterWallets.size
    };
  }

  /**
   * 计算区块买入金额统计
   * 检测第一区块集中购买模式（类似Dev持仓比例）
   * @private
   */
  _calculateBlockBuyStats(trades) {
    // 按区块分组，只计算买入金额（from_usd）
    const blockBuyAmounts = {};
    let totalBuyAmount = 0;

    trades.forEach(t => {
      const buyAmount = t.from_usd || 0; // 只计算买入
      const block = t.block_number;

      if (!blockBuyAmounts[block]) {
        blockBuyAmounts[block] = 0;
      }
      blockBuyAmounts[block] += buyAmount;
      totalBuyAmount += buyAmount;
    });

    // 找出买入金额最大的区块
    let maxBlockBuyAmount = 0;
    let maxBlockNumber = null;

    for (const [block, amount] of Object.entries(blockBuyAmounts)) {
      if (amount > maxBlockBuyAmount) {
        maxBlockBuyAmount = amount;
        maxBlockNumber = block;
      }
    }

    // 计算最大区块买入金额占比
    const maxBlockBuyRatio = totalBuyAmount > 0 ? maxBlockBuyAmount / totalBuyAmount : 0;

    return {
      maxBlockBuyRatio: parseFloat(maxBlockBuyRatio.toFixed(4)),
      maxBlockNumber: maxBlockNumber ? parseInt(maxBlockNumber) : null,
      maxBlockBuyAmount: parseFloat(maxBlockBuyAmount.toFixed(2)),
      totalBuyAmount: parseFloat(totalBuyAmount.toFixed(2))
    };
  }

  /**
   * 获取空结果
   * @private
   */
  _getEmptyResult() {
    return {
      walletClusterThreshold: this.clusterTimeThreshold,
      walletClusterMethod: 'time',

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondSize: 0,
      walletClusterAvgSize: 0,
      walletClusterMinSize: 0,

      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaCount: 0,
      walletClusterMegaRatio: 0,

      walletClusterMaxClusterRatio: 0,

      walletClusterMaxClusterWallets: 0,

      walletClusterIntervalMean: null,

      walletClusterMaxBlockBuyRatio: 0,
      walletClusterMaxBlockNumber: null,
      walletClusterMaxBlockBuyAmount: 0,
      walletClusterTotalBuyAmount: 0
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      walletClusterThreshold: null,
      walletClusterMethod: null,

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondSize: 0,
      walletClusterAvgSize: 0,
      walletClusterMinSize: 0,

      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaCount: 0,
      walletClusterMegaRatio: 0,

      walletClusterMaxClusterRatio: 0,

      walletClusterMaxClusterWallets: 0,

      walletClusterIntervalMean: null,

      walletClusterMaxBlockBuyRatio: 0,
      walletClusterMaxBlockNumber: null,
      walletClusterMaxBlockBuyAmount: 0,
      walletClusterTotalBuyAmount: 0
    };
  }
}

module.exports = { WalletClusterService };
