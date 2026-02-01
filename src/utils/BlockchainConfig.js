/**
 * 区块链配置中心
 *
 * 集中管理所有区块链相关的配置信息，包括：
 * - 区块链元数据（名称、ID、类型等）
 * - 原生代币配置（地址、符号、精度等）
 * - Token ID 后缀映射
 * - 链配置（网络参数、交易参数等）
 * - 地址验证规则（EVM 和 Solana）
 *
 * @module utils/BlockchainConfig
 * @author Trading Engine Team
 * @created 2026-01-09
 */

/**
 * 区块链配置类
 *
 * 所有配置均为静态属性和方法，无需实例化。
 * 提供统一的区块链信息访问接口，消除系统中的硬编码。
 *
 * @class
 */
class BlockchainConfig {
  /**
   * 区块链元数据定义
   *
   * 包含所有支持的区块链的基本信息
   *
   * @static
   * @type {Object.<string, BlockchainMetadata>}
   * @property {string} id - 区块链唯一标识符（小写）
   * @property {string} name - 区块链显示名称
   * @property {string} type - 区块链类型 ('evm' | 'solana')
   * @property {number} chainId - EVM 链 ID（Solana 为 null）
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
    },
    solana: {
      id: 'solana',
      name: 'Solana',
      fullName: 'Solana Network',
      type: 'solana',
      chainId: null,
      logoFile: 'solana-logo.png',
      aliases: ['sol', 'solana'],
      color: '#00FFA3'
    },
    // 预留：未来扩展的区块链
    ethereum: {
      id: 'ethereum',
      name: 'Ethereum',
      fullName: 'Ethereum Network',
      type: 'evm',
      chainId: 1,
      logoFile: 'ethereum-logo.png',
      aliases: ['eth', 'ethereum'],
      color: '#627EEA'
    }
  };

  /**
   * 原生代币配置
   *
   * 定义每个区块链的原生代币信息
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
    },
    solana: {
      symbol: 'SOL',
      name: 'SOL',
      addresses: [
        'So11111111111111111111111111111111111111112', // Wrapped SOL
        'NativeSo111111111111111111111111111111111111111', // 原生 SOL
        'so11111111111111111111111111111111111111112', // Wrapped SOL (小写)
        'nativeso111111111111111111111111111111111111111', // 原生 SOL (小写)
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // SOL (AVE API 原生表示)
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' // AVE API地址（代码中会自动转小写）
      ],
      decimals: 9,
      usdtPair: 'SOLUSDT',
      aveTokenId: 'So11111111111111111111111111111111111111112-solana'
    },
    ethereum: {
      symbol: 'ETH',
      name: 'ETH',
      addresses: [
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH (小写)
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'  // ETH (AVE API)
      ],
      decimals: 18,
      usdtPair: 'ETHUSDT',
      aveTokenId: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2-eth'
    }
  };

  /**
   * Token ID 后缀映射
   *
   * 用于构建 AVE API 的 Token ID（格式：{address}-{suffix}）
   *
   * @static
   * @type {Object.<string, string>}
   * @readonly
   */
  static TOKEN_ID_SUFFIXES = {
    bsc: 'bsc',
    bnb: 'bsc',        // 别名
    solana: 'solana',
    sol: 'solana',     // 别名
    ethereum: 'eth',
    eth: 'eth'         // 别名
  };

  /**
   * 链配置（用于 Trader 和网络连接）
   *
   * @static
   * @type {Object.<string, ChainConfig>}
   * @property {NetworkConfig} network - 网络配置
   * @property {TradingConfig} trading - 交易配置
   * @property {string[]} availableTraders - 可用的交易器列表
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
        'pancakeswap-v2',
        'pancakeswap-v3'
      ]
    },
    solana: {
      network: {
        name: 'Solana',
        chainId: null,
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        fallbackRpcUrls: [
          'https://solana-api.projectserum.com',
          'https://rpc.ankr.com/solana'
        ],
        blockExplorer: 'https://explorer.solana.com',
        confirmations: 1
      },
      trading: {
        maxGasPrice: null,      // Solana 不使用 Gas Price
        maxGasLimit: null,      // Solana 不使用 Gas Limit
        defaultSlippage: 0.01,  // 1% (Solana 通常更快的滑点)
        maxSlippage: 0.03       // 3%
      },
      availableTraders: [
        // Solana DEX traders - 未来实现
        // 'jupiter',
        // 'raydium'
      ]
    },
    ethereum: {
      network: {
        name: 'Ethereum',
        chainId: 1,
        rpcUrl: 'https://eth.llamarpc.com',
        fallbackRpcUrls: [
          'https://rpc.ankr.com/eth',
          'https://ethereum.publicnode.com'
        ],
        blockExplorer: 'https://etherscan.io',
        confirmations: 1
      },
      trading: {
        maxGasPrice: 50,        // Gwei
        maxGasLimit: 800000,
        defaultSlippage: 0.02,
        maxSlippage: 0.05
      },
      availableTraders: [
        'uniswap-v2',
        'uniswap-v3'
      ]
    }
  };

  /**
   * 地址验证正则表达式模式
   *
   * @static
   * @type {Object.<string, RegExp>}
   * @readonly
   */
  static VALIDATION_PATTERNS = {
    evm: /^0x[a-fA-F0-9]{40}$/,                    // EVM 地址：0x + 40 位十六进制
    solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/        // Solana 地址：Base58 编码，32-44 字符
  };

  /**
   * 当前支持的区块链列表
   *
   * 注意：虽然配置文件包含 ethereum，但用户明确要求
   * 暂时只支持 BSC 和 Solana，其他链作为预留配置。
   *
   * @static
   * @type {string[]}
   * @readonly
   */
  static SUPPORTED_BLOCKCHAINS = ['bsc', 'solana'];

  // ========== 公共方法 ==========

  /**
   * 规范化区块链 ID
   *
   * 将各种可能的输入（别名、大小写变化）转换为标准的小写 ID
   *
   * @static
   * @param {string} input - 输入的区块链标识符
   * @returns {string} 规范化后的区块链 ID（小写）
   * @throws {Error} 如果输入的区块链不受支持
   *
   * @example
   * BlockchainConfig.normalizeBlockchainId('BSC')      // 'bsc'
   * BlockchainConfig.normalizeBlockchainId('bnb')      // 'bsc'
   * BlockchainConfig.normalizeBlockchainId('SOL')      // 'solana'
   * BlockchainConfig.normalizeBlockchainId('Solana')   // 'solana'
   */
  static normalizeBlockchainId(input) {
    if (!input || typeof input !== 'string') {
      throw new Error(`无效的区块链标识符: ${input}`);
    }

    const normalized = input.toLowerCase().trim();

    // 检查是否是标准 ID
    if (this.BLOCKCHAINS[normalized]) {
      return normalized;
    }

    // 检查别名
    for (const [id, config] of Object.entries(this.BLOCKCHAINS)) {
      if (config.aliases.includes(normalized)) {
        return id;
      }
    }

    throw new Error(`不支持的区块链: ${input}`);
  }

  /**
   * 规范化代币地址（用于 Map 键）
   *
   * 对于 EVM 链（BSC、ETH等），地址转为小写
   * 对于 Solana，保持原样（Base58 编码区分大小写）
   *
   * @static
   * @param {string} tokenAddress - 代币地址
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 规范化后的地址
   *
   * @example
   * BlockchainConfig.normalizeTokenAddress('0xABC...123', 'bsc')      // '0xabc...123'
   * BlockchainConfig.normalizeTokenAddress('So11111111111111111111111111111111111111112', 'solana')  // 'So11111111111111111111111111111111111111112'
   */
  static normalizeTokenAddress(tokenAddress, blockchain) {
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      throw new Error(`无效的代币地址: ${tokenAddress}`);
    }

    const normalizedBlockchain = this.normalizeBlockchainId(blockchain);
    const blockchainType = this.BLOCKCHAINS[normalizedBlockchain]?.type;

    if (blockchainType === 'solana') {
      // Solana 地址使用 Base58 编码，区分大小写，保持原样
      return tokenAddress;
    } else {
      // EVM 链地址使用小写
      return tokenAddress.toLowerCase();
    }
  }

  /**
   * 获取区块链元数据
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {BlockchainMetadata} 区块链元数据
   * @throws {Error} 如果区块链不受支持
   */
  static getBlockchain(blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    return this.BLOCKCHAINS[normalized];
  }

  /**
   * 获取原生代币配置
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {NativeTokenConfig} 原生代币配置
   * @throws {Error} 如果区块链不受支持
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
   * @returns {string} 代币符号（如 'BNB', 'SOL'）
   */
  static getNativeTokenSymbol(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.symbol;
    } catch (error) {
      console.warn(`获取 ${blockchain} 原生代币符号失败:`, error.message);
      return 'BNB'; // 默认返回 BNB
    }
  }

  /**
   * 获取区块链显示名称
   *
   * @static
   * @param {string} blockchain - 区块链 ID（会自动规范化）
   * @returns {string} 区块链显示名称（如 'BSC', 'Solana'）
   *
   * @example
   * BlockchainConfig.getBlockchainDisplayName('bsc')      // 'BSC'
   * BlockchainConfig.getBlockchainDisplayName('sol')      // 'Solana'
   * BlockchainConfig.getBlockchainDisplayName('SOLANA')   // 'Solana'
   */
  static getBlockchainDisplayName(blockchain) {
    try {
      const config = this.getBlockchain(blockchain);
      return config.name;
    } catch (error) {
      console.warn(`获取 ${blockchain} 显示名称失败:`, error.message);
      return blockchain || 'Unknown'; // 返回原始值作为后备
    }
  }

  /**
   * 获取配置字段名
   *
   * 根据区块链类型动态生成配置字段名，例如：
   * - BSC -> initial_bnb, reserve_bnb
   * - Solana -> initial_sol, reserve_sol
   * - Ethereum -> initial_eth, reserve_eth
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
   * 获取原生代币地址列表
   *
   * 返回所有可能的地址表示，包括包装版本和 AVE API 表示
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string[]} 规范化后的地址列表
   */
  static getNativeTokenAddresses(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      const normalized = this.normalizeBlockchainId(blockchain);

      // 🔥 对 EVM 链使用小写，对 Solana 保持原样（区分大小写）
      return config.addresses.map(addr =>
        this.normalizeTokenAddress(addr, normalized)
      );
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
   * @returns {string} USDT 交易对符号（如 'BNBUSDT', 'SOLUSDT'）
   */
  static getUsdtPair(blockchain) {
    try {
      const config = this.getNativeToken(blockchain);
      return config.usdtPair;
    } catch (error) {
      console.warn(`获取 ${blockchain} USDT 交易对失败:`, error.message);
      return 'BNBUSDT'; // 默认返回 BNB/USDT
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
   * BlockchainConfig.buildTokenId('0xtoken...', 'bsc')      // '0xtoken...-bsc'
   * BlockchainConfig.buildTokenId('Soltoken...', 'solana')  // 'Soltoken...-solana'
   */
  static buildTokenId(tokenAddress, blockchain) {
    const normalized = this.normalizeBlockchainId(blockchain);
    const suffix = this.TOKEN_ID_SUFFIXES[normalized];

    if (!suffix) {
      throw new Error(`未找到 ${normalized} 的 Token ID 后缀配置`);
    }

    return `${tokenAddress}-${suffix}`;
  }

  /**
   * 规范化 Token ID
   *
   * 如果 Token ID 缺少后缀，自动添加默认后缀（基于区块链）
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

    // 如果已经包含 '-'，检查是否需要转换后缀
    if (tokenId.includes('-')) {
      const [address, suffix] = tokenId.split('-');

      // 检查后缀是否需要转换（如 'sol' → 'solana'）
      const normalizedBlockchain = this.normalizeBlockchainId(suffix);
      const correctSuffix = this.TOKEN_ID_SUFFIXES[normalizedBlockchain];

      if (suffix !== correctSuffix) {
        console.warn(`Token ID 后缀不匹配，自动修正: ${suffix} → ${correctSuffix}`);
        return `${address}-${correctSuffix}`;
      }

      return tokenId;
    }

    // 没有后缀，添加默认后缀
    const normalizedBlockchain = this.normalizeBlockchainId(defaultBlockchain);
    const suffix = this.TOKEN_ID_SUFFIXES[normalizedBlockchain];

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

    const suffix = tokenId.split('-')[1];
    try {
      return this.normalizeBlockchainId(suffix);
    } catch (error) {
      return null;
    }
  }

  /**
   * 验证地址格式
   *
   * 根据区块链类型验证地址格式
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

    try {
      const blockchainConfig = this.getBlockchain(blockchain);
      const type = blockchainConfig.type;

      if (type === 'evm') {
        return this.VALIDATION_PATTERNS.evm.test(address);
      } else if (type === 'solana') {
        return this.VALIDATION_PATTERNS.solana.test(address);
      }

      return false;
    } catch (error) {
      console.warn(`验证地址失败:`, error.message);
      return false;
    }
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
   * @returns {NetworkConfig} 网络配置
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
   * @returns {TradingConfig} 交易配置
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
   * 获取区块链 Logo 文件路径
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} Logo 文件名
   */
  static getLogoFile(blockchain) {
    try {
      const blockchainConfig = this.getBlockchain(blockchain);
      return blockchainConfig.logoFile;
    } catch (error) {
      console.warn(`获取 ${blockchain} Logo 失败:`, error.message);
      return 'bsc-logo.png'; // 默认返回 BSC logo
    }
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
   * 获取所有可用的区块链列表（包括预留的）
   *
   * @static
   * @returns {string[]} 所有可用的区块链 ID 列表
   */
  static getAllAvailableBlockchains() {
    return Object.keys(this.BLOCKCHAINS);
  }

  /**
   * 获取区块链类型
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {string} 区块链类型 ('evm' | 'solana')
   */
  static getBlockchainType(blockchain) {
    try {
      const blockchainConfig = this.getBlockchain(blockchain);
      return blockchainConfig.type;
    } catch (error) {
      console.warn(`获取 ${blockchain} 类型失败:`, error.message);
      return 'evm'; // 默认返回 EVM
    }
  }

  /**
   * 判断是否为 EVM 链
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否为 EVM 链
   */
  static isEVM(blockchain) {
    return this.getBlockchainType(blockchain) === 'evm';
  }

  /**
   * 判断是否为 Solana 链
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {boolean} 是否为 Solana 链
   */
  static isSolana(blockchain) {
    return this.getBlockchainType(blockchain) === 'solana';
  }

  /**
   * 获取 EVM 链 ID
   *
   * @static
   * @param {string} blockchain - 区块链 ID
   * @returns {number|null} EVM 链 ID，如果不是 EVM 链则返回 null
   */
  static getChainId(blockchain) {
    try {
      const blockchainConfig = this.getBlockchain(blockchain);
      return blockchainConfig.chainId;
    } catch (error) {
      console.warn(`获取 ${blockchain} Chain ID 失败:`, error.message);
      return null;
    }
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
      blockchain: this.BLOCKCHAINS[normalized],
      nativeToken: this.NATIVE_TOKENS[normalized],
      chainConfig: this.CHAIN_CONFIGS[normalized],
      tokenIdSuffix: this.TOKEN_ID_SUFFIXES[normalized]
    };
  }

  /**
   * 验证配置完整性
   *
   * 检查所有配置是否完整且一致（用于开发调试）
   *
   * @static
   * @returns {Object[]} 验证错误列表，如果为空则表示全部通过
   */
  static validateConfig() {
    const errors = [];

    // 检查支持的区块链是否都有完整配置
    for (const blockchain of this.SUPPORTED_BLOCKCHAINS) {
      // 检查 BLOCKCHAINS
      if (!this.BLOCKCHAINS[blockchain]) {
        errors.push({
          type: 'missing_blockchain',
          blockchain,
          message: `缺少 ${blockchain} 的区块链元数据`
        });
        continue;
      }

      // 检查 NATIVE_TOKENS
      if (!this.NATIVE_TOKENS[blockchain]) {
        errors.push({
          type: 'missing_native_token',
          blockchain,
          message: `缺少 ${blockchain} 的原生代币配置`
        });
      }

      // 检查 CHAIN_CONFIGS
      if (!this.CHAIN_CONFIGS[blockchain]) {
        errors.push({
          type: 'missing_chain_config',
          blockchain,
          message: `缺少 ${blockchain} 的链配置`
        });
      }

      // 检查 TOKEN_ID_SUFFIXES
      if (!this.TOKEN_ID_SUFFIXES[blockchain]) {
        errors.push({
          type: 'missing_token_suffix',
          blockchain,
          message: `缺少 ${blockchain} 的 Token ID 后缀配置`
        });
      }
    }

    return errors;
  }
}

module.exports = {
  BlockchainConfig
};
