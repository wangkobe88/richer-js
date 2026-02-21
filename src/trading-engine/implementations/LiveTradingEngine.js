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
const traderFactory = require('../traders');
const Logger = require('../../services/logger');

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

    // 初始化 FourMeme 交易器（用于内盘交易）
    this._fourMemeTrader = traderFactory.createTrader('fourmeme', traderConfig);
    await this._fourMemeTrader.setWallet(this._privateKey);
    // 传递 logger 给交易器
    if (this._fourMemeTrader.setLogger) {
      this._fourMemeTrader.setLogger(this.logger);
    }
    console.log('✅ FourMeme 交易器初始化成功');

    // 初始化 PancakeSwap V2 交易器（用于出盘后代币的外部交易）
    this._pancakeSwapTrader = traderFactory.createTrader('pancakeswap-v2', traderConfig);
    await this._pancakeSwapTrader.setWallet(this._privateKey);
    // 传递 logger 给交易器
    if (this._pancakeSwapTrader.setLogger) {
      this._pancakeSwapTrader.setLogger(this.logger);
    }
    console.log('✅ PancakeSwap V2 交易器初始化成功');

    // 设置默认交易器为 FourMeme（用于买入）
    this._trader = this._fourMemeTrader;

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

      const buyResult = await this._trader.buyToken(
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
        // 反推实际成交价格
        if (actualTokenAmount > 0) {
          actualPrice = amountInBNB / actualTokenAmount;
        }
        this.logger.info(this._experimentId, '_executeBuy',
          `交易器返回 | actualAmountOut=${actualTokenAmount}, actualPrice=${actualPrice}`);
      } else {
        // 交易器没有返回实际数量，使用价格估算
        actualPrice = signal.price || 0;
        actualTokenAmount = actualPrice > 0 ? amountInBNB / actualPrice : 0;
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

      // 智能选择交易器：优先使用 FourMeme，失败则使用 PancakeSwap V2
      let sellResult;
      let traderUsed = 'unknown';

      // 准备交易参数（两个交易器滑点格式不同）
      const fourmemeOptions = {
        slippageTolerance: this._maxSlippage * 100, // 转换为百分比格式
        gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
      };
      const pancakeOptions = {
        slippage: this._maxSlippage, // 小数格式
        gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
      };

      // 转换为 wei 格式（交易器期望 BigInt 格式，代币最小单位）
      // amountToSell 已经是代币数量（decimal 格式），需要转换为 wei
      // ERC20 代币通常是 18 位小数
      const ethers = require('ethers');
      const amountToSellBigInt = ethers.parseUnits(amountToSell.toFixed(18), 18);

      // 1. 首先尝试使用 FourMeme 交易器（内盘）
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

        // 检查是否是 bonding curve 饱和错误
        const isBondingCurveSaturated = fourmemeError.code === 'BONDING_CURVE_SATURATED' ||
          fourmemeError.message?.includes('bonding curve') ||
          fourmemeError.message?.includes('已饱和');

        if (isBondingCurveSaturated) {
          // Bonding curve 饱和，内盘无法卖出
          // 这种情况下，尝试 PancakeSwap 可能也会失败（如果没有流动性池）
          // 但为了完整性，仍然尝试一次，以便在确实有流动性时能够卖出
          this.logger.warn(this._experimentId, '_executeSell',
            `Bonding curve 已饱和，尝试通过 PancakeSwap 卖出（如果有流动性池）`);
        }

        this.logger.info(this._experimentId, '_executeSell', `尝试使用 PancakeSwap V2 交易器卖出 ${signal.symbol}...`);

        // 2. FourMeme 失败，尝试使用 PancakeSwap V2（外盘）
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

          // 提供更友好的错误信息
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
        actualBnbReceived = amountToSell * price;
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
      cardManager.afterSell(signal.symbol, actualCards);
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
    const FourmemeCollector = require('../../collectors/fourmeme-collector');
    const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
    const { RoundSummary } = require('../utils/RoundSummary');

    // 加载配置
    const config = require('../../../config/default.json');

    // Logger 已经在 _initializeDataSources 中初始化，这里跳过
    // 初始化 DataService（与虚拟盘一致）
    this.dataService = new ExperimentDataService();

    // 初始化 TokenPool（与虚拟盘一致，传递 logger）
    this._tokenPool = new TokenPool(this.logger);
    await this._tokenPool.initialize();
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

    // 初始化 Fourmeme 收集器（与虚拟盘一致，传递 logger）
    this._fourmemeCollector = new FourmemeCollector(
      config,
      this.logger,
      this._tokenPool
    );
    this.logger.info('LiveTradingEngine', 'Initialize', 'Fourmeme 收集器初始化完成');
    console.log(`✅ Fourmeme 收集器初始化完成`);

    // 初始化 RoundSummary（与虚拟盘一致）
    this._roundSummary = new RoundSummary(this._experimentId, this.logger, this._blockchain);
    this.logger.info('LiveTradingEngine', 'Initialize', 'RoundSummary 初始化完成');
    console.log(`✅ RoundSummary 初始化完成`);

    // 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    const availableFactorIds = new Set([
      'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
      'holdDuration', 'profitPercent',
      'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
      'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap'
    ]);

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
      }

      // 清理过期代币
      const removed = this._tokenPool.cleanup();
      if (removed.length > 0) {
        this.logger.info(this._experimentId, 'MonitoringCycle', `清理过期代币: ${removed.length} 个`);
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
          created_at: token.createdAt,
          raw_api_data: token.rawApiData || null,
          contract_risk_raw_ave_data: token.contractRisk || null,
          creator_address: token.creatorAddress || null
        });
        this._seenTokens.add(tokenKey);
        this.logger.debug(this._experimentId, 'ProcessToken', `新代币已保存: ${token.symbol}`);
      }

      const currentPrice = token.currentPrice || 0;
      if (currentPrice === 0) {
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

      // 评估策略
      const strategy = this._strategyEngine.evaluate(
        factorResults,
        token.token,
        Date.now(),
        token
      );

      if (strategy) {
        if (strategy.action === 'buy' && token.status !== 'monitoring') {
          this.logger.debug(this._experimentId, 'ProcessToken', `${token.symbol} 买入策略跳过 (状态: ${token.status})`);
          return;
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

        const executed = await this._executeStrategy(strategy, token, factorResults);

        // RoundSummary - 记录执行结果
        if (this._roundSummary) {
          this._roundSummary.recordSignalExecution(
            token.token,
            executed,
            executed ? null : '执行失败'
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
    const launchPrice = token.launchPrice || 0;

    let earlyReturn = 0;
    if (launchPrice > 0 && currentPrice > 0) {
      earlyReturn = ((currentPrice - launchPrice) / launchPrice) * 100;
    }

    // collectionPrice 保留用于兼容和调试
    const collectionPrice = token.collectionPrice || currentPrice;

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

    const highestPrice = token.highestPrice || launchPrice || currentPrice;
    const highestPriceTimestamp = token.highestPriceTimestamp || collectionTime;

    let drawdownFromHighest = 0;
    if (highestPrice > 0 && currentPrice > 0) {
      drawdownFromHighest = ((currentPrice - highestPrice) / highestPrice) * 100;
    }

    return {
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
      txVolumeU24h: token.txVolumeU24h || 0,
      holders: token.holders || 0,
      tvl: token.tvl || 0,
      fdv: token.fdv || 0,
      marketCap: token.marketCap || 0
    };
  }

  /**
   * 执行策略（与虚拟盘一致）
   * @private
   * @param {Object} strategy - 策略对象
   * @param {Object} token - 代币数据
   * @param {Object} factorResults - 因子计算结果
   * @returns {Promise<boolean>} 是否执行成功
   */
  async _executeStrategy(strategy, token, factorResults = null) {
    const latestPrice = token.currentPrice || 0;

    if (!factorResults) {
      factorResults = this._buildFactors(token);
    }

    // 获取卡牌仓位管理配置（与虚拟盘一致）
    const positionManagement = this._experiment.config?.positionManagement;

    if (strategy.action === 'buy') {
      if (token.status !== 'monitoring') {
        return false;
      }

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
          return false;
        }
        this.logger.info(this._experimentId, '_executeStrategy',
          `Dev 钱包检查通过，继续购买流程 | symbol=${token.symbol}`);
      } else {
        this.logger.info(this._experimentId, '_executeStrategy',
          `无 creator_address，跳过 Dev 钱包检查，继续购买流程 | symbol=${token.symbol}`);
      }
      // ========== 验证结束 ==========

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
          age: factorResults.age,
          currentPrice: factorResults.currentPrice,
          collectionPrice: factorResults.collectionPrice,
          earlyReturn: factorResults.earlyReturn,
          riseSpeed: factorResults.riseSpeed,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent,
          highestPrice: factorResults.highestPrice,
          highestPriceTimestamp: factorResults.highestPriceTimestamp,
          drawdownFromHighest: factorResults.drawdownFromHighest,
          txVolumeU24h: factorResults.txVolumeU24h,
          holders: factorResults.holders,
          tvl: factorResults.tvl,
          fdv: factorResults.fdv,
          marketCap: factorResults.marketCap
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.markAsBought(token.token, token.chain, {
          buyPrice: latestPrice,
          buyTime: Date.now()
        });

        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);

        // 更新代币状态到数据库（与虚拟盘一致）
        await this.dataService.updateTokenStatus(this._experimentId, token.token, 'bought');

        return true;
      }

      return false;

    } else if (strategy.action === 'sell') {
      if (token.status !== 'bought') {
        return false;
      }

      const cardManager = this._tokenPool.getCardPositionManager(token.token, token.chain);

      if (!cardManager) {
        this.logger.warn(this._experimentId, '_executeStrategy', `代币 ${token.symbol} 没有卡牌管理器，跳过卖出`);
        return false;
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
          age: factorResults.age,
          currentPrice: factorResults.currentPrice,
          collectionPrice: factorResults.collectionPrice,
          earlyReturn: factorResults.earlyReturn,
          riseSpeed: factorResults.riseSpeed,
          buyPrice: factorResults.buyPrice,
          holdDuration: factorResults.holdDuration,
          profitPercent: factorResults.profitPercent,
          highestPrice: factorResults.highestPrice,
          highestPriceTimestamp: factorResults.highestPriceTimestamp,
          drawdownFromHighest: factorResults.drawdownFromHighest,
          txVolumeU24h: factorResults.txVolumeU24h,
          holders: factorResults.holders,
          tvl: factorResults.tvl,
          fdv: factorResults.fdv,
          marketCap: factorResults.marketCap
        } : null
      };

      const result = await this.processSignal(signal);

      if (result && result.success) {
        this._tokenPool.recordStrategyExecution(token.token, token.chain, strategy.id);
        return true;
      }

      return false;
    }

    return false;
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


  // 注意：不再允许使用硬编码策略
  // 策略必须在实验配置中通过 config.strategiesConfig 明确定义
}

module.exports = { LiveTradingEngine };
