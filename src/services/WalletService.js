/**
 * 钱包服务组件
 * 从 rich-js 拷贝而来，用于实盘交易的钱包操作
 */

const Decimal = require('decimal.js');
const { BlockchainConfig } = require('../utils/BlockchainConfig');

/**
 * 钱包余额信息
 * @typedef {Object} WalletBalance
 * @property {string} symbol - 代币符号
 * @property {string} address - 代币合约地址
 * @property {Decimal} balance - 余额数量
 * @property {Decimal} valueUSD - 美元价值
 * @property {number} decimals - 精度
 */

/**
 * 钱包服务类
 * @class
 */
class WalletService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.AVE_API_KEY;
    this.timeout = config.timeout || 30000;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.baseURL = 'https://prod.ave-api.com';
    this.provider = config.provider || null; // 可选的区块链 provider，用于获取原生代币余额

    // 缓存钱包余额数据
    this.balanceCache = new Map();
    this.cacheTimeout = config.cacheTimeout || 60000; // 1分钟缓存
    this.lastCacheUpdate = 0;
  }

  /**
   * 安全地创建 Decimal 对象
   * @private
   * @param {*} value - 要转换的值
   * @returns {Decimal} Decimal 对象
   */
  _safeDecimal(value) {
    // 处理 null、undefined、空字符串、纯空白字符串
    if (value === null || value === undefined) {
      return new Decimal(0);
    }

    const strValue = String(value).trim();

    // 处理空字符串、纯符号（如 "-"、"+"）
    if (strValue === '' || strValue === '-' || strValue === '+' || strValue === '--') {
      return new Decimal(0);
    }

    try {
      return new Decimal(strValue);
    } catch (error) {
      console.warn(`⚠️ 无效的 Decimal 值: "${value}" (${typeof value})，使用 0 代替`);
      return new Decimal(0);
    }
  }

  /**
   * 获取钱包余额（带缓存和重试机制）
   * @param {string} walletAddress - 钱包地址
   * @param {string} chain - 区块链网络（默认 bsc）
   * @returns {Promise<WalletBalance[]>} 钱包余额列表
   */
  async getWalletBalances(walletAddress, chain = 'bsc') {
    const cacheKey = `${walletAddress}_${chain}`;
    const now = Date.now();

    // 检查缓存
    if (this.balanceCache.has(cacheKey) &&
        (now - this.lastCacheUpdate) < this.cacheTimeout) {
      console.log(`💰 使用缓存的钱包余额数据: ${walletAddress}`);
      return this.balanceCache.get(cacheKey);
    }

    console.log(`💰 获取钱包余额: ${walletAddress} (${chain})`);

    let lastError = null;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`🔄 尝试获取钱包余额 (第${attempt}次)`);

        // 使用fetch直接调用AVE API
        const url = `${this.baseURL}/v2/address/walletinfo/tokens?wallet_address=${walletAddress}&chain=${chain}&pageSize=500&pageNO=1`;

        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-API-KEY': this.apiKey,
            'Accept': '*/*'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const walletData = result.data || [];

        if (!walletData || !Array.isArray(walletData)) {
          throw new Error('API返回数据格式无效');
        }

        // 转换为标准格式
        let balances = walletData
          .filter(token => token && token.symbol)
          .map(token => {
            // 提取AVE PNL数据
            const pnl = {
              unrealized: this._safeDecimal(token.unrealized_profit),
              realized: this._safeDecimal(token.realized_profit),
              total: this._safeDecimal(token.total_profit),
              totalRatio: parseFloat(token.total_profit_ratio || '0'),
              averagePurchasePrice: parseFloat(token.average_purchase_price_usd || '0')
            };

            const balanceAmount = this._safeDecimal(token.balance_amount);
            const balanceUSD = this._safeDecimal(token.balance_usd);
            const currentPriceUSD = this._safeDecimal(token.current_price_usd);
            const avgPurchasePrice = this._safeDecimal(token.average_purchase_price_usd);

            return {
              symbol: token.symbol || 'UNKNOWN',
              address: token.token,
              balance: balanceAmount,
              valueUSD: balanceUSD,
              decimals: 18,
              priceUSD: currentPriceUSD,
              pnl,
              averagePurchasePrice: avgPurchasePrice,
              balanceAmount: balanceAmount,
              currentPriceUSD: currentPriceUSD
            };
          })
          .filter(balance => balance.balance.gt(0));

        // 对于 Solana，需要合并 Native SOL 和 WSOL 余额
        const normalizedChain = BlockchainConfig.normalizeBlockchainId(chain);
        const isSolana = normalizedChain === 'solana';
        if (isSolana) {
          console.log('🔍 检测到 Solana 链，合并 Native SOL 和 WSOL 余额...');

          const nativeSolAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
          const wsolAddress = 'So11111111111111111111111111111111111111112';

          const nativeSOL = balances.find(b => BlockchainConfig.normalizeTokenAddress(b.address, normalizedChain) === nativeSolAddress);
          const wsol = balances.find(b => b.address === wsolAddress);

          if (nativeSOL || wsol) {
            const nativeBalance = nativeSOL ? nativeSOL.balance : new Decimal('0');
            const wsolBalance = wsol ? wsol.balance : new Decimal('0');
            const totalSOL = nativeBalance.add(wsolBalance);

            const filteredBalances = balances.filter(b =>
              BlockchainConfig.normalizeTokenAddress(b.address, normalizedChain) !== nativeSolAddress &&
              b.address !== wsolAddress
            );

            const combinedValueUSD = (nativeSOL ? nativeSOL.valueUSD : new Decimal('0'))
              .add(wsol ? wsol.valueUSD : new Decimal('0'));
            const combinedPriceUSD = wsol ? wsol.priceUSD : (nativeSOL ? nativeSOL.priceUSD : new Decimal('0'));

            const combinedPnl = {
              unrealized: (nativeSOL?.pnl?.unrealized || new Decimal('0')).add(wsol?.pnl?.unrealized || new Decimal('0')),
              realized: (nativeSOL?.pnl?.realized || new Decimal('0')).add(wsol?.pnl?.realized || new Decimal('0')),
              total: (nativeSOL?.pnl?.total || new Decimal('0')).add(wsol?.pnl?.total || new Decimal('0')),
              totalRatio: parseFloat((wsol?.pnl?.totalRatio || 0)),
              averagePurchasePrice: parseFloat((wsol?.pnl?.averagePurchasePrice || 0))
            };

            const totalBalanceAmount = (nativeSOL?.balanceAmount || new Decimal('0')).add(wsol?.balanceAmount || new Decimal('0'));
            const combinedAvgPrice = totalBalanceAmount.gt(0)
              ? (nativeSOL?.averagePurchasePrice || new Decimal('0')).mul(nativeSOL?.balanceAmount || new Decimal('0'))
                  .add((wsol?.averagePurchasePrice || new Decimal('0')).mul(wsol?.balanceAmount || new Decimal('0')))
                  .div(totalBalanceAmount)
              : new Decimal('0');

            filteredBalances.unshift({
              symbol: 'SOL',
              address: wsolAddress,
              balance: totalSOL,
              valueUSD: combinedValueUSD.gt(0) ? combinedValueUSD : totalSOL.mul(combinedPriceUSD),
              decimals: 9,
              priceUSD: combinedPriceUSD,
              pnl: combinedPnl,
              averagePurchasePrice: combinedAvgPrice,
              balanceAmount: totalBalanceAmount,
              currentPriceUSD: combinedPriceUSD
            });

            balances = filteredBalances;
            console.log(`   ✅ 合并完成: ${totalSOL} SOL (${wsolAddress})`);
          }
        }

        // 🔥 对于 EVM 链（BSC），检查是否有原生代币余额
        // AVE API 可能不返回原生代币（BNB/ETH），只返回 WBNB/WETH
        // 如果配置了 provider，尝试直接从区块链获取原生代币余额
        if (!isSolana && this.provider && walletAddress) {
          const nativeTokenInfo = BlockchainConfig.getNativeToken(normalizedChain);
          const nativeTokenAddresses = BlockchainConfig.getNativeTokenAddresses(normalizedChain);
          const nativeAddrs = new Set(
            nativeTokenAddresses.map(addr => BlockchainConfig.normalizeTokenAddress(addr, normalizedChain))
          );

          // 检查 AVE API 返回的余额中是否有原生代币
          const hasNativeBalance = balances.some(b =>
            nativeAddrs.has(BlockchainConfig.normalizeTokenAddress(b.address, normalizedChain))
          );

          if (!hasNativeBalance) {
            console.log(`🔍 AVE API 未返回原生代币 (${nativeTokenInfo.symbol})，尝试从区块链获取...`);
            try {
              const balance = await this.provider.getBalance(walletAddress);
              const balanceAmount = new Decimal(balance.toString()).div(new Decimal(10).pow(nativeTokenInfo.decimals));

              if (balanceAmount.gt(0)) {
                console.log(`💰 从区块链获取原生 ${nativeTokenInfo.symbol} 余额: ${balanceAmount}`);

                // 使用 AVE API 的原生表示地址
                const aveNativeAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
                balances.unshift({
                  symbol: nativeTokenInfo.symbol,
                  address: aveNativeAddress,
                  balance: balanceAmount,
                  valueUSD: balanceAmount,
                  decimals: nativeTokenInfo.decimals,
                  priceUSD: new Decimal(0),
                  pnl: {
                    unrealized: new Decimal(0),
                    realized: new Decimal(0),
                    total: new Decimal(0),
                    totalRatio: 0,
                    averagePurchasePrice: 0
                  },
                  averagePurchasePrice: new Decimal(0),
                  balanceAmount: balanceAmount,
                  currentPriceUSD: new Decimal(0)
                });
              }
            } catch (rpcError) {
              console.warn(`⚠️ 从区块链获取原生代币余额失败: ${rpcError.message}`);
            }
          }
        }

        // 更新缓存
        this.balanceCache.set(cacheKey, balances);
        this.lastCacheUpdate = now;

        console.log(`✅ 钱包余额获取成功: ${balances.length} 种代币`);

        return balances;

      } catch (error) {
        lastError = error;
        console.error(`❌ 获取钱包余额失败 (第${attempt}次):`, error.message);

        if (attempt === this.retryAttempts) {
          break;
        }

        console.log(`⏳ 等待 ${this.retryDelay}ms 后重试...`);
        await this.sleep(this.retryDelay);

        this.retryDelay = Math.min(this.retryDelay * 1.5, 10000);
      }
    }

    // 所有尝试都失败，返回空数组
    console.error(`💥 获取钱包余额最终失败:`, lastError.message);
    return [];
  }

  /**
   * 获取特定代币的余额
   * @param {string} walletAddress - 钱包地址
   * @param {string} tokenAddress - 代币合约地址
   * @param {string} chain - 区块链网络
   * @returns {Promise<Decimal>} 代币余额
   */
  async getTokenBalance(walletAddress, tokenAddress, chain = 'bsc') {
    try {
      const balances = await this.getWalletBalances(walletAddress, chain);
      const normalizedChain = BlockchainConfig.normalizeBlockchainId(chain);
      const normalizedTokenAddress = BlockchainConfig.normalizeTokenAddress(tokenAddress, normalizedChain);
      const token = balances.find(b =>
        BlockchainConfig.normalizeTokenAddress(b.address, normalizedChain) === normalizedTokenAddress
      );

      return token ? token.balance : new Decimal('0');
    } catch (error) {
      console.error(`❌ 获取代币余额失败 [${tokenAddress}]:`, error.message);
      return new Decimal('0');
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.balanceCache.clear();
    this.lastCacheUpdate = 0;
    console.log(`🧹 钱包余额缓存已清除`);
  }

  /**
   * 睡眠函数
   * @param {number} ms - 毫秒数
   * @returns {Promise} Promise
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 验证钱包地址格式
   * @param {string} address - 钱包地址
   * @returns {boolean} 是否有效
   */
  isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}

module.exports = { WalletService };
