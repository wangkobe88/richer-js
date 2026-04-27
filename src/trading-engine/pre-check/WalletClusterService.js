/**
 * 钱包簇分析服务
 *
 * 检测拉砸代币的"钱包簇"特征：
 * - 拉砸代币：少数大型簇，第2簇远小于第1簇
 * - 非拉砸代币：多个小簇，簇大小分布更均匀
 *
 * 支持两种聚簇方法（通过配置选择）：
 * - time: 时间戳聚簇（2秒阈值）- 精度较低
 * - block: 区块号聚簇（7区块阈值）- 精度更高，推荐使用
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
   * @param {Object} config - 配置对象
   * @param {string} config.mode - 'time' 或 'block'
   * @param {number} config.clusterBlockThreshold - 区块号阈值
   */
  constructor(logger, config = {}) {
    this.logger = logger;

    // 支持两种模式：time（时间戳聚簇）或 block（区块号聚簇）
    // 默认使用区块号聚簇，因为更准确
    const mode = config.mode || 'block';

    if (mode === 'time') {
      // 兼容旧配置：时间戳聚簇
      this.clusterBlockThreshold = config.clusterBlockThreshold || 2;
      this.clusterMethod = 'time';
    } else {
      // 新配置：区块号聚簇（默认，阈值=7）
      this.clusterBlockThreshold = config.clusterBlockThreshold || 7;
      this.clusterMethod = 'block';
    }
  }

  /**
   * 执行钱包簇分析
   * @param {Array} trades - 早期交易数据（必须按时间升序排列）
   * @param {string} tokenAddress - 代币地址（用于区分买入/卖出）
   * @returns {Object} 分析结果
   */
  performClusterAnalysis(trades, tokenAddress = null) {
    const startTime = Date.now();

    this.logger.debug('[WalletClusterService] 开始钱包簇分析', {
      trades_count: trades?.length || 0,
      clustering_method: this.clusterMethod,
      threshold: this.clusterBlockThreshold + ' blocks'
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

    // 计算第二簇与第一簇的比例
    // - 当有2个或更多簇时：第二簇大小 / 第一簇大小
    // - 当只有1个簇时：设为1，表示所有交易集中在一个簇（100%集中）
    const secondToFirstRatio = sortedSizes.length >= 2
      ? sortedSizes[1] / sortedSizes[0]
      : 1;

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
    const blockBuyStats = this._calculateBlockBuyStats(trades, tokenAddress);

    const result = {
      // 基础信息
      walletClusterThreshold: this.clusterBlockThreshold,
      walletClusterMethod: this.clusterMethod,
      walletClusterBlockThreshold: this.clusterBlockThreshold,

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
      walletClusterMaxBlockBuyAmount: blockBuyStats.maxBlockBuyTokenAmount
    };

    this.logger.debug('[WalletClusterService] 钱包簇分析完成', {
      cluster_count: result.walletClusterCount,
      max_cluster_size: result.walletClusterMaxSize,
      second_to_first_ratio: result.walletClusterSecondToFirstRatio,
      mega_cluster_ratio: result.walletClusterMegaRatio,
      clustering_method: result.walletClusterMethod,
      threshold: result.walletClusterThreshold + ' blocks',
      is_pump_dump: isPumpDump,
      max_block_buy_ratio: result.walletClusterMaxBlockBuyRatio,
      max_block_number: result.walletClusterMaxBlockNumber
    });

    return result;
  }

  /**
   * 识别交易簇
   * 根据配置使用时间戳或区块号进行聚簇
   * @private
   */
  _detectClusters(trades) {
    if (!trades || trades.length === 0) return [];

    const clusters = [];
    let clusterStartIdx = 0;

    for (let i = 1; i <= trades.length; i++) {
      let shouldSplit = false;

      if (this.clusterMethod === 'time') {
        // 时间戳聚簇
        const timeGap = (i < trades.length && trades[i].time && trades[i - 1].time)
          ? trades[i].time - trades[i - 1].time
          : (this.clusterBlockThreshold + 1);
        shouldSplit = (i === trades.length || timeGap > this.clusterBlockThreshold);
      } else {
        // 区块号聚簇
        const blockGap = (i < trades.length && trades[i].block_number && trades[i - 1].block_number)
          ? trades[i].block_number - trades[i - 1].block_number
          : (this.clusterBlockThreshold + 1);
        shouldSplit = (i === trades.length || blockGap > this.clusterBlockThreshold);
      }

      if (shouldSplit) {
        const clusterSize = i - clusterStartIdx;
        const cluster = Array.from({ length: clusterSize }, (_, k) => clusterStartIdx + k);
        clusters.push(cluster);
        clusterStartIdx = i;
      }
    }

    return clusters;
  }

  /**
   * 计算簇间间隔
   * @private
   */
  _calculateClusterIntervals(trades, clusters) {
    const intervals = [];

    for (let i = 1; i < clusters.length; i++) {
      const prevClusterLastIdx = clusters[i - 1][clusters[i - 1].length - 1];
      const currClusterFirstIdx = clusters[i][0];

      if (this.clusterMethod === 'time') {
        const interval = trades[currClusterFirstIdx].time - trades[prevClusterLastIdx].time;
        intervals.push(interval);
      } else {
        const prevBlock = trades[prevClusterLastIdx].block_number;
        const currBlock = trades[currClusterFirstIdx].block_number;
        const interval = (currBlock && prevBlock) ? (currBlock - prevBlock) : null;
        if (interval !== null) {
          intervals.push(interval);
        }
      }
    }

    return intervals;
  }

  /**
   * 计算钱包统计
   * @private
   */
  _calculateWalletStats(trades, clusters) {
    // 总钱包数（使用 wallet_address 识别真实用户，from_address 可能是路由合约）
    const allWallets = new Set();
    trades.forEach(t => {
      const participant = t.wallet_address || t.from_address;
      if (participant) allWallets.add(participant.toLowerCase());
    });

    // 最大簇的钱包数
    const clusterSizes = clusters.map(c => c.length);
    const maxClusterIdx = clusterSizes.indexOf(Math.max(...clusterSizes));

    const maxClusterWallets = new Set();
    clusters[maxClusterIdx].forEach(idx => {
      const t = trades[idx];
      const participant = t.wallet_address || t.from_address;
      if (participant) maxClusterWallets.add(participant.toLowerCase());
    });

    return {
      totalWallets: allWallets.size,
      maxClusterWallets: maxClusterWallets.size
    };
  }

  /**
   * 计算区块内连续购买代币数量统计
   * 检测单个区块内连续购买操作拿了多少比例的代币
   * @private
   * @param {Array} trades - 交易数据
   * @param {string} tokenAddress - 代币地址（用于区分买入/卖出）
   * @returns {Object} 区块购买统计
   */
  _calculateBlockBuyStats(trades, tokenAddress) {
    if (!trades || trades.length === 0 || !tokenAddress) {
      return {
        maxBlockBuyRatio: 0,
        maxBlockNumber: null,
        maxBlockBuyTokenAmount: 0
      };
    }

    const tokenAddressLower = tokenAddress.toLowerCase();

    // 1. 按区块分组
    const blockGroups = new Map();
    trades.forEach(t => {
      const block = t.block_number;
      if (block == null) return;

      if (!blockGroups.has(block)) {
        blockGroups.set(block, []);
      }
      blockGroups.get(block).push(t);
    });

    // 2. 遍历每个区块，找出最大连续购买簇
    let maxClusterAmount = 0;
    let maxBlockNumber = null;

    for (const [blockNumber, blockTrades] of blockGroups.entries()) {
      const clusterAmount = this._findMaxContinuousBuyCluster(blockTrades, tokenAddressLower);
      if (clusterAmount > maxClusterAmount) {
        maxClusterAmount = clusterAmount;
        maxBlockNumber = blockNumber;
      }
    }

    // 3. 计算比例（代币总供应量为10亿）
    const TOTAL_SUPPLY = 1_000_000_000;
    const maxBlockBuyRatio = maxClusterAmount / TOTAL_SUPPLY;

    return {
      maxBlockBuyRatio: parseFloat(maxBlockBuyRatio.toFixed(6)),
      maxBlockNumber: maxBlockNumber,
      maxBlockBuyTokenAmount: parseFloat(maxClusterAmount.toFixed(2))
    };
  }

  /**
   * 找出单个区块内最大的连续购买簇的代币数量
   * 连续购买：遇到卖出则打断，忽略非买卖交易
   * @private
   * @param {Array} blockTrades - 同一区块内的交易
   * @param {string} tokenAddressLower - 代币地址（小写）
   * @returns {number} 最大连续购买簇的代币数量
   */
  _findMaxContinuousBuyCluster(blockTrades, tokenAddressLower) {
    let maxAmount = 0;
    let currentAmount = 0;

    // 按时间排序
    const sortedTrades = [...blockTrades].sort((a, b) => (a.time || 0) - (b.time || 0));

    for (const trade of sortedTrades) {
      const toToken = (trade.to_token || '').toLowerCase();
      const fromToken = (trade.from_token || '').toLowerCase();
      const toAmount = trade.to_amount || 0;

      const isBuy = toToken === tokenAddressLower;
      const isSell = fromToken === tokenAddressLower;

      if (isBuy) {
        // 买入，累计代币数量
        currentAmount += toAmount;
      } else if (isSell) {
        // 卖出，记录当前簇并重置
        maxAmount = Math.max(maxAmount, currentAmount);
        currentAmount = 0;
      }
      // 既不是买入也不是卖出（如添加流动性），忽略，不打断连续购买
    }

    // 处理最后一个簇
    maxAmount = Math.max(maxAmount, currentAmount);

    return maxAmount;
  }

  /**
   * 获取空结果
   * @private
   */
  _getEmptyResult() {
    return {
      walletClusterThreshold: this.clusterBlockThreshold,
      walletClusterMethod: this.clusterMethod,
      walletClusterBlockThreshold: this.clusterBlockThreshold,

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
      walletClusterMaxBlockBuyAmount: 0
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

      // 钱包累积集中度因子（与 EarlyParticipantCheckService 保持一致）
      earlyTradesTop1BuyRatio: 0,
      earlyTradesTop3BuyRatio: 0,
      earlyTradesTop1NetHoldingRatio: 0
    };
  }
}

module.exports = { WalletClusterService };
