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

    // 初始化早期参与者检查服务
    this.earlyParticipantService = new EarlyParticipantCheckService(logger, {
      calculateGrowthScore: false  // 暂不计算增长评分
    });
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
   * @param {string} chain - 区块链
   * @param {Object} tokenInfo - 代币信息（用于早期参与者检查）
   * @param {number} tokenInfo.launchAt - 代币创建时间戳（秒）
   * @param {string} tokenInfo.innerPair - 内盘交易对
   * @returns {Promise<Object>} 检查结果
   */
  async performAllChecks(tokenAddress, creatorAddress, experimentId, chain = 'bsc', tokenInfo = null) {
    const startTime = Date.now();

    this.logger.info('[PreBuyCheckService] 开始执行购买前检查', {
      token_address: tokenAddress,
      creator_address: creatorAddress || 'none',
      experiment_id: experimentId,
      chain
    });

    try {
      // 并行执行检查（如果都有数据）
      const [holderCheck, earlyParticipantCheck] = await Promise.all([
        this._performHolderCheck(tokenAddress, creatorAddress, experimentId, chain),
        this._performEarlyParticipantCheck(tokenAddress, chain, tokenInfo)
      ]);

      // 构建结果
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
        token_address: tokenAddress,
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
        earlyTradesHighValuePerMin: result.earlyTradesHighValuePerMin || 0,
        duration: result.checkDuration
      });

      return result;

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
        holderCanBuy: false,

        holderCheckReason: `检查失败: ${errorMessage}`,
        blacklistReason: `检查失败: ${errorMessage}`,
        devCheckReason: `检查失败: ${errorMessage}`,

        canBuy: false,
        checkReason: `购买前检查失败: ${errorMessage}`,

        // 早期参与者检查失败时的空值
        ...this.earlyParticipantService.getEmptyFactorValues()
      };
    }
  }

  /**
   * 执行持有者检查
   * @private
   */
  async _performHolderCheck(tokenAddress, creatorAddress, experimentId, chain) {
    if (!this.config.holderCheckEnabled) {
      return {
        canBuy: true,
        whitelistCount: 0,
        blacklistCount: 0,
        holdersCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        reason: '持有者检查已禁用',
        blacklistReason: '检查已禁用',
        devReason: '检查已禁用',
        largeHoldingReason: '检查已禁用'
      };
    }

    return await this.holderService.checkAllHolderRisks(
      tokenAddress,
      creatorAddress,
      experimentId,
      chain,
      this.config.devHoldingThreshold,
      this.config.largeHoldingThreshold
    );
  }

  /**
   * 执行早期参与者检查
   * @private
   */
  async _performEarlyParticipantCheck(tokenAddress, chain, tokenInfo) {
    if (!this.config.earlyParticipantCheckEnabled) {
      return this.earlyParticipantService.getEmptyFactorValues();
    }

    if (!tokenInfo || !tokenInfo.launchAt || !tokenInfo.innerPair) {
      this.logger.warn('[PreBuyCheckService] 缺少代币信息，跳过早期参与者检查', {
        token_address: tokenAddress,
        has_launch_at: !!tokenInfo?.launchAt,
        has_inner_pair: !!tokenInfo?.innerPair
      });
      return this.earlyParticipantService.getEmptyFactorValues();
    }

    return await this.earlyParticipantService.performCheck(
      tokenAddress,
      tokenInfo.innerPair,
      chain,
      tokenInfo.launchAt,
      Math.floor(Date.now() / 1000)
    );
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
      ...this.earlyParticipantService.getEmptyFactorValues()
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

module.exports = { PreBuyCheckService };
