/**
 * 代币持有者服务
 * 用于检测代币持有者是否包含黑名单钱包
 */

const config = require('../../../config/default.json');

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

/**
 * 安全地解析 balance_ratio 为数字
 * AVE API 返回的 balance_ratio 可能是：
 * - 数字（如 0.0525）
 * - 字符串百分比（如 "5.25%"）
 * - 字符串小数（如 "0.0525"）
 * - 空字符串或其他无效值
 * @private
 * @param {*} ratio - balance_ratio 值
 * @returns {number} 解析后的百分比（0-100）
 */
function _parseBalanceRatio(ratio) {
  if (ratio === null || ratio === undefined) return 0;
  if (typeof ratio === 'number') {
    // 如果已经是数字，可能是小数（0.0525）或百分比（5.25）
    // 假设 <= 1 的值是小数形式，需要 * 100
    return ratio <= 1 ? ratio * 100 : ratio;
  }
  if (typeof ratio === 'string') {
    const trimmed = ratio.trim();
    if (trimmed === '') return 0;
    // 移除可能的 % 符号
    const numericStr = trimmed.replace('%', '');
    const parsed = parseFloat(numericStr);
    if (isNaN(parsed)) return 0;
    // 如果 <= 1，假设是小数形式，需要 * 100
    return parsed <= 1 ? parsed * 100 : parsed;
  }
  return 0;
}

class TokenHolderService {
  /**
   * @param {Object} supabase - Supabase客户端
   * @param {Object} logger - Logger实例
   */
  constructor(supabase, logger) {
    this.supabase = supabase;
    this.logger = logger;
    this.aveApi = null;

    // 黑白名单缓存（初始化时加载一次，不更新）
    this._blacklistAddresses = new Set(); // 黑名单地址（不含白名单）
    this._whitelistAddresses = new Set();  // 白名单地址
    this._lpAddresses = new Set();         // LP地址（用于排除）
    this._cacheLoaded = false;

    // 常用DEX LP地址（BSC）
    this._commonLPAddresses = new Set([
      '0x5c952063c7fc8610ffdb798152d69f0b9550762b'  // 4meme LP
    ]);
  }

  /**
   * 初始化钱包缓存（在引擎启动时调用）
   */
  async initWalletCache() {
    if (this._cacheLoaded) {
      this.logger.info('[TokenHolderService] 钱包缓存已加载，跳过');
      return;
    }

    try {
      this.logger.info('[TokenHolderService] 开始加载钱包缓存...');

      // 并行获取黑白名单
      const [blacklistResult, whitelistResult] = await Promise.all([
        this._fetchWalletsByCategories(['pump_group', 'negative_holder', 'dev']),
        this._fetchWalletsByCategories(['good_holder'])
      ]);

      this._blacklistAddresses = new Set(blacklistResult.map(w => w.address.toLowerCase()));
      this._whitelistAddresses = new Set(whitelistResult.map(w => w.address.toLowerCase()));

      // LP地址直接使用硬编码列表
      this._lpAddresses = new Set(this._commonLPAddresses);

      this._cacheLoaded = true;

      this.logger.info('[TokenHolderService] 钱包缓存加载完成', {
        blacklistCount: this._blacklistAddresses.size,
        whitelistCount: this._whitelistAddresses.size,
        lpCount: this._lpAddresses.size
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
  async _fetchWalletsByCategories(categories) {
    const allWallets = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('address')
        .in('category', categories)
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
   * 获取并存储代币持有者信息
   * @param {string} tokenAddress - 代币地址
   * @param {string} experimentId - 实验ID，可为 null
   * @param {string} signalId - 信号ID，可为 null
   * @param {string} chain - 区块链，默认 'bsc'
   * @returns {Promise<Object>} { snapshotId, holders }
   */
  async fetchAndStoreHolders(tokenAddress, experimentId, signalId, chain = 'bsc') {
    try {
      // 从AVE获取持有者数据
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 生成快照ID
      const snapshotId = `${tokenAddress}_${Date.now()}`;

      // 存储到数据库
      await this._storeHolders(tokenAddress, experimentId, signalId, snapshotId, holderData);

      return {
        snapshotId,
        holders: holderData.holders || [],
        token: holderData.token
      };
    } catch (error) {
      this.logger.error(null, 'TokenHolderService',
        `获取持有者失败: ${tokenAddress} - ${_safeGetErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * 检查持有者风险（基于黑白名单缓存）
   * @param {string} tokenAddress - 代币地址
   * @param {string} experimentId - 实验ID，可为 null
   * @param {string} signalId - 信号ID，可为 null
   * @param {string} chain - 区块链，默认 'bsc'
   * @returns {Promise<Object>} { canBuy, whitelistCount, blacklistCount, reason }
   */
  async checkHolderRisk(tokenAddress, experimentId, signalId, chain = 'bsc') {
    try {
      // 确保缓存已加载
      await this._ensureCacheLoaded();

      // 获取持有者数据
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 存储到数据库
      const snapshotId = `${tokenAddress}_${Date.now()}`;
      await this._storeHolders(tokenAddress, experimentId, signalId, snapshotId, holderData);

      // 使用缓存数据检查
      return this._checkHoldersWithCache(holderData.holders);
    } catch (error) {
      this.logger.error(null, 'TokenHolderService',
        `检查持有者风险失败: ${tokenAddress} - ${_safeGetErrorMessage(error)}`);
      // 出错时默认返回不可购买，保守处理
      return {
        canBuy: false,
        whitelistCount: 0,
        blacklistCount: 0,
        reason: `检查失败: ${_safeGetErrorMessage(error)}`
      };
    }
  }

  /**
   * 综合持有者检查（一次性完成所有检查）
   * 包括：黑/白名单检查 + Dev持仓比例检查 + 大额持仓检查
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址（可为null）
   * @param {string} experimentId - 实验ID，可为null
   * @param {string} signalId - 信号ID，可为null
   * @param {string} chain - 区块链，默认 'bsc'
   * @param {number} devThreshold - Dev持仓阈值（百分比），默认 15
   * @param {number} largeHoldingThreshold - 大额持仓阈值（百分比），默认 18
   * @returns {Promise<Object>} 综合检查结果
   */
  async checkAllHolderRisks(tokenAddress, creatorAddress, experimentId, signalId, chain = 'bsc', devThreshold = 15, largeHoldingThreshold = 18) {
    try {
      // 确保缓存已加载
      await this._ensureCacheLoaded();

      // 获取持有者数据（只调用一次 API）
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 存储到数据库
      const snapshotId = `${tokenAddress}_${Date.now()}`;
      await this._storeHolders(tokenAddress, experimentId, signalId, snapshotId, holderData);

      // 1. 黑/白名单检查
      const blacklistCheck = this._checkHoldersWithCache(holderData.holders);

      // 2. Dev 持仓检查
      let devCheck = { canBuy: true, devHoldingRatio: 0, reason: '无创建者地址，跳过' };
      if (creatorAddress) {
        const creator = holderData.holders?.find(
          h => h.address && h.address.toLowerCase() === creatorAddress.toLowerCase()
        );
        if (creator) {
          const devHoldingRatio = _parseBalanceRatio(creator.balance_ratio);
          const canBuy = devHoldingRatio < devThreshold;
          devCheck = {
            canBuy,
            devHoldingRatio,
            reason: canBuy
              ? `Dev持仓比例${devHoldingRatio.toFixed(1)}%正常`
              : `Dev持仓比例${devHoldingRatio.toFixed(1)}%超过阈值${devThreshold}%`
          };
        } else {
          devCheck = { canBuy: true, devHoldingRatio: 0, reason: 'Dev不在持有者中' };
        }
      }

      // 3. 大额持仓检查（排除LP地址）
      const largeHoldingCheck = this._checkLargeHolding(holderData.holders, largeHoldingThreshold);

      // 合并结果
      const canBuy = blacklistCheck.canBuy && devCheck.canBuy && largeHoldingCheck.canBuy;
      const reasons = [];
      if (!blacklistCheck.canBuy) reasons.push(`黑/白名单: ${blacklistCheck.reason}`);
      if (!devCheck.canBuy) reasons.push(`Dev持仓: ${devCheck.reason}`);
      if (!largeHoldingCheck.canBuy) reasons.push(`大额持仓: ${largeHoldingCheck.reason}`);
      if (canBuy && reasons.length === 0) {
        reasons.push('所有持有者检查通过');
      }

      this.logger.info('[TokenHolderService] 综合持有者检查完成', {
        token_address: tokenAddress,
        creator_address: creatorAddress || 'none',
        canBuy,
        blacklistCheck,
        devCheck,
        largeHoldingCheck
      });

      return {
        canBuy,
        whitelistCount: blacklistCheck.whitelistCount,
        blacklistCount: blacklistCheck.blacklistCount,
        devHoldingRatio: devCheck.devHoldingRatio,
        maxHoldingRatio: largeHoldingCheck.maxHoldingRatio,
        reason: reasons.join('; '),
        blacklistReason: blacklistCheck.reason,
        devReason: devCheck.reason,
        largeHoldingReason: largeHoldingCheck.reason,
        // 返回持有者数据供后续使用（如果需要）
        holdersCount: holderData.holders?.length || 0
      };

    } catch (error) {
      const errorMessage = _safeGetErrorMessage(error);
      this.logger.error('[TokenHolderService] 综合持有者检查失败', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        error: errorMessage
      });
      // 出错时保守处理，拒绝购买
      return {
        canBuy: false,
        whitelistCount: 0,
        blacklistCount: 0,
        devHoldingRatio: 0,
        maxHoldingRatio: 0,
        reason: `持有者检查失败: ${errorMessage}`,
        blacklistReason: `检查失败: ${errorMessage}`,
        devReason: `检查失败: ${errorMessage}`,
        largeHoldingReason: `检查失败: ${errorMessage}`,
        holdersCount: 0
      };
    }
  }

  /**
   * 私有方法：从AVE获取持有者
   * @private
   */
  async _getHoldersFromAVE(tokenAddress, chain = 'bsc') {
    if (!this.aveApi) {
      const { AveTokenAPI } = require('../../core/ave-api');
      const apiKey = process.env.AVE_API_KEY;

      this.aveApi = new AveTokenAPI(
        config.ave.apiUrl,
        config.ave.timeout,
        apiKey
      );
    }

    // AVE API 需要 tokenId 格式为 {address}-{chain}
    const tokenId = `${tokenAddress}-${chain}`;

    // 使用 AveTokenAPI 的 getTokenTop100Holders 方法
    const holders = await this.aveApi.getTokenTop100Holders(tokenId);

    // getTokenTop100Holders 返回的是持有者数组
    if (!holders || !Array.isArray(holders)) {
      throw new Error('AVE API返回数据格式错误');
    }

    // 包装成统一格式
    return {
      holders: holders,
      token: tokenAddress
    };
  }

  /**
   * 私有方法：存储持有者数据（总是插入新记录）
   * @private
   */
  async _storeHolders(tokenAddress, experimentId, signalId, snapshotId, holderData) {
    // 添加调试日志
    this.logger.info('[TokenHolderService] 准备存储持有者数据', {
      token_address: tokenAddress,
      experiment_id: experimentId,
      signal_id: signalId,
      holders_count: holderData.holders?.length || 0
    });

    // 直接插入新记录（一个代币可以有多条持有者记录）
    const { error, data } = await this.supabase
      .from('token_holders')
      .insert({
        token_address: tokenAddress,
        experiment_id: experimentId,
        signal_id: signalId,
        holder_data: holderData,
        snapshot_id: snapshotId
      })
      .select()
      .single();

    if (error) {
      this.logger.error('[TokenHolderService] 插入失败', {
        error: _safeGetErrorMessage(error),
        details: error.hint || error.details || error.code,
        token_address: tokenAddress,
        experiment_id: experimentId,
        signal_id: signalId
      });
      throw new Error(`存储持有者数据失败: ${_safeGetErrorMessage(error)}`);
    }

    this.logger.info('[TokenHolderService] 插入成功', {
      token_address: tokenAddress,
      experiment_id: experimentId,
      signal_id: signalId,
      inserted_id: data?.id
    });
  }

  /**
   * 私有方法：获取最新持有者数据
   * @private
   */
  async _getLatestHolders(tokenAddress) {
    const { data, error } = await this.supabase
      .from('token_holders')
      .select('holder_data')
      .eq('token_address', tokenAddress)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle(); // 使用 maybeSingle 允许没有结果

    if (error) {
      throw new Error(`查询持有者数据失败: ${_safeGetErrorMessage(error)}`);
    }

    return data?.holder_data;
  }

  /**
   * 使用缓存检查持有者（新逻辑）
   * @private
   * @param {Array} holders - 持有者数组
   * @returns {Object} { canBuy, whitelistCount, blacklistCount, reason }
   */
  _checkHoldersWithCache(holders) {
    if (!holders || holders.length === 0) {
      return {
        canBuy: true,
        whitelistCount: 0,
        blacklistCount: 0,
        reason: '无持有者数据'
      };
    }

    let whitelistCount = 0;
    let blacklistCount = 0;
    const matchedBlacklist = [];
    const matchedWhitelist = [];

    holders.forEach(holder => {
      const addr = holder.address?.toLowerCase();
      if (!addr) return;

      // 优先检查白名单（白名单会覆盖黑名单）
      if (this._whitelistAddresses.has(addr)) {
        whitelistCount++;
        matchedWhitelist.push(addr);
      } else if (this._blacklistAddresses.has(addr)) {
        blacklistCount++;
        matchedBlacklist.push(addr);
      }
    });

    // 判断逻辑
    const canBuy = this._evaluateCanBuy(whitelistCount, blacklistCount);
    const reason = this._getReason(whitelistCount, blacklistCount, canBuy);

    this.logger.info('[TokenHolderService] 持有者检查结果', {
      whitelistCount,
      blacklistCount,
      canBuy,
      reason,
      matchedBlacklist: matchedBlacklist.slice(0, 5), // 只记录前5个
      matchedWhitelist: matchedWhitelist.slice(0, 5)
    });

    return {
      canBuy,
      whitelistCount,
      blacklistCount,
      reason
    };
  }

  /**
   * 评估是否可以购买
   * @private
   * @param {number} whitelistCount - 白名单数量
   * @param {number} blacklistCount - 黑名单数量
   * @returns {boolean}
   */
  _evaluateCanBuy(whitelistCount, blacklistCount) {
    // 条件1：黑白名单均没有命中
    if (whitelistCount === 0 && blacklistCount === 0) {
      return true;
    }

    // 条件2：白名单 >= 黑名单 * 2，且黑名单 <= 10
    if (blacklistCount <= 10 && whitelistCount >= blacklistCount * 2) {
      return true;
    }

    return false;
  }

  /**
   * 生成原因说明
   * @private
   * @param {number} whitelistCount - 白名单数量
   * @param {number} blacklistCount - 黑名单数量
   * @param {boolean} canBuy - 是否可以购买
   * @returns {string}
   */
  _getReason(whitelistCount, blacklistCount, canBuy) {
    if (canBuy) {
      if (whitelistCount === 0 && blacklistCount === 0) {
        return '无黑白名单命中';
      }
      return `白名单${whitelistCount}个 >= 黑名单${blacklistCount}个 × 2，且黑名单 ≤ 10`;
    }

    if (blacklistCount > 10) {
      return `黑名单持有者过多(${blacklistCount}个 > 10)`;
    }
    if (blacklistCount > 0 && whitelistCount < blacklistCount * 2) {
      return `白名单不足(${whitelistCount}个 < 黑名单${blacklistCount}个 × 2)`;
    }
    if (blacklistCount > 0 && whitelistCount === 0) {
      return `命中黑名单但无白名单抵消(${blacklistCount}个黑名单)`;
    }
    return '未知原因';
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

      // 提取所有唯一参与者地址（买方 + 卖方）
      const participants = new Set();
      for (const trade of trades) {
        if (trade.from_address) participants.add(trade.from_address.toLowerCase());
        if (trade.to_address) participants.add(trade.to_address.toLowerCase());
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
    if (canBuy) {
      if (whitelistCount === 0 && blacklistCount === 0) {
        return '早期交易者无黑白名单命中';
      }
      return `白名单${whitelistCount}个 >= 黑名单${blacklistCount}个 × 2，且黑名单 ≤ 10`;
    }

    if (blacklistCount > 10) {
      return `早期交易者黑名单过多(${blacklistCount}个 > 10)`;
    }
    if (blacklistCount > 0 && whitelistCount < blacklistCount * 2) {
      return `早期交易者白名单不足(${whitelistCount}个 < 黑名单${blacklistCount}个 × 2)`;
    }
    if (blacklistCount > 0 && whitelistCount === 0) {
      return `早期交易者命中黑名单但无白名单抵消(${blacklistCount}个黑名单)`;
    }
    return '未知原因';
  }

  /**
   * 检查Dev持仓比例是否超过阈值
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址
   * @param {string} chain - 区块链
   * @param {number} threshold - 阈值（百分比，如15表示15%）
   * @returns {Promise<Object>} { canBuy, devHoldingRatio, reason }
   */
  async checkDevHoldingRatio(tokenAddress, creatorAddress, chain = 'bsc', threshold = 15) {
    try {
      this.logger.info('[TokenHolderService] 开始Dev持仓检查', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        threshold: `${threshold}%`
      });

      // 如果没有创建者地址，无法检查，默认通过
      if (!creatorAddress) {
        return {
          canBuy: true,
          devHoldingRatio: 0,
          reason: '无创建者地址，跳过Dev持仓检查'
        };
      }

      // 获取持有者数据
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      if (!holderData.holders || holderData.holders.length === 0) {
        return {
          canBuy: true,
          devHoldingRatio: 0,
          reason: '无持有者数据，跳过Dev持仓检查'
        };
      }

      // 查找创建者在持有者中的数据
      const creator = holderData.holders.find(
        h => h.address && h.address.toLowerCase() === creatorAddress.toLowerCase()
      );

      if (!creator) {
        // Dev不在持有者中，通过检查
        this.logger.info('[TokenHolderService] Dev不在持有者中', {
          token_address: tokenAddress,
          creator_address: creatorAddress
        });
        return {
          canBuy: true,
          devHoldingRatio: 0,
          reason: 'Dev不在持有者中'
        };
      }

      // 计算Dev持仓比例
      const devHoldingRatio = _parseBalanceRatio(creator.balance_ratio);
      const canBuy = devHoldingRatio < threshold;

      this.logger.info('[TokenHolderService] Dev持仓检查结果', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        devHoldingRatio: `${devHoldingRatio.toFixed(1)}%`,
        threshold: `${threshold}%`,
        canBuy
      });

      return {
        canBuy,
        devHoldingRatio,
        reason: canBuy
          ? `Dev持仓比例${devHoldingRatio.toFixed(1)}%正常`
          : `Dev持仓比例${devHoldingRatio.toFixed(1)}%超过阈值${threshold}%`
      };

    } catch (error) {
      const errorMessage = error?.message || error?.error || String(error);
      this.logger.error('[TokenHolderService] Dev持仓检查失败', {
        token_address: tokenAddress,
        creator_address: creatorAddress,
        error: errorMessage,
        errorType: error?.constructor?.name || typeof error
      });
      // 出错时保守处理，拒绝购买
      return {
        canBuy: false,
        devHoldingRatio: 0,
        reason: `Dev持仓检查失败: ${errorMessage}`
      };
    }
  }

  /**
   * 检查是否有任何持有者（排除LP地址）持仓比例超过阈值
   * @param {Array} holders - 持有者数组
   * @param {number} threshold - 阈值（百分比，如18表示18%），默认 18
   * @returns {Object} { canBuy, maxHoldingRatio, maxHolderAddress, reason }
   */
  _checkLargeHolding(holders, threshold = 18) {
    if (!holders || holders.length === 0) {
      return {
        canBuy: true,
        maxHoldingRatio: 0,
        maxHolderAddress: null,
        reason: '无持有者数据'
      };
    }

    let maxHoldingRatio = 0;
    let maxHolderAddress = null;

    // 遍历所有持有者，排除LP地址
    holders.forEach(holder => {
      const addr = holder.address?.toLowerCase();
      if (!addr) return;

      // 跳过LP地址
      if (this._lpAddresses.has(addr)) {
        return;
      }

      const holdingRatio = _parseBalanceRatio(holder.balance_ratio);
      if (holdingRatio > maxHoldingRatio) {
        maxHoldingRatio = holdingRatio;
        maxHolderAddress = addr;
      }
    });

    const canBuy = maxHoldingRatio < threshold;
    const reason = canBuy
      ? `最大持仓比例${maxHoldingRatio.toFixed(1)}%正常`
      : `最大持仓比例${maxHoldingRatio.toFixed(1)}%超过阈值${threshold}% (地址:${maxHolderAddress})`;

    this.logger.info('[TokenHolderService] 大额持仓检查结果', {
      maxHoldingRatio: `${maxHoldingRatio.toFixed(1)}%`,
      maxHolderAddress,
      threshold: `${threshold}%`,
      canBuy
    });

    return {
      canBuy,
      maxHoldingRatio,
      maxHolderAddress,
      reason
    };
  }
}

module.exports = { TokenHolderService };
