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
   * 检查持有者是否包含黑名单钱包
   * @param {string} tokenAddress - 代币地址
   * @param {string} experimentId - 实验ID，可为 null
   * @param {string} chain - 区块链，默认 'bsc'
   * @param {Array<string>} riskCategories - 风险category数组，如 ['pump_group', 'negative_holder']
   * @returns {Promise<Object>} { hasNegative, negativeHolders, reason }
   */
  async checkHolderRisk(tokenAddress, experimentId, chain = 'bsc', riskCategories = ['pump_group', 'negative_holder']) {
    try {
      // 添加调试日志
      this.logger.info('[TokenHolderService] checkHolderRisk 调用', {
        token_address: tokenAddress,
        experiment_id: experimentId,
        experiment_id_type: typeof experimentId,
        chain: chain
      });

      // 总是获取最新数据并更新（使用 upsert）
      const holderData = await this._getHoldersFromAVE(tokenAddress, chain);

      // 存储到数据库（会更新已存在的记录）
      const snapshotId = `${tokenAddress}_${Date.now()}`;
      await this._storeHolders(tokenAddress, experimentId, snapshotId, holderData);

      // 检查黑名单持有者
      return this._checkNegativeHolders(holderData.holders, riskCategories);
    } catch (error) {
      this.logger.error(null, 'TokenHolderService',
        `检查持有者风险失败: ${tokenAddress} - ${error.message}`);
      // 出错时默认返回无风险，避免阻止正常交易
      return { hasNegative: false, negativeHolders: [], reason: null };
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
   * 私有方法：检查是否包含黑名单持有者
   * @private
   */
  async _checkNegativeHolders(holders, riskCategories) {
    if (!holders || holders.length === 0) {
      return { hasNegative: false, negativeHolders: [], reason: null };
    }

    // 提取持有者地址
    const holderAddresses = holders.map(h => h.address).filter(Boolean);

    if (holderAddresses.length === 0) {
      return { hasNegative: false, negativeHolders: [], reason: null };
    }

    // 查询这些地址在wallets表中的category
    const { data: walletData, error } = await this.supabase
      .from('wallets')
      .select('address, category')
      .in('address', holderAddresses);

    if (error) {
      throw new Error(`查询钱包信息失败: ${error.message}`);
    }

    // 筛选出黑名单钱包
    const negativeWallets = (walletData || []).filter(w =>
      w.category && riskCategories.includes(w.category)
    );

    if (negativeWallets.length > 0) {
      const categories = negativeWallets.map(w => w.category);
      const reason = `包含黑名单持有者: ${[...new Set(categories)].join(', ')}`;

      return {
        hasNegative: true,
        negativeHolders: negativeWallets,
        reason
      };
    }

    return { hasNegative: false, negativeHolders: [], reason: null };
  }
}

module.exports = { TokenHolderService };
