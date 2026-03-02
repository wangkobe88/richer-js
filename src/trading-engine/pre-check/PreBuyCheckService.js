/**
 * 购买前检查服务
 * 统一的购买前检查入口，整合所有预检查逻辑
 *
 * 职责：
 * 1. 执行购买前的所有检查（黑/白名单、Dev持仓等）
 * 2. 返回结构化的检查结果
 * 3. 将检查结果转换为因子格式
 */

const { TokenHolderService } = require('../holders/TokenHolderService');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  devHoldingThreshold: 15,  // Dev持仓阈值（百分比）
  holderCheckEnabled: true   // 是否启用持有者检查
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
   * @returns {Promise<Object>} 检查结果
   */
  async performAllChecks(tokenAddress, creatorAddress, experimentId, chain = 'bsc') {
    const startTime = Date.now();

    this.logger.info('[PreBuyCheckService] 开始执行购买前检查', {
      token_address: tokenAddress,
      creator_address: creatorAddress || 'none',
      experiment_id: experimentId,
      chain
    });

    try {
      // 执行持有者检查
      const holderCheck = await this._performHolderCheck(
        tokenAddress,
        creatorAddress,
        experimentId,
        chain
      );

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

        // 详细原因（用于日志）
        holderCheckReason: holderCheck.reason,
        blacklistReason: holderCheck.blacklistReason,
        devCheckReason: holderCheck.devReason,

        // 综合结果
        canBuy: holderCheck.canBuy,
        checkReason: holderCheck.reason
      };

      this.logger.info('[PreBuyCheckService] 购买前检查完成', {
        token_address: tokenAddress,
        canBuy: result.canBuy,
        blacklistCount: result.holderBlacklistCount,
        whitelistCount: result.holderWhitelistCount,
        devHoldingRatio: result.devHoldingRatio,
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
        checkReason: `购买前检查失败: ${errorMessage}`
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
        reason: '持有者检查已禁用',
        blacklistReason: '检查已禁用',
        devReason: '检查已禁用'
      };
    }

    return await this.holderService.checkAllHolderRisks(
      tokenAddress,
      creatorAddress,
      experimentId,
      chain,
      this.config.devHoldingThreshold
    );
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
      holderCanBuy: null
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
