/**
 * 钱包簇分析服务
 *
 * 检测拉砸代币的"钱包簇"特征：
 * - 拉砸代币：少数大型簇，第2簇远小于第1簇
 * - 非拉砸代币：多个小簇，簇大小分布更均匀
 *
 * 🔥 改进：使用区块号进行聚簇，精度更高
 * - 相邻交易区块间隔≤1则归为同一簇
 * - 无回退机制，数据异常时返回空结果
 *
 * 核心特征：
 * 1. secondToFirstRatio - 第2簇/第1簇比值（拉砸 < 0.3）
 * 2. megaClusterRatio - 超大簇占比（>平均簇大小×2）
 * 3. top2ClusterRatio - 前2簇占比
 */

class WalletClusterService {
  /**
   * @param {Object} logger - Logger实例
   */
  constructor(logger) {
    this.logger = logger;
    // 🔥 使用区块号进行聚簇，无回退机制
    this.clusterBlockThreshold = 1;  // 区块间隔阈值（推荐值）
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
      clustering_method: 'block',
      block_threshold: this.clusterBlockThreshold
    });

    if (!trades || trades.length === 0) {
      return this._getEmptyResult();
    }

    // 1. 验证区块号可用性
    if (trades.length > 0 && (trades[0].block_number === undefined || trades[0].block_number === null)) {
      this.logger.warn('[WalletClusterService] 缺少区块号数据，无法进行聚簇分析', {
        trades_count: trades.length
      });
      return this._getEmptyResult();
    }

    // 2. 识别交易簇（使用区块号）
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

    // 计算最大簇占比（新增：用于检测超级簇）
    const maxClusterRatio = trades.length > 0
      ? (sortedSizes[0] || 0) / trades.length
      : 0;

    const result = {
      // 元数据
      walletClusterBlockThreshold: this.clusterBlockThreshold,
      walletClusterMethod: 'block',

      // 核心因子
      walletClusterCount: clusters.length,
      walletClusterMaxSize: sortedSizes[0] || 0,
      walletClusterSecondToFirstRatio: secondToFirstRatio,
      walletClusterTop2Ratio: top2ClusterRatio,
      walletClusterMegaRatio: megaClusterTradeCount / trades.length,

      // 辅助因子
      walletClusterMaxClusterWallets: walletStats.maxClusterWallets
    };

    this.logger.debug('[WalletClusterService] 钱包簇分析完成', {
      cluster_count: result.walletClusterCount,
      max_cluster_size: result.walletClusterMaxSize,
      second_to_first_ratio: result.walletClusterSecondToFirstRatio,
      mega_cluster_ratio: result.walletClusterMegaRatio,
      clustering_method: result.walletClusterMethod,
      block_threshold: `${result.walletClusterBlockThreshold} blocks`,
      is_pump_dump: isPumpDump
    });

    return result;
  }

  /**
   * 识别交易簇（基于区块号）
   * 相邻交易区块间隔不超过阈值则归为同一簇
   * @private
   */
  _detectClusters(trades) {
    if (!trades || trades.length === 0) return [];

    const clusters = [];
    let clusterStartIdx = 0;

    for (let i = 1; i <= trades.length; i++) {
      // 使用区块号判断簇边界
      const currentBlock = trades[i]?.block_number || null;
      const prevBlock = trades[i - 1]?.block_number || null;

      let shouldEndCluster = i === trades.length;

      if (currentBlock !== null && prevBlock !== null && currentBlock > 0 && prevBlock > 0) {
        // 使用区块号：区块间隔超过阈值则结束簇
        const blockGap = currentBlock - prevBlock;
        shouldEndCluster = shouldEndCluster || blockGap > this.clusterBlockThreshold;
      } else {
        // 区块号缺失，无法继续聚簇
        shouldEndCluster = true;
      }

      if (shouldEndCluster) {
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
   * 获取空结果
   * @private
   */
  _getEmptyResult() {
    return {
      walletClusterBlockThreshold: this.clusterBlockThreshold,
      walletClusterMethod: 'block',

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaRatio: 0,
      walletClusterMaxClusterWallets: 0
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      walletClusterBlockThreshold: null,
      walletClusterMethod: null,

      walletClusterCount: 0,
      walletClusterMaxSize: 0,
      walletClusterSecondToFirstRatio: 0,
      walletClusterTop2Ratio: 0,
      walletClusterMegaRatio: 0,
      walletClusterMaxClusterWallets: 0
    };
  }
}

module.exports = { WalletClusterService };
