/**
 * Uniswap V4 交易器实现
 * 支持 Ethereum 和 Base 两条链
 *
 * V4 架构与 V2 完全不同：
 * - PoolManager 单例管理所有池子（不再有独立 Pair 合约）
 * - PoolKey 标识池子：(currency0, currency1, fee, tickSpacing, hooks)
 * - Universal Router 执行 V4 交易
 * - Quoter 合约用于价格查询
 * - StateView 合约用于池子状态查询
 * - 支持 Permit2 代币授权
 *
 * @module trading-engine/traders/implementations/UniswapV4Trader
 */

const { ethers } = require('ethers');
const BaseTrader = require('../core/BaseTrader');

// ============================================================
// 合约地址（按链分组）
// ============================================================
const CHAIN_ADDRESSES = {
  ethereum: {
    chainId: 1,
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
    stateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    rpcUrl: 'https://eth.llamarpc.com'
  },
  base: {
    chainId: 8453,
    poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    universalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
    quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
    stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    weth: '0x4200000000000000000000000000000000000006',
    rpcUrl: 'https://mainnet.base.org'
  }
};

// ============================================================
// Universal Router 命令和 V4 子操作编码
// ============================================================

// Universal Router 命令字节
const COMMAND = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  V2_SWAP_EXACT_IN: 0x02,
  V2_SWAP_EXACT_OUT: 0x03,
  PERMIT2_PERMIT: 0x04,
  WRAP_ETH: 0x05,
  UNWRAP_ETH: 0x06,
  V4_SWAP: 0x10
};

// V4_SWAP 内部子操作
const V4_ACTION = {
  SWAP_EXACT_IN: 0x00,
  SWAP_EXACT_OUT: 0x01,
  SETTLE: 0x0a,
  SETTLE_ALL: 0x0b,
  TAKE: 0x0c,
  TAKE_ALL: 0x0d,
  TAKE_PORTION: 0x0e
};

// ============================================================
// ABI 定义
// ============================================================

// Universal Router ABI（仅 execute 方法）
const UNIVERSAL_ROUTER_ABI = [
  {
    "inputs": [
      { "name": "commands", "type": "bytes" },
      { "name": "inputs", "type": "bytes[]" },
      { "name": "deadline", "type": "uint256" }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

// Quoter ABI
const QUOTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "name": "poolKey", "type": "tuple", "components": [
            { "name": "currency0", "type": "address" },
            { "name": "currency1", "type": "address" },
            { "name": "fee", "type": "uint24" },
            { "name": "tickSpacing", "type": "int24" },
            { "name": "hooks", "type": "address" }
          ]},
          { "name": "zeroForOne", "type": "bool" },
          { "name": "exactAmount", "type": "uint128" },
          { "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      { "name": "amountOut", "type": "int128" },
      { "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// StateView ABI
const STATE_VIEW_ABI = [
  {
    "inputs": [
      {
        "components": [
          { "name": "currency0", "type": "address" },
          { "name": "currency1", "type": "address" },
          { "name": "fee", "type": "uint24" },
          { "name": "tickSpacing", "type": "int24" },
          { "name": "hooks", "type": "address" }
        ],
        "name": "poolKey",
        "type": "tuple"
      }
    ],
    "name": "getPoolByAddress",
    "outputs": [
      {
        "components": [
          { "name": "currency0", "type": "address" },
          { "name": "currency1", "type": "address" },
          { "name": "fee", "type": "uint24" },
          { "name": "tickSpacing", "type": "int24" },
          { "name": "hooks", "type": "address" }
        ],
        "name": "key",
        "type": "tuple"
      },
      { "name": "sqrtPriceX96", "type": "uint160" },
      { "name": "liquidity", "type": "uint128" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// Permit2 ABI（approve 方法）
const PERMIT2_ABI = [
  {
    "inputs": [
      { "name": "token", "type": "address" },
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint160" },
      { "name": "expiration", "type": "uint48" }
    ],
    "name": "approve",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "owner", "type": "address" },
      { "name": "token", "type": "address" },
      { "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [
      { "name": "amount", "type": "uint160" },
      { "name": "expiration", "type": "uint48" },
      { "name": "nonce", "type": "uint48" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// ERC20 ABI
const ERC20_ABI = [
  {
    "constant": false,
    "inputs": [
      { "name": "_spender", "type": "address" },
      { "name": "_value", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "name": "", "type": "bool" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [
      { "name": "_owner", "type": "address" },
      { "name": "_spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [{ "name": "", "type": "uint256" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "type": "function"
  }
];

// ============================================================
// UniswapV4Trader 类
// ============================================================

class UniswapV4Trader extends BaseTrader {
  constructor(config = {}) {
    super(config);

    // 确定链
    const blockchain = config.blockchain || config.chain || 'ethereum';
    const chainKey = this._resolveChainKey(blockchain);
    const addresses = CHAIN_ADDRESSES[chainKey];

    if (!addresses) {
      throw new Error(`UniswapV4Trader 不支持的链: ${blockchain}。支持: ethereum, base`);
    }

    this._chainKey = chainKey;
    this._addresses = addresses;

    this.contracts = {
      poolManager: addresses.poolManager,
      universalRouter: addresses.universalRouter,
      quoter: addresses.quoter,
      stateView: addresses.stateView,
      permit2: addresses.permit2,
      weth: addresses.weth
    };

    // 覆盖基类的 provider 为对应链的 RPC
    this.provider = new ethers.JsonRpcProvider(addresses.rpcUrl);
    // 重置 wallet（provider 变了）
    this.wallet = null;

    // 交易配置
    this.defaultGasLimit = config.gasLimit || 500000;
    this.defaultSlippage = config.slippage || 0.01; // 1%
    this.maxSlippage = config.maxSlippage || 0.05; // 5%
    this.defaultDeadline = config.deadline || 300; // 5分钟

    // 缓存
    this.poolKeyCache = new Map();    // tokenAddress -> PoolKey
    this.tokenInfoCache = new Map();  // tokenAddress -> { decimals }

    console.log(`🦄 Uniswap V4 交易器初始化完成 (${chainKey})`);
  }

  /**
   * 将链名标准化为 CHAIN_ADDRESSES 的 key
   * @private
   */
  _resolveChainKey(blockchain) {
    const normalized = (blockchain || '').toLowerCase().trim();
    if (normalized === 'ethereum' || normalized === 'eth') return 'ethereum';
    if (normalized === 'base') return 'base';
    return normalized;
  }

  /**
   * 设置钱包私钥（覆盖基类，使用本链 provider）
   * @param {string} privateKey - 私钥字符串
   */
  async setWallet(privateKey) {
    try {
      if (!privateKey || typeof privateKey !== 'string') {
        throw new Error('Private key is required and must be a string');
      }
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }
      if (privateKey.length !== 66) {
        throw new Error('Invalid private key length');
      }

      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.signer = this.wallet;

      console.log(`👛 Uniswap V4 钱包已设置: ${this.wallet.address} (${this._chainKey})`);
      await this.verifyWalletConnection();
    } catch (error) {
      throw new Error(`Failed to set wallet: ${error.message}`);
    }
  }

  /**
   * 构建默认 PoolKey（无 hooks, 标准费率）
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string} [wethAddress] - WETH 地址（默认使用本链配置）
   * @param {number} [fee] - 费率（默认 10000 = 1%）
   * @param {number} [tickSpacing] - tick 间距（默认 200）
   * @returns {Object} PoolKey
   */
  buildDefaultPoolKey(tokenAddress, wethAddress = null, fee = 10000, tickSpacing = 200) {
    const weth = wethAddress || this.contracts.weth;
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    // currency0 < currency1（按地址排序）
    const [currency0, currency1] = [weth, tokenAddress].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    return {
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks: ZERO_ADDRESS
    };
  }

  /**
   * 通过 StateView 查找代币的 V4 池子
   *
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object|null>} 池子信息 { poolKey, sqrtPriceX96, liquidity }
   */
  async discoverPool(tokenAddress) {
    if (this.poolKeyCache.has(tokenAddress)) {
      return this.poolKeyCache.get(tokenAddress);
    }

    const stateView = new ethers.Contract(this.contracts.stateView, STATE_VIEW_ABI, this.provider);

    // 尝试不同费率组合查找池子
    const feeConfigs = [
      { fee: 10000, tickSpacing: 200 },  // 1%
      { fee: 3000, tickSpacing: 60 },    // 0.3%
      { fee: 500, tickSpacing: 10 },     // 0.05%
      { fee: 100, tickSpacing: 1 },      // 0.01%
      { fee: 0, tickSpacing: 0 }         // 0% (static fee)
    ];

    for (const { fee, tickSpacing } of feeConfigs) {
      try {
        const poolKey = this.buildDefaultPoolKey(tokenAddress, null, fee, tickSpacing);

        const result = await stateView.getPoolByAddress([
          poolKey.currency0,
          poolKey.currency1,
          poolKey.fee,
          poolKey.tickSpacing,
          poolKey.hooks
        ]);

        // 如果 sqrtPriceX96 > 0，说明池子存在且有流动性
        if (result.sqrtPriceX96 > 0n) {
          const poolInfo = {
            poolKey,
            sqrtPriceX96: result.sqrtPriceX96,
            liquidity: result.liquidity
          };

          this.poolKeyCache.set(tokenAddress, poolInfo);
          console.log(`🔍 发现 V4 池子: fee=${fee}, tickSpacing=${tickSpacing}, liquidity=${result.liquidity}`);
          return poolInfo;
        }
      } catch (error) {
        // 该费率组合不存在池子，继续尝试下一个
        continue;
      }
    }

    throw new Error(`未找到代币 ${tokenAddress} 的 V4 池子`);
  }

  /**
   * 通过 Quoter 获取报价
   *
   * @param {Object} poolKey - 池子 key
   * @param {boolean} zeroForOne - 是否 token0 → token1
   * @param {bigint} amountIn - 输入金额
   * @returns {Promise<bigint>} 输出金额
   */
  async getQuote(poolKey, zeroForOne, amountIn) {
    const quoter = new ethers.Contract(this.contracts.quoter, QUOTER_ABI, this.provider);

    const result = await quoter.quoteExactInputSingle({
      poolKey: [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks
      ],
      zeroForOne,
      exactAmount: amountIn,
      sqrtPriceLimitX96: zeroForOne
        ? 4295128739n + 1n   // MIN_SQRT_RATIO + 1
        : 1461446703485210103287273052203988822378723970342n - 1n  // MAX_SQRT_RATIO - 1
    });

    return result.amountOut;
  }

  /**
   * 获取代币精度
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>}
   */
  async getTokenDecimals(tokenAddress) {
    if (this.tokenInfoCache.has(tokenAddress)) {
      return this.tokenInfoCache.get(tokenAddress).decimals;
    }
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await tokenContract.decimals();
      this.tokenInfoCache.set(tokenAddress, { decimals });
      return decimals;
    } catch (error) {
      console.warn(`获取代币精度失败，使用默认值 18: ${error.message}`);
      return 18;
    }
  }

  /**
   * 获取代币余额
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<string>}
   */
  async getTokenBalance(tokenAddress) {
    if (!this.wallet) throw new Error('钱包未设置');
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await this.getTokenDecimals(tokenAddress);
      const balance = await tokenContract.balanceOf(this.wallet.address);
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      console.error(`获取代币余额失败: ${error.message}`);
      return '0';
    }
  }

  /**
   * 获取原生代币余额
   * @returns {Promise<string>}
   */
  async getNativeBalance() {
    if (!this.wallet) throw new Error('钱包未设置');
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.formatEther(balance);
    } catch (error) {
      throw new Error(`获取余额失败: ${error.message}`);
    }
  }

  // ============================================================
  // Permit2 授权管理
  // ============================================================

  /**
   * 确保代币已通过 Permit2 授权给 Universal Router
   *
   * 两步授权：
   * 1. ERC20.approve(Permit2, amount) — 授权 Permit2 可转移代币
   * 2. Permit2.approve(token, UniversalRouter, amount, expiration) — 授权 Router 可通过 Permit2 拉取代币
   *
   * @param {string} tokenAddress - 代币地址
   * @param {bigint} amount - 需要授权的金额
   * @returns {Promise<boolean>}
   */
  async ensurePermit2Allowance(tokenAddress, amount) {
    if (!this.wallet) throw new Error('钱包未设置');

    try {
      // Step 1: 检查 ERC20 → Permit2 的授权
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const erc20Allowance = await tokenContract.allowance(this.wallet.address, this.contracts.permit2);

      if (BigInt(erc20Allowance) < amount) {
        console.log(`🔐 授权代币给 Permit2: ${tokenAddress}`);
        const approveTx = await tokenContract.approve(this.contracts.permit2, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`✅ ERC20 → Permit2 授权成功`);
      }

      // Step 2: 检查 Permit2 → Universal Router 的授权
      const permit2Contract = new ethers.Contract(this.contracts.permit2, PERMIT2_ABI, this.wallet);
      const [p2Amount, p2Expiration] = await permit2Contract.allowance(
        this.wallet.address,
        tokenAddress,
        this.contracts.universalRouter
      );

      const now = Math.floor(Date.now() / 1000);
      const maxExpiration = Math.pow(2, 48) - 1; // uint48 max

      if (BigInt(p2Amount) < amount || Number(p2Expiration) < now) {
        console.log(`🔐 授权 Permit2 → Universal Router: ${tokenAddress}`);
        const p2ApproveTx = await permit2Contract.approve(
          tokenAddress,
          this.contracts.universalRouter,
          ethers.MaxUint160,
          maxExpiration
        );
        await p2ApproveTx.wait();
        console.log(`✅ Permit2 → Router 授权成功`);
      }

      return true;
    } catch (error) {
      console.error(`Permit2 授权失败: ${error.message}`);
      return false;
    }
  }

  // ============================================================
  // Universal Router 编码
  // ============================================================

  /**
   * 编码 V4_SWAP 子操作的 input data
   *
   * 格式: [numActions(1 byte)] [action1(1 byte)] ... [actionN(1 byte)] [encoded_params_concatenated]
   *
   * @param {number[]} actions - 子操作码数组
   * @param {string[]} encodedParams - 每个子操作的 ABI 编码参数
   * @returns {string} 编码后的 hex string
   * @private
   */
  _encodeV4SwapInput(actions, encodedParams) {
    const numActions = actions.length;

    // 拼接: numActions + action codes + all params
    const parts = [
      ethers.solidityPacked(['uint8'], [numActions]),
      ethers.solidityPacked(
        actions.map(() => 'uint8'),
        actions
      )
    ];

    for (const param of encodedParams) {
      parts.add ? null : parts.push(param);
    }

    return ethers.concat(parts);
  }

  /**
   * 编码 SWAP_EXACT_IN 子操作参数
   *
   * @param {Object} poolKey - 池子 key {currency0, currency1, fee, tickSpacing, hooks}
   * @param {boolean} zeroForOne - 方向
   * @param {bigint} amountIn - 输入金额
   * @param {bigint} amountOutMin - 最小输出
   * @returns {string} ABI 编码的 hex string
   * @private
   */
  _encodeSwapExactInParams(poolKey, zeroForOne, amountIn, amountOutMin) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address,address,uint24,int24,address)', 'bool', 'uint128', 'uint128', 'bytes'],
      [
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        zeroForOne,
        amountIn,
        amountOutMin,
        '0x' // 空 hookData
      ]
    );
  }

  /**
   * 编码 SETTLE_ALL 子操作参数
   * @param {string} currency - 币种地址（address(0) 表示原生代币）
   * @param {bigint} amount - 金额
   * @returns {string}
   * @private
   */
  _encodeSettleAllParams(currency, amount) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [currency, amount]
    );
  }

  /**
   * 编码 TAKE_ALL 子操作参数
   * @param {string} currency - 币种地址
   * @param {bigint} amount - 金额
   * @returns {string}
   * @private
   */
  _encodeTakeAllParams(currency, amount) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [currency, amount]
    );
  }

  /**
   * 编码 WRAP_ETH 命令的 input
   * @param {bigint} amount - ETH 数量
   * @returns {string}
   * @private
   */
  _encodeWrapEthInput(amount) {
    // WRAP_ETH(receiver, amount)
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [this.contracts.universalRouter, amount]
    );
  }

  /**
   * 编码 UNWRAP_ETH 命令的 input
   * @param {bigint} amount - ETH 数量
   * @returns {string}
   * @private
   */
  _encodeUnwrapEthInput(amount) {
    // UNWRAP_ETH(receiver, amount)
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [this.wallet.address, amount]
    );
  }

  /**
   * 构建完整的 V4_SWAP input data
   *
   * @param {Object} poolKey - 池子 key
   * @param {boolean} zeroForOne - 方向
   * @param {bigint} amountIn - 输入金额
   * @param {bigint} amountOutMin - 最小输出
   * @param {string} settleCurrency - 要结算的币种
   * @param {bigint} settleAmount - 要结算的金额
   * @param {string} takeCurrency - 要提取的币种
   * @param {bigint} takeAmount - 要提取的金额
   * @returns {string}
   * @private
   */
  _buildV4SwapInput(poolKey, zeroForOne, amountIn, amountOutMin, settleCurrency, settleAmount, takeCurrency, takeAmount) {
    const actions = [
      V4_ACTION.SWAP_EXACT_IN,
      V4_ACTION.SETTLE_ALL,
      V4_ACTION.TAKE_ALL
    ];

    const encodedParams = [
      this._encodeSwapExactInParams(poolKey, zeroForOne, amountIn, amountOutMin),
      this._encodeSettleAllParams(settleCurrency, settleAmount),
      this._encodeTakeAllParams(takeCurrency, takeAmount)
    ];

    // 构建完整的 input: numActions(1 byte) + action codes + concatenated params
    const numActionsBytes = ethers.solidityPacked(['uint8'], [actions.length]);
    const actionCodesBytes = ethers.solidityPacked(
      actions.map(() => 'uint8'),
      actions
    );

    return ethers.concat([numActionsBytes, actionCodesBytes, ...encodedParams]);
  }

  // ============================================================
  // 交易方法
  // ============================================================

  /**
   * 买入代币 (ETH → Token)
   *
   * 流程：
   * 1. 发现 V4 池子（PoolKey）
   * 2. 通过 Quoter 获取报价
   * 3. 构建交易：WRAP_ETH + V4_SWAP
   * 4. 发送交易
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string|bigint} ethAmount - ETH 数量（以 ETH 为单位的字符串或 wei 的 BigInt）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 交易结果
   */
  async buyToken(tokenAddress, ethAmount, options = {}) {
    if (!this.wallet) throw new Error('钱包未设置');

    const {
      slippage = this.defaultSlippage,
      deadline = this.defaultDeadline,
      maxRetries = 3
    } = options;

    return await this._executeWithRetry(
      async () => await this._buyTokenInternal(tokenAddress, ethAmount, { slippage, deadline }),
      maxRetries,
      'buyToken'
    );
  }

  async _buyTokenInternal(tokenAddress, ethAmount, options = {}) {
    if (!this.wallet) throw new Error('钱包未设置');

    const { slippage = this.defaultSlippage, deadline = this.defaultDeadline } = options;

    try {
      console.log(`🛒 V4 买入: ${tokenAddress}, ETH: ${ethAmount}`);

      // 1. 发现池子
      const poolInfo = await this.discoverPool(tokenAddress);
      const poolKey = poolInfo.poolKey;

      // 2. 确定方向（WETH → Token）
      const weth = this.contracts.weth;
      const zeroForOne = poolKey.currency0.toLowerCase() === weth.toLowerCase();

      // 3. 解析输入金额
      const amountIn = typeof ethAmount === 'bigint'
        ? ethAmount
        : ethers.parseEther(ethAmount);

      // 4. 获取报价
      const quoteOut = await this.getQuote(poolKey, zeroForOne, amountIn);
      const expectedOut = BigInt(quoteOut);
      const slippageBps = Math.floor((1 - slippage) * 10000);
      const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

      console.log(`📊 预期输出: ${expectedOut}, 最小: ${amountOutMin}`);

      // 5. 构建 Universal Router 交易
      // Commands: WRAP_ETH + V4_SWAP
      const commands = ethers.hexlify([COMMAND.WRAP_ETH, COMMAND.V4_SWAP]);

      // WRAP_ETH input
      const wrapInput = this._encodeWrapEthInput(amountIn);

      // V4_SWAP input: SWAP_EXACT_IN + SETTLE_ALL(WETH) + TAKE_ALL(token)
      const v4Input = this._buildV4SwapInput(
        poolKey,
        zeroForOne,
        amountIn,
        amountOutMin,
        weth,           // settle WETH
        amountIn,       // settle amount = wrapped ETH
        tokenAddress,   // take token
        amountOutMin    // take at least amountOutMin
      );

      const inputs = [wrapInput, v4Input];
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline;

      // 6. 编码 execute 调用
      const routerContract = new ethers.Contract(
        this.contracts.universalRouter,
        UNIVERSAL_ROUTER_ABI,
        this.wallet
      );

      const txData = routerContract.interface.encodeFunctionData("execute", [
        commands,
        inputs,
        deadlineTimestamp
      ]);

      // 7. 估算 Gas
      const estimatedGas = await this._safeEstimateGas({
        to: this.contracts.universalRouter,
        data: txData,
        value: amountIn,
        from: this.wallet.address
      });

      const gasPrice = await this._getOptimalGasPrice();
      const bufferedGasLimit = (estimatedGas * 130n) / 100n; // V4 操作 Gas 消耗较高，加 30% buffer

      // 8. 发送交易
      const tx = await this.wallet.sendTransaction({
        to: this.contracts.universalRouter,
        data: txData,
        value: amountIn,
        gasLimit: bufferedGasLimit,
        gasPrice,
        type: 2, // EIP-1559
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: await this._getPriorityFee()
      });

      console.log(`📤 V4 买入交易已发送: ${tx.hash}`);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`✅ V4 买入成功! Gas: ${receipt.gasUsed}`);
        return {
          success: true,
          txHash: tx.hash,
          amountOut: expectedOut.toString(),
          amountOutMin: amountOutMin.toString(),
          gasUsed: receipt.gasUsed,
          error: null
        };
      } else {
        throw new Error('V4 买入交易执行失败');
      }
    } catch (error) {
      console.error(`❌ V4 买入失败: ${error.message}`);
      return {
        success: false,
        txHash: null,
        error: error.message
      };
    }
  }

  /**
   * 卖出代币 (Token → ETH)
   *
   * 流程：
   * 1. 发现 V4 池子
   * 2. 通过 Quoter 获取报价
   * 3. 设置 Permit2 授权
   * 4. 构建交易：V4_SWAP + UNWRAP_ETH
   * 5. 发送交易
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string|bigint} tokenAmount - 代币数量
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 交易结果
   */
  async sellToken(tokenAddress, tokenAmount, options = {}) {
    if (!this.wallet) throw new Error('钱包未设置');

    const {
      slippage = this.defaultSlippage,
      deadline = this.defaultDeadline,
      maxRetries = 3
    } = options;

    return await this._executeWithRetry(
      async () => await this._sellTokenInternal(tokenAddress, tokenAmount, { slippage, deadline }),
      maxRetries,
      'sellToken'
    );
  }

  async _sellTokenInternal(tokenAddress, tokenAmount, options = {}) {
    if (!this.wallet) throw new Error('钱包未设置');

    const { slippage = this.defaultSlippage, deadline = this.defaultDeadline } = options;

    try {
      console.log(`💰 V4 卖出: ${tokenAddress}, 数量: ${tokenAmount}`);

      // 1. 发现池子
      const poolInfo = await this.discoverPool(tokenAddress);
      const poolKey = poolInfo.poolKey;

      // 2. 确定方向（Token → WETH）
      const weth = this.contracts.weth;
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();

      // 3. 解析代币数量
      const decimals = await this.getTokenDecimals(tokenAddress);
      const amountIn = typeof tokenAmount === 'bigint'
        ? tokenAmount
        : ethers.parseUnits(tokenAmount.toString(), decimals);

      // 4. 获取报价
      const quoteOut = await this.getQuote(poolKey, zeroForOne, amountIn);
      const expectedOut = BigInt(quoteOut);
      const slippageBps = Math.floor((1 - slippage) * 10000);
      const amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;

      console.log(`📊 预期 ETH 输出: ${ethers.formatEther(expectedOut)}, 最小: ${ethers.formatEther(amountOutMin)}`);

      // 5. 设置 Permit2 授权
      const allowanceOk = await this.ensurePermit2Allowance(tokenAddress, amountIn);
      if (!allowanceOk) {
        throw new Error('Permit2 代币授权失败');
      }

      // 6. 构建 Universal Router 交易
      // Commands: V4_SWAP + UNWRAP_ETH
      const commands = ethers.hexlify([COMMAND.V4_SWAP, COMMAND.UNWRAP_ETH]);

      // V4_SWAP input: SWAP_EXACT_IN + SETTLE_ALL(token) + TAKE_ALL(WETH)
      const v4Input = this._buildV4SwapInput(
        poolKey,
        zeroForOne,
        amountIn,
        amountOutMin,
        tokenAddress,   // settle token
        amountIn,       // settle token amount
        weth,           // take WETH
        amountOutMin    // take at least amountOutMin WETH
      );

      // UNWRAP_ETH input
      const unwrapInput = this._encodeUnwrapEthInput(amountOutMin);

      const inputs = [v4Input, unwrapInput];
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline;

      // 7. 编码 execute 调用
      const routerContract = new ethers.Contract(
        this.contracts.universalRouter,
        UNIVERSAL_ROUTER_ABI,
        this.wallet
      );

      const txData = routerContract.interface.encodeFunctionData("execute", [
        commands,
        inputs,
        deadlineTimestamp
      ]);

      // 8. 估算 Gas
      const estimatedGas = await this._safeEstimateGas({
        to: this.contracts.universalRouter,
        data: txData,
        from: this.wallet.address
      });

      const gasPrice = await this._getOptimalGasPrice();
      const bufferedGasLimit = (estimatedGas * 130n) / 100n;

      // 9. 发送交易
      const tx = await this.wallet.sendTransaction({
        to: this.contracts.universalRouter,
        data: txData,
        gasLimit: bufferedGasLimit,
        gasPrice,
        type: 2,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: await this._getPriorityFee()
      });

      console.log(`📤 V4 卖出交易已发送: ${tx.hash}`);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`✅ V4 卖出成功! Gas: ${receipt.gasUsed}`);
        return {
          success: true,
          txHash: tx.hash,
          amountOut: expectedOut.toString(),
          amountOutMin: amountOutMin.toString(),
          gasUsed: receipt.gasUsed,
          error: null
        };
      } else {
        throw new Error('V4 卖出交易执行失败');
      }
    } catch (error) {
      console.error(`❌ V4 卖出失败: ${error.message}`);
      return {
        success: false,
        txHash: null,
        error: error.message
      };
    }
  }

  /**
   * 获取代币价格（以原生代币计价）
   *
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<string>} 代币价格（ETH）
   */
  async getTokenPrice(tokenAddress) {
    try {
      const poolInfo = await this.discoverPool(tokenAddress);
      const poolKey = poolInfo.poolKey;
      const weth = this.contracts.weth;

      // 确定方向：1 个代币 → ? ETH
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();

      const decimals = await this.getTokenDecimals(tokenAddress);
      const oneToken = ethers.parseUnits('1', decimals);

      const quoteOut = await this.getQuote(poolKey, zeroForOne, oneToken);
      return ethers.formatEther(BigInt(quoteOut));
    } catch (error) {
      console.error(`获取代币价格失败: ${error.message}`);
      return '0';
    }
  }

  /**
   * 检查流动性是否充足
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string} amount - 交易金额
   * @param {boolean} isBuy - 是否为买入
   * @returns {Promise<boolean>}
   */
  async checkLiquidity(tokenAddress, amount, isBuy = true) {
    try {
      const poolInfo = await this.discoverPool(tokenAddress);
      // V4 的 liquidity 是当前活跃流动性
      // 简单检查：liquidity > 0
      return poolInfo.liquidity > 0n;
    } catch (error) {
      console.error(`检查流动性失败: ${error.message}`);
      return false;
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 安全 Gas 估算
   * @private
   */
  async _safeEstimateGas(tx) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const gasEstimate = await this.provider.estimateGas(tx);
        if (typeof gasEstimate === 'bigint') return gasEstimate;
        if (gasEstimate && typeof gasEstimate === 'object') {
          if (gasEstimate.toString) return BigInt(gasEstimate.toString());
        }
        return BigInt(gasEstimate);
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ Gas 估算 #${attempt} 失败: ${error.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }

    const msg = lastError.message.toLowerCase();
    if (msg.includes('insufficient allowance') || msg.includes('unauthorized')) {
      throw new Error(`Gas 估算失败 - 授权问题: ${lastError.message}`);
    }
    if (msg.includes('revert')) {
      throw new Error(`Gas 估算失败 - 执行错误: ${lastError.message}`);
    }

    console.warn('⚠️ Gas 估算失败，使用保守默认值');
    return BigInt(this.defaultGasLimit || 600000);
  }

  /**
   * 获取最优 Gas 价格
   * @private
   */
  async _getOptimalGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      return feeData.gasPrice;
    } catch (error) {
      const defaultGwei = this._chainKey === 'ethereum' ? '20' : '1';
      return ethers.parseUnits(defaultGwei, 'gwei');
    }
  }

  /**
   * 获取 priority fee
   * @private
   */
  async _getPriorityFee() {
    try {
      const feeData = await this.provider.getFeeData();
      return feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
    } catch (error) {
      return ethers.parseUnits('1', 'gwei');
    }
  }

  /**
   * 带重试的执行器
   * @private
   */
  async _executeWithRetry(operation, maxRetries = 3, name = 'operation') {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) console.log(`✅ ${name} 重试成功 (#${attempt})`);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`❌ ${name} #${attempt} 失败: ${error.message}`);

        const msg = error.message.toLowerCase();
        if (['insufficient balance', 'invalid address', 'invalid signature', 'nonce'].some(e => msg.includes(e))) {
          break;
        }

        if (attempt < maxRetries) {
          const wait = attempt * 3000;
          console.log(`⏳ ${wait / 1000}s 后重试...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }

    return {
      success: false,
      txHash: null,
      error: `重试 ${maxRetries} 次后失败: ${lastError.message}`
    };
  }

  /**
   * 获取交易器信息
   */
  getInfo() {
    const baseInfo = super.getInfo();
    return {
      ...baseInfo,
      contracts: this.contracts,
      chain: this._chainKey,
      type: 'Uniswap V4',
      description: `Uniswap V4 PoolManager on ${this._chainKey}`
    };
  }
}

module.exports = UniswapV4Trader;
