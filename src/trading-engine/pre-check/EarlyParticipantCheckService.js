/**
 * 早期参与者检查服务
 * 获取代币早期交易数据，计算时间标准化的参与者指标
 *
 * 职责：
 * 1. 调用AVE API获取早期交易数据
 * 2. 计算时间窗口标准化的指标
 * 3. 分析增长趋势特征
 */

const config = require('../../../config/default.json');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  maxWindowSeconds: 180,         // 最大检查窗口（3分钟）
  lowValueThreshold: 10,         // 低价值阈值（USD）
  highValueThreshold: 100,       // 高价值阈值（USD）
  calculateGrowthScore: false,   // 是否计算增长评分
  accelerationSegments: 3,       // 加速度计算分段数（已废弃，保留配置兼容性）
  calculateGrowthMetrics: false  // 是否计算增长特征（分析显示无效，默认关闭）
};

class EarlyParticipantCheckService {
  /**
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象
   */
  constructor(logger, config = {}) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.aveTxApi = null;
  }

  /**
   * 获取AVE Tx API实例（延迟初始化）
   * @private
   */
  _getTxApi() {
    if (!this.aveTxApi) {
      const { AveTxAPI } = require('../../core/ave-api');
      const apiKey = process.env.AVE_API_KEY;
      this.aveTxApi = new AveTxAPI(
        config.ave.apiUrl,
        config.ave.timeout,
        apiKey
      );
    }
    return this.aveTxApi;
  }

  /**
   * 执行早期参与者检查
   * @param {string} tokenAddress - 代币地址
   * @param {string} innerPair - 内盘交易对（如 0x..._fo）
   * @param {string} chain - 区块链
   * @param {number} launchAt - 代币创建时间戳（秒）
   * @param {number} checkTime - 当前检查时间戳（秒）
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenAddress, innerPair, chain, launchAt, checkTime) {
    const startTime = Date.now();

    // 计算检查窗口
    const elapsedSeconds = checkTime - launchAt;
    const windowSeconds = Math.min(elapsedSeconds, this.config.maxWindowSeconds);

    this.logger.info('[EarlyParticipantCheckService] 开始早期参与者检查', {
      token_address: tokenAddress,
      launch_at: launchAt,
      check_time: checkTime,
      elapsed_seconds: elapsedSeconds,
      window_seconds: windowSeconds
    });

    try {
      // 1. 获取早期交易数据
      const trades = await this._fetchEarlyTrades(innerPair, chain, launchAt, windowSeconds);

      if (!trades || trades.length === 0) {
        this.logger.warn('[EarlyParticipantCheckService] 未获取到交易数据', {
          token_address: tokenAddress
        });
        return this._getEmptyResult(launchAt, checkTime, windowSeconds);
      }

      // 2. 计算数据覆盖度
      const coverage = this._calculateDataCoverage(trades, launchAt, windowSeconds);

      // 3. 计算基础统计
      const basicStats = this._calculateBasicStats(trades);

      // 4. 计算速率指标（用代币年龄作为窗口）
      const rateMetrics = this._calculateRateMetrics(basicStats, elapsedSeconds);

      // 5. 计算增长特征（可选，分析显示效果不佳，默认关闭）
      let growthMetrics = { acceleration: 0, accelerationRatio: null, trend: 'no_data' };
      let growthScore = null;
      if (this.config.calculateGrowthMetrics) {
        growthMetrics = this._calculateGrowthMetrics(trades, launchAt, windowSeconds);
        if (this.config.calculateGrowthScore) {
          growthScore = this._calculateGrowthScore(rateMetrics, growthMetrics);
        }
      }

      const result = {
        // 标记已执行检查
        earlyTradesChecked: 1,
        earlyTradesCheckTimestamp: Date.now(),
        earlyTradesCheckDuration: Date.now() - startTime,

        // 基础信息
        earlyTradesCheckTime: elapsedSeconds,
        earlyTradesWindow: windowSeconds,

        // 数据范围（删除无效的gapBefore/gapAfter）
        earlyTradesExpectedFirstTime: launchAt,
        earlyTradesExpectedLastTime: launchAt + windowSeconds,
        earlyTradesDataFirstTime: coverage.dataFirstTime,
        earlyTradesDataLastTime: coverage.dataLastTime,
        earlyTradesDataCoverage: coverage.coverageRatio,

        // 速率指标（时间标准化，可跨代币比较）
        earlyTradesVolumePerMin: rateMetrics.volumePerMin,
        earlyTradesCountPerMin: rateMetrics.countPerMin,
        earlyTradesWalletsPerMin: rateMetrics.walletsPerMin,
        earlyTradesHighValuePerMin: rateMetrics.highValuePerMin,

        // 绝对值
        earlyTradesTotalCount: basicStats.totalCount,
        earlyTradesVolume: basicStats.totalVolume,
        earlyTradesUniqueWallets: basicStats.uniqueWallets,
        earlyTradesHighValueCount: basicStats.highValueCount,
        earlyTradesFilteredCount: basicStats.filteredCount
      };

      // 增长特征（可选，分析显示效果不佳）
      if (this.config.calculateGrowthMetrics) {
        result.earlyTradesAcceleration = growthMetrics.acceleration;
        result.earlyTradesAccelerationRatio = growthMetrics.accelerationRatio;
        result.earlyTradesGrowthTrend = growthMetrics.trend;
        result.earlyTradesGrowthScore = growthScore;
      }

      this.logger.info('[EarlyParticipantCheckService] 早期参与者检查完成', {
        token_address: tokenAddress,
        trades_count: trades.length,
        coverage: coverage.coverageRatio,
        volume_per_min: rateMetrics.volumePerMin.toFixed(2),
        count_per_min: rateMetrics.countPerMin.toFixed(1),
        wallets_per_min: rateMetrics.walletsPerMin.toFixed(1),
        high_value_per_min: rateMetrics.highValuePerMin.toFixed(1),
        duration: result.earlyTradesCheckDuration
      });

      return result;

    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);

      this.logger.error('[EarlyParticipantCheckService] 早期参与者检查失败', {
        token_address: tokenAddress,
        error: errorMessage
      });

      // 出错时返回空结果，不影响整体购买流程
      return this._getEmptyResult(launchAt, checkTime, windowSeconds);
    }
  }

  /**
   * 获取早期交易数据
   * @private
   */
  async _fetchEarlyTrades(innerPair, chain, launchAt, windowSeconds) {
    const txApi = this._getTxApi();
    const pairId = `${innerPair}-${chain}`;
    const fromTime = launchAt;
    const toTime = launchAt + windowSeconds;

    const allTrades = [];
    let currentToTime = toTime;
    const MAX_PAGES = 10;

    for (let page = 0; page < MAX_PAGES; page++) {
      const trades = await txApi.getSwapTransactions(
        pairId,
        300,              // limit
        fromTime,         // fromTime
        currentToTime,    // toTime
        'asc'             // sort
      );

      if (trades.length === 0) break;

      allTrades.push(...trades);

      if (trades.length < 300) break;

      // 继续向前查询
      currentToTime = trades[0].time - 1;
      if (currentToTime < fromTime) break;
    }

    // 按时间排序
    allTrades.sort((a, b) => a.time - b.time);

    return allTrades;
  }

  /**
   * 计算数据覆盖度
   * @private
   */
  _calculateDataCoverage(trades, launchAt, windowSeconds) {
    if (!trades || trades.length === 0) {
      return {
        dataFirstTime: null,
        dataLastTime: null,
        coverageRatio: 0,
        actualCoverage: 0,
        gapBefore: 0,
        gapAfter: windowSeconds
      };
    }

    const dataFirstTime = trades[0].time;
    const dataLastTime = trades[trades.length - 1].time;
    const actualCoverage = dataLastTime - dataFirstTime;
    const coverageRatio = actualCoverage / windowSeconds;

    return {
      dataFirstTime,
      dataLastTime,
      coverageRatio: parseFloat(Math.min(coverageRatio, 1).toFixed(3)),
      actualCoverage,
      gapBefore: parseFloat(Math.max(0, dataFirstTime - launchAt).toFixed(1)),
      gapAfter: parseFloat(Math.max(0, (launchAt + windowSeconds) - dataLastTime).toFixed(1))
    };
  }

  /**
   * 计算基础统计
   * @private
   */
  _calculateBasicStats(trades) {
    let totalVolume = 0;
    let filteredCount = 0;
    let highValueCount = 0;
    const uniqueWallets = new Set();

    trades.forEach(t => {
      const value = t.from_usd || t.to_usd || 0;
      totalVolume += value;

      if (t.from_address) uniqueWallets.add(t.from_address.toLowerCase());
      if (t.to_address) uniqueWallets.add(t.to_address.toLowerCase());

      if (value >= this.config.lowValueThreshold) filteredCount++;
      if (value >= this.config.highValueThreshold) highValueCount++;
    });

    return {
      totalCount: trades.length,
      totalVolume: parseFloat(totalVolume.toFixed(2)),
      uniqueWallets: uniqueWallets.size,
      filteredCount,
      highValueCount
    };
  }

  /**
   * 计算速率指标（时间标准化）
   * 方案C：用代币年龄（检查时间）作为窗口
   * @private
   */
  _calculateRateMetrics(basicStats, checkTimeSeconds) {
    // 用从创建到检查的时间作为窗口（代币年龄）
    const ageMinutes = checkTimeSeconds / 60;

    if (ageMinutes <= 0) {
      return {
        volumePerMin: 0,
        countPerMin: 0,
        walletsPerMin: 0,
        highValuePerMin: 0
      };
    }

    return {
      volumePerMin: parseFloat((basicStats.totalVolume / ageMinutes).toFixed(2)),
      countPerMin: parseFloat((basicStats.totalCount / ageMinutes).toFixed(1)),
      walletsPerMin: parseFloat((basicStats.uniqueWallets / ageMinutes).toFixed(1)),
      highValuePerMin: parseFloat((basicStats.highValueCount / ageMinutes).toFixed(1))
    };
  }

  /**
   * 获取空结果
   * @private
   */
  _getEmptyResult(launchAt, checkTime, windowSeconds) {
    return {
      earlyTradesChecked: 1,
      earlyTradesCheckTimestamp: Date.now(),
      earlyTradesCheckDuration: 0,

      earlyTradesCheckTime: checkTime - launchAt,
      earlyTradesWindow: windowSeconds,

      earlyTradesExpectedFirstTime: launchAt,
      earlyTradesExpectedLastTime: launchAt + windowSeconds,
      earlyTradesDataFirstTime: null,
      earlyTradesDataLastTime: null,
      earlyTradesDataCoverage: 0,

      earlyTradesVolumePerMin: 0,
      earlyTradesCountPerMin: 0,
      earlyTradesWalletsPerMin: 0,
      earlyTradesHighValuePerMin: 0,

      earlyTradesTotalCount: 0,
      earlyTradesVolume: 0,
      earlyTradesUniqueWallets: 0,
      earlyTradesHighValueCount: 0,
      earlyTradesFilteredCount: 0
    };
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      earlyTradesChecked: 0,
      earlyTradesCheckTimestamp: null,
      earlyTradesCheckDuration: null,

      earlyTradesCheckTime: null,
      earlyTradesWindow: null,

      earlyTradesExpectedFirstTime: null,
      earlyTradesExpectedLastTime: null,
      earlyTradesDataFirstTime: null,
      earlyTradesDataLastTime: null,
      earlyTradesDataCoverage: 0,

      earlyTradesVolumePerMin: 0,
      earlyTradesCountPerMin: 0,
      earlyTradesWalletsPerMin: 0,
      earlyTradesHighValuePerMin: 0,

      earlyTradesTotalCount: 0,
      earlyTradesVolume: 0,
      earlyTradesUniqueWallets: 0,
      earlyTradesHighValueCount: 0,
      earlyTradesFilteredCount: 0
    };
  }

  /**
   * 评估早期参与者数据是否满足购买条件
   *
   * 策略B：高召回率+多因子稳定性
   * 基于全因子分析（102个样本）
   *
   * 核心条件：
   * - highValueCount >= 8     (高价值交易数, AUC: 83.0%)
   * - highValuePerMin >= 5.6  (高价值/分, AUC: 78.5%)
   * - countPerMin >= 10.6     (交易次数/分, AUC: 78.7%)
   *
   * 性能指标：
   * - F1: 0.64
   * - 精确率: 55.6%
   * - 召回率: 75%
   * - 通过率: 26.5%
   *
   * @param {Object} checkResult - performCheck 返回的结果
   * @param {Object} strategyConfig - 策略配置
   * @returns {Object} { canBuy: boolean, reason: string, details: Object }
   */
  evaluateBuyEligibility(checkResult, strategyConfig) {
    if (!checkResult || checkResult.earlyTradesChecked !== 1) {
      return {
        canBuy: true,
        reason: '早期参与者检查未执行',
        details: null
      };
    }

    const config = strategyConfig?.earlyParticipants || {};

    // 基于分析的阈值（策略B）
    const highValueCountThreshold = config.highValueCountThreshold ?? 8;
    const highValuePerMinThreshold = config.highValuePerMinThreshold ?? 5.6;
    const countPerMinThreshold = config.countPerMinThreshold ?? 10.6;

    // 检查三个核心条件
    const highValueCountOk = (checkResult.earlyTradesHighValueCount || 0) >= highValueCountThreshold;
    const highValuePerMinOk = (checkResult.earlyTradesHighValuePerMin || 0) >= highValuePerMinThreshold;
    const countPerMinOk = (checkResult.earlyTradesCountPerMin || 0) >= countPerMinThreshold;

    const canBuy = highValueCountOk && highValuePerMinOk && countPerMinOk;

    // 构建失败原因
    const reasons = [];
    if (!highValueCountOk) reasons.push(`高价值交易数(${checkResult.earlyTradesHighValueCount || 0}) < ${highValueCountThreshold}`);
    if (!highValuePerMinOk) reasons.push(`高价值/分(${(checkResult.earlyTradesHighValuePerMin || 0).toFixed(1)}) < ${highValuePerMinThreshold}`);
    if (!countPerMinOk) reasons.push(`交易次数/分(${(checkResult.earlyTradesCountPerMin || 0).toFixed(1)}) < ${countPerMinThreshold}`);

    // 构建通过原因
    const passInfos = [
      `高价值交易数:${checkResult.earlyTradesHighValueCount || 0}`,
      `高价值/分:${(checkResult.earlyTradesHighValuePerMin || 0).toFixed(1)}`,
      `交易次数/分:${(checkResult.earlyTradesCountPerMin || 0).toFixed(1)}`
    ];

    return {
      canBuy,
      reason: canBuy
        ? `早期参与者检查通过 (${passInfos.join(', ')})`
        : `早期参与者检查失败: ${reasons.join(', ')}`,
      details: {
        highValueCountOk,
        highValuePerMinOk,
        countPerMinOk,
        highValueCount: checkResult.earlyTradesHighValueCount || 0,
        highValuePerMin: checkResult.earlyTradesHighValuePerMin || 0,
        countPerMin: checkResult.earlyTradesCountPerMin || 0,
        // 额外信息
        totalCount: checkResult.earlyTradesTotalCount || 0,
        uniqueWallets: checkResult.earlyTradesUniqueWallets || 0,
        volumePerMin: checkResult.earlyTradesVolumePerMin || 0
      }
    };
  }

  /**
   * 安全地获取错误消息
   * @private
   */
  _safeGetErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error) return error.error;
    return String(error);
  }
}

module.exports = { EarlyParticipantCheckService };
