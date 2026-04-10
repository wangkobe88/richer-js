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
  fixedWindowSeconds: 90,         // 固定回溯窗口（90秒）
  lowValueThreshold: 10,          // 低价值阈值（USD）
  highValueThreshold: 80,         // 高价值阈值（USD）
  calculateGrowthScore: false,    // 是否计算增长评分
  accelerationSegments: 3,        // 加速度计算分段数（已废弃，保留配置兼容性）
  calculateGrowthMetrics: false,  // 是否计算增长特征（分析显示无效，默认关闭）
  apiMaxRetries: 6,               // API调用最大重试次数
  apiRetryDelayMs: 1000           // API重试延迟（毫秒）
};

class EarlyParticipantCheckService {
  /**
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象
   * @param {Object} supabase - Supabase客户端（可选，用于存储数据）
   */
  constructor(logger, config = {}, supabase = null) {
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.aveTxApi = null;
    this.supabase = supabase;
  }

  /**
   * 设置 Supabase 客户端（延迟注入）
   * @param {Object} supabase - Supabase客户端
   */
  setSupabase(supabase) {
    this.supabase = supabase;
  }

  /**
   * 带重试的API调用
   * @private
   */
  async _fetchTradesWithRetry(txApi, pairId, limit, fromTime, toTime, sort) {
    const maxRetries = this.config.apiMaxRetries || 3;
    const retryDelay = this.config.apiRetryDelayMs || 1000;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const trades = await txApi.getSwapTransactions(pairId, limit, fromTime, toTime, sort);
        if (attempt > 1) {
          this.logger.info('[EarlyParticipantCheckService] API重试成功', {
            attempt,
            pair_id: pairId
          });
        }
        return trades;
      } catch (error) {
        lastError = error;
        this.logger.warn('[EarlyParticipantCheckService] API调用失败', {
          attempt,
          max_retries: maxRetries,
          pair_id: pairId,
          error: error.message
        });

        if (attempt < maxRetries) {
          // 第1-2次：指数退避 (1秒, 2秒)
          // 第3-6次：固定等待2秒
          let delay;
          if (attempt <= 2) {
            delay = retryDelay * Math.pow(2, attempt - 1);
          } else {
            delay = 2000; // 第3-6次重试都等待2秒
          }
          this.logger.debug('[EarlyParticipantCheckService] 等待重试', {
            attempt,
            delay_ms: delay
          });
          await this._sleep(delay);
        }
      }
    }

    // 所有重试都失败
    throw new Error(`API调用失败（重试${maxRetries}次后）: ${lastError?.message || '未知错误'}`);
  }

  /**
   * 延迟函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
   * @param {number} launchAt - 代币创建时间戳（秒）（保留参数兼容性，但不再使用）
   * @param {number} checkTime - 当前检查时间戳（秒）
   * @returns {Promise<Object>} 检查结果
   */
  async performCheck(tokenAddress, innerPair, chain, launchAt, checkTime) {
    const startTime = Date.now();

    this.logger.info('[EarlyParticipantCheckService] 开始早期参与者检查', {
      token_address: tokenAddress,
      inner_pair: innerPair,
      chain,
      check_time: checkTime
    });

    try {
      // 1. 获取交易数据（固定90秒回溯窗口）
      const trades = await this._fetchEarlyTrades(innerPair, chain, checkTime);

      if (!trades || trades.length === 0) {
        this.logger.error('[EarlyParticipantCheckService] 未获取到交易数据，拒绝交易', {
          token_address: tokenAddress,
          inner_pair: innerPair,
          chain
        });
        // 数据获取失败时抛出错误，而不是返回空结果
        throw new Error('未获取到交易数据，无法进行早期参与者检查');
      }

      // 2. 计算实际数据跨度
      const coverage = this._calculateDataCoverage(trades);

      // 3. 计算基础统计
      const basicStats = this._calculateBasicStats(trades);

      // 4. 计算速率指标（使用实际数据跨度）
      const rateMetrics = this._calculateRateMetrics(basicStats, coverage);

      const result = {
        // 标记已执行检查
        earlyTradesChecked: 1,
        earlyTradesCheckTimestamp: Date.now(),
        earlyTradesCheckDuration: Date.now() - startTime,

        // 基础信息
        earlyTradesCheckTime: checkTime,
        earlyTradesWindow: this.config.fixedWindowSeconds,

        // 数据范围
        earlyTradesExpectedFirstTime: checkTime - this.config.fixedWindowSeconds,
        earlyTradesExpectedLastTime: checkTime,
        earlyTradesDataFirstTime: coverage.dataFirstTime,
        earlyTradesDataLastTime: coverage.dataLastTime,
        earlyTradesDataCoverage: coverage.coverageRatio,
        // 新增：实际数据跨度
        earlyTradesActualSpan: coverage.actualSpan,
        earlyTradesRateCalcWindow: coverage.rateCalculationWindow,

        // 速率指标（使用实际数据跨度计算）
        earlyTradesVolumePerMin: rateMetrics.volumePerMin,
        earlyTradesCountPerMin: rateMetrics.countPerMin,
        earlyTradesWalletsPerMin: rateMetrics.walletsPerMin,
        earlyTradesHighValuePerMin: rateMetrics.highValuePerMin,

        // 绝对值
        earlyTradesTotalCount: basicStats.totalCount,
        earlyTradesVolume: basicStats.totalVolume,
        earlyTradesUniqueWallets: basicStats.uniqueWallets,
        earlyTradesHighValueCount: basicStats.highValueCount,
        earlyTradesFilteredCount: basicStats.filteredCount,

        // 新增因子
        earlyTradesFinalLiquidity: basicStats.earlyTradesFinalLiquidity,
        earlyTradesDrawdownFromHighest: basicStats.earlyTradesDrawdownFromHighest,

        // 内部数据（供钱包簇检查复用）
        _trades: trades
      };

      this.logger.info('[EarlyParticipantCheckService] 早期参与者检查完成', {
        token_address: tokenAddress,
        trades_count: trades.length,
        actual_span: coverage.actualSpan,
        rate_calc_window: coverage.rateCalculationWindow,
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
      return this._getEmptyResult();
    }
  }

  /**
   * 获取早期交易数据
   * 固定回溯90秒窗口，循环获取直到覆盖完整时间窗口
   * @private
   */
  async _fetchEarlyTrades(innerPair, chain, checkTime) {
    const txApi = this._getTxApi();
    const pairId = `${innerPair}-${chain}`;

    // 固定回溯90秒
    const targetFromTime = checkTime - this.config.fixedWindowSeconds;
    let currentToTime = checkTime;

    const allTrades = [];
    let loopCount = 0;
    const maxLoops = 10; // 防止无限循环，最多10次（可覆盖3000笔交易）

    this.logger.debug('[EarlyParticipantCheckService] 开始循环获取交易数据', {
      pair_id: pairId,
      target_from_time: targetFromTime,
      initial_to_time: currentToTime,
      window_seconds: this.config.fixedWindowSeconds
    });

    while (loopCount < maxLoops) {
      loopCount++;

      // 调用API获取一批数据（带重试）
      const trades = await this._fetchTradesWithRetry(
        txApi,
        pairId,
        300,              // limit - 最大300条
        targetFromTime,   // fromTime - 固定为目标起始时间
        currentToTime,    // toTime - 当前批次的结束时间
        'asc'             // sort - 按时间升序
      );

      if (trades.length === 0) {
        this.logger.debug('[EarlyParticipantCheckService] 批次无数据，结束', {
          loop: loopCount
        });
        break;
      }

      // 记录这批交易的时间范围
      const batchFirstTime = trades[0].time;
      const batchLastTime = trades[trades.length - 1].time;

      this.logger.debug('[EarlyParticipantCheckService] 获取到批次数据', {
        loop: loopCount,
        trades_count: trades.length,
        batch_first_time: batchFirstTime,
        batch_last_time: batchLastTime,
        batch_span: (batchLastTime - batchFirstTime).toFixed(1) + 's'
      });

      allTrades.push(...trades);

      // 检查是否已经覆盖到目标起始时间
      if (batchFirstTime <= targetFromTime) {
        this.logger.debug('[EarlyParticipantCheckService] 已覆盖完整时间窗口', {
          loop: loopCount,
          total_trades: allTrades.length
        });
        break;
      }

      // 如果返回了300条数据，可能还有更早的数据
      // 更新toTime为当前批次最早交易时间的前1秒，继续获取
      if (trades.length === 300) {
        currentToTime = batchFirstTime - 1;
        this.logger.debug('[EarlyParticipantCheckService] 继续获取更早的数据', {
          loop: loopCount,
          new_to_time: currentToTime
        });
      } else {
        // 返回数据不足300条，说明已经没有更早的数据了
        this.logger.debug('[EarlyParticipantCheckService] 数据已获取完毕', {
          loop: loopCount,
          total_trades: allTrades.length
        });
        break;
      }
    }

    // 按时间排序并去重（以防批次间有重叠）
    const uniqueTrades = this._deduplicateTrades(allTrades);

    this.logger.info('[EarlyParticipantCheckService] 交易数据获取完成', {
      pair_id: pairId,
      total_trades: uniqueTrades.length,
      loops: loopCount,
      expected_window: this.config.fixedWindowSeconds + 's',
      actual_span: uniqueTrades.length > 0
        ? ((uniqueTrades[uniqueTrades.length - 1].time - uniqueTrades[0].time).toFixed(1) + 's')
        : '0s',
      data_completeness: uniqueTrades.length > 0 && uniqueTrades[0].time <= targetFromTime ? 'complete' : 'partial'
    });

    return uniqueTrades;
  }

  /**
   * 对交易数据去重（基于tx_id）
   * @private
   */
  _deduplicateTrades(trades) {
    if (!trades || trades.length === 0) return [];

    const seen = new Set();
    const unique = [];

    // 先按时间排序
    const sorted = trades.sort((a, b) => a.time - b.time);

    for (const trade of sorted) {
      const key = trade.tx_id || `${trade.time}_${trade.from_address}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(trade);
      }
    }

    return unique;
  }

  /**
   * 计算数据覆盖度和实际数据跨度
   * @private
   */
  _calculateDataCoverage(trades) {
    if (!trades || trades.length === 0) {
      return {
        dataFirstTime: null,
        dataLastTime: null,
        coverageRatio: 0,
        actualSpan: 0,
        rateCalculationWindow: 1  // 最小窗口，避免除以0
      };
    }

    const dataFirstTime = trades[0].time;
    const dataLastTime = trades[trades.length - 1].time;
    const actualSpan = dataLastTime - dataFirstTime;

    // 边界情况：只有1笔交易时，actualSpan = 0
    // 使用最小窗口1秒避免除以0
    const rateCalculationWindow = actualSpan > 0 ? actualSpan : 1;

    return {
      dataFirstTime,
      dataLastTime,
      coverageRatio: 1,  // 数据已获取，覆盖度总是1
      actualSpan: parseFloat(actualSpan.toFixed(1)),
      rateCalculationWindow: parseFloat(rateCalculationWindow.toFixed(1))
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

    // 新增：用于计算价格相关因子
    let highestPrice = 0;
    let finalPrice = 0;  // 窗口结束时价格（最后有效价格）
    let finalLiquidity = null;

    trades.forEach(t => {
      const value = t.from_usd || t.to_usd || 0;
      totalVolume += value;

      if (t.from_address) uniqueWallets.add(t.from_address.toLowerCase());
      if (t.to_address) uniqueWallets.add(t.to_address.toLowerCase());

      if (value >= this.config.lowValueThreshold) filteredCount++;
      if (value >= this.config.highValueThreshold) highValueCount++;

      // 计算价格相关因子
      const toTokenPrice = t.to_token_price_usd || 0;
      const fromTokenPrice = t.from_token_price_usd || 0;

      // 代币价格通常是较小的值（如 8.4e-6），而 WBNB 价格较大（如 670）
      // 通过判断哪个价格小于 1 来确定代币价格
      let price = 0;
      if (toTokenPrice > 0 && toTokenPrice < 1) {
        price = toTokenPrice;
      } else if (fromTokenPrice > 0 && fromTokenPrice < 1) {
        price = fromTokenPrice;
      }

      if (price > 0) {
        if (price > highestPrice) highestPrice = price;
        finalPrice = price;  // 更新最后价格
      }

      // 记录最后一笔交易的流动性
      finalLiquidity = t.pair_liquidity_usd || null;
    });

    // 计算从最高价的跌幅（百分比）
    // 使用窗口结束时的价格（最后价格）vs 最高价，而不是最低价 vs 最高价
    // 这样可以反映购买时刻从历史最高点的实际回撤情况
    let drawdownFromHighest = 0;
    if (highestPrice > 0 && finalPrice > 0) {
      drawdownFromHighest = ((finalPrice - highestPrice) / highestPrice) * 100;
    }

    return {
      totalCount: trades.length,
      totalVolume: parseFloat(totalVolume.toFixed(2)),
      uniqueWallets: uniqueWallets.size,
      filteredCount,
      highValueCount,
      // 新增因子
      earlyTradesFinalLiquidity: finalLiquidity,
      earlyTradesDrawdownFromHighest: parseFloat(drawdownFromHighest.toFixed(2))
    };
  }

  /**
   * 计算速率指标（使用实际数据跨度）
   * @private
   */
  _calculateRateMetrics(basicStats, coverage) {
    // 使用实际数据跨度计算速率（单位：分钟）
    const windowMinutes = coverage.rateCalculationWindow / 60;

    if (windowMinutes <= 0) {
      return {
        volumePerMin: 0,
        countPerMin: 0,
        walletsPerMin: 0,
        highValuePerMin: 0
      };
    }

    return {
      volumePerMin: parseFloat((basicStats.totalVolume / windowMinutes).toFixed(2)),
      countPerMin: parseFloat((basicStats.totalCount / windowMinutes).toFixed(1)),
      walletsPerMin: parseFloat((basicStats.uniqueWallets / windowMinutes).toFixed(1)),
      highValuePerMin: parseFloat((basicStats.highValueCount / windowMinutes).toFixed(1))
    };
  }

  /**
   * 获取空结果（未获取到交易数据时）
   * @private
   */
  _getEmptyResult() {
    const checkTime = Math.floor(Date.now() / 1000);

    return {
      earlyTradesChecked: 1,
      earlyTradesCheckTimestamp: Date.now(),
      earlyTradesCheckDuration: 0,

      earlyTradesCheckTime: checkTime,
      earlyTradesWindow: this.config.fixedWindowSeconds,

      earlyTradesExpectedFirstTime: checkTime - this.config.fixedWindowSeconds,
      earlyTradesExpectedLastTime: checkTime,
      earlyTradesDataFirstTime: null,
      earlyTradesDataLastTime: null,
      earlyTradesDataCoverage: 0,
      earlyTradesActualSpan: 9999,
      earlyTradesRateCalcWindow: 1,

      // 内盘无数据时给通过值（可能已出内盘），Ratio 类保持 0 自然通过
      earlyTradesVolumePerMin: 9999,
      earlyTradesCountPerMin: 100,
      earlyTradesWalletsPerMin: 9999,
      earlyTradesHighValuePerMin: 9999,

      earlyTradesTotalCount: 9999,
      earlyTradesVolume: 9999,
      earlyTradesUniqueWallets: 9999,
      earlyTradesHighValueCount: 9999,
      earlyTradesFilteredCount: 9999,

      // 新增因子
      earlyTradesFinalLiquidity: 9999,
      earlyTradesDrawdownFromHighest: 0,

      // 标记内盘无交易数据（可能已出内盘）
      earlyTradesNoInnerData: 1,

      // 内部数据（供钱包簇检查复用）
      _trades: []
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
      earlyTradesFilteredCount: 0,

      // 新增因子
      earlyTradesFinalLiquidity: null,
      earlyTradesDrawdownFromHighest: null,

      // 内盘无数据标记
      earlyTradesNoInnerData: 0,

      // 内部数据（供钱包簇检查复用）
      _trades: []
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
      // 数据获取失败时，拒绝交易
      return {
        canBuy: false,
        reason: '早期参与者数据未获取到，拒绝交易',
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
   * 存储早期交易者数据（裸数据）
   * @param {string} tokenAddress - 代币地址
   * @param {string} signalId - 信号ID
   * @param {string} experimentId - 实验ID
   * @param {string} innerPair - 内盘交易对
   * @param {string} chain - 区块链
   * @param {Array} tradesData - 原始交易数据（_trades字段）
   * @param {number} checkTime - 检查时间戳（秒）
   * @returns {Promise<boolean>} 是否存储成功
   */
  async storeEarlyParticipantTrades(tokenAddress, signalId, experimentId, innerPair, chain, tradesData, checkTime) {
    if (!this.supabase) {
      this.logger.warn('[EarlyParticipantCheckService] Supabase 客户端未初始化，跳过存储早期交易数据');
      return false;
    }

    if (!signalId) {
      this.logger.warn('[EarlyParticipantCheckService] signalId 为空，跳过存储早期交易数据');
      return false;
    }

    if (!tradesData || tradesData.length === 0) {
      this.logger.debug('[EarlyParticipantCheckService] 早期交易数据为空，跳过存储');
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('early_participant_trades')
        .insert({
          signal_id: signalId,
          token_address: tokenAddress,
          experiment_id: experimentId,
          chain: chain,
          trades_data: tradesData,    // 裸数据，不做任何处理
          inner_pair: innerPair,
          check_time: checkTime,
          window_seconds: this.config.fixedWindowSeconds
        });

      if (error) {
        this.logger.error('[EarlyParticipantCheckService] 存储早期交易数据失败', {
          token_address: tokenAddress,
          signal_id: signalId,
          error: error.message,
          details: error.hint || error.details || error.code
        });
        return false;
      }

      this.logger.info('[EarlyParticipantCheckService] 早期交易数据存储成功', {
        token_address: tokenAddress,
        signal_id: signalId,
        trades_count: tradesData.length
      });

      return true;
    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);
      this.logger.error('[EarlyParticipantCheckService] 存储早期交易数据异常', {
        token_address: tokenAddress,
        signal_id: signalId,
        error: errorMessage
      });
      return false;
    }
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
