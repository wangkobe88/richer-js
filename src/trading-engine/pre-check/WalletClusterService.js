/**
 * 钱包簇分析服务
 *
 * 检测拉砸代币的"钱包簇"特征：
 * - 拉砸代币：少数大型簇，第2簇远小于第1簇
 * - 非拉砸代币：多个小簇，簇大小分布更均匀
 *
 * 核心特征：
 * 1. secondToFirstRatio - 第2簇/第1簇比值（拉砸 < 0.3）
 * 2. megaClusterRatio - 超大簇占比（>100笔）
 * 3. top2ClusterRatio - 前2簇占比
 */

class WalletClusterService {
  /**
   * @param {Object} logger - Logger实例
   */
  constructor(logger) {
    this.logger = logger;
    // 固定配置
    this.clusterThresholdSeconds = 2;
    this.megaClusterThreshold = 100;
  }

  /**
   * 执行钱包簇分析
   * @param {Array} trades - 早期交易数据（必须按时间升序排列）
   * @returns {Object} 分析结果
   */
  performClusterAnalysis(trades) {
    const startTime = Date.now();

    this.logger.debug('[WalletClusterService] 开始钱包簇分析', {
      trades_count: trades?.length || 0
    });

    if (!trades || trades.length === 0) {
      return this._getEmptyResult();
    }

    // 1. 识别交易簇
    const clusters = this._detectClusters(trades, this.clusterThresholdSeconds);

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
    const megaClusters = clusterSizes.filter(s => s >= this.megaClusterThreshold);
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

    const result = {
      // 基础信息
      walletClusterThreshold: this.clusterThresholdSeconds,

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

      // 最大簇钱包集中度
      walletClusterMaxClusterWallets: walletStats.maxClusterWallets,

      // 簇间时间间隔
      walletClusterIntervalMean: clusterIntervals.length > 0
        ? clusterIntervals.reduce((a, b) => a + b, 0) / clusterIntervals.length
        : null
    };

    this.logger.debug('[WalletClusterService] 钱包簇分析完成', {
      cluster_count: result.walletClusterCount,
      max_cluster_size: result.walletClusterMaxSize,
      second_to_first_ratio: result.walletClusterSecondToFirstRatio,
      mega_cluster_ratio: result.walletClusterMegaRatio,
      is_pump_dump: isPumpDump
    });

    return result;
  }

  /**
   * 识别交易簇（修复版）
   * 使用固定时间窗口：每笔交易与簇首笔的时间间隔不超过阈值
   * @private
   */
  _detectClusters(trades, thresholdSecs) {
    if (!trades || trades.length === 0) return [];

    const clusters = [];
    let clusterStartIdx = 0;  // 当前簇的首笔交易索引

    for (let i = 1; i <= trades.length; i++) {
      // 检查是否应该结束当前簇：
      // 1. 到达数组末尾，或
      // 2. 当前交易与簇首笔的时间间隔超过阈值
      if (i === trades.length ||
          (trades[i].time - trades[clusterStartIdx].time) > thresholdSecs) {
        // 结束当前簇，添加 [clusterStartIdx, i) 的所有交易
        const clusterSize = i - clusterStartIdx;
        const cluster = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
        clusters.push(cluster);
        // 开始新簇
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
   * 获取空结果
   * @private
   */
  _getEmptyResult() {
    return {
      walletClusterThreshold: this.clusterThresholdSeconds,

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondSize: 0,
      walletClusterAvgSize: 0,
      walletClusterMinSize: 0,

      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaCount: 0,
      walletClusterMegaRatio: 0,

      walletClusterMaxClusterWallets: 0,

      walletClusterIntervalMean: null
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      walletClusterThreshold: null,

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondSize: 0,
      walletClusterAvgSize: 0,
      walletClusterMinSize: 0,

      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaCount: 0,
      walletClusterMegaRatio: 0,

      walletClusterMaxClusterWallets: 0,

      walletClusterIntervalMean: null
    };
  }
}

module.exports = { WalletClusterService };
