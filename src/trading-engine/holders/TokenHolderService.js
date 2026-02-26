/**
 * 代币持有者服务
 * 用于检测代币持有者是否包含黑名单钱包
 */

const config = require('../../../config/default.json');

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
    this._cacheLoaded = false;
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
      this._cacheLoaded = true;

      this.logger.info('[TokenHolderService] 钱包缓存加载完成', {
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
        throw new Error(`获取钱包数据失败: ${error.message}`);
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
   * @param {string} chain - 区块链，默认 'bsc'
   * @returns {Promise<Object>} { snapshotId, holders }
   */
  async fetchAndStoreHolders(tokenAddress, experimentId, chain = 'bsc') {
    try {
      // 从AVE获取持有者数据
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 生成快照ID
      const snapshotId = `${tokenAddress}_${Date.now()}`;

      // 存储到数据库
      await this._storeHolders(tokenAddress, experimentId, snapshotId, holderData);

      return {
        snapshotId,
        holders: holderData.holders || [],
        token: holderData.token
      };
    } catch (error) {
      this.logger.error(null, 'TokenHolderService',
        `获取持有者失败: ${tokenAddress} - ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查持有者风险（基于黑白名单缓存）
   * @param {string} tokenAddress - 代币地址
   * @param {string} experimentId - 实验ID，可为 null
   * @param {string} chain - 区块链，默认 'bsc'
   * @returns {Promise<Object>} { canBuy, whitelistCount, blacklistCount, reason }
   */
  async checkHolderRisk(tokenAddress, experimentId, chain = 'bsc') {
    try {
      // 确保缓存已加载
      await this._ensureCacheLoaded();

      // 获取持有者数据
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 存储到数据库
      const snapshotId = `${tokenAddress}_${Date.now()}`;
      await this._storeHolders(tokenAddress, experimentId, snapshotId, holderData);

      // 使用缓存数据检查
      return this._checkHoldersWithCache(holderData.holders);
    } catch (error) {
      this.logger.error(null, 'TokenHolderService',
        `检查持有者风险失败: ${tokenAddress} - ${error.message}`);
      // 出错时默认返回不可购买，保守处理
      return {
        canBuy: false,
        whitelistCount: 0,
        blacklistCount: 0,
        reason: `检查失败: ${error.message}`
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
  async _storeHolders(tokenAddress, experimentId, snapshotId, holderData) {
    // 添加调试日志
    this.logger.info('[TokenHolderService] 准备存储持有者数据', {
      token_address: tokenAddress,
      experiment_id: experimentId,
      experiment_id_type: typeof experimentId,
      holders_count: holderData.holders?.length || 0
    });

    // 直接插入新记录（一个代币可以有多条持有者记录）
    const { error, data } = await this.supabase
      .from('token_holders')
      .insert({
        token_address: tokenAddress,
        experiment_id: experimentId,
        holder_data: holderData,
        snapshot_id: snapshotId
      })
      .select()
      .single();

    if (error) {
      this.logger.error('[TokenHolderService] 插入失败', {
        error: error.message,
        details: error.hint || error.details || error.code,
        token_address: tokenAddress,
        experiment_id: experimentId
      });
      throw new Error(`存储持有者数据失败: ${error.message}`);
    }

    this.logger.info('[TokenHolderService] 插入成功', {
      token_address: tokenAddress,
      experiment_id: experimentId,
      inserted_id: data?.id,
      inserted_experiment_id: data?.experiment_id
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
      throw new Error(`查询持有者数据失败: ${error.message}`);
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
}

module.exports = { TokenHolderService };
