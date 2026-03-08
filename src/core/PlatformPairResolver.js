/**
 * 平台交易对信息解析服务
 *
 * 负责从代币地址和平台信息获取交易对 Pair 地址
 * 用于 getSwapTransactions API 调用，格式：{pairAddress}-{chain}
 *
 * 支持不同平台的获取策略：
 * - fourmeme: 直接拼接 (tokenAddress + '_fo')，结果如 0x..._fo
 * - flap: 直接拼接 (tokenAddress + '_iportal')，结果如 0x..._iportal
 * - bankr: 通过 AVE API getTokenDetail 获取 pairs 数组中的 pair 地址
 * - pumpfun: 通过 AVE API getTokenDetail 获取 pairs 数组中的 pair 地址
 *
 * @module core/PlatformPairResolver
 * @author Trading Engine Team
 * @created 2026-03-06
 */

const { AveTokenAPI } = require('./ave-api/token-api');
const config = require('../../config/default.json');

/**
 * 平台配置定义
 * 每个平台定义了如何获取 Pair 地址的策略
 */
const PLATFORM_CONFIGS = {
  fourmeme: {
    name: 'four.meme',
    chain: 'bsc',
    // 直接拼接策略：tokenAddress + '_fo'
    strategy: 'direct',
    suffix: '_fo',
    description: 'BSC 链上的 four.meme 平台'
  },
  flap: {
    name: 'flap',
    chain: 'bsc',
    strategy: 'direct',
    suffix: '_iportal',
    description: 'BSC 链上的 flap 平台'
  },
  bankr: {
    name: 'bankr',
    chain: 'base',
    // API 查询策略：从 getTokenDetail 返回的 pairs 数组获取
    strategy: 'api',
    description: 'Base 链上的 bankr 平台'
  },
  pumpfun: {
    name: 'pumpfun',
    chain: 'solana',
    strategy: 'api',
    description: 'Solana 链上的 pumpfun 平台'
  }
};

/**
 * 平台交易对解析器类
 *
 * @class
 */
class PlatformPairResolver {
  constructor(logger = null) {
    // 缓存已解析的 Pair 地址信息
    // 格式: Map<cacheKey, { pairAddress, platform, chain, cachedAt }>
    this._cache = new Map();
    this._cacheTTL = 5 * 60 * 1000; // 缓存 5 分钟

    // 延迟初始化 AVE API
    this._aveApi = null;

    // Logger
    this._logger = logger || console;
  }

  /**
   * 获取 AVE API 实例（延迟初始化）
   * @private
   * @returns {AveTokenAPI}
   */
  _getAveApi() {
    if (!this._aveApi) {
      const apiKey = process.env.AVE_API_KEY;
      this._aveApi = new AveTokenAPI(
        config.ave.apiUrl,
        config.ave.timeout,
        apiKey
      );
    }
    return this._aveApi;
  }

  /**
   * 从代币地址和平台信息获取 Pair 地址
   *
   * 返回的 pairAddress 用于构建 getSwapTransactions 的参数：
   * - 格式：getSwapTransactions(pairAddress + '-' + chain, ...)
   * - fourmeme: pairAddress = tokenAddress + '_fo'，如 '0x..._fo'
   * - pumpfun: pairAddress 从 API 返回，如 '5o6pXzM...nxi8'
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string} platform - 平台名称 (fourmeme, flap, bankr, pumpfun)
   * @param {string} [chain] - 区块链（可选，从平台配置推断）
   * @returns {Promise<{pairAddress: string, platform: string, chain: string}>}
   * @throws {Error} 如果平台不支持或 API 调用失败
   */
  async resolvePairAddress(tokenAddress, platform, chain = null) {
    const platformKey = platform.toLowerCase();

    // 检查平台是否支持
    if (!PLATFORM_CONFIGS[platformKey]) {
      throw new Error(`不支持的平台: ${platform}。支持的平台: ${Object.keys(PLATFORM_CONFIGS).join(', ')}`);
    }

    const platformConfig = PLATFORM_CONFIGS[platformKey];
    const actualChain = chain || platformConfig.chain;

    // 检查缓存
    const cacheKey = this._getCacheKey(tokenAddress, platformKey, actualChain);
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt < this._cacheTTL)) {
      this._logger.debug('[PlatformPairResolver] 使用缓存的 pairAddress', {
        token_address: tokenAddress,
        platform,
        pair_address: cached.pairAddress
      });
      return {
        pairAddress: cached.pairAddress,
        platform: platformKey,
        chain: actualChain
      };
    }

    // 根据策略获取 pairAddress
    let pairAddress;
    if (platformConfig.strategy === 'direct') {
      // 直接拼接策略：fourmeme 和 flap
      pairAddress = `${tokenAddress}${platformConfig.suffix}`;
      this._logger.debug('[PlatformPairResolver] 直接拼接 pairAddress', {
        token_address: tokenAddress,
        platform,
        pair_address: pairAddress
      });
    } else if (platformConfig.strategy === 'api') {
      // API 查询策略：bankr 和 pumpfun
      pairAddress = await this._fetchPairAddressFromApi(tokenAddress, platformKey, actualChain);
    } else {
      throw new Error(`未知的策略类型: ${platformConfig.strategy}`);
    }

    // 更新缓存
    this._cache.set(cacheKey, {
      pairAddress,
      platform: platformKey,
      chain: actualChain,
      cachedAt: Date.now()
    });

    return {
      pairAddress,
      platform: platformKey,
      chain: actualChain
    };
  }

  /**
   * 向后兼容方法：resolveInnerPair
   * @deprecated 请使用 resolvePairAddress 代替
   */
  async resolveInnerPair(tokenAddress, platform, chain = null) {
    const result = await this.resolvePairAddress(tokenAddress, platform, chain);
    return {
      innerPair: result.pairAddress,
      platform: result.platform,
      chain: result.chain
    };
  }

  /**
   * 通过 AVE API 获取 Pair 地址
   *
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} platform - 平台名称
   * @param {string} chain - 区块链
   * @returns {Promise<string>} pairAddress
   * @throws {Error} 如果 API 调用失败或找不到交易对
   */
  async _fetchPairAddressFromApi(tokenAddress, platform, chain) {
    this._logger.debug('[PlatformPairResolver] 通过 API 获取 pairAddress', {
      token_address: tokenAddress,
      platform,
      chain
    });

    const aveApi = this._getAveApi();
    const tokenId = `${tokenAddress}-${chain}`;

    let tokenDetail;
    try {
      tokenDetail = await aveApi.getTokenDetail(tokenId);
    } catch (error) {
      this._logger.error('[PlatformPairResolver] API 调用失败', {
        token_address: tokenAddress,
        platform,
        chain,
        error: error.message
      });
      throw new Error(`获取代币详情失败 (${platform}/${chain}): ${error.message}`);
    }

    // 从 pairs 数组获取交易对地址
    // bankr/pumpfun 返回的是实际的 pair 地址，不是拼接的
    const pairs = tokenDetail.pairs || [];

    if (pairs.length === 0) {
      throw new Error(`代币 ${tokenAddress} 没有找到交易对`);
    }

    // 取第一个交易对作为内盘交易对
    // 通常第一个交易对就是该代币的主要交易对
    const pairAddress = pairs[0].pair;

    if (!pairAddress) {
      throw new Error(`代币 ${tokenAddress} 的交易对数据缺少 pair 字段`);
    }

    this._logger.debug('[PlatformPairResolver] API 返回 pairAddress', {
      token_address: tokenAddress,
      platform,
      chain,
      pair_address: pairAddress,
      total_pairs: pairs.length
    });

    return pairAddress;
  }

  /**
   * 构建用于 getSwapTransactions 的完整交易对 ID
   *
   * @param {string} pairAddress - Pair 地址
   * @param {string} chain - 区块链
   * @returns {string} 完整的交易对 ID，格式：{pairAddress}-{chain}
   */
  buildPairId(pairAddress, chain) {
    return `${pairAddress}-${chain}`;
  }

  /**
   * 批量解析 Pair 地址（用于性能优化）
   *
   * @param {Array<{tokenAddress: string, platform: string, chain?: string}>} tokens - 代币列表
   * @returns {Promise<Map<string, {pairAddress: string, platform: string, chain: string}>>} tokenAddress -> pairInfo 的映射
   */
  async resolvePairAddressesBatch(tokens) {
    const results = new Map();

    // 分组处理：直接拼接的可以批量处理，API 查询的需要逐个处理
    const directTokens = [];
    const apiTokens = [];

    for (const { tokenAddress, platform, chain } of tokens) {
      const platformKey = platform.toLowerCase();
      const platformConfig = PLATFORM_CONFIGS[platformKey];

      if (!platformConfig) {
        this._logger.warn('[PlatformPairResolver] 跳过不支持的平台', {
          token_address: tokenAddress,
          platform
        });
        continue;
      }

      if (platformConfig.strategy === 'direct') {
        directTokens.push({ tokenAddress, platform, platformConfig, chain });
      } else {
        apiTokens.push({ tokenAddress, platform, platformConfig, chain });
      }
    }

    // 处理直接拼接的代币
    for (const { tokenAddress, platform, platformConfig, chain } of directTokens) {
      const actualChain = chain || platformConfig.chain;
      const pairAddress = `${tokenAddress}${platformConfig.suffix}`;
      results.set(tokenAddress, {
        pairAddress,
        platform,
        chain: actualChain
      });
    }

    // 处理需要 API 查询的代币（逐个处理，避免并发过多）
    for (const { tokenAddress, platform, platformConfig, chain } of apiTokens) {
      try {
        const actualChain = chain || platformConfig.chain;
        const pairAddress = await this._fetchPairAddressFromApi(tokenAddress, platform, actualChain);
        results.set(tokenAddress, {
          pairAddress,
          platform,
          chain: actualChain
        });
      } catch (error) {
        this._logger.error('[PlatformPairResolver] 批量解析失败', {
          token_address: tokenAddress,
          platform,
          error: error.message
        });
        // 失败的代币不放入结果中
      }
    }

    this._logger.info('[PlatformPairResolver] 批量解析完成', {
      total: tokens.length,
      direct: directTokens.length,
      api: apiTokens.length,
      resolved: results.size
    });

    return results;
  }

  /**
   * 向后兼容方法：resolveInnerPairsBatch
   * @deprecated 请使用 resolvePairAddressesBatch 代替
   */
  async resolveInnerPairsBatch(tokens) {
    const results = await this.resolvePairAddressesBatch(tokens);
    // 转换为旧格式
    const legacyResults = new Map();
    for (const [tokenAddress, value] of results.entries()) {
      legacyResults.set(tokenAddress, {
        innerPair: value.pairAddress,
        platform: value.platform,
        chain: value.chain
      });
    }
    return legacyResults;
  }

  /**
   * 生成缓存键
   *
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} platform - 平台名称
   * @param {string} chain - 区块链
   * @returns {string} 缓存键
   */
  _getCacheKey(tokenAddress, platform, chain) {
    return `${tokenAddress}:${platform}:${chain}`;
  }

  /**
   * 清除缓存
   *
   * @param {string} [tokenAddress] - 指定代币地址（可选），如果不指定则清除全部
   */
  clearCache(tokenAddress = null) {
    if (tokenAddress) {
      // 清除特定代币的缓存
      for (const key of this._cache.keys()) {
        if (key.startsWith(tokenAddress)) {
          this._cache.delete(key);
        }
      }
      this._logger.debug('[PlatformPairResolver] 清除特定代币缓存', { token_address: tokenAddress });
    } else {
      // 清除全部缓存
      this._cache.clear();
      this._logger.debug('[PlatformPairResolver] 清除全部缓存');
    }
  }

  /**
   * 获取缓存统计信息
   *
   * @returns {Object} 缓存统计
   */
  getCacheStats() {
    const entries = Array.from(this._cache.entries());
    const now = Date.now();
    const validCount = entries.filter(([, v]) => now - v.cachedAt < this._cacheTTL).length;
    const expiredCount = entries.length - validCount;

    return {
      total: entries.length,
      valid: validCount,
      expired: expiredCount,
      ttl: this._cacheTTL
    };
  }

  /**
   * 检查平台是否支持直接拼接策略
   *
   * @param {string} platform - 平台名称
   * @returns {boolean} 是否支持直接拼接
   */
  static isDirectPlatform(platform) {
    const platformKey = platform.toLowerCase();
    return PLATFORM_CONFIGS[platformKey]?.strategy === 'direct';
  }

  /**
   * 获取平台配置
   *
   * @param {string} platform - 平台名称
   * @returns {Object|null} 平台配置
   */
  static getPlatformConfig(platform) {
    return PLATFORM_CONFIGS[platform.toLowerCase()] || null;
  }

  /**
   * 获取所有支持的平台列表
   *
   * @returns {Array<string>} 平台名称列表
   */
  static getSupportedPlatforms() {
    return Object.keys(PLATFORM_CONFIGS);
  }

  /**
   * 从代币对象推断平台
   *
   * 这是一个辅助方法，用于从 token 数据中获取平台信息
   *
   * @param {Object} token - 代币对象，可能包含 platform 字段
   * @param {string} defaultPlatform - 默认平台
   * @returns {string} 平台名称
   */
  static inferPlatformFromToken(token, defaultPlatform = 'fourmeme') {
    if (token && token.platform) {
      return token.platform;
    }
    return defaultPlatform;
  }
}

module.exports = {
  PlatformPairResolver,
  PLATFORM_CONFIGS
};
