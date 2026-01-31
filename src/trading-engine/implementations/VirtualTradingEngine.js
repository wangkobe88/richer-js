/**
 * 虚拟交易引擎 - 简化版
 * 用于 fourmeme 交易实验的虚拟交易模拟
 */

const { ITradingEngine, TradingMode, EngineStatus } = require('../interfaces/ITradingEngine');
const { Experiment, Trade, TradeSignal, TradeStatus } = require('../entities');
const { ExperimentFactory } = require('../factories/ExperimentFactory');
const { ExperimentDataService } = require('../../web/services/ExperimentDataService');
const { dbManager } = require('../../services/dbManager');
const Logger = require('../../services/logger');

/**
 * 虚拟交易引擎
 * @class
 * @implements ITradingEngine
 */
class VirtualTradingEngine {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {number} config.initialBalance - 初始余额 (默认 100 BNB)
   */
  constructor(config = {}) {
    this._id = `virtual_${Date.now()}`;
    this._name = 'Fourmeme Virtual Trading Engine';
    this._mode = TradingMode.VIRTUAL;
    this._status = EngineStatus.STOPPED;

    // 实验相关
    this._experiment = null;
    this._experimentId = null;

    // 虚拟资金管理
    this.initialBalance = config.initialBalance || 100; // BNB
    this.currentBalance = this.initialBalance;
    this.holdings = new Map(); // tokenAddress -> { amount, avgBuyPrice }

    // 统计信息
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalSignals: 0,
      executedSignals: 0
    };

    // 服务
    this.dataService = new ExperimentDataService();
    this.logger = new Logger({ dir: './logs' });

    // 数据库客户端
    this.supabase = dbManager.getClient();

    console.log(`🎮 虚拟交易引擎已创建: ${this.id}, 初始余额: ${this.initialBalance} BNB`);
  }

  // Getter 方法 - 返回私有属性
  get id() { return this._id; }
  get name() { return this._name; }
  get mode() { return this._mode; }
  get status() { return this._status; }
  get experiment() { return this._experiment; }

  /**
   * 初始化引擎
   * @param {Experiment|string} experimentOrId - 实验实体或实验ID
   * @returns {Promise<void>}
   */
  async initialize(experimentOrId) {
    try {
      // 加载或创建实验
      if (typeof experimentOrId === 'string') {
        // 加载现有实验
        const factory = ExperimentFactory.getInstance();
        this._experiment = await factory.load(experimentOrId);
        if (!this._experiment) {
          throw new Error(`实验不存在: ${experimentOrId}`);
        }
      } else if (experimentOrId instanceof Experiment) {
        // 使用提供的实验
        this._experiment = experimentOrId;
      } else {
        throw new Error('无效的实验参数');
      }

      this._experimentId = this._experiment.id;

      // 从实验配置中获取初始余额
      if (this._experiment.config?.virtual?.initialBalance) {
        this.initialBalance = this._experiment.config.virtual.initialBalance;
        this.currentBalance = this.initialBalance;
      }

      // 加载持仓数据
      await this._loadHoldings();

      this._status = EngineStatus.STOPPED;

      console.log(`✅ 虚拟交易引擎初始化完成: 实验 ${this._experimentId}`);
      this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎初始化完成', {
        initialBalance: this.initialBalance,
        currentBalance: this.currentBalance,
        holdingsCount: this.holdings.size
      });

    } catch (error) {
      console.error('❌ 虚拟交易引擎初始化失败:', error.message);
      this._status = EngineStatus.ERROR;
      throw error;
    }
  }

  /**
   * 启动引擎
   * @returns {Promise<void>}
   */
  async start() {
    if (this._status === EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎已在运行');
      return;
    }

    this._status = EngineStatus.RUNNING;

    // 更新实验状态
    if (this._experiment) {
      this._experiment.start();
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'running');
    }

    console.log(`🚀 虚拟交易引擎已启动: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已启动');
  }

  /**
   * 停止引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._status === EngineStatus.STOPPED) {
      console.warn('⚠️ 引擎已停止');
      return;
    }

    this._status = EngineStatus.STOPPED;

    // 更新实验状态
    if (this._experiment) {
      this._experiment.stop('stopped');
      const factory = ExperimentFactory.getInstance();
      await factory.updateStatus(this._experimentId, 'stopped');
    }

    console.log(`🛑 虚拟交易引擎已停止: 实验 ${this._experimentId}`);
    this.logger.info(this._experimentId, 'VirtualTradingEngine', '引擎已停止', {
      metrics: this.metrics
    });
  }

  /**
   * 处理策略信号
   * @param {Object} signal - 策略信号
   * @returns {Promise<Object>} 处理结果
   */
  async processSignal(signal) {
    if (this._status !== EngineStatus.RUNNING) {
      console.warn('⚠️ 引擎未运行，忽略信号');
      return { executed: false, reason: '引擎未运行' };
    }

    this.metrics.totalSignals++;

    // 记录信号到数据库
    const tradeSignal = TradeSignal.fromStrategySignal(signal, this._experimentId);
    await this.dataService.saveSignal(tradeSignal);

    console.log(`📊 收到信号: ${signal.action} ${signal.symbol} (${signal.tokenAddress})`);
    console.log(`   原因: ${signal.reason}`);
    console.log(`   置信度: ${signal.confidence}%`);

    // 根据信号类型执行交易
    let tradeResult = null;
    if (signal.action === 'buy') {
      tradeResult = await this._executeBuy(signal);
    } else if (signal.action === 'sell') {
      tradeResult = await this._executeSell(signal);
    } else {
      console.log(`ℹ️ 忽略 hold 信号: ${signal.symbol}`);
      return { executed: false, reason: 'hold信号' };
    }

    if (tradeResult && tradeResult.success) {
      this.metrics.executedSignals++;
    }

    return tradeResult;
  }

  /**
   * 执行买入交易
   * @param {Object} signal - 买入信号
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeBuy(signal) {
    try {
      const amountInBNB = this._calculateBuyAmount(signal);
      if (amountInBNB <= 0) {
        return { success: false, reason: '余额不足或计算金额为0' };
      }

      const price = signal.price || signal.buyPrice || 0;
      const tokenAmount = price > 0 ? amountInBNB / price : 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'buy',
        amount: tokenAmount,
        price: price
      };

      const result = await this.executeTrade(tradeRequest);

      if (result.success) {
        console.log(`✅ 买入成功: ${signal.symbol} 数量=${tokenAmount.toFixed(6)}, 价格=${price}`);
      }

      return result;

    } catch (error) {
      console.error(`❌ 买入失败: ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  /**
   * 执行卖出交易
   * @param {Object} signal - 卖出信号
   * @returns {Promise<Object>} 交易结果
   * @private
   */
  async _executeSell(signal) {
    try {
      const holding = this.holdings.get(signal.tokenAddress);
      if (!holding || holding.amount <= 0) {
        return { success: false, reason: '无持仓' };
      }

      // 卖出全部持仓
      const amountToSell = holding.amount;
      const price = signal.price || 0;
      const amountOutBNB = price > 0 ? amountToSell * price : 0;

      const tradeRequest = {
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        direction: 'sell',
        amount: amountToSell,
        price: price
      };

      const result = await this.executeTrade(tradeRequest);

      if (result.success) {
        console.log(`✅ 卖出成功: ${signal.symbol} 数量=${amountToSell.toFixed(6)}, 收入=${amountOutBNB.toFixed(4)} BNB`);
      }

      return result;

    } catch (error) {
      console.error(`❌ 卖出失败: ${error.message}`);
      return { success: false, reason: error.message };
    }
  }

  /**
   * 计算买入金额
   * @param {Object} signal - 信号
   * @returns {number} BNB金额
   * @private
   */
  _calculateBuyAmount(signal) {
    // 默认每次使用当前余额的10%
    const tradeRatio = this._experiment.config?.virtual?.tradeRatio || 0.1;
    const amount = this.currentBalance * tradeRatio;

    // 最小交易金额 0.001 BNB
    return Math.max(amount, 0.001);
  }

  /**
   * 执行交易
   * @param {Object} tradeRequest - 交易请求
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(tradeRequest) {
    this.metrics.totalTrades++;

    const trade = Trade.fromVirtualTrade({
      tokenAddress: tradeRequest.tokenAddress,
      symbol: tradeRequest.symbol,
      chain: this._experiment.blockchain || 'bsc',
      direction: tradeRequest.direction,
      amount: tradeRequest.amount,
      price: tradeRequest.price,
      success: false, // 先设置为false，执行成功后再更新
      error: null
    }, this._experimentId);

    try {
      if (tradeRequest.direction === 'buy') {
        await this._processBuy(trade);
      } else if (tradeRequest.direction === 'sell') {
        await this._processSell(trade);
      }

      trade.markAsSuccess();
      this.metrics.successfulTrades++;

      // 保存交易记录
      await this.dataService.saveTrade(trade);

      return {
        success: true,
        trade: trade.toJSON(),
        balance: this.currentBalance,
        holdings: Array.from(this.holdings.entries())
      };

    } catch (error) {
      trade.markAsFailed(error.message);
      this.metrics.failedTrades++;

      // 保存失败交易记录
      await this.dataService.saveTrade(trade);

      return {
        success: false,
        error: error.message,
        trade: trade.toJSON()
      };
    }
  }

  /**
   * 处理买入
   * @param {Trade} trade - 交易实体
   * @private
   */
  async _processBuy(trade) {
    const cost = parseFloat(trade.price) * parseFloat(trade.amount);
    const costWithFee = cost * 1.001; // 0.1% 手续费

    if (costWithFee > this.currentBalance) {
      throw new Error(`余额不足: 需要 ${costWithFee.toFixed(4)} BNB, 可用 ${this.currentBalance.toFixed(4)} BNB`);
    }

    // 扣除余额
    this.currentBalance -= costWithFee;

    // 更新持仓
    const holding = this.holdings.get(trade.tokenAddress) || { amount: 0, avgBuyPrice: 0 };
    const totalCost = holding.amount * holding.avgBuyPrice + cost;
    holding.amount += parseFloat(trade.amount);
    holding.avgBuyPrice = totalCost / holding.amount;
    this.holdings.set(trade.tokenAddress, holding);

    console.log(`💰 买入执行: ${trade.tokenSymbol} ${trade.amount.toFixed(6)} @ ${trade.price}, 耗费 ${costWithFee.toFixed(4)} BNB`);
    console.log(`   当前余额: ${this.currentBalance.toFixed(4)} BNB`);
  }

  /**
   * 处理卖出
   * @param {Trade} trade - 交易实体
   * @private
   */
  async _processSell(trade) {
    const revenue = parseFloat(trade.price) * parseFloat(trade.amount);
    const revenueWithFee = revenue * 0.999; // 0.1% 手续费

    // 增加余额
    this.currentBalance += revenueWithFee;

    // 更新持仓
    const holding = this.holdings.get(trade.tokenAddress);
    if (holding) {
      holding.amount -= parseFloat(trade.amount);
      if (holding.amount <= 0.000001) {
        this.holdings.delete(trade.tokenAddress);
      } else {
        this.holdings.set(trade.tokenAddress, holding);
      }
    }

    // 计算盈亏
    const pnl = revenue - (holding.avgBuyPrice * parseFloat(trade.amount));
    const pnlPercentage = (pnl / (holding.avgBuyPrice * parseFloat(trade.amount))) * 100;

    console.log(`💰 卖出执行: ${trade.tokenSymbol} ${trade.amount.toFixed(6)} @ ${trade.price}, 收入 ${revenueWithFee.toFixed(4)} BNB`);
    console.log(`   盈亏: ${pnl.toFixed(4)} BNB (${pnlPercentage.toFixed(2)}%)`);
    console.log(`   当前余额: ${this.currentBalance.toFixed(4)} BNB`);
  }

  /**
   * 加载持仓数据
   * @private
   */
  async _loadHoldings() {
    try {
      const trades = await this.dataService.getTrades(this._experimentId, {
        limit: 10000
      });

      // 重置持仓
      this.holdings.clear();
      this.currentBalance = this.initialBalance;

      // 按时间顺序重放交易
      for (const trade of trades.sort((a, b) => a.createdAt - b.createdAt)) {
        if (!trade.success) continue;

        if (trade.direction === 'buy') {
          const cost = parseFloat(trade.price) * parseFloat(trade.amount) * 1.001;
          this.currentBalance -= cost;

          const holding = this.holdings.get(trade.tokenAddress) || { amount: 0, avgBuyPrice: 0 };
          const totalCost = holding.amount * holding.avgBuyPrice + cost;
          holding.amount += parseFloat(trade.amount);
          holding.avgBuyPrice = totalCost / holding.amount;
          this.holdings.set(trade.tokenAddress, holding);

        } else if (trade.direction === 'sell') {
          const revenue = parseFloat(trade.price) * parseFloat(trade.amount) * 0.999;
          this.currentBalance += revenue;

          const holding = this.holdings.get(trade.tokenAddress);
          if (holding) {
            holding.amount -= parseFloat(trade.amount);
            if (holding.amount <= 0.000001) {
              this.holdings.delete(trade.tokenAddress);
            }
          }
        }
      }

      console.log(`📦 持仓加载完成: ${this.holdings.size} 个代币, 余额 ${this.currentBalance.toFixed(4)} BNB`);

    } catch (error) {
      console.error('❌ 加载持仓失败:', error.message);
    }
  }

  /**
   * 获取状态
   * @returns {string}
   */
  getStatus() {
    return this._status;
  }

  /**
   * 获取指标
   * @returns {Object}
   */
  getMetrics() {
    const profit = this.currentBalance - this.initialBalance;
    const profitRate = (profit / this.initialBalance) * 100;

    return {
      ...this.metrics,
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      profit: profit,
      profitRate: profitRate,
      holdingsCount: this.holdings.size,
      holdings: Array.from(this.holdings.entries()).map(([addr, h]) => ({
        tokenAddress: addr,
        amount: h.amount,
        avgBuyPrice: h.avgBuyPrice
      }))
    };
  }

  /**
   * 保存运行时指标
   * @param {string} metricName - 指标名称
   * @param {number} metricValue - 指标值
   */
  async saveMetric(metricName, metricValue) {
    await this.dataService.saveRuntimeMetric(
      this._experimentId,
      metricName,
      metricValue,
      { timestamp: new Date().toISOString() }
    );
  }
}

module.exports = { VirtualTradingEngine };
