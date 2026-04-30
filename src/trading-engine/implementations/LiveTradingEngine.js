/**
 * 实盘交易引擎
 * 继承自 AbstractTradingEngine，实现真实交易
 * 重构版本，支持 AVE API 持仓同步和真实交易执行
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const Decimal = require('decimal.js');
const { BlockchainConfig } = require('../../utils/BlockchainConfig');
const { WalletService } = require('../../services/WalletService');
const { categoryToRating } = require('../../narrative/utils/rating-utils.mjs');
const traderFactory = require('../traders');
const Logger = require('../../services/logger');

// Super IP 检测模块（懒加载，ESM 动态导入，用于 tweetAuthorType 因子）
let superIpModules = null;
async function getSuperIpModules() {
  if (!superIpModules) {
    const mod = await import('../../narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
    superIpModules = {
      detectSuperIP: mod.detectSuperIP
    };
  }
  return superIpModules;
}

/**
 * 实盘交易引擎
 * @class
 * @extends AbstractTradingEngine
 */
class LiveTradingEngine extends AbstractTradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    super({
      id: `live_${Date.now()}`,
      name: 'Fourmeme Live Trading Engine',
      mode: TradingMode.LIVE,
      blockchain: config.blockchain || 'bsc',
      ...config
    });

    // 实盘特有属性
    this._walletAddress = null;
    this._privateKey = null;
    this._reserveNative = new Decimal(config.reserveNative || 0.1);
    this._walletBalance = new Decimal(0); // 保存总钱包余额
    this._maxSlippage = 0.05;

    // 服务
    this._walletService = null;
    this._trader = null;
    this._fourMemeTrader = null;
    this._pancakeSwapTrader = null;
    this._uniswapV2Trader = null;
    this._uniswapV4Trader = null;
    this._monitoringTimer = null;

    // 代币池相关（与虚拟盘一致）
    this._fourmemeCollector = null;
    this._aveTokenApi = null;
    this._seenTokens = new Set();

    // 日志记录器（与虚拟盘一致）
    this.logger = null;

    // 数据服务（与虚拟盘一致）
    this.dataService = null;
    this.timeSeriesService = null;

    // RoundSummary - 轮次总结（与虚拟盘一致）
    this._roundSummary = null;

    // 叙事分析配置
    this._narrativeAnalysisEnabled = false;
    this._narrativeReanalyze = false;
    this._narrativeTriggerThreshold = 80; // 默认80%
    this._narrativeMaxWaitSeconds = 10; // 默认等待10秒
    this._narrativePollIntervalMs = 2000; // 默认每2秒检查一次

    // 统计信息
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0
    };

    console.log(`💰 实盘交易引擎已创建: ${this.id}`);
  }

  // ==================== 抽象方法实现 ====================

  /**
   * 初始化数据源（Live 特有：初始化 WalletService 和 Trader）
   * @protected
   * @returns {Promise<void>}
   */
  async _initializeDataSources() {
    // 首先初始化 Logger（必须在交易器之前）
    const Logger = require('../../services/logger');
    this.logger = new Logger({ dir: './logs', experimentId: this._experimentId });
    this.logger.info(this._experimentId, 'LiveTradingEngine', 'Logger 初始化完成');

    // 从实验配置获取钱包信息
    const walletConfig = this._experiment.config?.wallet;
    if (!walletConfig) {
      throw new Error('实盘实验缺少钱包配置 (config.wallet)');
    }

    this._walletAddress = walletConfig.address;
    if (!this._walletAddress) {
      throw new Error('实盘实验缺少钱包地址 (config.wallet.address)');
    }

    // 解密私钥
    const { CryptoUtils } = require('../../utils/CryptoUtils');
    const cryptoUtils = new CryptoUtils();
    const encryptedKey = walletConfig.privateKey;

    if (!encryptedKey) {
      throw new Error('实盘实验缺少私钥 (config.wallet.privateKey)');
    }

    try {
      this._privateKey = cryptoUtils.decrypt(encryptedKey);
      console.log('🔓 私钥解密成功');
    } catch (error) {
      throw new Error(`私钥解密失败: ${error.message}`);
    }

    // 初始化 WalletService（先不传 provider）
    this._walletService = new WalletService({
      apiKey: process.env.AVE_API_KEY,
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 2000,
      cacheTimeout: 0 // 实盘不使用缓存
    });

    console.log(`✅ WalletService 初始化完成，钱包地址: ${this._walletAddress}`);

    // 交易器配置
    const traderConfig = {
      blockchain: this._blockchain,
      chain: this._blockchain,
      enabled: true,
      trading: {
        maxGasPrice: this._experiment.config?.trading?.maxGasPrice || 10,
        maxGasLimit: this._experiment.config?.trading?.maxGasLimit || 500000,
        defaultSlippage: this._experiment.config?.trading?.maxSlippage ? this._experiment.config.trading.maxSlippage / 100 : 0.02,
        maxSlippage: this._experiment.config?.trading?.maxSlippage ? this._experiment.config.trading.maxSlippage / 100 : 0.05
      }
    };

    // 根据区块链类型初始化对应的交易器
    const blockchain = this._blockchain;
    const setLoggerIfAvailable = (trader) => {
      if (trader.setLogger) trader.setLogger(this.logger);
    };

    if (blockchain === 'bsc') {
      // BSC 链：FourMeme（内盘） + PancakeSwap V2（外盘）
      this._fourMemeTrader = traderFactory.createTrader('fourmeme', traderConfig);
      await this._fourMemeTrader.setWallet(this._privateKey);
      setLoggerIfAvailable(this._fourMemeTrader);
      console.log('✅ FourMeme 交易器初始化成功');

      this._pancakeSwapTrader = traderFactory.createTrader('pancakeswap-v2', traderConfig);
      await this._pancakeSwapTrader.setWallet(this._privateKey);
      setLoggerIfAvailable(this._pancakeSwapTrader);
      console.log('✅ PancakeSwap V2 交易器初始化成功');

      this._trader = this._fourMemeTrader;

    } else if (blockchain === 'ethereum') {
      // ETH 链：Uniswap V2 + V4
      this._uniswapV2Trader = traderFactory.createTrader('uniswap-v2', traderConfig);
      await this._uniswapV2Trader.setWallet(this._privateKey);
      setLoggerIfAvailable(this._uniswapV2Trader);
      console.log('✅ Uniswap V2 交易器初始化成功');

      this._uniswapV4Trader = traderFactory.createTrader('uniswap-v4', traderConfig);
      await this._uniswapV4Trader.setWallet(this._privateKey);
      setLoggerIfAvailable(this._uniswapV4Trader);
      console.log('✅ Uniswap V4 交易器初始化成功');

      this._trader = this._uniswapV2Trader;

    } else if (blockchain === 'base') {
      // Base 链：Uniswap V4
      this._uniswapV4Trader = traderFactory.createTrader('uniswap-v4', traderConfig);
      await this._uniswapV4Trader.setWallet(this._privateKey);
      setLoggerIfAvailable(this._uniswapV4Trader);
      console.log('✅ Uniswap V4 交易器初始化成功');

      this._trader = this._uniswapV4Trader;

    } else {
      throw new Error(`不支持的区块链: ${blockchain}，Live 模式当前支持 bsc/ethereum/base`);
    }

    // 将 trader 的 provider 传递给 WalletService，用于获取原生代币余额
    if (this._trader.provider) {
      this._walletService.provider = this._trader.provider;
      console.log('✅ WalletService 已配置 provider');
    }

    // 初始化实盘特定组件
    await this._initializeLiveComponents();

    // 初始化真实持仓
    await this._initializeRealPortfolio();
  }

  /**
   * 运行主循环（Live 特有：定时监控循环）
   * @protected
   * @returns {Promise<void>}
   */
  async _runMainLoop() {
    const interval = 10000; // 10秒间隔

    this._monitoringTimer = setInterval(async () => {
      await this._monitoringCycle();
    }, interval);

    console.log(`🔄 实盘监控循环已启动，间隔: ${interval}ms`);
  }

  /**
   * 同步持仓数据（Live 特有：从 AVE API 获取真实持仓）
   * @protected
   * @returns {Promise<void>}
   */
  async _syncHoldings() {
    try {
      // 从 AVE API 获取钱包余额
      const walletBalances = await this._walletService.getWalletBalances(
        this._walletAddress,
        this._blockchain
      );

      // 保存现有 CardPositionManager 状态
      const existingCardManagers = new Map();
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (portfolio && portfolio.positions) {
        for (const [tokenAddr, position] of portfolio.positions) {
          const cardManager = this._tokenPool.getCardPositionManager(tokenAddr, this._blockchain);
          if (cardManager) {
            existingCardManagers.set(tokenAddr, {
              bnbCards: cardManager.bnbCards,
              tokenCards: cardManager.tokenCards,
              totalCards: cardManager.totalCards,
              perCardMaxBNB: cardManager.perCardMaxBNB
            });
          }
        }
      }

      // 清空并重建 PortfolioManager 持仓
      if (portfolio && portfolio.positions) {
        portfolio.positions.clear();

        for (const token of walletBalances) {
          const normalizedAddr = BlockchainConfig.normalizeTokenAddress(token.address, this._blockchain);

          await this._portfolioManager.updatePosition(
            this._portfolioId,
            normalizedAddr,
            token.balance,
            token.pnl?.averagePurchasePrice || token.averagePurchasePrice || 0,
            'hold'
          );

          // 恢复或创建 CardPositionManager
          let cardManager = this._tokenPool.getCardPositionManager(normalizedAddr, this._blockchain);
          if (!cardManager && existingCardManagers.has(normalizedAddr)) {
            // 恢复已有代币的卡牌状态
            const savedState = existingCardManagers.get(normalizedAddr);
            const { CardPositionManager } = require('../../portfolio/CardPositionManager');
            cardManager = new CardPositionManager({
              totalCards: savedState.totalCards || 4,
              perCardMaxBNB: savedState.perCardMaxBNB || 0.25,
              minCardsForTrade: 1,
              initialAllocation: {
                bnbCards: savedState.bnbCards,
                tokenCards: savedState.tokenCards
              }
            });
            this._tokenPool.setCardPositionManager(normalizedAddr, this._blockchain, cardManager);
          }
        }
      } else {
        this.logger.warn(this._experimentId, 'SyncHoldings', 'Portfolio 为空，跳过持仓同步');
        return;
      }

      this.logger.info(this._experimentId, 'SyncHoldings', `持仓同步完成: ${walletBalances.length} 种代币`);

    } catch (error) {
      this.logger.error(this._experimentId, 'SyncHoldings', `持仓同步失败: ${error.message}`);
      // 不抛出错误，允许引擎继续运行
    }
  }

  /**
   * 执行买入（Live 特有：使用真实交易器）
   * @protected
   * @param {Object} signal - 买入信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */

  /**
   * 根据 AVE API 返回的 main pair 信息智能选择 trader
   * 通过 getTokenDetail 获取 amm 字段，映射到对应的交易器
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链标识
   * @returns {Promise<Object>} 选中的 trader 实例
   */
  async _selectTraderForToken(tokenAddress, chain) {
    // BSC 链默认 fourmeme，Base 链默认 uniswap-v4
    if (chain === 'bsc') return this._fourmemeTrader;
    if (chain === 'base') return this._uniswapV4Trader;

    // ETH 链：查询 AVE API 获取 main pair 的 amm
    try {
      const tokenId = `${tokenAddress}-${chain}`;
      const detail = await this._aveTokenApi.getTokenDetail(tokenId);
      const tokenData = detail.token || {};
      const pairs = detail.pairs || [];
      const mainPairAddr = tokenData.main_pair;

      // 找到 main pair
      const mainPair = mainPairAddr
        ? pairs.find(p => p.pair === mainPairAddr)
        : pairs[0];

      if (mainPair && mainPair.amm) {
        const amm = mainPair.amm.toLowerCase();
        this.logger.info(this._experimentId, 'SmartTrader',
          `AVE API 返回 main pair | token=${tokenAddress?.slice(0, 10)}..., amm=${amm}, pair=${mainPair.pair}`);

        if (amm.includes('v4') && this._uniswapV4Trader) {
          return this._uniswapV4Trader;
        } else if (amm.includes('v3') && this._uniswapV4Trader) {
          // V3 pool 也通过 V4 trader 的 hook 处理
          return this._uniswapV4Trader;
        } else if (amm.includes('uniswap') && this._uniswapV2Trader) {
          return this._uniswapV2Trader;
        } else if (amm.includes('pancake') && this._pancakeSwapTrader) {
          return this._pancakeSwapTrader;
        }
        // amm 未匹配到已知 trader，fallback
        this.logger.warn(this._experimentId, 'SmartTrader',
          `未知 amm 类型: ${amm}，使用默认 trader`);
      }
    } catch (e) {
      this.logger.warn(this._experimentId, 'SmartTrader',
        `AVE API 查询失败，使用默认 trader | error=${e.message}`);
    }

    // fallback: 按链返回默认 trader
    return this._uniswapV2Trader;
  }

  async _executeBuy(signal, signalId = null, metadata = {}) {
    this.logger.info(this._experimentId, '_executeBuy',
      `========== _executeBuy 被调用 ==========`);
    this.logger.info(this._experimentId, '_executeBuy',
      `signal | action=${signal.action}, symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, price=${signal.price}, cards=${signal.cards}, signalId=${signalId}`);

    try {
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        this.logger.error(this._experimentId, '_executeBuy',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      // 记录买入前的卡牌和余额状态（与虚拟盘一致）
      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const beforeBalance = {
        bnbBalance: this._walletBalance,
        tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
      };

      this.logger.info(this._experimentId, '_executeBuy',
        `卡牌状态 | ${beforeCardState.bnbCards} BNB卡, ${beforeCardState.tokenCards} 代币卡`);
      this.logger.info(this._experimentId, '_executeBuy',
        `余额状态 | ${beforeBalance.bnbBalance} BNB, ${beforeBalance.tokenBalance} 代币`);

      const amountInBNB = this._calculateBuyAmount(signal);
      this.logger.info(this._experimentId, '_executeBuy',
        `计算买入金额 | amountInBNB=${amountInBNB}, signal.cards=${signal.cards}`);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      // 检查资金是否足够
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (portfolio) {
        const maxSpendable = portfolio.availableBalance || portfolio.cashBalance;
        this.logger.info(this._experimentId, '_executeBuy',
          `资金检查 | 需要 ${amountInBNB} BNB, 可用 ${maxSpendable} BNB, 保留 ${this._reserveNative} BNB`);
        if (new Decimal(amountInBNB).gt(maxSpendable)) {
          this.logger.error(this._experimentId, '_executeBuy',
            `资金不足 | 需要 ${amountInBNB} BNB，可用 ${maxSpendable} BNB（已保留 ${this._reserveNative} BNB 用于 GAS）`);
          return {
            success: false,
            reason: `资金不足: 需要 ${amountInBNB} BNB，可用 ${maxSpendable} BNB（已保留 ${this._reserveNative} BNB 用于 GAS）`
          };
        }
      }

      // 使用真实交易器执行买入
      this.logger.info(this._experimentId, '_executeBuy',
        `执行交易 | symbol=${signal.symbol}, amount=${amountInBNB} BNB, tokenAddress=${signal.tokenAddress}`);
      // FourMemeDirectTrader 使用 slippageTolerance (百分比格式，如 5 表示 5%)
      // PancakeSwapV2Trader 使用 slippage (小数格式，如 0.05 表示 5%)
      const buyOptions = {
        slippage: this._maxSlippage,
        slippageTolerance: this._maxSlippage * 100, // 转换为百分比
        gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
      };

      // 转换为 wei 格式（交易器期望 BigInt/BigNumber 格式）
      const ethers = require('ethers');
      this.logger.info(this._experimentId, '_executeBuy',
        `类型检查 | amountInBNB=${amountInBNB}, typeof=${typeof amountInBNB}, string=${amountInBNB.toString()}`);

      const amountInWei = ethers.parseEther(amountInBNB.toString());

      this.logger.info(this._experimentId, '_executeBuy',
        `Wei 转换 | amountInWei=${amountInWei}, typeof=${typeof amountInWei}`);

      // 智能选择 trader：根据 main pair 的 amm 类型自动路由
      const selectedTrader = await this._selectTraderForToken(signal.tokenAddress, signal.chain || this._blockchain);
      this.logger.info(this._experimentId, '_executeBuy',
        `选中 trader | type=${selectedTrader === this._uniswapV4Trader ? 'uniswap-v4' : selectedTrader === this._uniswapV2Trader ? 'uniswap-v2' : 'other'}`);

      const buyResult = await selectedTrader.buyToken(
        signal.tokenAddress,
        amountInWei,
        buyOptions
      );

      this.logger.info(this._experimentId, '_executeBuy',
        `交易结果 | success=${buyResult?.success}, error=${buyResult?.error || 'none'}, txHash=${buyResult?.transactionHash || buyResult?.txHash || 'none'}`);

      if (!buyResult.success) {
        this.logger.error(this._experimentId, '_executeBuy',
          `交易执行失败 | reason=${buyResult.error || '交易执行失败'}`);
        return { success: false, reason: buyResult.error || '交易执行失败' };
      }

      // 更新 PortfolioManager（使用实际成交数据）
      // 尝试从交易结果中获取实际代币数量，如果没有则用价格估算
      let actualTokenAmount;
      let actualPrice = signal.price || 0;

      if (buyResult.actualAmountOut || buyResult.amountOut) {
        // 交易器返回了实际成交数量
        actualTokenAmount = parseFloat(buyResult.actualAmountOut || buyResult.amountOut || 0);
        // 反推实际成交价格（使用 Decimal 避免浮点数精度问题）
        if (actualTokenAmount > 0) {
          actualPrice = new Decimal(amountInBNB).div(actualTokenAmount).toNumber();
        }
        this.logger.info(this._experimentId, '_executeBuy',
          `交易器返回 | actualAmountOut=${actualTokenAmount}, actualPrice=${actualPrice}`);
      } else {
        // 交易器没有返回实际数量，使用价格估算（使用 Decimal 避免浮点数精度问题）
        actualPrice = signal.price || 0;
        actualTokenAmount = actualPrice > 0 ? new Decimal(amountInBNB).div(actualPrice).toNumber() : 0;
        this.logger.info(this._experimentId, '_executeBuy',
          `价格估算 | signal.price=${signal.price}, actualPrice=${actualPrice}, actualTokenAmount=${actualTokenAmount}`);
      }

      // 确保数值有效
      if (!isFinite(actualTokenAmount) || actualTokenAmount <= 0) {
        this.logger.error(this._experimentId, '_executeBuy',
          `代币数量无效 | actualTokenAmount=${actualTokenAmount}, 使用 fallback`);
        actualTokenAmount = amountInBNB / (signal.price || 1e-6);
      }
      if (!isFinite(actualPrice) || actualPrice <= 0) {
        this.logger.error(this._experimentId, '_executeBuy',
          `价格无效 | actualPrice=${actualPrice}, 使用 signal.price=${signal.price}`);
        actualPrice = signal.price || 1e-6;
      }

      this.logger.info(this._experimentId, '_executeBuy',
        `更新 Portfolio | actualTokenAmount=${actualTokenAmount}, actualPrice=${actualPrice}`);

      await this._portfolioManager.executeTrade(
        this._portfolioId,
        signal.tokenAddress,
        'buy',
        actualTokenAmount,
        actualPrice
      );

      // 创建交易记录并保存到数据库（与虚拟盘一致）
      const { Trade } = require('../entities');
      const trade = new Trade({
        experimentId: this._experimentId,
        signalId: signalId,
        tokenAddress: signal.tokenAddress,
        tokenSymbol: signal.symbol,
        tradeDirection: 'buy',
        tradeStatus: 'success',
        success: true,
        isVirtualTrade: false,
        // 买入: BNB -> 代币
        inputCurrency: 'BNB',
        outputCurrency: signal.symbol,
        inputAmount: String(amountInBNB),
        outputAmount: String(actualTokenAmount),
        unitPrice: String(actualPrice),
        txHash: buyResult.transactionHash || buyResult.txHash,
        gasUsed: buyResult.gasUsed || null,
        gasPrice: buyResult.gasPrice || null,
        executedAt: new Date(),
        metadata: {
          ...metadata,
          txHash: buyResult.transactionHash || buyResult.txHash,
          protocol: 'FourMeme',
          method: 'buyToken'
        }
      });
      const tradeId = await trade.save();
      this.logger.info(this._experimentId, '_executeBuy', `交易记录已保存 | tradeId=${tradeId}`);

      // 更新卡牌分配
      const cards = parseInt(signal.cards) || 1;
      this.logger.info(this._experimentId, '_executeBuy',
        `更新卡牌分配 | cards=${cards}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
      cardManager.afterBuy(signal.symbol, cards);
      this.logger.info(this._experimentId, '_executeBuy',
        `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

      const afterCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const afterBalance = {
        bnbBalance: this._walletBalance,
        tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
      };

      const tradeResult = {
        success: true,
        tradeId: tradeId,
        txHash: buyResult.transactionHash || buyResult.txHash,
        trade: trade,
        metadata: {
          ...metadata,
          txHash: buyResult.transactionHash || buyResult.txHash,
          cardPositionChange: {
            before: {
              ...beforeCardState,
              ...beforeBalance
            },
            after: {
              ...afterCardState,
              ...afterBalance
            },
            transferredCards: cards
          }
        }
      };

      // 更新交易记录的 metadata（与虚拟盘一致）
      if (tradeId && tradeResult.metadata) {
        this.logger.info(this._experimentId, '_executeBuy',
          `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
        await this.dataService.updateTrade(tradeId, {
          metadata: tradeResult.metadata
        });
      }

      this.logger.info(this._experimentId, '_executeBuy',
        `========== _executeBuy 完成 | success=true, tradeId=${tradeResult.tradeId} ==========`);

      return tradeResult;

    } catch (error) {
      this.logger.error(this._experimentId, '_executeBuy',
        `========== _executeBuy 异常 | error=${error.message} ==========`);
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出（Live 特有：智能选择交易器）
   * @protected
   * @param {Object} signal - 卖出信号
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 交易结果
   */
  async _executeSell(signal, signalId = null, metadata = {}) {
    this.logger.info(this._experimentId, '_executeSell',
      `检查持仓 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        this.logger.warn(this._experimentId, '_executeSell',
          `无持仓 | tokenAddress=${signal.tokenAddress}`);
        return { success: false, reason: '无持仓' };
      }
      if (holding.amount <= 0) {
        this.logger.warn(this._experimentId, '_executeSell',
          `持仓数量为0 | tokenAddress=${signal.tokenAddress}, amount=${holding.amount}`);
        return { success: false, reason: '持仓数量为0' };
      }

      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeSell',
          `卡牌管理器未初始化 | tokenAddress=${signal.tokenAddress}, chain=${signal.chain}`);
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      // 记录卖出前的卡牌和余额状态（与虚拟盘一致）
      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const beforeBalance = {
        bnbBalance: this._walletBalance,
        tokenBalance: holding.amount
      };

      this.logger.info(this._experimentId, '_executeSell',
        `卡牌状态 | ${beforeCardState.bnbCards} BNB卡, ${beforeCardState.tokenCards} 代币卡`);
      this.logger.info(this._experimentId, '_executeSell',
        `余额状态 | ${beforeBalance.bnbBalance} BNB, ${beforeBalance.tokenBalance} 代币`);

      const cards = signal.cards || 'all';
      const sellAll = (cards === 'all');
      const cardsToUse = sellAll ? null : parseInt(cards);
      const amountToSell = cardManager.calculateSellAmount(holding.amount, signal.symbol, cardsToUse, sellAll);

      if (amountToSell <= 0) {
        return { success: false, reason: '计算卖出数量为0' };
      }

      // 智能选择交易器：根据链类型使用不同的交易器组合
      let sellResult;
      let traderUsed = 'unknown';

      // 转换为 wei 格式（交易器期望 BigInt 格式，代币最小单位）
      const ethers = require('ethers');
      const amountToSellBigInt = ethers.parseUnits(amountToSell.toFixed(18), 18);

      if (this._blockchain === 'bsc') {
        // BSC: FourMeme(内盘) → PancakeSwap V2(外盘) fallback
        const fourmemeOptions = {
          slippageTolerance: this._maxSlippage * 100,
          gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
        };
        const pancakeOptions = {
          slippage: this._maxSlippage,
          gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
        };

        try {
          this.logger.info(this._experimentId, '_executeSell', `尝试使用 FourMeme 交易器卖出 ${signal.symbol}...`);
          sellResult = await this._fourMemeTrader.sellToken(
            signal.tokenAddress,
            amountToSellBigInt,
            fourmemeOptions
          );

          if (sellResult.success) {
            traderUsed = 'fourmeme';
            this.logger.info(this._experimentId, '_executeSell', `FourMeme 交易器卖出成功`);
          } else {
            throw new Error(sellResult.error || 'FourMeme 交易失败');
          }
        } catch (fourmemeError) {
          this.logger.warn(this._experimentId, '_executeSell', `FourMeme 交易器卖出失败: ${fourmemeError.message}`);

          const isBondingCurveSaturated = fourmemeError.code === 'BONDING_CURVE_SATURATED' ||
            fourmemeError.message?.includes('bonding curve') ||
            fourmemeError.message?.includes('已饱和');

          if (isBondingCurveSaturated) {
            this.logger.warn(this._experimentId, '_executeSell',
              `Bonding curve 已饱和，尝试通过 PancakeSwap 卖出（如果有流动性池）`);
          }

          this.logger.info(this._experimentId, '_executeSell', `尝试使用 PancakeSwap V2 交易器卖出 ${signal.symbol}...`);

          try {
            sellResult = await this._pancakeSwapTrader.sellToken(
              signal.tokenAddress,
              amountToSellBigInt,
              pancakeOptions
            );

            if (sellResult.success) {
              traderUsed = 'pancakeswap-v2';
              this.logger.info(this._experimentId, '_executeSell', `PancakeSwap V2 交易器卖出成功`);
            } else {
              throw new Error(sellResult.error || 'PancakeSwap V2 交易失败');
            }
          } catch (pancakeError) {
            this.logger.error(this._experimentId, '_executeSell', `PancakeSwap V2 交易器也失败: ${pancakeError.message}`);

            if (isBondingCurveSaturated && pancakeError.message?.includes('交易对')) {
              return {
                success: false,
                reason: `代币 bonding curve 已饱和且未在 DEX 创建流动性池，无法卖出。需等待流动性添加到 DEX 后才能卖出。`
              };
            }

            return {
              success: false,
              reason: `所有交易器均失败: FourMeme(${fourmemeError.message}), PancakeSwap V2(${pancakeError.message})`
            };
          }
        }

      } else if (this._blockchain === 'ethereum') {
        // ETH: 智能选择 trader，失败后 fallback 到另一个
        const uniswapOptions = {
          slippage: this._maxSlippage,
          gasPrice: this._experiment.config?.trading?.maxGasPrice || 50
        };

        const primaryTrader = await this._selectTraderForToken(signal.tokenAddress, signal.chain || this._blockchain);
        const primaryName = primaryTrader === this._uniswapV4Trader ? 'uniswap-v4' : 'uniswap-v2';
        const fallbackTrader = primaryTrader === this._uniswapV4Trader ? this._uniswapV2Trader : this._uniswapV4Trader;
        const fallbackName = primaryTrader === this._uniswapV4Trader ? 'uniswap-v2' : 'uniswap-v4';

        try {
          this.logger.info(this._experimentId, '_executeSell', `尝试使用 ${primaryName} 交易器卖出 ${signal.symbol}...`);
          sellResult = await primaryTrader.sellToken(
            signal.tokenAddress,
            amountToSellBigInt,
            uniswapOptions
          );

          if (sellResult.success) {
            traderUsed = primaryName;
            this.logger.info(this._experimentId, '_executeSell', `${primaryName} 交易器卖出成功`);
          } else {
            throw new Error(sellResult.error || `${primaryName} 交易失败`);
          }
        } catch (primaryError) {
          this.logger.warn(this._experimentId, '_executeSell', `${primaryName} 交易器卖出失败: ${primaryError.message}`);

          this.logger.info(this._experimentId, '_executeSell', `尝试使用 ${fallbackName} 交易器卖出 ${signal.symbol}...`);

          try {
            sellResult = await fallbackTrader.sellToken(
              signal.tokenAddress,
              amountToSellBigInt,
              uniswapOptions
            );

            if (sellResult.success) {
              traderUsed = fallbackName;
              this.logger.info(this._experimentId, '_executeSell', `${fallbackName} 交易器卖出成功`);
            } else {
              throw new Error(sellResult.error || `${fallbackName} 交易失败`);
            }
          } catch (fallbackError) {
            this.logger.error(this._experimentId, '_executeSell', `${fallbackName} 交易器也失败: ${fallbackError.message}`);
            return {
              success: false,
              reason: `所有交易器均失败: ${primaryName}(${primaryError.message}), ${fallbackName}(${fallbackError.message})`
            };
          }
        }

      } else if (this._blockchain === 'base') {
        // Base: Uniswap V4
        const uniswapOptions = {
          slippage: this._maxSlippage,
          gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
        };

        try {
          this.logger.info(this._experimentId, '_executeSell', `使用 Uniswap V4 交易器卖出 ${signal.symbol}...`);
          sellResult = await this._uniswapV4Trader.sellToken(
            signal.tokenAddress,
            amountToSellBigInt,
            uniswapOptions
          );

          if (sellResult.success) {
            traderUsed = 'uniswap-v4';
            this.logger.info(this._experimentId, '_executeSell', `Uniswap V4 交易器卖出成功`);
          } else {
            throw new Error(sellResult.error || 'Uniswap V4 交易失败');
          }
        } catch (v4Error) {
          this.logger.error(this._experimentId, '_executeSell', `Uniswap V4 交易器失败: ${v4Error.message}`);
          return {
            success: false,
            reason: `Uniswap V4 交易失败: ${v4Error.message}`
          };
        }

      } else {
        return { success: false, reason: `不支持的区块链: ${this._blockchain}` };
      }

      // 更新 metadata 记录使用的交易器
      metadata.traderUsed = traderUsed;

      if (!sellResult.success) {
        return { success: false, reason: sellResult.error || '交易执行失败' };
      }

      // 更新 PortfolioManager
      const price = signal.price || 0;
      await this._portfolioManager.executeTrade(
        this._portfolioId,
        signal.tokenAddress,
        'sell',
        amountToSell,
        price
      );

      // 计算实际收到的 BNB 数量
      let actualBnbReceived = 0;
      if (sellResult.actualReceived) {
        actualBnbReceived = parseFloat(sellResult.actualReceived);
      } else if (price > 0 && amountToSell > 0) {
        // 使用 Decimal 进行乘法，避免浮点数精度问题
        actualBnbReceived = new Decimal(amountToSell).mul(price).toNumber();
      }

      // 创建交易记录并保存到数据库（与虚拟盘一致）
      const { Trade } = require('../entities');
      const trade = new Trade({
        experimentId: this._experimentId,
        signalId: signalId,
        tokenAddress: signal.tokenAddress,
        tokenSymbol: signal.symbol,
        tradeDirection: 'sell',
        tradeStatus: 'success',
        success: true,
        isVirtualTrade: false,
        // 卖出: 代币 -> BNB
        inputCurrency: signal.symbol,
        outputCurrency: 'BNB',
        inputAmount: String(amountToSell),
        outputAmount: String(actualBnbReceived),
        unitPrice: String(price),
        txHash: sellResult.transactionHash || sellResult.txHash,
        gasUsed: sellResult.gasUsed || null,
        gasPrice: sellResult.gasPrice || null,
        executedAt: new Date(),
        metadata: {
          ...metadata,
          txHash: sellResult.transactionHash || sellResult.txHash,
          traderUsed: traderUsed,
          protocol: traderUsed === 'fourmeme' ? 'FourMeme' : 'PancakeSwap V2',
          method: 'sellToken'
        }
      });
      const tradeId = await trade.save();
      this.logger.info(this._experimentId, '_executeSell', `交易记录已保存 | tradeId=${tradeId}`);

      // 更新卡牌分配
      const actualCards = sellAll ? beforeCardState.tokenCards : cardsToUse;
      this.logger.info(this._experimentId, '_executeSell',
        `更新卡牌分配 | actualCards=${actualCards}, sellAll=${sellAll}, before: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);
      cardManager.afterSell(signal.symbol, actualCards, sellAll);
      this.logger.info(this._experimentId, '_executeSell',
        `更新卡牌分配完成 | after: bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}`);

      const afterCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };
      const afterBalance = {
        bnbBalance: this._walletBalance,
        tokenBalance: this._getHolding(signal.tokenAddress)?.amount || 0
      };

      const tradeResult = {
        success: true,
        tradeId: tradeId,
        txHash: sellResult.transactionHash || sellResult.txHash,
        trade: trade,
        metadata: {
          ...metadata,
          txHash: sellResult.transactionHash || sellResult.txHash,
          traderUsed: traderUsed,
          cardPositionChange: {
            before: {
              ...beforeCardState,
              ...beforeBalance
            },
            after: {
              ...afterCardState,
              ...afterBalance
            },
            transferredCards: actualCards
          }
        }
      };

      // 更新交易记录的 metadata（与虚拟盘一致）
      if (tradeId && tradeResult.metadata) {
        this.logger.info(this._experimentId, '_executeSell',
          `更新交易记录 | tradeId=${tradeId}, after状态已更新`);
        await this.dataService.updateTrade(tradeId, {
          metadata: tradeResult.metadata
        });
      }

      // 🔥 卖出成功后，检查是否还有剩余持仓
      // 如果tokenCards为0，说明已全部卖出，更新状态为sold（交易后观察期）
      if (cardManager.tokenCards === 0) {
        this.logger.info(this._experimentId, '_executeSell',
          `已全部卖出，更新代币状态为sold(观察30分钟) | tokenAddress=${signal.tokenAddress}, symbol=${signal.symbol}`);

        // 记录已完成的交易对
        const token = this._tokenPool.getToken(signal.tokenAddress, signal.chain);
        if (token && token.buyTime && token.buyPrice) {
          const sellTime = Date.now();
          const buyPrice = token.buyPrice;
          const sellPrice = price;
          const returnRate = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice * 100) : 0;
          const pnl = actualBnbReceived - (actualBnbReceived / (1 + returnRate / 100));

          this._tokenPool.addCompletedPair(signal.tokenAddress, signal.chain, {
            buyTime: token.buyTime,
            sellTime: sellTime,
            returnRate: returnRate,
            pnl: pnl
          });

          this.logger.info(this._experimentId, '_executeSell',
            `记录已完成交易对 | symbol=${token.symbol}, buyPrice=${buyPrice}, sellPrice=${sellPrice}, returnRate=${returnRate.toFixed(2)}%, pnl=${pnl.toFixed(6)} BNB`);
        }

        this._tokenPool.markAsSold(signal.tokenAddress, signal.chain);
        await this.dataService.updateTokenStatus(this._experimentId, signal.tokenAddress, 'sold');
      }

      return tradeResult;

    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * 是否记录时序数据（Live 返回 true）
   * @protected
   * @returns {boolean}
   */
  _shouldRecordTimeSeries() {
    return true;
  }

  // ==================== Live 特有方法 ====================

  /**
   * 初始化 Live 特有组件
   * @private
   * @returns {Promise<void>}
   */
  async _initializeLiveComponents() {
    // 延迟加载模块
    const TokenPool = require('../../core/token-pool');
    const { StrategyEngine } = require('../../strategies/StrategyEngine');
    const PlatformCollector = require('../../collectors/platform-collector');
    const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
    const { RoundSummary } = require('../utils/RoundSummary');

    // 加载配置
    const config = require('../../../config/default.json');

    // Logger 已经在 _initializeDataSources 中初始化，这里跳过
    // 初始化 DataService（与虚拟盘一致）
    this.dataService = new ExperimentDataService();

    // ========== 风险控制组件初始化（与虚拟盘一致） ==========

    // 1. 初始化价格历史缓存（用于趋势检测）
    const PriceHistoryCache = require('../PriceHistoryCache');
    this._priceHistoryCache = new PriceHistoryCache(15 * 60 * 1000); // 15分钟
    this.logger.info('LiveTradingEngine', 'Initialize', '价格历史缓存初始化完成');
    console.log(`✅ 价格历史缓存初始化完成`);

    // 2. 初始化趋势检测器
    const TrendDetector = require('../TrendDetector');
    this._trendDetector = new TrendDetector({
      minDataPoints: 6,
      maxDataPoints: Infinity,
      cvThreshold: 0.005,
      scoreThreshold: 30,
      totalReturnThreshold: 5,
      riseRatioThreshold: 0.5
    });
    this.logger.info('LiveTradingEngine', 'Initialize', '价格趋势检测器初始化完成');
    console.log(`✅ 价格趋势检测器初始化完成`);

    // 2.5 初始化持有者历史缓存（用于持有者趋势检测）
    const HolderHistoryCache = require('../HolderHistoryCache');
    this._holderHistoryCache = new HolderHistoryCache(15 * 60 * 1000); // 15分钟
    this.logger.info('LiveTradingEngine', 'Initialize', '持有者历史缓存初始化完成');
    console.log(`✅ 持有者历史缓存初始化完成`);

    // 2.6 初始化持有者趋势检测器
    const HolderTrendDetector = require('../HolderTrendDetector');
    this._holderTrendDetector = new HolderTrendDetector({
      minDataPoints: 6,
      maxDataPoints: Infinity,
      cvThreshold: 0.02, // 持有者变化更稳定，阈值更高
      scoreThreshold: 30,
      growthRatioThreshold: 3, // 3%增长
      riseRatioThreshold: 0.5
    });
    this.logger.info('LiveTradingEngine', 'Initialize', '持有者趋势检测器初始化完成');
    console.log(`✅ 持有者趋势检测器初始化完成`);

    // 3. 初始化持有者服务
    const { TokenHolderService } = require('../holders/TokenHolderService');
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();
    this._tokenHolderService = new TokenHolderService(supabase, this.logger);
    this.logger.info('LiveTradingEngine', 'Initialize', '持有者服务初始化完成');
    console.log(`✅ 持有者服务初始化完成`);

    // 4. 初始化购买前检查服务
    const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');

    // 合并配置：外部默认配置 + 实验配置
    const defaultConfig = require('../../../config/default.json');
    const experimentPreBuyConfig = this._experiment?.config?.preBuyCheck || {};
    const preBuyCheckConfig = {
      ...defaultConfig.preBuyCheck,
      ...experimentPreBuyConfig
    };

    // 保存配置供后续使用
    this._preBuyCheckConfig = preBuyCheckConfig;

    this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
    this.logger.info('LiveTradingEngine', 'Initialize', `购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled}, skipTwitterSearch=${preBuyCheckConfig.skipTwitterSearch})`);
    console.log(`✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled}, skipTwitterSearch=${preBuyCheckConfig.skipTwitterSearch})`);

    // 5. 初始化 TokenPool（传入价格历史缓存和持有者历史缓存，与虚拟盘一致）
    this._tokenPool = new TokenPool(this.logger, this._priceHistoryCache, this._holderHistoryCache);
    this.logger.info('LiveTradingEngine', 'Initialize', '代币池初始化完成');
    console.log(`✅ 代币池初始化完成`);

    // 初始化 AVE TokenAPI（用于获取价格数据）
    const { AveTokenAPI } = require('../../core/ave-api');
    const apiKey = process.env.AVE_API_KEY;
    this._aveTokenApi = new AveTokenAPI(
      config.ave.apiUrl,
      config.ave.timeout,
      apiKey
    );
    this.logger.info('LiveTradingEngine', 'Initialize', 'AVE TokenAPI 初始化完成');
    console.log(`✅ AVE TokenAPI 初始化完成`);

    // 初始化 FourMeme API（用于获取创建者地址）
    const { FourMemeTokenAPI } = require('../../core/fourmeme-api');
    this._fourMemeApi = new FourMemeTokenAPI(
      config.fourmeme?.apiUrl || 'https://four.meme',
      config.fourmeme?.timeout || 30000
    );
    this.logger.info('LiveTradingEngine', 'Initialize', 'FourMeme API 初始化完成');
    console.log(`✅ FourMeme API 初始化完成`);

    // 初始化 Platform 收集器（合并实验配置 + 传入实验ID和区块链，与虚拟盘一致）
    const experimentCollectorConfig = this._experiment?.config?.collector || {};
    const mergedCollectorConfig = {
      ...config,
      collector: {
        ...config.collector,
        ...experimentCollectorConfig
      }
    };
    this._fourmemeCollector = new PlatformCollector(
      mergedCollectorConfig,
      this.logger,
      this._tokenPool,
      this._experimentId,
      this._blockchain
    );
    this.logger.info('LiveTradingEngine', 'Initialize', `Platform 收集器初始化完成 [实验ID: ${this._experimentId}, 区块链: ${this._blockchain}, 收集频率: ${mergedCollectorConfig.collector.interval}ms, 代币最大年龄: ${mergedCollectorConfig.collector.maxAgeSeconds}s]`);
    console.log(`✅ Platform 收集器初始化完成 [区块链: ${this._blockchain}, 收集频率: ${mergedCollectorConfig.collector.interval}ms]`);

    // 初始化 RoundSummary（与虚拟盘一致）
    this._roundSummary = new RoundSummary(this._experimentId, this.logger, this._blockchain);
    this.logger.info('LiveTradingEngine', 'Initialize', 'RoundSummary 初始化完成');
    console.log(`✅ RoundSummary 初始化完成`);

    // 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    // 使用统一的 FactorBuilder 获取可用因子列表（与虚拟盘一致）
    const { getAvailableFactorIds } = require('../core/FactorBuilder');
    const availableFactorIds = getAvailableFactorIds();

    // 转换策略配置格式（与虚拟盘一致）
    const strategyArray = [];
    if (strategies.buyStrategies && Array.isArray(strategies.buyStrategies)) {
      strategies.buyStrategies.forEach((s, idx) => {
        strategyArray.push({
          id: `buy_${idx}_${s.priority || 0}`,
          name: `买入策略 P${s.priority || 0}`,
          description: s.description || '',
          action: 'buy',
          condition: s.condition,
          priority: s.priority || 0,
          cooldown: s.cooldown || 300,
          cards: s.cards || 1,
          maxExecutions: s.maxExecutions || null,
          preBuyCheckCondition: s.preBuyCheckCondition || null, // 添加预检查条件
          repeatBuyCheckCondition: s.repeatBuyCheckCondition || null, // 添加再次购买检查条件
          enabled: true
        });
      });
    }
    if (strategies.sellStrategies && Array.isArray(strategies.sellStrategies)) {
      strategies.sellStrategies.forEach((s, idx) => {
        strategyArray.push({
          id: `sell_${idx}_${s.priority || 0}`,
          name: `卖出策略 P${s.priority || 0}`,
          description: s.description || '',
          action: 'sell',
          condition: s.condition,
          priority: s.priority || 0,
          cooldown: s.cooldown || 300,
          cards: s.cards || 1,
          maxExecutions: s.maxExecutions || null,
          enabled: true
        });
      });
    }

    this._strategyEngine.loadStrategies(strategyArray, availableFactorIds);
    this.logger.info('LiveTradingEngine', 'Initialize', `策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 初始化叙事分析配置（与虚拟盘一致）
    const experimentConfig = this._experiment?.config || {};
    const narrativeAnalysisConfig = experimentConfig.strategiesConfig?.narrativeAnalysis || experimentConfig.narrativeAnalysis || {};
    this._narrativeAnalysisEnabled = narrativeAnalysisConfig.enabled === true;
    this._narrativeReanalyze = narrativeAnalysisConfig.reanalyze === true;
    this._narrativeTriggerThreshold = narrativeAnalysisConfig.triggerThreshold || 80;
    this._narrativeMaxWaitSeconds = narrativeAnalysisConfig.maxWaitSeconds || 10;
    this._narrativePollIntervalMs = narrativeAnalysisConfig.pollIntervalMs || 2000;

    if (this._narrativeAnalysisEnabled) {
      this.logger.info('LiveTradingEngine', 'Initialize', `✅ 叙事分析已启用 (阈值: ${this._narrativeTriggerThreshold}%, 等待: ${this._narrativeMaxWaitSeconds}s)`);
      console.log(`✅ 叙事分析已启用 (阈值: ${this._narrativeTriggerThreshold}%, 等待: ${this._narrativeMaxWaitSeconds}s)`);
    } else {
      this.logger.info('LiveTradingEngine', 'Initialize', `⚠️ 叙事分析未启用`);
    }

    // GMGN 安全检测配置（与虚拟盘一致）
    this._gmgnSecurityCheckEnabled = experimentConfig.strategiesConfig?.gmgnSecurityCheck?.enabled ?? experimentConfig.gmgnSecurityCheck?.enabled ?? false;
    if (this._gmgnSecurityCheckEnabled) {
      this.logger.info('LiveTradingEngine', 'Initialize', '✅ GMGN 安全检测已启用');
      console.log('✅ GMGN 安全检测已启用');
    }

    // 提前加载 Super IP 检测模块（用于 tweetAuthorType 因子）
    getSuperIpModules().catch(err => console.warn('Super IP 模块加载失败:', err.message));

    // 初始化时序数据服务
    const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
    this.timeSeriesService = new ExperimentTimeSeriesService();
  }

  /**
   * 初始化真实投资组合
   * @private
   * @returns {Promise<void>}
   */
  async _initializeRealPortfolio() {
    if (!this._walletService) {
      throw new Error('WalletService 未初始化');
    }

    // 获取钱包余额（包括原生代币）
    const walletBalances = await this._walletService.getWalletBalances(
      this._walletAddress,
      this._blockchain
    );

    // 计算可用主币余额
    // 使用 BlockchainConfig 获取所有可能的 Native 代币地址（包括 AVE API 表示）
    const nativeTokenAddresses = BlockchainConfig.getNativeTokenAddresses(this._blockchain);
    let nativeBalance = new Decimal(0);

    for (const token of walletBalances) {
      const normalizedAddr = BlockchainConfig.normalizeTokenAddress(token.address, this._blockchain);
      // 检查是否是原生代币（包括 WBNB 和 AVE API 的原生表示）
      if (nativeTokenAddresses.some(nativeAddr =>
        BlockchainConfig.normalizeTokenAddress(nativeAddr, this._blockchain) === normalizedAddr
      )) {
        nativeBalance = token.balance;
        this.logger.info(this._experimentId, 'InitializeRealPortfolio', `找到 Native 代币余额 ${normalizedAddr}: ${nativeBalance}`);
        break;
      }
    }

    const availableBalance = Decimal.max(0, nativeBalance.sub(this._reserveNative));

    // 保存总钱包余额（用于显示）
    this._walletBalance = nativeBalance;

    this.logger.info(this._experimentId, 'InitializeRealPortfolio', `钱包余额: 主币总额=${nativeBalance}, 保留=${this._reserveNative}, 可用=${availableBalance}`);

    // 创建投资组合
    const portfolioId = await this._portfolioManager.createPortfolio(
      availableBalance,
      { blockchain: this._blockchain }
    );
    this._portfolioId = portfolioId;

    // 初始化持仓（排除原生代币）
    const nativeAddrs = new Set(
      nativeTokenAddresses.map(addr => BlockchainConfig.normalizeTokenAddress(addr, this._blockchain))
    );

    for (const token of walletBalances) {
      const normalizedAddr = BlockchainConfig.normalizeTokenAddress(token.address, this._blockchain);
      if (!nativeAddrs.has(normalizedAddr) && token.balance.gt(0)) {
        await this._portfolioManager.updatePosition(
          this._portfolioId,
          normalizedAddr,
          token.balance,
          token.pnl?.averagePurchasePrice || 0,
          'hold'
        );
      }
    }
  }

  /**
   * 监控循环（与虚拟盘一致）
   * @private
   * @returns {Promise<void>}
   */
  async _monitoringCycle() {
    this._loopCount++;
    const startTime = Date.now();

    if (this._isStopped) {
      return;
    }

    // RoundSummary - 开始新轮次
    if (this._roundSummary) {
      this._roundSummary.startRound(this._loopCount);
    }

    this.logger.info(this._experimentId, 'MonitoringCycle', `开始第 ${this._loopCount} 轮监控`);

    try {
      // 同步真实持仓
      await this._syncHoldings();

      // RoundSummary - 记录收集器统计
      if (this._roundSummary) {
        const collectorStats = this._fourmemeCollector.getStats();
        this._roundSummary.recordCollectorStats({
          lastFetched: collectorStats.lastFetched || 0,
          lastAdded: collectorStats.lastAdded || 0,
          lastSkipped: collectorStats.lastSkipped || 0,
          poolSize: collectorStats.poolSize,
          monitoringCount: collectorStats.monitoringCount,
          boughtCount: collectorStats.boughtCount
        });
      }

      // 获取代币池中的监控代币（与虚拟盘一致）
      const tokens = this._tokenPool.getMonitoringTokens();
      this.logger.debug(this._experimentId, 'MonitoringCycle', `池中监控代币数: ${tokens.length} (monitoring+bought)`);

      if (tokens.length === 0) {
        this.logger.debug(this._experimentId, 'MonitoringCycle', `第 ${this._loopCount} 轮监控: 无代币需要处理`);
        // 创建投资组合快照
        await this._createPortfolioSnapshot();
        // RoundSummary - 打印总结
        if (this._roundSummary) {
          this._roundSummary.printToConsole();
          this._roundSummary.writeToLog();
        }
        return;
      }

      // 批量获取价格
      await this._fetchBatchPrices(tokens);

      // 存储因子数据用于清理不活跃代币
      const factorResultsMap = new Map();

      // 处理每个代币（包括买入和卖出策略）
      for (const token of tokens) {
        await this._processToken(token);
        // 收集因子数据用于后续清理判断
        const factorResults = this._buildFactors(token);
        factorResultsMap.set(token.token, factorResults);
      }

      // 🔧 清理低收益且无交易的代币
      const removedInactive = this._tokenPool.cleanupInactiveTokens(factorResultsMap);
      if (removedInactive.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle',
          `清理不活跃代币: ${removedInactive.length} 个 - ` +
          removedInactive.map(t => `${t.symbol}(${t.poolTimeMinutes}分钟, ${t.earlyReturn}%)`).join(', ')
        );
        // 同步 status 到数据库
        for (const t of removedInactive) {
          await this._updateTokenStatus(t.address, t.chain, 'inactive');
        }
        // 计算被清理代币的涨幅分析
        const inactiveAddresses = removedInactive.map(t => t.token || t.address);
        await this._calculateTokensAnalysis(inactiveAddresses);
      }

      // 清理过期代币
      const removed = this._tokenPool.cleanup();
      if (removed.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle', `清理过期代币: ${removed.length} 个`);

        // 计算被移除代币的涨幅分析
        // cleanup() 返回的是字符串数组，格式为 "address-chain"，需要提取地址部分
        const removedAddresses = removed.map(key => {
          if (typeof key === 'string') {
            return key.split('-')[0]; // 提取地址部分
          }
          return key.token || key.address || key;
        });
        await this._calculateTokensAnalysis(removedAddresses);
      }

      // RoundSummary - 记录投资组合摘要
      if (this._roundSummary) {
        const portfolio = this._buildPortfolioSummary();
        this._roundSummary.recordPortfolio(portfolio);
      }

      // 创建投资组合快照
      await this._createPortfolioSnapshot();

      // RoundSummary - 打印总结
      if (this._roundSummary) {
        this._roundSummary.printToConsole();
        this._roundSummary.writeToLog();
      }

      const duration = Date.now() - startTime;
      this.logger.info(this._experimentId, 'MonitoringCycle', `第 ${this._loopCount} 轮监控完成，耗时: ${duration}ms`);

    } catch (error) {
      this.logger.error(this._experimentId, 'MonitoringCycle', `监控循环失败: ${error.message}`);
    }

    // 检查并计算统计数据
    await this._checkAndCalculateStats();
  }

  /**
   * 构建投资组合摘要（只显示通过策略买入的代币）
   * @private
   * @returns {Object} 投资组合摘要
   */
  _buildPortfolioSummary() {
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    if (!portfolio) {
      return {
        totalValue: 0,
        availableBalance: 0,
        positions: []
      };
    }

    // 只显示通过策略买入的代币（status = 'bought'）
    const boughtTokens = this._tokenPool.getTokensByStatus('bought');
    const boughtTokenAddresses = new Set(boughtTokens.map(t => t.token));

    return {
      totalValue: portfolio.totalValue,
      availableBalance: portfolio.cashBalance,
      positions: Array.from(portfolio.positions.entries())
        .filter(([address]) => boughtTokenAddresses.has(address))
        .map(([address, position]) => {
          const token = this._tokenPool.getToken(address, this._blockchain);
          return {
            address: address,
            symbol: token?.symbol || 'UNKNOWN',
            amount: position.amount,
            avgBuyPrice: position.avgBuyPrice,
            currentValue: position.amount * (position.avgBuyPrice || 0)
          };
        })
    };
  }

  /**
   * 批量获取代币价格（与虚拟盘一致）
   * @private
   * @param {Array} tokens - 代币数组
   * @returns {Promise<Object>} 价格信息字典
   */
  async _fetchBatchPrices(tokens) {
    try {
      if (!tokens || tokens.length === 0) {
        return {};
      }

      const tokenIds = tokens.map(t => `${t.token}-${t.chain}`);
      const batchSize = 200;
      const allPrices = {};

      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batchIds = tokenIds.slice(i, i + batchSize);

        const prices = await this._aveTokenApi.getTokenPrices(
          batchIds,
          0,
          0
        );

        for (const token of tokens) {
          const tokenId = `${token.token}-${token.chain}`;
          const priceInfo = prices[tokenId];

          if (priceInfo && priceInfo.current_price_usd) {
            const price = parseFloat(priceInfo.current_price_usd);
            if (price > 0) {
              const extraData = {
                txVolumeU24h: parseFloat(priceInfo.tx_volume_u_24h) || 0,
                holders: parseInt(priceInfo.holders) || 0,
                tvl: parseFloat(priceInfo.tvl) || 0,
                fdv: parseFloat(priceInfo.fdv) || 0,
                marketCap: parseFloat(priceInfo.market_cap) || 0
              };
              this._tokenPool.updatePrice(token.token, token.chain, price, Date.now(), extraData);
            }
          }
        }

        Object.assign(allPrices, prices);
      }

      return allPrices;

    } catch (error) {
      this.logger.error(this._experimentId, 'FetchBatchPrices', `批量获取价格失败: ${error.message}`);
      return {};
    }
  }

  /**
   * 处理单个代币（与虚拟盘一致）
   * @private
   * @param {Object} token - 代币数据
   * @returns {Promise<void>}
   */
  async _processToken(token) {
    try {
      const tokenKey = `${token.token}-${token.chain}`;
      if (!this._seenTokens.has(tokenKey)) {
        // 保存代币到数据库（与虚拟盘一致）
        await this.dataService.saveToken(this._experimentId, {
          token: token.token,
          symbol: token.symbol,
          chain: token.chain,
          platform: token.platform || 'fourmeme',
          created_at: token.createdAt,
          raw_api_data: token.rawApiData || null,
          contract_security_raw_data: token.contractSecurity || null,
          creator_address: token.creatorAddress || null,
          status: token.status || 'monitoring'
        });
        this._seenTokens.add(tokenKey);
        this.logger.debug(this._experimentId, 'ProcessToken', `新代币已保存: ${token.symbol}`);
      }

      const currentPrice = token.currentPrice || 0;
      const skipConfig = this._experiment?.config?.strategiesConfig;
      const skipStrategyDetection = skipConfig?.skipStrategyDetection === true;
      const skipMaxRounds = skipConfig?.skipStrategyDetectionMaxRounds ?? 1;

      if (currentPrice === 0 && !(skipStrategyDetection && (token._dataCollectionRound || 0) < skipMaxRounds)) {
        // 使用 RoundSummary 记录价格获取失败（与虚拟盘一致）
        if (this._roundSummary) {
          this._roundSummary.recordTokenIndicators(
            token.token,
            token.symbol,
            {
              type: 'error',
              error: '无法获取有效价格 (价格API无数据)',
              factorValues: { currentPrice: 0 }
            },
            0,
            {
              createdAt: token.createdAt,
              addedAt: token.addedAt,
              status: token.status,
              collectionPrice: token.collectionPrice,
              launchPrice: token.launchPrice
            }
          );
        }
        return;
      }

      // 构建因子
      // 累加数据采集轮数（每次进入因子计算循环时 +1）
      token._dataCollectionRound = (token._dataCollectionRound || 0) + 1;

      const factorResults = this._buildFactors(token);

      // 记录时序数据（与虚拟盘一致，添加日志）
      console.log(`📊 [时序数据] 准备保存 | symbol=${token.symbol}, tokenAddress=${token.token}, price=${factorResults.currentPrice}`);
      if (this.timeSeriesService) {
        // 使用统一的 FactorBuilder 序列化因子
        const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');

        const recordResult = await this.timeSeriesService.recordRoundData({
          experimentId: this._experimentId,
          tokenAddress: token.token,
          tokenSymbol: token.symbol,
          timestamp: new Date(),
          loopCount: this._loopCount,
          priceUsd: factorResults.currentPrice,
          priceNative: null,
          factorValues: buildFactorValuesForTimeSeries(factorResults),
          blockchain: this._blockchain
        });
        console.log(`📊 [时序数据] 保存结果 | symbol=${token.symbol}, result=${recordResult}`);
        if (!recordResult) {
          this.logger.warn(this._experimentId, 'ProcessToken', `时序数据保存失败 | symbol=${token.symbol}`);
        }
      }

      // RoundSummary - 记录代币指标
      if (this._roundSummary) {
        this._roundSummary.recordTokenIndicators(
          token.token,
          token.symbol,
          {
            type: 'factor-based',
            factorCount: Object.keys(factorResults).length,
            strategyCount: this._strategyEngine.getStrategyCount(),
            factorValues: factorResults,
            triggeredStrategy: null
          },
          factorResults.currentPrice,
          {
            createdAt: token.createdAt,
            addedAt: token.addedAt,
            status: token.status,
            collectionPrice: token.collectionPrice,
            launchPrice: token.launchPrice
          }
        );
      }

      // 叙事分析触发检测
      if (this._narrativeAnalysisEnabled) {
        const satisfaction = this._calculateTrendFactorSatisfaction(factorResults);
        if (satisfaction >= this._narrativeTriggerThreshold) {
          await this._createOrUpdateNarrativeTask(token, satisfaction);
        }
      }

      // 评估策略（支持跳过第一层检测）
      let strategy;

      if (skipStrategyDetection && token.status !== 'bought'
          && (token._dataCollectionRound || 0) <= skipMaxRounds) {
        // 跳过第一层策略条件评估，直接使用第一个买入策略的配置进入预检查
        strategy = this._strategyEngine.getAllStrategies()
          .find(s => s.enabled && s.action === 'buy');
      } else {
        strategy = this._strategyEngine.evaluate(
          factorResults,
          token.token,
          Date.now(),
          token
        );
      }

      if (strategy) {
        if (strategy.action === 'buy') {
          // 买入行为完全由卡牌管理器控制，无需状态检查
        }
        if (strategy.action === 'sell' && token.status !== 'bought') {
          this.logger.debug(this._experimentId, 'ProcessToken', `${token.symbol} 卖出策略跳过 (状态: ${token.status})`);
          return;
        }
      }

      if (strategy) {
        this.logger.info(this._experimentId, 'ProcessToken', `${token.symbol} 触发策略: ${strategy.name} (${strategy.action})`);

        // RoundSummary - 记录信号
        if (this._roundSummary) {
          this._roundSummary.recordSignal(token.token, {
            direction: strategy.action.toUpperCase(),
            action: strategy.action,
            confidence: 80,
            reason: strategy.name
          });

          const tokenData = this._roundSummary.getRoundData()?.tokens?.find(t => t.address === token.token);
          if (tokenData && tokenData.indicators) {
            tokenData.indicators.triggeredStrategy = strategy;
          }
        }

        const executionResult = await this._executeStrategy(strategy, token, factorResults);

        // RoundSummary - 记录执行结果
        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(
            token.token,
            executionResult.success,
            executionResult.success ? null : (executionResult.reason || '执行失败')
          );
        }
      }

      // RoundSummary - 记录持仓信息
      if (this._roundSummary && token.status === 'bought') {
        const holding = this._getHolding(token.token);
        if (holding) {
          this._roundSummary.recordPosition(token.token, {
            symbol: token.symbol,
            amount: holding.amount,
            buyPrice: holding.avgBuyPrice,
            currentPrice: factorResults.currentPrice
          });
        }
      }

    } catch (error) {
      this.logger.error(this._experimentId, 'ProcessToken', `处理代币 ${token.symbol} 失败: ${error.message}`);
    }
  }

  /**
   * 构建策略因子（与虚拟盘一致）
   * @private
   * @param {Object} token - 代币数据
   * @returns {Object} 因子结果
   */
  _buildFactors(token) {
    const now = Date.now();
    const currentPrice = token.currentPrice || 0;

    // collectionPrice 保留用于兼容和调试
    const collectionPrice = token.collectionPrice || currentPrice;

    // 使用 launchPrice 作为基准，如果没有则使用 collectionPrice（收集价格）
    // 这样可以确保即使 AVE API 没有返回 launch_price，earlyReturn 也能基于收集价格计算
    const launchPrice = token.launchPrice || collectionPrice || 0;

    let earlyReturn = 0;
    if (launchPrice > 0 && currentPrice > 0) {
      earlyReturn = ((currentPrice - launchPrice) / launchPrice) * 100;
    }

    // age 基于代币创建时间（AVE API 的 created_at），而不是收集时间
    const tokenCreatedAt = token.createdAt || Date.now() / 1000;
    const age = (now - tokenCreatedAt * 1000) / 1000 / 60;

    let riseSpeed = 0;
    if (age > 0) {
      riseSpeed = earlyReturn / age;
    }

    const holdDuration = token.buyTime ? (now - token.buyTime) / 1000 : 0;

    let profitPercent = 0;
    if (token.buyPrice && token.buyPrice > 0 && currentPrice > 0) {
      profitPercent = ((currentPrice - token.buyPrice) / token.buyPrice) * 100;
    }

    const collectionTime = token.collectionTime || token.addedAt || now;
    const highestPrice = token.highestPrice || launchPrice || currentPrice;
    const highestPriceTimestamp = token.highestPriceTimestamp || collectionTime;

    let drawdownFromHighest = 0;
    if (highestPrice > 0 && currentPrice > 0) {
      drawdownFromHighest = ((currentPrice - highestPrice) / highestPrice) * 100;
    }

    // 计算最近一次购买后的最高价回撤（用于止损/止盈）
    let highestPriceSinceLastBuy = token.highestPriceSinceLastBuy;
    let highestPriceSinceLastBuyTimestamp = token.highestPriceSinceLastBuyTimestamp;
    let drawdownFromHighestSinceLastBuy = null;

    if (token.buyTime) {
      // 如果代币已被购买，维护购买后的最高价
      if (highestPriceSinceLastBuy === null || currentPrice > highestPriceSinceLastBuy) {
        highestPriceSinceLastBuy = currentPrice;
        highestPriceSinceLastBuyTimestamp = now;
        // 更新 token 状态
        token.highestPriceSinceLastBuy = currentPrice;
        token.highestPriceSinceLastBuyTimestamp = now;
      }

      // 计算从购买后最高价的回撤
      if (highestPriceSinceLastBuy > 0) {
        drawdownFromHighestSinceLastBuy = ((currentPrice - highestPriceSinceLastBuy) / highestPriceSinceLastBuy) * 100;
      }
    }

    // 计算最近一次购买后的最高持有者数量回撤
    let highestHolderCountSinceLastBuy = token.highestHolderCountSinceLastBuy;
    let highestHolderCountSinceLastBuyTimestamp = token.highestHolderCountSinceLastBuyTimestamp;
    let holderDrawdownFromHighestSinceLastBuy = null;
    const currentHolderCount = token.holders || 0;

    if (token.buyTime) {
      // 如果代币已被购买，维护购买后的最高持有者数量
      // 注意：持有者数量更新是在 TokenPool.updatePrice 中处理的
      highestHolderCountSinceLastBuy = token.highestHolderCountSinceLastBuy;
      highestHolderCountSinceLastBuyTimestamp = token.highestHolderCountSinceLastBuyTimestamp;

      // 计算从购买后最高持有者数量的回撤
      if (highestHolderCountSinceLastBuy !== null && highestHolderCountSinceLastBuy > 0) {
        holderDrawdownFromHighestSinceLastBuy = ((currentHolderCount - highestHolderCountSinceLastBuy) / highestHolderCountSinceLastBuy) * 100;
      }
    }

    const factors = {
      age: age,
      currentPrice: currentPrice,
      collectionPrice: collectionPrice,
      launchPrice: launchPrice,
      earlyReturn: earlyReturn,
      riseSpeed: riseSpeed,
      buyPrice: token.buyPrice || 0,
      holdDuration: holdDuration,
      profitPercent: profitPercent,
      highestPrice: highestPrice,
      highestPriceTimestamp: highestPriceTimestamp,
      drawdownFromHighest: drawdownFromHighest,
      highestPriceSinceLastBuy: highestPriceSinceLastBuy,
      drawdownFromHighestSinceLastBuy: drawdownFromHighestSinceLastBuy,
      highestHolderCountSinceLastBuy: highestHolderCountSinceLastBuy,
      holderDrawdownFromHighestSinceLastBuy: holderDrawdownFromHighestSinceLastBuy,
      txVolumeU24h: token.txVolumeU24h || 0,
      holders: token.holders || 0,
      tvl: token.tvl || 0,
      fdv: token.fdv || 0,
      marketCap: token.marketCap || 0,
      // 推文作者类型因子（0=普通, 1=A级SuperIP, 2=S级SuperIP）
      tweetAuthorType: this._detectTweetAuthorType(token),
      // 数据采集轮数因子（第几次进入因子计算循环）
      dataCollectionRound: token._dataCollectionRound || 1,
    };

    // 价格趋势检测因子（使用固定窗口：最多8个点）
    const prices = this._tokenPool.getTokenPrices(token.token, token.chain);

    // 固定窗口：只使用最近8个点
    const maxPoints = 8;
    const _prices = prices.slice(-maxPoints);

    // 记录实际使用的数据点数量
    factors.trendDataPoints = _prices.length;

    // 渐进式计算：根据可用数据点数量计算不同指标
    if (_prices.length >= 2) {
      // 基础指标（需要至少 2 个数据点）

      // 1. 总收益率和上涨占比（需要 2 个点）
      const firstPrice = _prices[0];
      const lastPrice = _prices[_prices.length - 1];
      factors.trendTotalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

      // 计算上涨次数占比
      let riseCount = 0;
      for (let i = 1; i < _prices.length; i++) {
        if (_prices[i] > _prices[i - 1]) riseCount++;
      }
      factors.trendRiseRatio = riseCount / Math.max(1, _prices.length - 1);

      // 2. 变异系数 CV（需要 2 个点）
      if (this._trendDetector) {
        factors.trendCV = this._trendDetector._calculateCV(_prices);
      }

      // 3. 最近的下跌统计（检查最近 5 个或所有数据点）
      const _checkSize = Math.min(5, _prices.length);
      const _recentPrices = _prices.slice(-_checkSize);
      let _downCount = 0;
      for (let i = 1; i < _recentPrices.length; i++) {
        if (_recentPrices[i] < _recentPrices[i - 1]) _downCount++;
      }
      factors.trendRecentDownCount = _downCount;
      factors.trendRecentDownRatio = _downCount / Math.max(1, _recentPrices.length - 1);

      // 4. 连续下跌次数
      let _consecutiveDowns = 0;
      for (let i = _prices.length - 1; i > 0; i--) {
        if (_prices[i] < _prices[i - 1]) {
          _consecutiveDowns++;
        } else {
          break;
        }
      }
      factors.trendConsecutiveDowns = _consecutiveDowns;

      // 需要至少 4 个数据点的指标
      if (_prices.length >= 4 && this._trendDetector) {
        // 方向确认（2个独立指标 + 斜率数值）
        const _direction = this._trendDetector._confirmDirection(_prices);
        factors.trendPriceUp = _direction.trendPriceUp;
        factors.trendMedianUp = _direction.trendMedianUp;
        factors.trendSlope = _direction.relativeSlope || 0; // 相对斜率（百分比）

        // 趋势强度评分
        const _strength = this._trendDetector._calculateTrendStrength(_prices);
        factors.trendStrengthScore = _strength.score;
      }
    }

    // 持有者趋势检测因子（使用固定窗口：最多8个点）
    const holderCounts = this._tokenPool.getTokenHolderCounts(token.token, token.chain);

    // 固定窗口：只使用最近8个点
    const _holderCounts = holderCounts.slice(-maxPoints);

    // 记录持有者趋势数据点数量
    factors.holderTrendDataPoints = _holderCounts.length;

    if (_holderCounts.length >= 2) {
      // 基础指标（需要至少 2 个数据点）

      // 1. 增长率和增长占比（需要 2 个点）
      const firstCount = _holderCounts[0];
      const lastCount = _holderCounts[_holderCounts.length - 1];
      factors.holderTrendGrowthRatio = firstCount > 0 ? ((lastCount - firstCount) / firstCount) * 100 : 0;

      // 计算增长次数占比
      let riseCount = 0;
      for (let i = 1; i < _holderCounts.length; i++) {
        if (_holderCounts[i] > _holderCounts[i - 1]) riseCount++;
      }
      factors.holderTrendRiseRatio = riseCount / Math.max(1, _holderCounts.length - 1);

      // 2. 变异系数 CV（需要 2 个点）
      if (this._holderTrendDetector) {
        factors.holderTrendCV = this._holderTrendDetector._calculateCV(_holderCounts);
      }

      // 3. 最近的减少统计（检查最近 5 个或所有数据点）
      const _checkSize = Math.min(5, _holderCounts.length);
      const _recentCounts = _holderCounts.slice(-_checkSize);
      let _decreaseCount = 0;
      for (let i = 1; i < _recentCounts.length; i++) {
        if (_recentCounts[i] < _recentCounts[i - 1]) _decreaseCount++;
      }
      factors.holderTrendRecentDecreaseCount = _decreaseCount;
      factors.holderTrendRecentDecreaseRatio = _decreaseCount / Math.max(1, _recentCounts.length - 1);

      // 4. 连续减少次数
      let _consecutiveDecreases = 0;
      for (let i = _holderCounts.length - 1; i > 0; i--) {
        if (_holderCounts[i] < _holderCounts[i - 1]) {
          _consecutiveDecreases++;
        } else {
          break;
        }
      }
      factors.holderTrendConsecutiveDecreases = _consecutiveDecreases;

      // 需要至少 4 个数据点的指标
      if (_holderCounts.length >= 4 && this._holderTrendDetector) {
        // 方向确认（2个独立指标 + 斜率数值）
        const _direction = this._holderTrendDetector._confirmDirection(_holderCounts);
        factors.holderTrendHolderCountUp = _direction.holderCountUp;
        factors.holderTrendMedianUp = _direction.holderMedianUp;
        factors.holderTrendSlope = _direction.relativeSlope || 0; // 相对斜率（百分比）

        // 趋势强度评分
        const _strength = this._holderTrendDetector._calculateTrendStrength(_holderCounts);
        factors.holderTrendStrengthScore = _strength.score;
      }
    }

    return factors;
  }

  /**
   * 检测推文作者类型（Super IP 等级）
   * @private
   * @param {Object} token - 代币数据
   * @returns {number} 0=普通, 1=A级SuperIP, 2=S级SuperIP
   */
  _detectTweetAuthorType(token) {
    try {
      const twitterUrl = token.rawApiData?.fourmeme_creator_info?.full_info?.twitterUrl;
      if (!twitterUrl || !superIpModules) return 0;
      const ipInfo = superIpModules.detectSuperIP(twitterUrl, null);
      if (!ipInfo) return 0;
      return ipInfo.tier === 'S' ? 2 : 1;
    } catch {
      return 0;
    }
  }

  /**
   * 执行策略（与虚拟盘一致）
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} token - 代币数据
   * @param {Object} factorResults - 因子计算结果
   * @returns {Promise<Object>} 执行结果 { success: boolean, reason?: string }
   */
  async _executeStrategy(strategy, token, factorResults = null) {
    // 辅助函数：返回成功/失败结果
    const successResult = () => ({ success: true });
    const failResult = (reason) => ({ success: false, reason });

    const latestPrice = token.currentPrice || 0;

    if (!factorResults) {
      factorResults = this._buildFactors(token);
    }

    // 获取卡牌仓位管理配置（与虚拟盘一致）
    const positionManagement = this._experiment.config?.positionManagement;

    if (strategy.action === 'buy') {
      // 买入行为完全由卡牌管理器控制，无需状态检查

      // ========== 验证 creator_address ==========
      // 1. 如果创建者地址为 null，重新获取
      if (!token.creator_address) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `代币 creator_address 为 null，重新获取并验证 | symbol=${token.symbol}, address=${token.token}`);

        try {
          // 使用 FourMeme API 获取创建者地址
          const creatorInfo = await this._fourMemeApi.getCreatorAddress(token.token);

          if (creatorInfo.creator_address) {
            token.creator_address = creatorInfo.creator_address;
            // 更新数据库中的 creator_address
            await this.dataService.updateTokenCreatorAddress(this._experimentId, token.token, creatorInfo.creator_address);
            this.logger.info(this._experimentId, '_executeStrategy',
              `重新获取成功，继续 Dev 钱包检查 | symbol=${token.symbol}, creator=${creatorInfo.creator_address}`);
            // 重新获取成功，继续检查 Dev 钱包
          } else {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `重新获取后仍无 creator_address，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}, address=${token.token}`);
            // 跳过 Dev 钱包检查，直接继续购买流程
          }
        } catch (error) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `重新获取 creator_address 失败，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}, error=${error.message}`);
          // API 调用失败，跳过 Dev 钱包检查，直接继续购买流程
        }
      }

      // 2. 如果创建者地址存在，检查是否为 Dev 钱包
      if (token.creator_address) {
        this.logger.info(this._experimentId, '_executeStrategy',
          `开始 Dev 钱包检查 | symbol=${token.symbol}, creator=${token.creator_address}`);
        const isNegativeDevWallet = await this.isNegativeDevWallet(token.creator_address);
        if (isNegativeDevWallet) {
          this.logger.error(this._experimentId, '_executeStrategy',
            `代币创建者为 Dev 钱包，拒绝购买 | symbol=${token.symbol}, address=${token.token}, creator=${token.creator_address}`);
          return failResult('代币创建者为 Dev 钱包，拒绝购买');
        }
        this.logger.info(this._experimentId, '_executeStrategy',
          `Dev 钱包检查通过，继续购买流程 | symbol=${token.symbol}`);
      } else {
        this.logger.info(this._experimentId, '_executeStrategy',
          `无 creator_address，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}`);
      }
      // ========== 验证结束 ==========

      // ========== 先创建并保存信号到数据库（与虚拟盘一致）==========
      // 初始化策略执行记录
      if (!token.strategyExecutions) {
        const strategyIds = this._strategyEngine.getAllStrategies().map(s => s.id);
        this._tokenPool.initStrategyExecutions(token.token, token.chain, strategyIds);
      }

      // 初始化卡牌管理器
      if (positionManagement && positionManagement.enabled) {
        let cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);
        if (!cardManager) {
          const { CardPositionManager } = require('../../portfolio/CardPositionManager');
          cardManager = new CardPositionManager({
            totalCards: positionManagement.totalCards || 4,
            perCardMaxBNB: positionManagement.perCardMaxBNB || 0.25,
            minCardsForTrade: 1,
            initialAllocation: {
              bnbCards: (positionManagement.totalCards || 4),
              tokenCards: 0
            }
          });
          this._tokenPool.setCardPositionManager(token.token, token.chain, cardManager);
          this.logger.info(this._experimentId, '_executeStrategy', `初始化卡牌管理器: ${token.symbol}, 全部BNB卡状态`);
        }
      }

      // 创建信号对象（与虚拟盘一致）
      const signal = {
        action: 'buy',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 1,
        strategyId: strategy.id,
        strategyName: strategy.name,
        cardConfig: positionManagement?.enabled ? {
          totalCards: positionManagement.totalCards || 4,
          perCardMaxBNB: positionManagement.perCardMaxBNB || 0.25
        } : null,
        factors: factorResults ? {
          // 使用 FactorBuilder 构建完整的因子数据（与虚拟盘一致）
          trendFactors: this._buildTrendFactors(factorResults),
          // 购买前检查 factors（初始为默认值，检查通过后更新）
          preBuyCheckFactors: {
            preBuyCheck: factorResults.preBuyCheck || 0,
            checkTimestamp: factorResults.checkTimestamp || null,
            checkDuration: factorResults.checkDuration || null,
            holdersCount: factorResults.holdersCount || 0,
            devHoldingRatio: factorResults.devHoldingRatio || 0,
            maxHoldingRatio: factorResults.maxHoldingRatio || 0,
            holderCanBuy: factorResults.holderCanBuy ?? null,
            // 早期交易者黑白名单因子
            earlyTraderBlacklistCount: factorResults.earlyTraderBlacklistCount || 0,
            earlyTraderWhitelistCount: factorResults.earlyTraderWhitelistCount || 0,
            earlyTraderUniqueParticipants: factorResults.earlyTraderUniqueParticipants || 0,
            earlyTraderBlacklistRatio: factorResults.earlyTraderBlacklistRatio || 0,
            earlyTraderCanBuy: factorResults.earlyTraderCanBuy ?? null,
            preTraderCanBuy: factorResults.preTraderCanBuy ?? null,
            preTraderCheckReason: factorResults.preTraderCheckReason ?? null,
            // 早期参与者检查因子
            earlyTradesChecked: factorResults.earlyTradesChecked || 0,
            earlyTradesCheckTimestamp: factorResults.earlyTradesCheckTimestamp || null,
            earlyTradesCheckDuration: factorResults.earlyTradesCheckDuration || null,
            earlyTradesCheckTime: factorResults.earlyTradesCheckTime || null,
            earlyTradesWindow: factorResults.earlyTradesWindow || null,
            earlyTradesExpectedFirstTime: factorResults.earlyTradesExpectedFirstTime || null,
            earlyTradesExpectedLastTime: factorResults.earlyTradesExpectedLastTime || null,
            earlyTradesDataFirstTime: factorResults.earlyTradesDataFirstTime || null,
            earlyTradesDataLastTime: factorResults.earlyTradesDataLastTime || null,
            earlyTradesDataCoverage: factorResults.earlyTradesDataCoverage || 0,
            earlyTradesActualSpan: factorResults.earlyTradesActualSpan || 0,
            earlyTradesRateCalcWindow: factorResults.earlyTradesRateCalcWindow || 1,
            earlyTradesNoInnerData: factorResults.earlyTradesNoInnerData || 0,
            earlyTradesVolumePerMin: factorResults.earlyTradesVolumePerMin || 0,
            earlyTradesCountPerMin: factorResults.earlyTradesCountPerMin || 0,
            earlyTradesWalletsPerMin: factorResults.earlyTradesWalletsPerMin || 0,
            earlyTradesHighValuePerMin: factorResults.earlyTradesHighValuePerMin || 0,
            earlyTradesTotalCount: factorResults.earlyTradesTotalCount || 0,
            earlyTradesVolume: factorResults.earlyTradesVolume || 0,
            earlyTradesUniqueWallets: factorResults.earlyTradesUniqueWallets || 0,
            earlyTradesHighValueCount: factorResults.earlyTradesHighValueCount || 0,
            earlyTradesFilteredCount: factorResults.earlyTradesFilteredCount || 0,
            // 早期交易新增因子（与虚拟盘一致）
            earlyTradesFinalLiquidity: factorResults.earlyTradesFinalLiquidity || null,
            earlyTradesDrawdownFromHighest: factorResults.earlyTradesDrawdownFromHighest || null,
            // 钱包累积集中度因子（与虚拟盘一致）
            earlyTradesTop1BuyRatio: factorResults.earlyTradesTop1BuyRatio || 0,
            earlyTradesTop3BuyRatio: factorResults.earlyTradesTop3BuyRatio || 0,
            earlyTradesTop1NetHoldingRatio: factorResults.earlyTradesTop1NetHoldingRatio || 0,
            // 钱包簇检查因子
            walletClusterBlockThreshold: factorResults.walletClusterBlockThreshold || null,
            walletClusterMethod: factorResults.walletClusterMethod || null,
            walletClusterCount: factorResults.walletClusterCount || 0,
            walletClusterMaxSize: factorResults.walletClusterMaxSize || 0,
            walletClusterSecondToFirstRatio: factorResults.walletClusterSecondToFirstRatio || 0,
            walletClusterTop2Ratio: factorResults.walletClusterTop2Ratio || 0,
            walletClusterMegaRatio: factorResults.walletClusterMegaRatio || 0,
            walletClusterMaxClusterWallets: factorResults.walletClusterMaxClusterWallets || 0,
            // 最大区块买入金额占比因子（与虚拟盘一致）
            walletClusterMaxBlockBuyRatio: factorResults.walletClusterMaxBlockBuyRatio || 0,
            walletClusterMaxBlockNumber: factorResults.walletClusterMaxBlockNumber || null,
            walletClusterMaxBlockBuyAmount: factorResults.walletClusterMaxBlockBuyAmount || 0,
            walletClusterTotalBuyAmount: factorResults.walletClusterTotalBuyAmount || 0,
            // 强势交易者持仓因子（与虚拟盘一致）
            strongTraderNetPositionRatio: factorResults.strongTraderNetPositionRatio || 0,
            strongTraderTotalBuyRatio: factorResults.strongTraderTotalBuyRatio || 0,
            strongTraderTotalSellRatio: factorResults.strongTraderTotalSellRatio || 0,
            strongTraderWalletCount: factorResults.strongTraderWalletCount || 0,
            strongTraderTradeCount: factorResults.strongTraderTradeCount || 0,
            strongTraderSellIntensity: factorResults.strongTraderSellIntensity || 0,
            // 叙事分析评级因子
            narrativeRating: factorResults.narrativeRating ?? 9,
            // GMGN 安全检测因子（与虚拟盘一致）
            gmgnSecurityAvailable: 0,
            gmgnIsHoneypot: false,
            gmgnIsOpenSource: false,
            gmgnIsRenounced: false,
            gmgnHasBlacklist: -1,
            gmgnBuyTax: 0,
            gmgnSellTax: 0,
            gmgnTop10HolderRate: 0,
            gmgnHasAlert: false,
            gmgnPrivilegeCount: 0,
            gmgnLpLocked: false,
            gmgnLpLockPercent: 0,
            gmgnHolderCount: 0,
            gmgnLiquidity: 0,
          }
        } : null
      };

      this.logger.info(this._experimentId, '_executeStrategy',
        `创建信号 | symbol=${token.symbol}, action=${signal.action}`);

      // 先保存信号到数据库（与虚拟盘一致）
      let signalId = null;
      try {
        const { TradeSignal } = require('../entities');
        const tradeSignal = new TradeSignal({
          experimentId: this._experimentId,
          tokenAddress: signal.tokenAddress,
          tokenSymbol: signal.symbol,
          signalType: signal.action.toUpperCase(),
          action: signal.action,
          confidence: signal.confidence,
          reason: signal.reason,
          metadata: {
            ...signal.cardConfig,
            price: signal.price,
            strategyId: signal.strategyId,
            strategyName: signal.strategyName,
            cards: signal.cards,
            ...signal.factors
          }
        });
        signalId = await tradeSignal.save();
        this.logger.info(this._experimentId, '_executeStrategy',
          `信号已保存 | symbol=${token.symbol}, signalId=${signalId}`);

        // 信号创建后立即记录策略执行次数（不管预检查是否通过）
        // 这样 maxExecutions 限制才能正确生效
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
      } catch (saveError) {
        this.logger.error(this._experimentId, '_executeStrategy',
          `保存信号失败 | symbol=${token.symbol}, error=${saveError.message}`);
        return failResult('保存信号失败');
      }

      // ========== 叙事分析步骤（轮询获取结果） ==========
      let narrativeRating = 9; // 默认未评级（未启用叙事分析时通过预检查）
      if (this._narrativeAnalysisEnabled) {
        narrativeRating = await this._getNarrativeRating(token.token);
        this.logger.info(this._experimentId, '_executeStrategy',
          `叙事评级 | symbol=${token.symbol}, rating=${narrativeRating}`);
      }
      // ========== 叙事分析步骤结束 ==========

      // ========== 合约审计风控（与虚拟盘一致，已停用 AVE，GMGN 安全检测已在 PreBuyCheckService 中执行）==========
      let contractRiskData = this._getEmptyContractRiskData();  // 固定返回空数据
      // ========== 合约审计风控结束 ==========

      // ========== 然后进行预检查（与虚拟盘一致）==========
      let preCheckPassed = true;
      let blockReason = null;
      let preBuyCheckResult = null;

      // 1. Dev 钱包检查已在前面完成
      // 2. 综合购买前检查（使用 PreBuyCheckService）

      // 根据交易轮数确定是否需要执行预检查
      const currentRound = this._tokenPool.getCurrentRound(token.token, token.chain || 'bsc');
      let shouldPerformPreCheck = false;

      if (currentRound === 0) {
        // 首次买入：如果有 preBuyCheckCondition 则执行预检查
        shouldPerformPreCheck = !!(strategy.preBuyCheckCondition && String(strategy.preBuyCheckCondition).trim() !== '');
      } else {
        // 再次买入：只有明确配置了 repeatBuyCheckCondition 时才执行预检查
        shouldPerformPreCheck = !!(strategy.repeatBuyCheckCondition && String(strategy.repeatBuyCheckCondition).trim() !== '');
      }

      if (shouldPerformPreCheck && this._preBuyCheckService) {
        try {
          this.logger.info(this._experimentId, '_executeStrategy',
            `执行购买前检查 | symbol=${token.symbol}, round=${currentRound + 1}, creator=${token.creator_address || 'none'}`);

          // 构建代币信息（用于早期参与者检查）
          const tokenInfo = this._buildTokenInfo(token);

          let preBuyCheckCondition;
          if (currentRound === 0) {
            preBuyCheckCondition = strategy.preBuyCheckCondition;
          } else {
            preBuyCheckCondition = strategy.repeatBuyCheckCondition;
          }

          preBuyCheckCondition = String(preBuyCheckCondition).trim();

          // 获取上一对收益率
          const lastPairReturnRate = this._tokenPool.getLastPairReturnRate(token.token, token.chain || 'bsc');

          // 计算代币总供应量（与虚拟盘一致）
          let totalSupply = parseFloat(token.total) || 0;
          if (totalSupply <= 0 && factorResults.fdv > 0 && factorResults.currentPrice > 0) {
            totalSupply = factorResults.fdv / factorResults.currentPrice;
          }

          preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
            token.token,
            token.creator_address || null,
            this._experimentId,
            signalId,  // 传入信号ID
            token.chain || 'bsc',
            tokenInfo,
            preBuyCheckCondition,
            {
              checkTime: Math.floor(Date.now() / 1000),
              tokenBuyTime: token.buyTime || null,  // 代币首次买入时间
              drawdownFromHighest: factorResults.drawdownFromHighest || null,  // 趋势因子：最高价回撤
              buyRound: currentRound + 1,  // 即将进行的轮数
              lastPairReturnRate: lastPairReturnRate ?? 0,
              narrativeRating: narrativeRating,  // 叙事评级
              tweetAuthorType: factorResults.tweetAuthorType ?? 0,  // 推文作者类型
              dataCollectionRound: factorResults.dataCollectionRound ?? 0,  // 数据采集轮数
              skipTwitterSearch: this._preBuyCheckConfig?.skipTwitterSearch ?? false,
              skipGmgnSecurity: !this._gmgnSecurityCheckEnabled,  // GMGN 安全检测开关（与虚拟盘一致）
              contractRiskData: contractRiskData,  // 合约审计风控数据（与虚拟盘一致）
              totalSupply: totalSupply,  // 代币总供应量（与虚拟盘一致）
              rawApiData: token.rawApiData || null  // 原始API数据（用于社交因子融合，与虚拟盘一致）
            }
          );

          if (!preBuyCheckResult.canBuy) {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `购买前检查失败 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
              `reason=${preBuyCheckResult.checkReason}, ` +
              `whitelist=${preBuyCheckResult.earlyTraderWhitelistCount}, blacklist=${preBuyCheckResult.earlyTraderBlacklistCount}, ` +
              `devHoldingRatio=${(isNaN(preBuyCheckResult.devHoldingRatio) ? 'N/A' : preBuyCheckResult.devHoldingRatio.toFixed(1))}%, maxHoldingRatio=${(isNaN(preBuyCheckResult.maxHoldingRatio) ? 'N/A' : preBuyCheckResult.maxHoldingRatio.toFixed(1))}%`);
            preCheckPassed = false;
            blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
          } else {
            this.logger.info(this._experimentId, '_executeStrategy',
              `购买前检查通过 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
              `reason=${preBuyCheckResult.checkReason}`);
          }
        } catch (checkError) {
          const errorMsg = checkError?.message || String(checkError);
          this.logger.error(this._experimentId, '_executeStrategy',
            `购买前检查异常: ${token.symbol} - ${errorMsg}`);
          // 检查失败时拒绝购买，保守处理
          preCheckPassed = false;
          blockReason = `购买前检查异常: ${errorMsg}`;
        }
      } else if (!shouldPerformPreCheck) {
        this.logger.info(this._experimentId, '_executeStrategy',
          `跳过购买前检查 | symbol=${token.symbol}, round=${currentRound + 1}`);
      }

      // 如果预检查失败，更新信号状态并返回失败（与虚拟盘一致）
      if (!preCheckPassed) {
        this.logger.warn(this._experimentId, '_executeStrategy',
          `预检查失败 | symbol=${token.symbol}, reason=${blockReason}`);

        // 即使预检查失败，也要保存购买前置检查结果到 metadata（用于分析）
        if (preBuyCheckResult && signalId) {
          const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
          const regularFactors = buildFactorValuesForTimeSeries(factorResults);
          const preBuyCheckFactors = buildPreBuyCheckFactorValues(preBuyCheckResult);

          // 提取 tokenCreateTime（用于记录使用的是哪种方法）
          const tokenCreateTime = token.createdAt
            ? Math.floor(new Date(token.createdAt * 1000).getTime() / 1000)
            : null;

          const failedCheckMetadata = {
            tokenCreateTime: tokenCreateTime,
            regularFactors: regularFactors,
            preBuyCheckFactors: preBuyCheckFactors,
            preBuyCheckResult: {
              canBuy: preBuyCheckResult.canBuy,
              reason: preBuyCheckResult.checkReason || 'pre_buy_check_failed',
              failedConditions: preBuyCheckResult.failedConditions || null
            }
          };

          try {
            // 传递Twitter数据（与虚拟盘一致）
            const directFields = {
              twitter_search_result: preBuyCheckResult._twitterRawResult || null,
              twitter_search_duration: preBuyCheckResult._twitterDuration || null,
              gmgn_security_raw_data: preBuyCheckResult.gmgnSecurityRawData || null,
              gmgn_token_info_raw_data: preBuyCheckResult.gmgnTokenInfoRawData || null
            };
            await this._updateSignalMetadata(signalId, failedCheckMetadata, directFields);
            this.logger.info(this._experimentId, '_executeStrategy',
              `预检查失败，但已保存购买前置检查数据 | symbol=${token.symbol}, signalId=${signalId}`);
          } catch (updateError) {
            this.logger.warn(this._experimentId, '_executeStrategy',
              `更新信号元数据失败 | symbol=${token.symbol}, error=${updateError.message}`);
          }
        }

        // 更新信号状态为 failed（预检查失败）
        if (signalId) {
          await this._updateSignalStatus(signalId, 'failed', {
            message: `预检查失败: ${blockReason}`,
            reason: blockReason
          });
        }

        // 记录到 RoundSummary
        if (this._roundSummary) {
          this._roundSummary.recordSignal(token.token, {
            direction: 'BUY',
            action: 'buy',
            confidence: 0,
            reason: `预检查失败: ${blockReason}`
          });
          this._roundSummary.recordSignalExecution(token.token, false, `预检查失败: ${blockReason}`);
        }

        return failResult(`预检查失败: ${blockReason}`);
      }

      // ========== 预检查通过，构建信号元数据并执行交易 ==========
      this.logger.info(this._experimentId, '_executeStrategy',
        `预检查通过，构建信号元数据 | symbol=${token.symbol}`);

      // 构建信号元数据（包含趋势因子和购买前检查因子）
      if (preBuyCheckResult && signalId) {
        const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
        const trendFactors = buildFactorValuesForTimeSeries(factorResults);
        const preBuyCheckFactors = buildPreBuyCheckFactorValues(preBuyCheckResult);

        // 提取 tokenCreateTime（用于记录使用的是哪种方法）
        const tokenCreateTime = token.createdAt
          ? Math.floor(new Date(token.createdAt * 1000).getTime() / 1000)
          : null;

        const signalMetadata = {
          tokenCreateTime: tokenCreateTime,
          trendFactors: trendFactors,
          preBuyCheckFactors: preBuyCheckFactors,
          preBuyCheckResult: {
            canBuy: preBuyCheckResult.canBuy,
            reason: preBuyCheckResult.checkReason || 'passed',
            failedConditions: preBuyCheckResult.failedConditions || null
          }
        };

        try {
          // 传递Twitter数据（与虚拟盘一致）
          const directFields = {
            twitter_search_result: preBuyCheckResult._twitterRawResult || null,
            twitter_search_duration: preBuyCheckResult._twitterDuration || null,
            gmgn_security_raw_data: preBuyCheckResult.gmgnSecurityRawData || null,
            gmgn_token_info_raw_data: preBuyCheckResult.gmgnTokenInfoRawData || null
          };
          await this._updateSignalMetadata(signalId, signalMetadata, directFields);
          this.logger.info(this._experimentId, '_executeStrategy',
            `信号元数据已更新 | symbol=${token.symbol}, signalId=${signalId}`);
        } catch (updateError) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `更新信号元数据失败 | symbol=${token.symbol}, error=${updateError.message}`);
        }
      }

      this.logger.info(this._experimentId, '_executeStrategy',
        `调用 processSignal | symbol=${token.symbol}`);

      const result = await this.processSignal(signal, signalId);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        // 更新代币状态到数据库（与虚拟盘一致）
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        return successResult();
      }

      return failResult('交易执行失败: result.success 为 false');

    } else if (strategy.action === 'sell') {
      if (token.status !== 'bought') {
        return failResult(`代币状态不是 bought (当前: ${token.status})`);
      }

      const cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);

      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy', `代币 ${token.symbol} 没有卡牌管理器，跳过卖出`);
        return failResult('没有卡牌管理器');
      }

      const cards = strategy.cards || 'all';
      const sellAll = (cards === 'all');

      let sellCalculatedRatio = 1.0;
      if (!sellAll) {
        const cardNum = parseInt(cards);
        if (!isNaN(cardNum) && cardNum > 0) {
          sellCalculatedRatio = cardNum / cardManager.totalCards;
        }
      }

      const signal = {
        action: 'sell',
        symbol: token.symbol,
        tokenAddress: token.token,
        chain: token.chain,
        price: latestPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 'all',
        strategyId: strategy.id,
        strategyName: strategy.name,
        buyPrice: token.buyPrice || null,
        profitPercent: token.buyPrice && latestPrice ? ((latestPrice - token.buyPrice) / token.buyPrice * 100) : null,
        holdDuration: token.buyTime ? ((Date.now() - token.buyTime) / 1000) : null,
        cardConfig: positionManagement?.enabled ? {
          totalCards: positionManagement.totalCards || 4,
          perCardMaxBNB: positionManagement.perCardMaxBNB || 0.25
        } : null,
        sellCalculatedRatio: sellCalculatedRatio,
        factors: factorResults ? {
          // 使用 FactorBuilder 构建完整的因子数据（与虚拟盘一致）
          trendFactors: this._buildTrendFactors(factorResults)
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        return successResult();
      }

      return failResult('卖出交易执行失败: result.success 为 false');
    }

    return failResult('未知策略类型');
  }

  /**
   * 计算买入金额（Live 特有：使用卡牌管理器）
   * @protected
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   */
  _calculateBuyAmount(signal) {
    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `_calculateBuyAmount 被调用 | symbol=${signal.symbol}, tokenAddress=${signal.tokenAddress}, chain=${signal.chain}, cards=${signal.cards}`);

    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `获取卡牌管理器 | cardManager=${cardManager ? '存在' : '不存在'}`);

    if (cardManager) {
      const cards = signal.cards || 1;
      this.logger.info(this._experimentId, '_calculateBuyAmount',
        `卡牌管理器状态 | bnbCards=${cardManager.bnbCards}, tokenCards=${cardManager.tokenCards}, totalCards=${cardManager.totalCards}, perCardMaxBNB=${cardManager.perCardMaxBNB}`);

      const amount = cardManager.calculateBuyAmount(cards);
      this.logger.info(this._experimentId, '_calculateBuyAmount',
        `卡牌管理器计算金额 | cards=${cards}, amount=${amount}`);

      if (amount <= 0) {
        this.logger.warn(this._experimentId, '_calculateBuyAmount',
          `卡牌管理器返回金额为0: ${signal.symbol}`);
        return 0;
      }

      // 检查可用余额是否足够
      const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
      if (portfolio && portfolio.availableBalance && portfolio.availableBalance.lt(amount)) {
        this.logger.warn(this._experimentId, '_calculateBuyAmount',
          `余额不足: 需要 ${amount} BNB, 当前 ${portfolio.availableBalance.toFixed(4)} BNB`);
        return 0;
      }
      // 转换为数字（amount 可能是 Decimal 对象）
      return typeof amount === 'number' ? amount : amount.toNumber();
    }

    // 默认使用可用余额的 20%
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    const tradeAmount = portfolio.availableBalance.mul(0.2);

    this.logger.info(this._experimentId, '_calculateBuyAmount',
      `使用默认金额计算 | tradeAmount=${tradeAmount}`);

    return tradeAmount.toNumber();
  }

  /**
   * 启动引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async start() {
    const { EngineStatus } = require('../interfaces/ITradingEngine');

    if (this._status === EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎已在运行');
      return;
    }

    // 调用基类 start 方法
    await super.start();

    // 启动收集器
    this._fourmemeCollector.start();
    const config = require('../../../config/default.json');
    console.log(`🔄 Fourmeme 收集器已启动 (${config.collector.interval}ms 间隔)`);

    console.log(`🚀 实盘交易引擎已启动: 实验 ${this._experimentId}`);
  }

  /**
   * 检查创建者地址是否为 Dev 钱包
   * @private
   * @param {string} creatorAddress - 创建者地址
   * @returns {Promise<boolean>} 是否为 Dev 钱包
   */
  async isNegativeDevWallet(creatorAddress) {
    if (!creatorAddress) return false;

    try {
      const { WalletDataService } = require('../../web/services/WalletDataService');
      const walletService = new WalletDataService();

      const allWallets = await walletService.getWallets();
      const devWallets = allWallets.filter(w => w.category === 'dev');

      return devWallets.some(w =>
        w.address.toLowerCase() === creatorAddress.toLowerCase()
      );
    } catch (error) {
      this.logger.error(this._experimentId, 'isNegativeDevWallet',
        `检查 Dev 钱包失败 | error=${error.message}`);
      return false;
    }
  }

  /**
   * 更新代币状态到数据库
   * @private
   * @param {string} tokenAddress - 代币地址
   * @param {string} chain - 链
   * @param {string} status - 状态
   * @returns {Promise<void>}
   */
  async _updateTokenStatus(tokenAddress, chain, status) {
    const { dbManager } = require('../../services/dbManager');
    const supabase = dbManager.getClient();

    const { error } = await supabase
      .from('experiment_tokens')
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('experiment_id', this._experimentId)
      .eq('token_address', tokenAddress)
      .eq('blockchain', chain || 'bsc');

    if (error) {
      this.logger.error(this._experimentId, '_updateTokenStatus',
        `更新代币状态失败 | tokenAddress=${tokenAddress}, status=${status}, error=${error.message}`);
    } else {
      this.logger.debug(this._experimentId, '_updateTokenStatus',
        `代币状态已更新 | tokenAddress=${tokenAddress}, status=${status}`);
    }
  }

  /**
   * 获取空的合约审计数据（已停用 AVE，GMGN 安全检测已在 PreBuyCheckService 中执行）
   * @private
   * @returns {Object} 空的合约审计数据
   */
  _getEmptyContractRiskData() {
    return {
      contractRiskAvailable: 0,
      contractRiskPairLockPercent: 0,
      contractRiskTopLpHolderPercent: 0,
      contractRiskLpHolders: 0,
      contractRiskScore: 0,
      contractRiskIsHoneypot: 0,
      contractRiskDexAmmType: 'unknown',
      contractRiskHasCode: 'unknown',
    };
  }

  /**
   * 构建代币信息（用于早期参与者检查）
   * @private
   * @param {Object} token - 代币数据
   * @returns {Object} 代币信息
   */
  _buildTokenInfo(token) {
    // 获取 launchAt（代币创建时间戳）
    let launchAt = null;

    // 尝试多个来源获取 launchAt
    // 1. 直接从 token.launchAt 获取
    if (token.launchAt) {
      launchAt = token.launchAt;
    }
    // 2. 从 token.raw_api_data.token.launch_at 获取
    else if (token.raw_api_data) {
      try {
        const rawApiData = typeof token.raw_api_data === 'string'
          ? JSON.parse(token.raw_api_data)
          : token.raw_api_data;

        // 尝试从不同的路径获取
        if (rawApiData.token?.launch_at) {
          launchAt = rawApiData.token.launch_at;
        } else if (rawApiData.launch_at) {
          launchAt = rawApiData.launch_at;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 3. 如果还是没有，使用 createdAt 作为备选
    if (!launchAt && token.createdAt) {
      launchAt = token.createdAt;
    }

    // 确定内盘交易对
    let innerPair = null;
    const platform = token.platform || 'fourmeme';

    // 优先使用已设置的 pairAddress（由 PlatformCollector 设置）
    if (token.pairAddress) {
      innerPair = token.pairAddress;
    } else if (platform === 'fourmeme') {
      innerPair = `${token.token}_fo`;
    } else if (platform === 'flap') {
      innerPair = `${token.token}_iportal`;
    } else if (token.main_pair) {
      innerPair = token.main_pair;
    } else if (token.pair) {
      innerPair = token.pair;
    } else {
      // 默认使用 fourmeme 格式
      innerPair = `${token.token}_fo`;
    }

    return {
      tokenAddress: token.token,
      symbol: token.symbol,
      chain: token.chain || 'bsc',
      createdAt: token.createdAt,
      collectionTime: token.collectionTime || token.addedAt || Date.now(),
      currentPrice: token.currentPrice || 0,
      launchPrice: token.launchPrice || token.collectionPrice || token.currentPrice || 0,
      tokenCreatedAt: launchAt,  // PreBuyCheckService 需要这个字段
      innerPair: innerPair        // EarlyParticipantCheckService 需要这个字段
    };
  }

  /**
   * 构建趋势因子（用于信号元数据）
   * @private
   * @param {Object} factorResults - 因子计算结果
   * @returns {Object} 趋势因子
   */
  _buildTrendFactors(factorResults) {
    const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
    return {
      ...buildFactorValuesForTimeSeries(factorResults),
      // 添加价格趋势检测相关因子（如果存在）
      trendDataPoints: factorResults.trendDataPoints,
      trendCV: factorResults.trendCV,
      trendPriceUp: factorResults.trendPriceUp,
      trendMedianUp: factorResults.trendMedianUp,
      trendSlope: factorResults.trendSlope,
      trendStrengthScore: factorResults.trendStrengthScore,
      trendTotalReturn: factorResults.trendTotalReturn,
      trendRiseRatio: factorResults.trendRiseRatio,
      trendRecentDownCount: factorResults.trendRecentDownCount,
      trendRecentDownRatio: factorResults.trendRecentDownRatio,
      trendConsecutiveDowns: factorResults.trendConsecutiveDowns,
      // 添加持有者趋势检测相关因子（如果存在）
      holderTrendDataPoints: factorResults.holderTrendDataPoints,
      holderTrendCV: factorResults.holderTrendCV,
      holderTrendHolderCountUp: factorResults.holderTrendHolderCountUp,
      holderTrendMedianUp: factorResults.holderTrendMedianUp,
      holderTrendSlope: factorResults.holderTrendSlope,
      holderTrendStrengthScore: factorResults.holderTrendStrengthScore,
      holderTrendGrowthRatio: factorResults.holderTrendGrowthRatio,
      holderTrendRiseRatio: factorResults.holderTrendRiseRatio,
      holderTrendRecentDecreaseCount: factorResults.holderTrendRecentDecreaseCount,
      holderTrendRecentDecreaseRatio: factorResults.holderTrendRecentDecreaseRatio,
      holderTrendConsecutiveDecreases: factorResults.holderTrendConsecutiveDecreases
    };
  }

  /**
   * 构建购买前检查因子（用于信号元数据）
   * @private
   * @param {Object} preBuyCheckResult - 预检查结果
   * @returns {Object} 预检查因子
   */
  _buildPreBuyCheckFactors(preBuyCheckResult) {
    const { buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
    return buildPreBuyCheckFactorValues(preBuyCheckResult);
  }

  /**
   * 更新信号元数据（使用基类实现，支持 directFields 参数）
   * @private
   * @param {string} signalId - 信号ID
   * @param {Object} metadata - 元数据
   * @param {Object} [directFields] - 直接数据库字段（如 twitter_search_result）
   * @returns {Promise<void>}
   */


  /**
   * 更新信号状态
   * @private
   * @param {string} signalId - 信号ID
   * @param {string} status - 状态
   * @param {Object} result - 结果对象
   * @returns {Promise<void>}
   */
  async _updateSignalStatus(signalId, status, result = {}) {
    if (!signalId) {
      return;
    }

    try {
      await this.dataService.updateSignalStatus(signalId, status, {
        executed: status === 'executed',
        execution_status: status,
        execution_reason: result.reason || result.message || null,
        executed_at: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error(this._experimentId, '_updateSignalStatus',
        `更新信号状态失败 | signalId=${signalId}, error=${error.message}`);
    }
  }

  /**
   * 停止引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._isStopped) {
      return;
    }

    // 停止收集器
    if (this._fourmemeCollector) {
      this._fourmemeCollector.stop();
      console.log(`⏹️ Fourmeme 收集器已停止`);
    }

    // 停止监控循环
    if (this._monitoringTimer) {
      clearInterval(this._monitoringTimer);
      this._monitoringTimer = null;
    }

    // 调用基类 stop 方法
    await super.stop();

    console.log(`🛑 实盘交易引擎已停止`);
  }

  /**
   * 执行叙事分析（实盘模式）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>} 叙事评级 (1=低质量, 2=中质量, 3=高质量, 9=未评级)
   */
  async _executeNarrativeAnalysis(tokenAddress) {
    const startTime = Date.now();
    try {
      const { NarrativeAnalyzer } = await import('../../narrative/analyzer/NarrativeAnalyzer.mjs');
      const result = await NarrativeAnalyzer.analyze(tokenAddress, {
        ignoreCache: this._narrativeReanalyze,
        experimentId: this._experimentId
      });
      const fromCache = result.meta?.fromCache ? '缓存' : 'LLM';
      const sourceExp = result.meta?.sourceExperimentId || 'N/A';
      const rating = categoryToRating(result.llmAnalysis?.summary?.category);

      this.logger.info(this._experimentId, '_executeNarrativeAnalysis',
        `叙事分析完成 | token=${tokenAddress.slice(0, 10)}..., rating=${rating}, source=${fromCache}, sourceExp=${sourceExp}, duration=${Date.now() - startTime}ms`);

      return rating;
    } catch (error) {
      this.logger.warn(this._experimentId, '_executeNarrativeAnalysis',
        `叙事分析失败 | token=${tokenAddress.slice(0, 10)}..., error=${error.message}`);
      return 9; // 错误返回未评级
    }
  }

  /**
   * 获取叙事评级（带轮询等待）
   * @protected
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>} 叙事评级
   */
  async _getNarrativeRating(tokenAddress) {
    return this._pollNarrativeRating(this._experimentId, tokenAddress, {
      maxWaitSeconds: this._narrativeMaxWaitSeconds,
      pollIntervalMs: this._narrativePollIntervalMs
    });
  }

  /**
   * 计算趋势因子满足比例
   * @protected
   * @param {Object} factorResults - 因子结果
   * @returns {number} 满足比例（0-100）
   */
  _calculateTrendFactorSatisfaction(factorResults) {
    // 获取买入策略的条件表达式
    const strategiesConfig = this._experiment?.config?.strategiesConfig || {};
    const buyStrategies = strategiesConfig.buyStrategies || [];

    // 使用第一个买入策略的条件（通常优先级最高）
    if (buyStrategies.length > 0 && buyStrategies[0].condition) {
      const condition = buyStrategies[0].condition;

      try {
        // 使用 ConditionEvaluator 计算满足比例
        const { ConditionEvaluator } = require('../../strategies/ConditionEvaluator');
        const evaluator = new ConditionEvaluator();
        return evaluator.evaluateWithScore(condition, factorResults);
      } catch (error) {
        this.logger.warn(this._experimentId, '_calculateTrendFactorSatisfaction',
          `条件评估失败 | error=${error.message}`);
        return 0;
      }
    }

    // 降级方案：如果没有配置买入策略，返回 0
    return 0;
  }




  // 注意：不再允许使用硬编码策略
  // 策略必须在实验配置中通过 config.strategiesConfig 明确定义
}

module.exports = { LiveTradingEngine };
