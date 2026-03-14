/**
 * 购买前检查服务
 * 统一的购买前检查入口，整合所有预检查逻辑
 *
 * 职责：
 * 1. 执行购买前的所有检查（黑/白名单、Dev持仓、早期参与者等）
 * 2. 返回结构化的检查结果
 * 3. 将检查结果转换为因子格式
 */

const { TokenHolderService } = require('../holders/TokenHolderService');
const { EarlyParticipantCheckService } = require('./EarlyParticipantCheckService');
const { WalletClusterService } = require('./WalletClusterService');
const { WalletDataService } = require('../../web/services/WalletDataService');
const TwitterSearchService = require('./TwitterSearchService');
const StrongTraderPositionService = require('./StrongTraderPositionService');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  devHoldingThreshold: 15,           // Dev持仓阈值（百分比）
  largeHoldingThreshold: 18,         // 大额持仓阈值（百分比）
  holderCheckEnabled: true,          // 是否启用持有者检查
  earlyParticipantCheckEnabled: true, // 是否启用早期参与者检查
  earlyParticipantFilterEnabled: false, // 是否启用早期参与者筛选（策略8）
  earlyParticipantStrategy: 'three_feature_and_p25',
  threeFeatureAndP25: {              // 策略8阈值配置
    volumePerMinThreshold: 1610,
    countPerMinThreshold: 14,
    highValuePerMinThreshold: 8
  }
};

class PreBuyCheckService {
  /**
   * @param {Object} supabase - Supabase客户端
   * @param {Object} logger - Logger实例
   * @param {Object} config - 配置对象
   */
  constructor(supabase, logger, config = {}) {
    this.supabase = supabase;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化持有者服务
    this.holderService = new TokenHolderService(supabase, logger);

    // 初始化早期参与者检查服务（传入 supabase 用于存储数据）
    this.earlyParticipantService = new EarlyParticipantCheckService(logger, {
      calculateGrowthScore: false  // 暂不计算增长评分
    }, supabase);

    // 初始化钱包簇检查服务
    // 默认使用区块号聚簇（比时间戳更准确）
    // 如果需要使用时间戳聚簇，配置 useTimeBasedClustering: true
    const clusterMode = this.config.useTimeBasedClustering ? 'time' : 'block';
    const clusterConfig = {
      mode: clusterMode,
      clusterBlockThreshold: this.config.clusterBlockThreshold || 7
    };
    this.walletClusterService = new WalletClusterService(logger, clusterConfig);

    // 初始化Twitter搜索服务
    this.twitterSearchService = new TwitterSearchService(logger);

    // 初始化强势交易者持仓服务
    this.strongTraderPositionService = new StrongTraderPositionService();
  }

  /**
   * 初始化服务（加载缓存等）
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.holderService.initWalletCache();
    this.logger.info('[PreBuyCheckService] 服务初始化完成');
  }

  /**
   * 执行所有购买前检查
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址（可为null）
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID（可为null）
   * @param {string} chain - 区块链
   * @param {Object} tokenInfo - 代币信息（用于早期参与者检查，只需要 innerPair）
   * @param {string} tokenInfo.innerPair - 内盘交易对
   * @param {string} preBuyCheckCondition - 购买前检查条件表达式（可选）
   * @param {Object} options - 可选配置
   * @param {number} options.checkTime - 检查时间戳（秒），用于回测时指定历史时间点
   * @param {boolean} options.skipHolderCheck - 是否跳过持有者检查（回测时为 true）
   * @param {boolean} options.skipEarlyParticipant - 是否跳过早期参与者检查
   * @param {boolean} options.skipTwitterSearch - 是否跳过Twitter搜索（回测时为 true，因子使用默认值）
   * @param {number} options.tokenBuyTime - 代币首次买入时间戳（毫秒），用于判断是否有历史交易记录
   * @param {number} options.drawdownFromHighest - 从最高价跌幅（%），负数表示下跌
   * @returns {Promise<Object>} 检查结果
   */
  async performAllChecks(tokenAddress, creatorAddress, experimentId, signalId, chain = 'bsc', tokenInfo = null, preBuyCheckCondition = null, options = {}) {
    const startTime = Date.now();
    const { checkTime, skipHolderCheck, skipEarlyParticipant, skipTwitterSearch, tokenBuyTime, drawdownFromHighest, buyRound, lastPairReturnRate } = options;

    this.logger.info('[PreBuyCheckService] 开始执行购买前检查', {
      token_address: tokenAddress,
      creator_address: creatorAddress || 'none',
      experiment_id: experimentId,
      signal_id: signalId || 'none',
      chain,
      has_condition: !!preBuyCheckCondition,
      condition: preBuyCheckCondition || '(空，默认通过)',
      check_time: checkTime || Math.floor(Date.now() / 1000),
      skip_holder_check: skipHolderCheck || false,
      skip_early_participant: skipEarlyParticipant || false,
      skip_twitter_search: skipTwitterSearch || false,
      buy_round: buyRound || 1,
      last_pair_return_rate: lastPairReturnRate ?? 0
    });

    try {
      // 先执行早期参与者检查（获取交易数据）
      const earlyParticipantCheck = await this._performEarlyParticipantCheck(
        tokenAddress, chain, tokenInfo, checkTime, skipEarlyParticipant
      );

      // Twitter搜索：回测时跳过，使用默认因子
      const twitterCheck = skipTwitterSearch
        ? this._getEmptyTwitterCheck()
        : await this._performTwitterSearch(tokenAddress);

      // 并行执行持有者检查、钱包簇检查、创建者Dev钱包检查、强势交易者持仓检查
      const [holderCheck, walletClusterCheck, creatorDevCheck, strongTraderCheck] = await Promise.all([
        this._performHolderCheck(tokenAddress, creatorAddress, experimentId, signalId, chain, skipHolderCheck),
        this._performWalletClusterCheck(earlyParticipantCheck),
        this._checkCreatorIsNotBadDevWallet(creatorAddress),
        this._performStrongTraderPositionCheck(tokenAddress, tokenInfo?.innerPair, checkTime, skipEarlyParticipant)
      ]);

      // 如果没有提供条件表达式，默认通过（不执行任何检查）
      if (!preBuyCheckCondition || !preBuyCheckCondition.trim()) {
        preBuyCheckCondition = 'true';  // 设置为 true 以便后续通过评估
      }

      // 存储早期交易者数据（如果有 signalId 和交易数据）
      if (signalId && earlyParticipantCheck._trades && earlyParticipantCheck._trades.length > 0) {
        // 同步存储，确保数据保存完成
        const storeSuccess = await this.earlyParticipantService.storeEarlyParticipantTrades(
          tokenAddress,
          signalId,
          experimentId,
          tokenInfo?.innerPair || null,
          chain,
          earlyParticipantCheck._trades,
          checkTime || Math.floor(Date.now() / 1000)
        );
        this.logger.info('[PreBuyCheckService] 早期交易数据存储完成', {
          signal_id: signalId,
          success: storeSuccess
        });
      }

      // 使用条件表达式评估
      return this._evaluateWithCondition(
        holderCheck,
        earlyParticipantCheck,
        walletClusterCheck,
        creatorDevCheck,
        twitterCheck,
        strongTraderCheck,
        preBuyCheckCondition,
        startTime,
        options.drawdownFromHighest,  // 传入 drawdownFromHighest
        {
          buyRound: options.buyRound,
          lastPairReturnRate: options.lastPairReturnRate
        }
      );
    } catch (error) {
      const errorMessage = this._safeGetErrorMessage(error);

      this.logger.error('[PreBuyCheckService] 购买前检查失败', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        error: errorMessage
      });

      // 出错时返回不可购买的结果
      return {
        preBuyCheck: 1,
        checkTimestamp: Date.now(),
        checkDuration: Date.now() - startTime,

        holderWhitelistCount: 0,
        holderBlacklistCount: 0,
        holdersCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        holderCanBuy: false,

        holderCheckReason: `检查失败: ${errorMessage}`,
        blacklistReason: `检查失败: ${errorMessage}`,
        devCheckReason: `检查失败: ${errorMessage}`,

        canBuy: false,
        checkReason: `购买前检查失败: ${errorMessage}`,

        // 多次交易因子（默认值）
        buyRound: options.buyRound || 1,
        lastPairReturnRate: options.lastPairReturnRate ?? 0,

        // 早期参与者检查失败时的空值
        ...this.earlyParticipantService.getEmptyFactorValues(),
        // 钱包簇检查失败时的空值
        ...this.walletClusterService.getEmptyFactorValues(),
        // Twitter检查失败时的空值
        twitterTotalResults: 0,
        twitterQualityTweets: 0,
        twitterLikes: 0,
        twitterRetweets: 0,
        twitterComments: 0,
        twitterTotalEngagement: 0,
        twitterAvgEngagement: 0,
        twitterVerifiedUsers: 0,
        twitterFollowers: 0,
        twitterUniqueUsers: 0,
        twitterSearchSuccess: false,
        twitterSearchDuration: 0,
        twitterSearchError: errorMessage,
        // 强势交易者持仓检查失败时的空值
        ...this.strongTraderPositionService.getEmptyFactorValues()
      };
    }
  }

  /**
   * 使用条件表达式评估
   * @private
   * @param {Object} holderCheck - 持有者检查结果
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果
   * @param {Object} walletClusterCheck - 钱包簇检查结果
   * @param {Object} creatorDevCheck - 创建者Dev检查结果
   * @param {Object} twitterCheck - Twitter检查结果
   * @param {Object} strongTraderCheck - 强势交易者持仓检查结果
   * @param {string} condition - 条件表达式
   * @param {number} startTime - 开始时间戳
   * @param {number} drawdownFromHighest - 从最高价跌幅
   * @param {Object} extraContext - 额外上下文 { buyRound, lastPairReturnRate }
   */
  _evaluateWithCondition(holderCheck, earlyParticipantCheck, walletClusterCheck, creatorDevCheck, twitterCheck, strongTraderCheck, condition, startTime, drawdownFromHighest = null, extraContext = {}) {
    // 构建基础结果
    const baseResult = {
      // 标记已执行预检查
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // 持有者检查结果
      holderWhitelistCount: holderCheck.whitelistCount || 0,
      holderBlacklistCount: holderCheck.blacklistCount || 0,
      holdersCount: holderCheck.holdersCount || 0,
      devHoldingRatio: holderCheck.devHoldingRatio || 0,
      maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
      holderCanBuy: holderCheck.canBuy,

      // 持有者检查详细原因
      holderCheckReason: holderCheck.reason,
      blacklistReason: holderCheck.blacklistReason,
      devCheckReason: holderCheck.devReason,

      // 创建者Dev钱包检查（1=不在Dev列表中, 0=在Dev列表中）
      creatorIsNotBadDevWallet: creatorDevCheck.creatorIsNotBadDevWallet ?? 0,

      // 从最高价跌幅（允许在条件表达式中使用）
      drawdownFromHighest: drawdownFromHighest ?? 0,

      // 多次交易因子
      buyRound: extraContext.buyRound || 1,
      lastPairReturnRate: extraContext.lastPairReturnRate ?? 0,

      // 早期参与者检查结果
      ...earlyParticipantCheck,

      // 钱包簇检查结果
      ...walletClusterCheck,

      // Twitter搜索结果
      ...twitterCheck.factors,
      _twitterRawResult: twitterCheck.rawResult,
      _twitterDuration: twitterCheck.duration,

      // 强势交易者持仓检查结果
      ...strongTraderCheck,

      // 早期参与者购买资格评估
      preTraderCanBuy: null,
      preTraderCheckReason: null
    };

    try {
      // 构建评估上下文
      const context = {
        // 持有者因子
        holderWhitelistCount: holderCheck.whitelistCount || 0,
        holderBlacklistCount: holderCheck.blacklistCount || 0,
        holdersCount: holderCheck.holdersCount || 0,
        devHoldingRatio: holderCheck.devHoldingRatio || 0,
        maxHoldingRatio: holderCheck.maxHoldingRatio || 0,
        // 早期参与者因子 - 速率指标
        earlyTradesChecked: earlyParticipantCheck.earlyTradesChecked || 0,
        earlyTradesHighValueCount: earlyParticipantCheck.earlyTradesHighValueCount || 0,
        earlyTradesHighValuePerMin: earlyParticipantCheck.earlyTradesHighValuePerMin || 0,
        earlyTradesCountPerMin: earlyParticipantCheck.earlyTradesCountPerMin || 0,
        earlyTradesVolumePerMin: earlyParticipantCheck.earlyTradesVolumePerMin || 0,
        earlyTradesWalletsPerMin: earlyParticipantCheck.earlyTradesWalletsPerMin || 0,
        earlyTradesTotalCount: earlyParticipantCheck.earlyTradesTotalCount || 0,
        earlyTradesVolume: earlyParticipantCheck.earlyTradesVolume || 0,
        earlyTradesUniqueWallets: earlyParticipantCheck.earlyTradesUniqueWallets || 0,
        earlyTradesDataCoverage: earlyParticipantCheck.earlyTradesDataCoverage || 0,
        earlyTradesFilteredCount: earlyParticipantCheck.earlyTradesFilteredCount || 0,
        // 早期参与者因子 - 数据跨度
        earlyTradesActualSpan: earlyParticipantCheck.earlyTradesActualSpan || 0,
        earlyTradesRateCalcWindow: earlyParticipantCheck.earlyTradesRateCalcWindow || 1,
        // 钱包簇因子
        walletClusterSecondToFirstRatio: walletClusterCheck.walletClusterSecondToFirstRatio || 0,
        walletClusterMegaRatio: walletClusterCheck.walletClusterMegaRatio || 0,
        walletClusterTop2Ratio: walletClusterCheck.walletClusterTop2Ratio || 0,
        walletClusterCount: walletClusterCheck.walletClusterCount || 0,
        walletClusterMaxSize: walletClusterCheck.walletClusterMaxSize || 0,
        walletClusterAvgSize: walletClusterCheck.walletClusterAvgSize || 0,
        walletClusterMaxClusterWallets: walletClusterCheck.walletClusterMaxClusterWallets || 0,
        // 最大区块买入金额占比因子
        walletClusterMaxBlockBuyRatio: walletClusterCheck.walletClusterMaxBlockBuyRatio || 0,
        walletClusterMaxBlockNumber: walletClusterCheck.walletClusterMaxBlockNumber || null,
        walletClusterMaxBlockBuyAmount: walletClusterCheck.walletClusterMaxBlockBuyAmount || 0,
        walletClusterTotalBuyAmount: walletClusterCheck.walletClusterTotalBuyAmount || 0,
        // 创建者Dev钱包因子（1=不在Dev列表中, 0=在Dev列表中）
        creatorIsNotBadDevWallet: creatorDevCheck.creatorIsNotBadDevWallet ?? 0,
        // Twitter因子
        twitterTotalResults: twitterCheck.factors.twitterTotalResults || 0,
        twitterQualityTweets: twitterCheck.factors.twitterQualityTweets || 0,
        twitterLikes: twitterCheck.factors.twitterLikes || 0,
        twitterRetweets: twitterCheck.factors.twitterRetweets || 0,
        twitterComments: twitterCheck.factors.twitterComments || 0,
        twitterTotalEngagement: twitterCheck.factors.twitterTotalEngagement || 0,
        twitterAvgEngagement: twitterCheck.factors.twitterAvgEngagement || 0,
        twitterVerifiedUsers: twitterCheck.factors.twitterVerifiedUsers || 0,
        twitterFollowers: twitterCheck.factors.twitterFollowers || 0,
        twitterUniqueUsers: twitterCheck.factors.twitterUniqueUsers || 0,
        twitterSearchSuccess: twitterCheck.factors.twitterSearchSuccess || false,
        twitterSearchDuration: twitterCheck.factors.twitterSearchDuration || 0,
        // 强势交易者持仓因子
        strongTraderNetPositionRatio: strongTraderCheck.strongTraderNetPositionRatio || 0,
        strongTraderTotalBuyRatio: strongTraderCheck.strongTraderTotalBuyRatio || 0,
        strongTraderTotalSellRatio: strongTraderCheck.strongTraderTotalSellRatio || 0,
        strongTraderWalletCount: strongTraderCheck.strongTraderWalletCount || 0,
        strongTraderTradeCount: strongTraderCheck.strongTraderTradeCount || 0,
        strongTraderSellIntensity: strongTraderCheck.strongTraderSellIntensity || 0,
        // 趋势因子（允许在条件表达式中使用）
        drawdownFromHighest: drawdownFromHighest ?? 0,
        // 多次交易因子（允许在条件表达式中使用）
        buyRound: extraContext.buyRound || 1,
        lastPairReturnRate: extraContext.lastPairReturnRate ?? 0
        // 注意：以下因子主要用于调试，通常不用于条件表达式
        // earlyTradesCheckTimestamp, earlyTradesCheckDuration, earlyTradesCheckTime
        // earlyTradesWindow, earlyTradesExpectedFirstTime, earlyTradesExpectedLastTime
        // earlyTradesDataFirstTime, earlyTradesDataLastTime
        // walletClusterCheckTimestamp, walletClusterCheckDuration
        // earlyWhaleMethod, earlyWhaleTotalTrades, earlyWhaleEarlyThreshold
      };

      const canBuy = this._safeEvaluate(condition, context);

      this.logger.info('[PreBuyCheckService] 条件表达式评估完成', {
        token_address: context.token_address,
        condition,
        canBuy,
        context: {
          holderBlacklistCount: context.holderBlacklistCount,
          devHoldingRatio: context.devHoldingRatio,
          maxHoldingRatio: context.maxHoldingRatio,
          earlyTradesHighValueCount: context.earlyTradesHighValueCount,
          earlyTradesCountPerMin: context.earlyTradesCountPerMin,
          walletClusterSecondToFirstRatio: context.walletClusterSecondToFirstRatio,
          twitterTotalResults: context.twitterTotalResults,
          twitterSearchDuration: context.twitterSearchDuration
        }
      });

      return {
        ...baseResult,
        canBuy,
        preTraderCanBuy: canBuy,
        checkReason: canBuy ? '购买前检查通过' : `购买前检查失败: ${condition}`
      };
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 条件表达式评估失败', {
        condition,
        error: error.message
      });
      return {
        ...baseResult,
        canBuy: false,
        checkReason: `条件表达式错误: ${error.message}`
      };
    }
  }

  /**
   * 默认评估逻辑（向后兼容）
   * @private
   */
  _evaluateDefault(holderCheck, earlyParticipantCheck, startTime) {
    // 构建基础结果
    const result = {
      // 标记已执行预检查
      preBuyCheck: 1,
      checkTimestamp: Date.now(),
      checkDuration: Date.now() - startTime,

      // 持有者检查结果
      holderWhitelistCount: holderCheck.whitelistCount,
      holderBlacklistCount: holderCheck.blacklistCount,
      holdersCount: holderCheck.holdersCount,
      devHoldingRatio: holderCheck.devHoldingRatio,
      holderCanBuy: holderCheck.canBuy,

      // 持有者检查详细原因
      holderCheckReason: holderCheck.reason,
      blacklistReason: holderCheck.blacklistReason,
      devCheckReason: holderCheck.devReason,

      // 早期参与者检查结果
      ...earlyParticipantCheck,

      // 早期参与者购买资格评估
      preTraderCanBuy: null,
      preTraderCheckReason: null,

      // 综合结果
      canBuy: holderCheck.canBuy,
      checkReason: holderCheck.reason
    };

    // 评估早期参与者购买资格
    if (this.config.earlyParticipantFilterEnabled && earlyParticipantCheck.earlyTradesChecked === 1) {
      const eligibility = this.earlyParticipantService.evaluateBuyEligibility(
        earlyParticipantCheck,
        this.config
      );
      result.preTraderCanBuy = eligibility.canBuy;
      result.preTraderCheckReason = eligibility.reason;

      // 综合决策：两个检查都必须通过
      result.canBuy = result.holderCanBuy && result.preTraderCanBuy;
      result.checkReason = this._buildCombinedCheckReason(
        result.holderCanBuy,
        result.preTraderCanBuy,
        holderCheck.reason,
        eligibility.reason
      );
    }

    this.logger.info('[PreBuyCheckService] 购买前检查完成', {
      holderCanBuy: result.holderCanBuy,
      preTraderCanBuy: result.preTraderCanBuy,
      canBuy: result.canBuy,
      checkReason: result.checkReason,
      blacklistCount: result.holderBlacklistCount,
      whitelistCount: result.holderWhitelistCount,
      devHoldingRatio: result.devHoldingRatio,
      earlyTradesTotalCount: result.earlyTradesTotalCount || 0,
      earlyTradesVolumePerMin: result.earlyTradesVolumePerMin || 0,
      earlyTradesCountPerMin: result.earlyTradesCountPerMin || 0,
      earlyTradesHighValuePerMin: result.earlyTradesHighValuePerMin || 0
    });

    return result;
  }

  /**
   * 安全的表达式评估
   * @private
   */
  _safeEvaluate(expression, context) {
    // 替换 AND/OR 为 JavaScript 运算符
    const jsExpr = expression
      .replace(/\bAND\b/gi, '&&')
      .replace(/\bOR\b/gi, '||')
      .replace(/\bNOT\b/gi, '!');

    // 使用 Function 构造器评估
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `return ${jsExpr};`);
    return fn(...values);
  }

  /**
   * 执行持有者检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址
   * @param {string} experimentId - 实验ID
   * @param {string} signalId - 信号ID
   * @param {string} chain - 区块链
   * @param {boolean} skipHolderCheck - 是否跳过检查（回测时为 true）
   */
  async _performHolderCheck(tokenAddress, creatorAddress, experimentId, signalId, chain, skipHolderCheck = false) {
    if (skipHolderCheck || !this.config.holderCheckEnabled) {
      const reason = skipHolderCheck ? '持有者检查已跳过（回测模式）' : '持有者检查已禁用';
      return {
        canBuy: true,
        whitelistCount: 0,
        blacklistCount: 0,
        holdersCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        reason: reason,
        blacklistReason: '检查已跳过',
        devReason: '检查已跳过',
        largeHoldingReason: '检查已跳过'
      };
    }

    return await this.holderService.checkAllHolderRisks(
      tokenAddress,
      creatorAddress,
      experimentId,
      signalId,
      chain,
      this.config.devHoldingThreshold,
      this.config.largeHoldingThreshold
    );
  }

  /**
   * 执行早期参与者检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 区块链
   * @param {Object} tokenInfo - 代币信息（只需要 innerPair）
   * @param {number} checkTime - 检查时间戳（秒），用于回测时指定历史时间点
   * @param {boolean} skipEarlyParticipant - 是否跳过检查
   */
  async _performEarlyParticipantCheck(tokenAddress, chain, tokenInfo, checkTime = null, skipEarlyParticipant = false) {
    if (skipEarlyParticipant || !this.config.earlyParticipantCheckEnabled) {
      return this.earlyParticipantService.getEmptyFactorValues();
    }

    // 早期参与者检查只需要 innerPair，不再需要 launchAt
    if (!tokenInfo || !tokenInfo.innerPair) {
      this.logger.warn('[PreBuyCheckService] 缺少代币信息，跳过早期参与者检查', {
        token_address: tokenAddress,
        has_inner_pair: !!tokenInfo?.innerPair
      });
      return this.earlyParticipantService.getEmptyFactorValues();
    }

    // 使用传入的 checkTime，如果没有则使用当前时间
    const effectiveCheckTime = checkTime || Math.floor(Date.now() / 1000);

    return await this.earlyParticipantService.performCheck(
      tokenAddress,
      tokenInfo.innerPair,
      chain,
      null,  // launchAt 参数已不再使用
      effectiveCheckTime
    );
  }

  /**
   * 执行钱包簇检查
   * @private
   * @param {Object} earlyParticipantCheck - 早期参与者检查结果（包含 trades 数据）
   * @returns {Object} 钱包簇检查结果
   */
  async _performWalletClusterCheck(earlyParticipantCheck = null) {
    // 从早期参与者检查结果中获取交易数据
    const trades = earlyParticipantCheck?._trades;

    if (!trades || trades.length === 0) {
      return this.walletClusterService.getEmptyFactorValues();
    }

    try {
      // 使用早期参与者检查已经获取的交易数据
      return this.walletClusterService.performClusterAnalysis(trades);
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 钱包簇检查失败', {
        error: error.message
      });
      return this.walletClusterService.getEmptyFactorValues();
    }
  }

  /**
   * 执行Twitter搜索检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Object} Twitter搜索结果
   */
  async _performTwitterSearch(tokenAddress) {
    const startTime = Date.now();
    try {
      this.logger.debug('[PreBuyCheckService] 开始Twitter搜索', { token_address: tokenAddress });
      const result = await this.twitterSearchService.performCheck(tokenAddress);
      this.logger.debug('[PreBuyCheckService] Twitter搜索完成', {
        token_address: tokenAddress,
        success: result.success,
        duration: result.duration,
        factors_count: Object.keys(result.factors || {}).length
      });
      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] Twitter搜索检查失败', {
        token_address: tokenAddress,
        error: error.message,
        stack: error.stack
      });
      // 返回空因子值
      return {
        success: false,
        factors: this.twitterSearchService.getEmptyFactors(Date.now() - startTime, error.message),
        rawResult: null,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * 获取空的Twitter搜索检查结果（用于回测时跳过Twitter搜索）
   * @private
   * @returns {Object} 空的Twitter搜索结果
   */
  _getEmptyTwitterCheck() {
    return {
      success: false,
      factors: {
        twitterTotalResults: 0,
        twitterQualityTweets: 0,
        twitterLikes: 0,
        twitterRetweets: 0,
        twitterComments: 0,
        twitterTotalEngagement: 0,
        twitterAvgEngagement: 0,
        twitterVerifiedUsers: 0,
        twitterFollowers: 0,
        twitterUniqueUsers: 0,
        twitterSearchSuccess: false,
        twitterSearchDuration: 0,
        twitterSearchError: 'Skipped in backtest'
      },
      rawResult: null,
      duration: 0,
      error: 'Skipped in backtest'
    };
  }

  /**
   * 执行强势交易者持仓检查
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} pairAddress - 交易对地址（innerPair）
   * @param {number} checkTime - 检查时间戳（秒）
   * @param {boolean} skipEarlyParticipant - 是否跳过检查（与早期参与者检查同步）
   * @returns {Promise<Object>} 强势交易者持仓检查结果
   */
  async _performStrongTraderPositionCheck(tokenAddress, pairAddress, checkTime = null, skipEarlyParticipant = false) {
    // 如果跳过早期参与者检查，也跳过强势交易者检查（因为使用同样的时间窗口）
    if (skipEarlyParticipant) {
      return this.strongTraderPositionService.getEmptyFactorValues();
    }

    // 如果没有交易对地址，返回空值
    if (!pairAddress) {
      this.logger.warn('[PreBuyCheckService] 缺少交易对地址，跳过强势交易者持仓检查', {
        token_address: tokenAddress,
        has_pair_address: !!pairAddress
      });
      return this.strongTraderPositionService.getEmptyFactorValues();
    }

    try {
      // 使用传入的 checkTime，如果没有则使用当前时间
      const effectiveCheckTime = checkTime || Math.floor(Date.now() / 1000);

      this.logger.debug('[PreBuyCheckService] 开始强势交易者持仓检查', {
        token_address: tokenAddress,
        pair_address: pairAddress,
        check_time: effectiveCheckTime
      });

      const result = await this.strongTraderPositionService.analyzePosition(
        tokenAddress,
        pairAddress,
        effectiveCheckTime
      );

      this.logger.debug('[PreBuyCheckService] 强势交易者持仓检查完成', {
        token_address: tokenAddress,
        net_position_ratio: result.strongTraderNetPositionRatio,
        wallet_count: result.strongTraderWalletCount,
        trade_count: result.strongTraderTradeCount,
        total_trades_analyzed: result._meta?.total_trades_analyzed || 0
      });

      return result;
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 强势交易者持仓检查失败', {
        token_address: tokenAddress,
        pair_address: pairAddress,
        error: error.message
      });
      return this.strongTraderPositionService.getEmptyFactorValues();
    }
  }

  /**
   * 构建综合检查原因
   * @private
   */
  _buildCombinedCheckReason(holderCanBuy, preTraderCanBuy, holderReason, preTraderReason) {
    const reasons = [];

    if (!holderCanBuy) {
      reasons.push(`持有者: ${holderReason}`);
    }

    if (!preTraderCanBuy) {
      reasons.push(`早期参与者: ${preTraderReason}`);
    }

    if (reasons.length === 0) {
      return '所有检查通过';
    }

    return reasons.join(' | ');
  }

  /**
   * 获取未执行检查时的默认因子值
   * @returns {Object} 默认因子值
   */
  getEmptyFactorValues() {
    return {
      preBuyCheck: 0,
      checkTimestamp: null,
      checkDuration: null,
      holderWhitelistCount: 0,
      holderBlacklistCount: 0,
      holdersCount: 0,
      devHoldingRatio: 0,
      maxHoldingRatio: 0,
      holderCanBuy: null,
      preTraderCanBuy: null,
      preTraderCheckReason: null,
      // 创建者Dev钱包检查（默认值：null 表示未检查）
      creatorIsNotBadDevWallet: null,
      // 多次交易因子（默认值）
      buyRound: 1,
      lastPairReturnRate: 0,
      ...this.earlyParticipantService.getEmptyFactorValues(),
      ...this.walletClusterService.getEmptyFactorValues(),
      // Twitter因子
      twitterTotalResults: 0,
      twitterQualityTweets: 0,
      twitterLikes: 0,
      twitterRetweets: 0,
      twitterComments: 0,
      twitterTotalEngagement: 0,
      twitterAvgEngagement: 0,
      twitterVerifiedUsers: 0,
      twitterFollowers: 0,
      twitterUniqueUsers: 0,
      twitterSearchSuccess: false,
      twitterSearchDuration: 0,
      twitterSearchError: null,
      // 强势交易者持仓因子
      ...this.strongTraderPositionService.getEmptyFactorValues()
    };
  }

  /**
   * 检查创建者是否为坏Dev钱包
   * @private
   * @param {string} creatorAddress - 创建者地址
   * @returns {Promise<Object>} { creatorIsNotBadDevWallet: number } 1=不在Dev列表中（好）, 0=在Dev列表中（坏）
   */
  async _checkCreatorIsNotBadDevWallet(creatorAddress) {
    // 数据异常（无创建者地址）时，默认给 1（通过）
    if (!creatorAddress) {
      this.logger.info('[PreBuyCheckService] 创建者地址为空，默认通过', {
        creator_address: creatorAddress
      });
      return { creatorIsNotBadDevWallet: 1 };
    }

    try {
      const walletService = new WalletDataService();
      const allWallets = await walletService.getWallets();
      const devWallets = allWallets.filter(w => w.category === 'dev');

      const isBadDevWallet = devWallets.some(
        w => w.address.toLowerCase() === creatorAddress.toLowerCase()
      );

      // 1 = 不在Dev列表中（好）, 0 = 在Dev列表中（坏）
      const result = isBadDevWallet ? 0 : 1;

      this.logger.info('[PreBuyCheckService] 创建者Dev钱包检查完成', {
        creator_address: creatorAddress,
        is_bad_dev_wallet: isBadDevWallet,
        creatorIsNotBadDevWallet: result
      });

      return { creatorIsNotBadDevWallet: result };
    } catch (error) {
      this.logger.error('[PreBuyCheckService] 创建者Dev钱包检查失败', {
        creator_address: creatorAddress,
        error: error.message
      });
      // 检查失败时保守处理，返回 1（不拒绝）
      return { creatorIsNotBadDevWallet: 1 };
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

module.exports = { PreBuyCheckService };
