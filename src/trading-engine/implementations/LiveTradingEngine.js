/**
 * 实盘交易引擎
 * 继承自 AbstractTradingEngine，实现真实交易
 * 重构版本，支持 AVE API 持仓同步和真实交易执行
 */

const { TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { AbstractTradingEngine } = require('../core/AbstractTradingEngine');
const Decimal = require('decimal.js');
const BlockchainConfig = require('../../config/blockchainConfig');
const { WalletService } = require('../../services/WalletService');
const traderFactory = require('./traders');

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
    this._reserveNative = new Decimal(0.1);
    this._maxSlippage = 0.05;

    // 服务
    this._walletService = null;
    this._trader = null;
    this._fourMemeTrader = null;
    this._pancakeSwapTrader = null;
    this._monitoringTimer = null;

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

    // 初始化 WalletService
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
    console.log('✅ FourMeme 交易器初始化成功');

    // 初始化 PancakeSwap V2 交易器（用于出盘后代币的外部交易）
    this._pancakeSwapTrader = traderFactory.createTrader('pancakeswap-v2', traderConfig);
    await this._pancakeSwapTrader.setWallet(this._privateKey);
    console.log('✅ PancakeSwap V2 交易器初始化成功');

    // 设置默认交易器为 FourMeme（用于买入）
    this._trader = this._fourMemeTrader;

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
        console.warn('⚠️ Portfolio 为空，跳过持仓同步');
        return;
      }

      console.log(`🔄 持仓同步完成: ${walletBalances.length} 种代币`);

    } catch (error) {
      console.error(`❌ 持仓同步失败: ${error.message}`);
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
    try {
      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      // 使用真实交易器执行买入
      // FourMemeDirectTrader 使用 slippageTolerance (百分比格式，如 5 表示 5%)
      // PancakeSwapV2Trader 使用 slippage (小数格式，如 0.05 表示 5%)
      const buyOptions = {
        slippage: this._maxSlippage,
        slippageTolerance: this._maxSlippage * 100, // 转换为百分比
        gasPrice: this._experiment.config?.trading?.maxGasPrice || 10
      };

      const buyResult = await this._trader.buyToken(
        signal.tokenAddress,
        String(amountInBNB),
        buyOptions
      );

      if (!buyResult.success) {
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
      } else {
        // 交易器没有返回实际数量，使用价格估算
        actualPrice = signal.price || 0;
        actualTokenAmount = actualPrice > 0 ? amountInBNB / actualPrice : 0;
      }

      await this._portfolioManager.executeTrade(
        this._portfolioId,
        signal.tokenAddress,
        'buy',
        actualTokenAmount,
        actualPrice
      );

      // 更新卡牌分配
      const cards = parseInt(signal.cards) || 1;
      cardManager.afterBuy(signal.symbol, cards);

      const afterCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      return {
        success: true,
        tradeId: signalId,
        txHash: buyResult.transactionHash || buyResult.txHash,
        metadata: {
          ...metadata,
          txHash: buyResult.transactionHash || buyResult.txHash,
          cardPositionChange: {
            before: beforeCardState,
            after: afterCardState,
            transferredCards: cards
          }
        }
      };

    } catch (error) {
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
    try {
      const holding = this._getHolding(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }

      const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
      if (!cardManager) {
        return { success: false, reason: '卡牌管理器未初始化' };
      }

      const beforeCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

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

      // 1. 首先尝试使用 FourMeme 交易器（内盘）
      try {
        console.log(`🔄 尝试使用 FourMeme 交易器卖出 ${signal.symbol}...`);
        sellResult = await this._fourMemeTrader.sellToken(
          signal.tokenAddress,
          String(amountToSell),
          fourmemeOptions
        );

        if (sellResult.success) {
          traderUsed = 'fourmeme';
          console.log(`✅ FourMeme 交易器卖出成功`);
        } else {
          throw new Error(sellResult.error || 'FourMeme 交易失败');
        }
      } catch (fourmemeError) {
        console.warn(`⚠️ FourMeme 交易器卖出失败: ${fourmemeError.message}`);
        console.log(`🔄 尝试使用 PancakeSwap V2 交易器卖出 ${signal.symbol}...`);

        // 2. FourMeme 失败，尝试使用 PancakeSwap V2（外盘）
        try {
          sellResult = await this._pancakeSwapTrader.sellToken(
            signal.tokenAddress,
            String(amountToSell),
            pancakeOptions
          );

          if (sellResult.success) {
            traderUsed = 'pancakeswap-v2';
            console.log(`✅ PancakeSwap V2 交易器卖出成功`);
          } else {
            throw new Error(sellResult.error || 'PancakeSwap V2 交易失败');
          }
        } catch (pancakeError) {
          console.error(`❌ PancakeSwap V2 交易器也失败: ${pancakeError.message}`);
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

      // 更新卡牌分配
      const actualCards = sellAll ? beforeCardState.tokenCards : cardsToUse;
      cardManager.afterSell(signal.symbol, actualCards);

      const afterCardState = {
        bnbCards: cardManager.bnbCards,
        tokenCards: cardManager.tokenCards,
        totalCards: cardManager.totalCards
      };

      return {
        success: true,
        tradeId: signalId,
        txHash: sellResult.transactionHash || sellResult.txHash,
        metadata: {
          ...metadata,
          txHash: sellResult.transactionHash || sellResult.txHash,
          traderUsed: traderUsed,
          cardPositionChange: {
            before: beforeCardState,
            after: afterCardState,
            transferredCards: actualCards
          }
        }
      };

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
    const { TokenPool } = require('../../core/token-pool');
    const { StrategyEngine } = require('../../strategies/StrategyEngine');

    // 初始化 TokenPool
    this._tokenPool = new TokenPool();
    await this._tokenPool.initialize();

    // 初始化策略引擎
    const strategies = this._buildStrategyConfig();
    this._strategyEngine = new StrategyEngine({ strategies });

    const availableFactorIds = new Set([
      'age', 'currentPrice', 'collectionPrice', 'earlyReturn', 'buyPrice',
      'holdDuration', 'profitPercent',
      'highestPrice', 'highestPriceTimestamp', 'drawdownFromHighest',
      'txVolumeU24h', 'holders', 'tvl', 'fdv', 'marketCap'
    ]);

    this._strategyEngine.loadStrategies(strategies, availableFactorIds);
    console.log(`✅ 策略引擎初始化完成，加载了 ${this._strategyEngine.getStrategyCount()} 个策略`);

    // 初始化时序数据服务
    const { ExperimentTimeSeriesService } = require('../../web/services/ExperimentTimeSeriesService');
    this._timeSeriesService = new ExperimentTimeSeriesService();
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

    // 获取钱包余额
    const walletBalances = await this._walletService.getWalletBalances(
      this._walletAddress,
      this._blockchain
    );

    // 计算可用主币余额
    const nativeTokenInfo = BlockchainConfig.getNativeTokenInfo(this._blockchain);
    const nativeAddr = BlockchainConfig.normalizeTokenAddress(nativeTokenInfo.wrappedAddress, this._blockchain);
    let nativeBalance = new Decimal(0);

    for (const token of walletBalances) {
      const normalizedAddr = BlockchainConfig.normalizeTokenAddress(token.address, this._blockchain);
      if (normalizedAddr === nativeAddr) {
        nativeBalance = token.balance;
        break;
      }
    }

    const availableBalance = Decimal.max(0, nativeBalance.sub(this._reserveNative));

    console.log(`💰 钱包余额: 主币总额=${nativeBalance}, 保留=${this._reserveNative}, 可用=${availableBalance}`);

    // 创建投资组合
    await this._portfolioManager.createPortfolio(
      this._portfolioId,
      availableBalance,
      this._blockchain
    );

    // 初始化持仓
    for (const token of walletBalances) {
      const normalizedAddr = BlockchainConfig.normalizeTokenAddress(token.address, this._blockchain);
      if (normalizedAddr !== nativeAddr && token.balance.gt(0)) {
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
   * 监控循环
   * @private
   * @returns {Promise<void>}
   */
  async _monitoringCycle() {
    this._loopCount++;

    if (this._isStopped) {
      return;
    }

    try {
      // 同步真实持仓
      await this._syncHoldings();

      // 获取当前持仓
      const holdings = this._getAllHoldings();

      console.log(`💰 第 ${this._loopCount} 轮监控: ${holdings.length} 个持仓`);

      // 处理每个持仓
      for (const holding of holdings) {
        await this._processHolding(holding);
      }

      // 创建投资组合快照
      await this._createPortfolioSnapshot();

    } catch (error) {
      console.error(`❌ 监控循环失败: ${error.message}`);
    }
  }

  /**
   * 处理单个持仓
   * @private
   * @param {Object} holding - 持仓信息
   * @returns {Promise<void>}
   */
  async _processHolding(holding) {
    // 获取当前价格
    const currentPrice = await this._getCurrentPrice(holding.tokenAddress);

    if (!currentPrice || currentPrice <= 0) {
      console.warn(`⚠️ 无法获取 ${holding.symbol} 的当前价格`);
      return;
    }

    // 构建因子
    const factors = this._buildFactors(holding, currentPrice);

    // 评估策略
    const strategy = this._strategyEngine.evaluate(
      factors,
      holding.tokenAddress,
      Date.now(),
      {}
    );

    if (strategy && strategy.action === 'sell') {
      console.log(`📉 ${holding.symbol} 触发卖出策略: ${strategy.name}`);

      const signal = {
        action: 'sell',
        symbol: holding.symbol,
        tokenAddress: holding.tokenAddress,
        chain: this._blockchain,
        price: currentPrice,
        confidence: 80,
        reason: strategy.name,
        cards: strategy.cards || 'all'
      };

      await this.processSignal(signal);
    }
  }

  /**
   * 获取当前价格（优先 FourMeme，失败则尝试 PancakeSwap V2）
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<number>} 当前价格
   */
  async _getCurrentPrice(tokenAddress) {
    try {
      // 优先使用 FourMeme 交易器获取价格
      const price = await this._fourMemeTrader.getTokenPrice(tokenAddress);
      if (price && parseFloat(price) > 0) {
        return parseFloat(price);
      }
    } catch (fourmemeError) {
      console.debug(`⚠️ FourMeme 获取价格失败: ${fourmemeError.message}`);
    }

    // FourMeme 失败，尝试使用 PancakeSwap V2 获取价格
    try {
      const pancakePrice = await this._pancakeSwapTrader.getTokenPrice(tokenAddress);
      if (pancakePrice && parseFloat(pancakePrice) > 0) {
        console.log(`📊 使用 PancakeSwap V2 价格: ${pancakePrice}`);
        return parseFloat(pancakePrice);
      }
    } catch (pancakeError) {
      console.debug(`⚠️ PancakeSwap V2 获取价格也失败: ${pancakeError.message}`);
    }

    console.error(`❌ 所有价格源均失败 [${tokenAddress}]`);
    return 0;
  }

  /**
   * 构建因子
   * @private
   * @param {Object} holding - 持仓信息
   * @param {number} currentPrice - 当前价格
   * @returns {Object} 因子对象
   */
  _buildFactors(holding, currentPrice) {
    const buyPrice = holding.avgBuyPrice || 0;
    const profitPercent = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice * 100) : 0;

    return {
      currentPrice: currentPrice,
      buyPrice: buyPrice,
      profitPercent: profitPercent,
      holdDuration: holding.holdDuration || 0,
      highestPrice: holding.highestPrice || currentPrice,
      drawdownFromHighest: holding.highestPrice > 0 ? ((currentPrice - holding.highestPrice) / holding.highestPrice * 100) : 0
    };
  }

  /**
   * 计算买入金额（Live 特有：使用卡牌管理器）
   * @protected
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   */
  _calculateBuyAmount(signal) {
    const cardManager = this._tokenPool.getCardPositionManager(signal.tokenAddress, signal.chain);
    if (cardManager) {
      const cards = signal.cards || 1;
      const amount = cardManager.calculateBuyAmount(cards);
      if (amount > 0) {
        return amount;
      }
    }

    // 默认使用可用余额的 20%
    const portfolio = this._portfolioManager.getPortfolio(this._portfolioId);
    const tradeAmount = portfolio.availableBalance.mul(0.2);

    return tradeAmount.toNumber();
  }

  /**
   * 停止引擎（覆盖基类方法）
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._isStopped) {
      return;
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
   * 构建默认策略（覆盖基类方法，Live 特有实现）
   * @protected
   * @returns {Object} 默认策略配置
   */
  _buildDefaultStrategies() {
    const config = this._experiment?.config || {};
    const strategyConfig = config.strategy || {};

    const takeProfit1 = strategyConfig.takeProfit1 !== undefined ? strategyConfig.takeProfit1 : 30;
    const takeProfit2 = strategyConfig.takeProfit2 !== undefined ? strategyConfig.takeProfit2 : 50;
    const stopLossMinutes = strategyConfig.stopLossMinutes !== undefined ? strategyConfig.stopLossMinutes : 5;

    const stopLossSeconds = stopLossMinutes * 60;

    console.log('⚠️ 使用默认实盘策略（止盈+止损）');

    return {
      take_profit_1: {
        id: 'take_profit_1',
        name: `止盈1 (${takeProfit1}%)`,
        action: 'sell',
        priority: 1,
        cooldown: 30,
        enabled: true,
        cards: 'all',
        maxExecutions: 1,
        condition: `profitPercent >= ${takeProfit1} AND holdDuration > 0`
      },
      take_profit_2: {
        id: 'take_profit_2',
        name: `止盈2 (${takeProfit2}%)`,
        action: 'sell',
        priority: 2,
        cooldown: 30,
        enabled: true,
        cards: 'all',
        maxExecutions: 1,
        condition: `profitPercent >= ${takeProfit2} AND holdDuration > 0`
      },
      stop_loss: {
        id: 'stop_loss',
        name: `时间止损 (${stopLossMinutes}分钟)`,
        action: 'sell',
        priority: 10,
        cooldown: 60,
        enabled: true,
        cards: 'all',
        maxExecutions: 1,
        condition: `holdDuration >= ${stopLossSeconds} AND profitPercent <= 0`
      }
    };
  }
}

module.exports = { LiveTradingEngine };
