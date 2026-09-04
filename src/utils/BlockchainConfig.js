/**
 * 区块链配置中心（BSC-only，Phase 6 收敛）
 *
 * 系统唯一支持链为 BSC（four.meme 内盘）。历史实验中的其他链数据
 * （solana/base/ethereum）仍可展示，但不再具备配置与交易能力：
 * 未知链的 normalize* 调用不再抛错，走原值/小写回落（历史数据只读展示）。
 *
 * 集中管理：
 * - 区块链元数据（名称、ID、类型）
 * - 原生代币配置（BNB 地址、符号、精度、AVE Token ID）
 * - Token ID 后缀映射（AVE API 辅助预检/工具端点）
 * - 链配置（网络参数、交易参数）
 *
 * @module utils/BlockchainConfig
 */

/**
 * 区块链配置类
 *
 * 所有配置均为静态属性和方法，无需实例化。
 *
 * @class
 */
class BlockchainConfig {
  /**
   * 区块链元数据定义
   *
   * @static
   * @type {Object.<string, BlockchainMetadata>}
   * @property {string} id - 区块链唯一标识符（小写）
   * @property {string} name - 区块链显示名称
   * @property {string} type - 区块链类型（'evm'）
   * @property {number} chainId - EVM 链 ID
   * @property {string} logoFile - Logo 文件名
   * @property {string[]} aliases - 别名列表（用于兼容性）
   * @readonly
   */
  static BLOCKCHAINS = {
    bsc: {
      id: 'bsc',
      name: 'BSC',
      fullName: 'Binance Smart Chain',
      type: 'evm',
      chainId: 56,
      logoFile: 'bsc-logo.png',
      aliases: ['bnb', 'binance', 'bsc'],
      color: '#F0B90B'
    }
  };

  /**
   * 原生代币配置
   *
   * @static
   * @type {Object.<string, NativeTokenConfig>}
   * @property {string} symbol - 代币符号
   * @property {string} name - 代币名称
   * @property {string[]} addresses - 所有可能的地址表示（包括包装版本和 AVE API 表示）
   * @property {number} decimals - 代币精度
   * @property {string} usdtPair - USDT 交易对符号
   * @property {string} aveTokenId - AVE API 使用的 Token ID
   * @readonly
   */
  static NATIVE_TOKENS = {
    bsc: {
      symbol: 'BNB',
      name: 'BNB',
      addresses: [
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB (包装版本)
        '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB (小写)
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'  // BNB (AVE API 原生表示)
      ],
      decimals: 18,
      usdtPair: 'BNBUSDT',
      aveTokenId: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c-bsc'
    }
  };

  /**
   * Token ID 后缀映射（AVE API：{address}-{suffix}）
   *
   * 未知链不在此表中，调用方 `|| chain` 回落原值。
   *
   * @static
   * @type {Object.<string, string>}
   * @readonly
   */
  static TOKEN_ID_SUFFIXES = {
    bsc: 'bsc',
    bnb: 'bsc'         // 别名
  };

  /**
   * 链配置（用于 Trader 和网络连接）
   *
   * @static
   * @type {Object.<string, ChainConfig>}
   * @readonly
   */
  static CHAIN_CONFIGS = {
    bsc: {
      network: {
        name: 'BSC',
        chainId: 56,
        rpcUrl: 'https://bsc-dataseed1.binance.org/',
        fallbackRpcUrls: [
          'https://bsc-dataseed2.binance.org/',
          'https://bsc-dataseed3.binance.org/'
        ],
        blockExplorer: 'https://bscscan.com',
        confirmations: 1
      },
      trading: {
        maxGasPrice: 10,        // Gwei
        maxGasLimit: 500000,    // 交易最大 Gas 限制
        defaultSlippage: 0.02,  // 2%
        maxSlippage: 0.05       // 5%
      },
      availableTraders: [
        'fourmeme',
        'pancakeswap-v2'
      ]
    }
  };

  /**
   * 地址验证正则表达式模式（EVM）
   *
   * @static
   * @type {Object.<string, RegExp>}
   * @readonly
   */
  static VALIDATION_PATTERNS = {
    evm: /^0x[a-fA-F0-9]{40}$/              // EVM 地址：0x + 40 位十六进制
  };

  /**
   * 当前支持的区块链列表
   *
   * @static
   * @type {string[]}
   * @readonly
   */
  static SUPPORTED_BLOCKCHAINS = ['bsc'];

  // ========== 公共方法 ==========

  /**
   * 规范化区块链 ID
   *
   * 将各种可能的输入（别名、大小写变化）转换为标准的小写 ID。
   * 未知链（历史实验数据）返回原值小写而非抛错——历史数据只读展示，
   * 不应因配置收敛而让读取路径 500。
   *
   * @static
   * @param {string} input - 输入的区块链标识符
   * @returns {string} 规范化后的区块链 ID（小写）
   *
   * @example
   * BlockchainConfig.normalizeBlockchainId('BSC')      // 'bsc'
   * BlockchainConfig.normalizeBlockchainId('bnb')      // 'bsc'
   * BlockchainConfig.normalizeBlockchainId('SOL')      // 'sol'（历史链，原值回落）
   */
  static normalizeBlockchainId(input) {
    if (!input || typeof input !== 'string') {
      throw new Error(`无效的区块链标识符: ${input}`);
    }

    const normalized = input.toLowerCase().trim();

    if (this.BLOCKCHAINS[normalized]) {
      return normalized;
    }

    // 别名
    for (const [id, config] of Object.entries(this.BLOCKCHAINS)) {
      if (config.aliases.includes(normalized)) {
        return id;
      }
    }

    // 未知链（历史实验数据）：原值回落
    return normalized;
  }

  /**
   * 规范化代币地址（用于 Map 键）：EVM 地址统一小写
   *
   * @static
   * @param {string} tokenAddress - 代币地址
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 规范化后的地址
   *
   * @example
   * BlockchainConfig.normalizeTokenAddress('0xABC...123', 'bsc')  // '0xabc...123'
   */
  static normalizeTokenAddress(tokenAddress, blockchain) {
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      throw new Error(`无效的代币地址: ${tokenAddress}`);
    }
    return tokenAddress.toLowerCase();
  }

  /**
   * 获取区块链元数据
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {BlockchainMetadata|null} 区块链元数据（未知链返回 null）
   */
  static getBlockchain(blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    return this.BLOCKCHAINS[normalized] || null;
  }

  /**
   * 获取原生代币配置
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {NativeTokenConfig} 原生代币配置
   * @throws {Error} 如果区块链没有原生代币配置（非 BSC）
   */
  static getNativeToken(blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    const config = this.NATIVE_TOKENS[normalized];

    if (!config) {
      throw new Error(`未找到 ${normalized} 的原生代币配置`);
    }

    return config;
  }

  /**
   * 获取原生代币符号
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 代币符号（如 'BNB'）
   */
  static getNativeTokenSymbol(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.symbol;
    } catch (error) {
      console.warn(`获取 ${blockchain} 原生代币符号失败:`, error.message);
      return 'BNB';
    }
  }

  /**
   * 获取区块链显示名称
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {string} 区块链显示名称（如 'BSC'；未知链返回原值）
   */
  static getBlockchainDisplayName(blockchain) {
    const config = this.getBlockchain(blockchain);
    return config ? config.name : (blockchain || 'Unknown');
  }

  /**
   * 获取配置字段名（initial_bnb / reserve_bnb 形态）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @param {string} baseName - 基础字段名（如 'initial', 'reserve'）
   * @returns {string} 完整的配置字段名
   */
  static getConfigFieldName(blockchain, baseName) {
    const normalizedId = this.normalizeBlockchainId(blockchain);
    const nativeSymbol = this.getNativeTokenSymbol(normalizedId).toLowerCase();
    return `${baseName}_${nativeSymbol}`;
  }

  /**
   * 获取原生代币地址列表（所有表示，含 AVE API 原生表示）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string[]} 规范化后的地址列表
   */
  static getNativeTokenAddresses(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.addresses.map(addr => this.normalizeTokenAddress(addr, blockchain));
    } catch (error) {
      console.warn(`获取 ${blockchain} 原生代币地址失败:`, error.message);
      return [];
    }
  }

  /**
   * 获取原生代币的主地址（包装版本）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 主地址
   */
  static getNativeTokenAddress(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.addresses[0]; // 第一个地址是主地址（包装版本）
    } catch (error) {
      console.warn(`获取 ${blockchain} 原生代币主地址失败:`, error.message);
      return '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // 默认返回 WBNB
    }
  }

  /**
   * 获取原生代币 USDT 交易对符号
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} USDT 交易对符号（如 'BNBUSDT'）
   */
  static getUsdtPair(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.usdtPair;
    } catch (error) {
      console.warn(`获取 ${blockchain} USDT 交易对失败:`, error.message);
      return 'BNBUSDT';
    }
  }

  /**
   * 构建 Token ID（用于 AVE API）
   *
   * 格式：{address}-{suffix}
   *
   * @static
   * @param {string} tokenAddress - 代币地址
   * @param {string} blockchain - 区块链 ID
   * @returns {string} Token ID
   *
   * @example
   * BlockchainConfig.buildTokenId('0xtoken...', 'bsc')  // '0xtoken...-bsc'
   */
  static buildTokenId(tokenAddress, blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    const suffix = this.TOKEN_ID_SUFFIXES[normalized] || normalized;

    return `${tokenAddress}-${suffix}`;
  }

  /**
   * 规范化 Token ID：缺后缀时补默认后缀（bsc）
   *
   * @static
   * @param {string} tokenId - Token ID（可能不完整）
   * @param {string} [defaultBlockchain='bsc'] - 默认区块链
   * @returns {string} 规范化后的 Token ID
   */
  static normalizeTokenId(tokenId, defaultBlockchain = 'bsc') {
    if (!tokenId || typeof tokenId !== 'string') {
      throw new Error(`无效的 Token ID: ${tokenId}`);
    }

    if (tokenId.includes('-')) {
      return tokenId; // 已带后缀，原样返回（后缀即链名）
    }

    const normalizedBlockchain = this.normalizeBlockchainId(defaultBlockchain);
    const suffix = this.TOKEN_ID_SUFFIXES[normalizedBlockchain] || normalizedBlockchain;

    return `${tokenId}-${suffix}`;
  }

  /**
   * 从 Token ID 中提取区块链
   *
   * @static
   * @param {string} tokenId - Token ID
   * @returns {string|null} 区块链 ID，如果无法提取则返回 null
   */
  static extractBlockchainFromTokenId(tokenId) {
    if (!tokenId || typeof tokenId !== 'string' || !tokenId.includes('-')) {
      return null;
    }

    return tokenId.split('-')[1] || null;
  }

  /**
   * 验证地址格式（EVM）
   *
   * @static
   * @param {string} address - 待验证的地址
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否有效
   */
  static isValidAddress(address, blockchain) {
    if (!address || typeof address !== 'string') {
      return false;
    }
    return this.VALIDATION_PATTERNS.evm.test(address);
  }

  /**
   * 获取链配置
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {ChainConfig} 链配置
   * @throws {Error} 如果区块链不受支持
   */
  static getChainConfig(blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    const config = this.CHAIN_CONFIGS[normalized];

    if (!config) {
      throw new Error(`未找到 ${normalized} 的链配置`);
    }

    return config;
  }

  /**
   * 获取网络配置
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {NetworkConfig|null} 网络配置
   */
  static getNetworkConfig(blockchain) {
    try {
      const chainConfig = this.getChainConfig(blockchain);
      return chainConfig.network;
    } catch (error) {
      console.warn(`获取 ${blockchain} 网络配置失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取交易配置
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {TradingConfig|null} 交易配置
   */
  static getTradingConfig(blockchain) {
    try {
      const chainConfig = this.getChainConfig(blockchain);
      return chainConfig.trading;
    } catch (error) {
      console.warn(`获取 ${blockchain} 交易配置失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取可用的交易器列表
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string[]} 交易器类型列表
   */
  static getAvailableTraders(blockchain) {
    try {
      const chainConfig = this.getChainConfig(blockchain);
      return chainConfig.availableTraders || [];
    } catch (error) {
      console.warn(`获取 ${blockchain} 可用交易器失败:`, error.message);
      return [];
    }
  }

  /**
   * 获取区块链 Logo 文件名
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} Logo 文件名
   */
  static getLogoFile(blockchain) {
    const blockchainConfig = this.getBlockchain(blockchain);
    return blockchainConfig ? blockchainConfig.logoFile : 'bsc-logo.png';
  }

  /**
   * 获取区块链 Logo URL（用于 Web 界面）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} Logo URL
   */
  static getLogoUrl(blockchain) {
    const logoFile = this.getLogoFile(blockchain);
    return `/static/${logoFile}`;
  }

  /**
   * 检查区块链是否受支持
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否受支持
   */
  static isSupported(blockchain) {
    try {
      const normalized = this.normalizeBlockchainId(blockchain);
      return this.SUPPORTED_BLOCKCHAINS.includes(normalized);
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取所有支持的区块链列表
   *
   * @static
   * @returns {string[]} 支持的区块链 ID 列表
   */
  static getSupportedBlockchains() {
    return [...this.SUPPORTED_BLOCKCHAINS];
  }

  /**
   * 获取所有可用的区块链列表
   *
   * @static
   * @returns {string[]} 所有可用的区块链 ID 列表
   */
  static getAllAvailableBlockchains() {
    return Object.keys(this.BLOCKCHAINS);
  }

  /**
   * 获取区块链类型（恒 'evm'）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 区块链类型
   */
  static getBlockchainType(blockchain) {
    const blockchainConfig = this.getBlockchain(blockchain);
    return blockchainConfig ? blockchainConfig.type : 'evm';
  }

  /**
   * 判断是否为 EVM 链（BSC-only 下恒 true）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否为 EVM 链
   */
  static isEVM(blockchain) {
    return this.getBlockchainType(blockchain) === 'evm';
  }

  /**
   * 判断是否为 Solana 链（BSC-only 下恒 false，历史链数据兼容判断用）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否为 Solana 链
   */
  static isSolana(blockchain) {
    return false;
  }

  /**
   * 获取 EVM 链 ID
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {number|null} EVM 链 ID
   */
  static getChainId(blockchain) {
    const blockchainConfig = this.getBlockchain(blockchain);
    return blockchainConfig ? blockchainConfig.chainId : null;
  }

  /**
   * 检查是否为全链模式
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否为全链模式
   */
  static isAllChainMode(blockchain) {
    return blockchain === 'all';
  }

  /**
   * 获取有交易器支持的链列表（可交易的链）
   *
   * @static
   * @returns {string[]} 有可用 trader 的链列表
   */
  static getTradeableChains() {
    return Object.entries(this.CHAIN_CONFIGS)
      .filter(([_, config]) => config.availableTraders && config.availableTraders.length > 0)
      .map(([chainId, _]) => chainId);
  }

  /**
   * 导出配置为 JSON（用于调试）
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {Object} 该区块链的所有配置
   */
  static exportConfig(blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);

    return {
      blockchain: this.BLOCKCHAINS[normalized] || null,
      nativeToken: this.NATIVE_TOKENS[normalized] || null,
      chainConfig: this.CHAIN_CONFIGS[normalized] || null,
      tokenIdSuffix: this.TOKEN_ID_SUFFIXES[normalized] || null
    };
  }

  /**
   * 验证配置完整性（开发调试用）
   *
   * @static
   * @returns {Object[]} 验证错误列表，如果为空则表示全部通过
   */
  static validateConfig() {
    const errors = [];

    for (const blockchain of this.SUPPORTED_BLOCKCHAINS) {
      if (!this.BLOCKCHAINS[blockchain]) {
        errors.push({ type: 'missing_blockchain', blockchain, message: `缺少 ${blockchain} 的区块链元数据` });
        continue;
      }
      if (!this.NATIVE_TOKENS[blockchain]) {
        errors.push({ type: 'missing_native_token', blockchain, message: `缺少 ${blockchain} 的原生代币配置` });
      }
      if (!this.CHAIN_CONFIGS[blockchain]) {
        errors.push({ type: 'missing_chain_config', blockchain, message: `缺少 ${blockchain} 的链配置` });
      }
      if (!this.TOKEN_ID_SUFFIXES[blockchain]) {
        errors.push({ type: 'missing_token_suffix', blockchain, message: `缺少 ${blockchain} 的 Token ID 后缀配置` });
      }
    }

    return errors;
  }
}

module.exports = {
  BlockchainConfig
};
