/**
 * 代币持有者服务
 * 用于检测代币持有者是否包含黑名单钱包
 *
 * P5 清理（2026-10-13）：AVE 持有者检查族（fetchAndStoreHolders/checkAllHolderRisks/
 * checkDevHoldingRatio/_getHoldersFromAVE 等）已随原始实现尸体一并删除——回测拿到的是
 * 最新数据而非历史快照，该族自停用起从未被任何链路调用。存活链路只有钱包黑白名单
 * 缓存（initWalletCache）与早期交易者名单匹配（checkEarlyTradersRisk）。
 */

/**
 * 安全地获取错误消息
 * @private
 * @param {*} error - 错误对象
 * @returns {string} 错误消息
 */
function _safeGetErrorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.error) return error.error;
  return String(error);
}

class TokenHolderService {
  /**
   * @param {Object} supabase - Supabase客户端
   * @param {Object} logger - Logger实例
   */
  constructor(supabase, logger) {
    this.supabase = supabase;
    this.logger = logger;

    // 黑白名单缓存（初始化时加载一次，不更新）
    this._blacklistAddresses = new Set(); // 黑名单地址（不含白名单）
    this._whitelistAddresses = new Set();  // 白名单地址
    this._cacheLoaded = false;
  }

  /**
   * 初始化钱包缓存（在引擎启动时调用）
   */
  async initWalletCache(chain = 'bsc') {
    if (this._cacheLoaded) {
      this.logger.info('[TokenHolderService] 钱包缓存已加载，跳过');
      return;
    }

    try {
      this.logger.info('[TokenHolderService] 开始加载钱包缓存...', { chain });

      // 并行获取黑白名单
      const [blacklistResult, whitelistResult] = await Promise.all([
        this._fetchWalletsByCategories(['pump_group', 'negative_holder', 'dev'], chain),
        this._fetchWalletsByCategories(['good_holder'], chain)
      ]);

      this._blacklistAddresses = new Set(blacklistResult.map(w => w.address.toLowerCase()));
      this._whitelistAddresses = new Set(whitelistResult.map(w => w.address.toLowerCase()));

      this._cacheLoaded = true;

      this.logger.info('[TokenHolderService] 钱包缓存加载完成', {
        chain,
        blacklistCount: this._blacklistAddresses.size,
        whitelistCount: this._whitelistAddresses.size
      });
    } catch (error) {
      this.logger.error('[TokenHolderService] 钱包缓存加载失败', error);
      throw error;
    }
  }

  /**
   * 分批获取钱包（处理 Supabase 1000 条限制）
   * @param {Array<string>} categories - 钱包分类
   * @returns {Promise<Array<{address: string}>>}
   */
  async _fetchWalletsByCategories(categories, chain = 'bsc') {
    const allWallets = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('address')
        .in('category', categories)
        .eq('chain', chain)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        throw new Error(`获取钱包数据失败: ${_safeGetErrorMessage(error)}`);
      }

      if (data && data.length > 0) {
        allWallets.push(...data);
        hasMore = data.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    this.logger.info('[TokenHolderService] 分批获取钱包完成', {
      categories,
      totalPages: page,
      totalCount: allWallets.length
    });

    return allWallets;
  }

  /**
   * 确保缓存已加载
   * @private
   */
  async _ensureCacheLoaded() {
    if (!this._cacheLoaded) {
      await this.initWalletCache();
    }
  }

  /**
   * 评估是否可以购买
   * @private
   * @param {number} whitelistCount - 白名单数量
   * @param {number} blacklistCount - 黑名单数量
   * @returns {boolean}
   */
  _evaluateCanBuy(whitelistCount, blacklistCount) {
    return true;
  }

  /**
   * 检查早期交易者的黑白名单风险
   * 从交易数据中提取所有参与者地址（买方+卖方），与黑白名单缓存匹配
   *
   * @param {Array} trades - 早期交易数据数组（来自 EarlyParticipantCheckService._trades）
   * @returns {Promise<Object>} { earlyTraderBlacklistCount, earlyTraderWhitelistCount, earlyTraderUniqueParticipants, earlyTraderCanBuy, reason }
   */
  async checkEarlyTradersRisk(trades) {
    try {
      // 确保缓存已加载
      await this._ensureCacheLoaded();

      // 边界情况：无交易数据
      if (!trades || trades.length === 0) {
        return {
          earlyTraderBlacklistCount: 0,
          earlyTraderWhitelistCount: 0,
          earlyTraderUniqueParticipants: 0,
          earlyTraderBlacklistRatio: 0,
          earlyTraderCanBuy: true,
          reason: '无早期交易数据'
        };
      }

      // 提取所有唯一参与者地址（使用 wallet_address 识别真实用户，from_address 可能是路由合约）
      const participants = new Set();
      for (const trade of trades) {
        const participant = trade.wallet_address || trade.from_address;
        if (participant) participants.add(participant.toLowerCase());
      }

      // 与黑白名单匹配
      let blacklistCount = 0;
      let whitelistCount = 0;

      for (const addr of participants) {
        // 白名单优先（与持有者检查逻辑一致）
        if (this._whitelistAddresses.has(addr)) {
          whitelistCount++;
        } else if (this._blacklistAddresses.has(addr)) {
          blacklistCount++;
        }
      }

      const canBuy = this._evaluateCanBuy(whitelistCount, blacklistCount);
      const reason = this._getEarlyTraderReason(whitelistCount, blacklistCount, canBuy);

      this.logger.info('[TokenHolderService] 早期交易者黑白名单检查结果', {
        unique_participants: participants.size,
        blacklist_count: blacklistCount,
        whitelist_count: whitelistCount,
        canBuy,
        reason
      });

      const earlyTraderBlacklistRatio = participants.size > 0 ? blacklistCount / participants.size : 0;

      return {
        earlyTraderBlacklistCount: blacklistCount,
        earlyTraderWhitelistCount: whitelistCount,
        earlyTraderUniqueParticipants: participants.size,
        earlyTraderBlacklistRatio,
        earlyTraderCanBuy: canBuy,
        reason
      };

    } catch (error) {
      this.logger.error('[TokenHolderService] 早期交易者黑白名单检查失败', {
        error: _safeGetErrorMessage(error)
      });
      return {
        earlyTraderBlacklistCount: 0,
        earlyTraderWhitelistCount: 0,
        earlyTraderUniqueParticipants: 0,
        earlyTraderBlacklistRatio: 0,
        earlyTraderCanBuy: false,
        reason: `检查失败: ${_safeGetErrorMessage(error)}`
      };
    }
  }

  /**
   * 生成早期交易者黑白名单原因说明
   * @private
   * @param {number} whitelistCount - 白名单数量
   * @param {number} blacklistCount - 黑名单数量
   * @param {boolean} canBuy - 是否可以购买
   * @returns {string}
   */
  _getEarlyTraderReason(whitelistCount, blacklistCount, canBuy) {
    if (whitelistCount === 0 && blacklistCount === 0) {
      return '早期交易者无黑白名单命中';
    }
    return `早期交易者黑白名单: 白名单${whitelistCount}个, 黑名单${blacklistCount}个`;
  }
}

module.exports = { TokenHolderService };
