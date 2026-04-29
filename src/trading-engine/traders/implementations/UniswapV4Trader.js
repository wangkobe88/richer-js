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
  SWEEP: 0x04,
  WRAP_ETH: 0x05,
  UNWRAP_ETH: 0x06,
  V4_SWAP: 0x10
};

// V4_SWAP 内部子操作（与链上部署的 Universal Router 一致）
const V4_ACTION = {
  SWAP_EXACT_IN: 0x07,
  SETTLE: 0x0b,
  TAKE_ALL: 0x0f
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
   * 查找代币的 V4 池子（通用，自动发现 hooks）
   *
   * 查找策略:
   * 1. 缓存命中 → 直接返回
   * 2. StateView(hooks=0) → 标准无 hooks 池子
   * 3. PoolManager Initialize 事件 → 自定义 hooks 池子（launchpad 代币）
   *
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} 池子信息 { poolKey, sqrtPriceX96, liquidity }
   */
  async discoverPool(tokenAddress) {
    if (this.poolKeyCache.has(tokenAddress)) {
      return this.poolKeyCache.get(tokenAddress);
    }

    // 策略 1: 通过 StateView 查找标准池子（hooks=0）
    try {
      const poolInfo = await this._discoverPoolViaStateView(tokenAddress);
      if (poolInfo) {
        return poolInfo;
      }
    } catch (error) {
      // StateView 查不到，继续尝试
    }

    // 策略 2: 通过 PoolManager Initialize 事件发现自定义 hooks 池子
    try {
      const poolInfo = await this.discoverPoolFromEvents(tokenAddress);
      if (poolInfo) {
        return poolInfo;
      }
    } catch (error) {
      console.warn(`⚠️ 事件发现 hooks 失败: ${error.message}`);
    }

    throw new Error(`未找到代币 ${tokenAddress} 的 V4 池子`);
  }

  /**
   * 通过 StateView 查找标准池子（无 hooks）
   * @private
   */
  async _discoverPoolViaStateView(tokenAddress) {
    const stateView = new ethers.Contract(this.contracts.stateView, STATE_VIEW_ABI, this.provider);

    const feeConfigs = [
      { fee: 10000, tickSpacing: 200 },
      { fee: 3000, tickSpacing: 60 },
      { fee: 500, tickSpacing: 10 },
      { fee: 100, tickSpacing: 1 },
      { fee: 0, tickSpacing: 0 }
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

        if (result.sqrtPriceX96 > 0n) {
          const poolInfo = { poolKey, sqrtPriceX96: result.sqrtPriceX96, liquidity: result.liquidity };
          this.poolKeyCache.set(tokenAddress, poolInfo);
          console.log(`🔍 [StateView] 发现 V4 池子: fee=${fee}, tickSpacing=${tickSpacing}, hooks=${poolKey.hooks}`);
          return poolInfo;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  /**
   * 通过 PoolManager Initialize 事件自动发现 hooks 地址
   *
   * 原理：代币创建交易中，launchpad 调用 PoolManager.initialize()，
   * 该方法发出 Initialize 事件，包含完整的 hooks 地址。
   *
   * 步骤:
   * 1. Blockscout API 获取代币创建交易哈希
   * 2. 获取交易 receipt，在 logs 中查找 PoolManager 的 Initialize 事件
   * 3. 匹配 tokenAddress 作为 currency0 或 currency1
   * 4. 解码 hooks、fee、tickSpacing
   *
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object|null>} 池子信息
   */
  async discoverPoolFromEvents(tokenAddress) {
    const axios = require('axios');
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    // 1. 获取代币创建交易
    const blockscoutUrl = this._getBlockscoutUrl();
    const resp = await axios.get(`${blockscoutUrl}/api`, {
      params: {
        module: 'contract',
        action: 'getcontractcreation',
        contractaddresses: tokenAddress
      },
      timeout: 15000
    });

    const creationTxHash = resp.data?.result?.[0]?.txHash;
    if (!creationTxHash) {
      throw new Error('Blockscout 未找到创建交易');
    }

    // 2. 获取交易 receipt
    const receipt = await this.provider.getTransactionReceipt(creationTxHash);
    if (!receipt) {
      throw new Error('无法获取创建交易 receipt');
    }

    // 3. 在 receipt logs 中查找 PoolManager Initialize 事件
    // Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1,
    //            uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
    const initTopic = ethers.id('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)');
    const poolManagerLower = this.contracts.poolManager.toLowerCase();
    const tokenLower = tokenAddress.toLowerCase();

    for (const log of receipt.logs) {
      if (log.topics[0] !== initTopic) continue;
      if (log.address.toLowerCase() !== poolManagerLower) continue;

      // 解码 indexed 参数
      const currency0 = ethers.getAddress('0x' + log.topics[2].slice(26));
      const currency1 = ethers.getAddress('0x' + log.topics[3].slice(26));

      // 检查是否匹配当前代币（另一个 currency 应为原生 ETH 或 WETH）
      const isMatch = currency0.toLowerCase() === tokenLower || currency1.toLowerCase() === tokenLower;
      if (!isMatch) continue;

      // 确认另一个 currency 是 ETH (address(0)) 或 WETH
      const otherCurrency = currency0.toLowerCase() === tokenLower ? currency1 : currency0;
      const wethLower = this.contracts.weth.toLowerCase();
      if (otherCurrency.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
          otherCurrency.toLowerCase() !== wethLower) {
        continue;
      }

      // 解码 non-indexed 参数
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint24', 'int24', 'address', 'uint160', 'int24'],
        log.data
      );

      const fee = Number(decoded[0]);
      const tickSpacing = Number(decoded[1]);
      const hooks = decoded[2];
      const sqrtPriceX96 = decoded[3];

      // 排序 currencies（currency0 < currency1）
      const [sortedCurrency0, sortedCurrency1] = [currency0, currency1].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
      );

      const poolKey = {
        currency0: sortedCurrency0,
        currency1: sortedCurrency1,
        fee,
        tickSpacing,
        hooks
      };

      const poolInfo = {
        poolKey,
        sqrtPriceX96,
        liquidity: 0n
      };

      this.poolKeyCache.set(tokenAddress, poolInfo);
      console.log(`🔍 [Events] 发现 V4 池子: fee=${fee}, tickSpacing=${tickSpacing}, hooks=${hooks}`);
      return poolInfo;
    }

    return null;
  }

  /**
   * 获取当前链的 Blockscout URL
   * @private
   */
  _getBlockscoutUrl() {
    if (this._chainKey === 'base') return 'https://base.blockscout.com';
    return 'https://eth.blockscout.com';
  }

  /**
   * 通过 Quoter 获取报价
   *
   * 注意：自定义 hooks 池子可能 Quoter 调用会失败（hooks 在 staticCall 中 revert），
   * 此时返回 null，由调用方决定如何处理。
   *
   * @param {Object} poolKey - 池子 key
   * @param {boolean} zeroForOne - 是否 token0 → token1
   * @param {bigint} amountIn - 输入金额
   * @returns {Promise<bigint|null>} 输出金额，失败返回 null
   */
  async getQuote(poolKey, zeroForOne, amountIn) {
    try {
      const signer = this.wallet || this.provider;
      const quoter = new ethers.Contract(this.contracts.quoter, QUOTER_ABI, signer);

      const result = await quoter.quoteExactInputSingle.staticCall({
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
          ? 4295128739n + 1n
          : 1461446703485210103287273052203988822378723970342n - 1n
      });

      return result.amountOut;
    } catch (error) {
      console.warn(`⚠️ Quoter 报价失败 (hooks=${poolKey.hooks}): ${error.message?.slice(0, 150)}`);
      return null;
    }
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
      const maxExpiration = (2n ** 48n) - 1n; // uint48 max as BigInt

      if (BigInt(p2Amount) < amount || Number(p2Expiration) < now) {
        console.log(`🔐 授权 Permit2 → Universal Router: ${tokenAddress}`);
        const p2ApproveTx = await permit2Contract.approve(
          tokenAddress,
          this.contracts.universalRouter,
          2n ** 160n - 1n,  // uint160 max
          maxExpiration,
          { gasLimit: 100000n }
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
  // Universal Router 编码（PathKey[] 格式 + 原生 ETH）
  // ============================================================

  /**
   * 编码 V4_SWAP 的 input（bytes actions, bytes[] params）
   *
   * 格式与链上成功交易一致:
   *   abi.encode(actions_bytes, [settleParams, swapParams, takeParams])
   *
   * @param {number[]} actions - 子操作码数组
   * @param {string[]} encodedParams - 每个子操作的 ABI 编码参数
   * @returns {string} 编码后的 hex string
   * @private
   */
  _encodeV4SwapInput(actions, encodedParams) {
    const actionsBytes = ethers.hexlify(new Uint8Array(actions));
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'bytes[]'],
      [actionsBytes, encodedParams]
    );
  }

  /**
   * 编码 SETTLE 参数: (address currency, uint256 amount, bool payerIsUser)
   *
   * 原生 ETH: currency=address(0), payerIsUser=true (从 msg.value 支付)
   * ERC20 代币: currency=tokenAddress, payerIsUser=true (通过 Permit2 拉取)
   *
   * @private
   */
  _encodeSettleParams(currency, amount, payerIsUser = true) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bool'],
      [currency, amount, payerIsUser]
    );
  }

  /**
   * 编码 SWAP_EXACT_IN 参数（PathKey[] 格式）
   *
   * ExactInputParams: (address currencyIn, PathKey[] path, uint128 amountIn, uint128 amountOutMin)
   * PathKey: (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)
   *
   * @private
   */
  _encodeSwapExactInParams(currencyIn, tokenAddress, poolKey, amountIn, amountOutMin) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'],
      [[
        currencyIn,
        [[tokenAddress, poolKey.fee, poolKey.tickSpacing, poolKey.hooks, '0x']],
        amountIn,
        amountOutMin
      ]]
    );
  }

  /**
   * 编码 TAKE_ALL 参数: (address currency, uint256 minAmount)
   * @private
   */
  _encodeTakeAllParams(currency, minAmount) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [currency, minAmount]
    );
  }

  /**
   * 编码 SWEEP 参数: (address token, address recipient, uint256 amountMin)
   * @private
   */
  _encodeSweepParams(token, recipient, amountMin) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256'],
      [token, recipient, amountMin]
    );
  }

  // ============================================================
  // 交易方法
  // ============================================================

  /**
   * 买入代币 (ETH → Token)
   *
   * 编码格式（与链上成功交易一致）:
   *   Commands: V4_SWAP(0x10) + SWEEP(0x04)
   *   V4_SWAP Actions: SETTLE(0x0b) + SWAP_EXACT_IN(0x07) + TAKE_ALL(0x0f)
   *   SETTLE: (address(0), amount, payerIsUser=true) — 原生 ETH
   *   SWAP_EXACT_IN: (currencyIn=address(0), PathKey[token], amountIn, amountOutMin)
   *   TAKE_ALL: (tokenAddress, amountOutMin)
   *   SWEEP: (address(0), walletAddress, 0) — 多余 ETH 返还
   *
   * @param {string} tokenAddress - 代币地址
   * @param {string|bigint} ethAmount - ETH 数量
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
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    try {
      console.log(`🛒 V4 买入: ${tokenAddress}, ETH: ${ethAmount}`);

      // 1. 发现池子（自动发现 hooks）
      const poolInfo = await this.discoverPool(tokenAddress);
      const poolKey = poolInfo.poolKey;

      // 2. 确定方向
      const zeroForOne = poolKey.currency0.toLowerCase() === ZERO_ADDRESS.toLowerCase();

      // 3. 解析输入金额
      const amountIn = typeof ethAmount === 'bigint'
        ? ethAmount
        : ethers.parseEther(ethAmount);

      // 4. 获取报价（Quoter 对自定义 hooks 池子可能失败）
      const quoteOut = await this.getQuote(poolKey, zeroForOne, amountIn);
      let expectedOut;
      let amountOutMin;

      if (quoteOut !== null) {
        expectedOut = BigInt(quoteOut);
        const slippageBps = Math.floor((1 - slippage) * 10000);
        amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;
        console.log(`📊 预期输出: ${expectedOut}, 最小: ${amountOutMin}, hooks: ${poolKey.hooks}`);
      } else {
        // Quoter 失败，使用 amountOutMin=0（依赖 hooks 合约的内部价格计算）
        expectedOut = 0n;
        amountOutMin = 0n;
        console.log(`📊 Quoter 不可用，amountOutMin=0, hooks: ${poolKey.hooks}`);
      }

      // 5. 构建 V4_SWAP input: SETTLE + SWAP_EXACT_IN + TAKE_ALL
      const v4Input = this._encodeV4SwapInput(
        [V4_ACTION.SETTLE, V4_ACTION.SWAP_EXACT_IN, V4_ACTION.TAKE_ALL],
        [
          this._encodeSettleParams(ZERO_ADDRESS, amountIn, true),       // SETTLE 原生 ETH
          this._encodeSwapExactInParams(ZERO_ADDRESS, tokenAddress, poolKey, amountIn, amountOutMin),
          this._encodeTakeAllParams(tokenAddress, amountOutMin)          // TAKE_ALL token
        ]
      );

      // SWEEP: 多余原生 ETH 返还给钱包
      const sweepInput = this._encodeSweepParams(ZERO_ADDRESS, this.wallet.address, 0n);

      // Commands: V4_SWAP + SWEEP
      const commands = ethers.hexlify(new Uint8Array([COMMAND.V4_SWAP, COMMAND.SWEEP]));
      const inputs = [v4Input, sweepInput];
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline;

      // 6. 编码并发送交易
      const routerContract = new ethers.Contract(
        this.contracts.universalRouter,
        UNIVERSAL_ROUTER_ABI,
        this.wallet
      );

      const txData = routerContract.interface.encodeFunctionData("execute", [
        commands, inputs, deadlineTimestamp
      ]);

      // 7. 估算 Gas
      const estimatedGas = await this._safeEstimateGas({
        to: this.contracts.universalRouter,
        data: txData,
        value: amountIn,
        from: this.wallet.address
      });

      const gasPrice = await this._getOptimalGasPrice();
      const bufferedGasLimit = (estimatedGas * 130n) / 100n;

      // 8. 发送交易（EIP-1559，不设 gasPrice）
      const tx = await this.wallet.sendTransaction({
        to: this.contracts.universalRouter,
        data: txData,
        value: amountIn,
        gasLimit: bufferedGasLimit,
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
   * 编码格式:
   *   Commands: V4_SWAP(0x10) + SWEEP(0x04)
   *   V4_SWAP Actions: SETTLE(0x0b) + SWAP_EXACT_IN(0x07) + TAKE_ALL(0x0f)
   *   SETTLE: (tokenAddress, amount, payerIsUser=true) — 通过 Permit2
   *   SWAP_EXACT_IN: (currencyIn=token, PathKey[ETH], amountIn, amountOutMin)
   *   TAKE_ALL: (address(0), amountOutMin) — 收原生 ETH
   *   SWEEP: (tokenAddress, walletAddress, 0) — 多余代币返还
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
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    try {
      console.log(`💰 V4 卖出: ${tokenAddress}, 数量: ${tokenAmount}`);

      // 1. 发现池子（自动发现 hooks）
      const poolInfo = await this.discoverPool(tokenAddress);
      const poolKey = poolInfo.poolKey;

      // 2. 确定方向
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();

      // 3. 解析代币数量
      const decimals = await this.getTokenDecimals(tokenAddress);
      const amountIn = typeof tokenAmount === 'bigint'
        ? tokenAmount
        : ethers.parseUnits(tokenAmount.toString(), decimals);

      // 4. 获取报价（Quoter 对自定义 hooks 池子可能失败）
      const quoteOut = await this.getQuote(poolKey, zeroForOne, amountIn);
      let expectedOut;
      let amountOutMin;

      if (quoteOut !== null) {
        expectedOut = BigInt(quoteOut);
        const slippageBps = Math.floor((1 - slippage) * 10000);
        amountOutMin = (expectedOut * BigInt(slippageBps)) / 10000n;
        console.log(`📊 预期 ETH 输出: ${ethers.formatEther(expectedOut)}, 最小: ${ethers.formatEther(amountOutMin)}`);
      } else {
        expectedOut = 0n;
        amountOutMin = 0n;
        console.log(`📊 Quoter 不可用，amountOutMin=0, hooks: ${poolKey.hooks}`);
      }

      // 5. 设置 Permit2 授权
      const allowanceOk = await this.ensurePermit2Allowance(tokenAddress, amountIn);
      if (!allowanceOk) {
        throw new Error('Permit2 代币授权失败');
      }

      // 6. 构建 V4_SWAP input: SETTLE + SWAP_EXACT_IN + TAKE_ALL
      const v4Input = this._encodeV4SwapInput(
        [V4_ACTION.SETTLE, V4_ACTION.SWAP_EXACT_IN, V4_ACTION.TAKE_ALL],
        [
          this._encodeSettleParams(tokenAddress, amountIn, true),       // SETTLE token via Permit2
          this._encodeSwapExactInParams(tokenAddress, ZERO_ADDRESS, poolKey, amountIn, amountOutMin),
          this._encodeTakeAllParams(ZERO_ADDRESS, amountOutMin)          // TAKE_ALL 原生 ETH
        ]
      );

      // SWEEP: 多余代币返还给钱包
      const sweepInput = this._encodeSweepParams(tokenAddress, this.wallet.address, 0n);

      // Commands: V4_SWAP + SWEEP
      const commands = ethers.hexlify(new Uint8Array([COMMAND.V4_SWAP, COMMAND.SWEEP]));
      const inputs = [v4Input, sweepInput];
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadline;

      // 7. 编码并发送交易
      const routerContract = new ethers.Contract(
        this.contracts.universalRouter,
        UNIVERSAL_ROUTER_ABI,
        this.wallet
      );

      const txData = routerContract.interface.encodeFunctionData("execute", [
        commands, inputs, deadlineTimestamp
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
      // 9. 发送交易（EIP-1559，不设 gasPrice）
      const tx = await this.wallet.sendTransaction({
        to: this.contracts.universalRouter,
        data: txData,
        gasLimit: bufferedGasLimit,
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

      // 确定方向：1 个代币 → ? ETH
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();

      const decimals = await this.getTokenDecimals(tokenAddress);
      const oneToken = ethers.parseUnits('1', decimals);

      const quoteOut = await this.getQuote(poolKey, zeroForOne, oneToken);
      if (quoteOut === null) {
        console.warn(`⚠️ 无法获取代币价格（Quoter 不支持 hooks: ${poolKey.hooks}）`);
        return '0';
      }
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
    // Ethereum 最低 gas 价格保障（某些 RPC 返回值过低会导致交易卡住）
    const MIN_GAS_PRICE = {
      ethereum: ethers.parseUnits('2', 'gwei'),
      bsc: ethers.parseUnits('1', 'gwei'),
      base: ethers.parseUnits('0.01', 'gwei'),
    };
    const minPrice = MIN_GAS_PRICE[this._chainKey] || ethers.parseUnits('1', 'gwei');

    try {
      const feeData = await this.provider.getFeeData();
      const price = feeData.gasPrice;
      if (price && price >= minPrice) return price;
      console.log(`⚠️ RPC 返回 gasPrice 过低 (${ethers.formatUnits(price || 0n, 'gwei')} Gwei)，使用最低保障值 ${ethers.formatUnits(minPrice, 'gwei')} Gwei`);
      return minPrice;
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
    // Ethereum 最低 priority fee 保障
    const MIN_PRIORITY_FEE = {
      ethereum: ethers.parseUnits('0.1', 'gwei'),
      bsc: ethers.parseUnits('1', 'gwei'),
      base: ethers.parseUnits('0.01', 'gwei'),
    };
    const minFee = MIN_PRIORITY_FEE[this._chainKey] || ethers.parseUnits('1', 'gwei');

    try {
      const feeData = await this.provider.getFeeData();
      const fee = feeData.maxPriorityFeePerGas;
      if (fee && fee >= minFee) return fee;
      console.log(`⚠️ RPC 返回 maxPriorityFeePerGas 过低 (${ethers.formatUnits(fee || 0n, 'gwei')} Gwei)，使用最低保障值 ${ethers.formatUnits(minFee, 'gwei')} Gwei`);
      return minFee;
    } catch (error) {
      return minFee;
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
