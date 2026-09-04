/**
 * 投资组合管理器实现
 * 提供完整的投资组合管理功能
 *
 * ====================== 模块分工说明 ======================
 *
 * PortfolioManager 职责：
 * 1. 投资组合生命周期管理 - 创建、更新、删除投资组合
 * 2. 交易执行核心逻辑 - 买卖交易、持仓更新、现金余额管理
 * 3. 价值计算和性能指标 - 持仓价值、盈亏计算、风险指标
 * 4. 风险控制 - 止损止盈、余额检查、持仓限制
 * 5. 持仓快照管理（内部状态跟踪）
 * 6. 资产配置分析和再平衡建议
 *
 * 与其他模块的关系：
 * - BacktestTradingEngine: 通过接口调用，专注回测流程控制
 * - TradingEngine: 实时交易引擎调用，处理实际交易
 * - ExperimentStorage: 仅用于数据持久化，不影响核心逻辑
 *
 * 设计原则：
 * - 业务逻辑独立性：不依赖具体的交易场景（回测/实盘）
 * - 时间适配性：支持时间适配器，可用于回测场景
 * - 数据一致性：所有投资组合操作通过此模块，确保状态一致
 * - 事件驱动：通过事件机制通知外部状态变化
 * ===========================================================
 */

const Decimal = require('decimal.js');
const { IPortfolioManager } = require('../interfaces/IPortfolio');
const { PortfolioCalculator } = require('../calculators/PortfolioCalculator');
const { PortfolioTracker } = require('../trackers/PortfolioTracker');
const EventEmitter = require('events');

/**
 * 投资组合管理器实现类
 * @class
 * @extends IPortfolioManager
 * @extends EventEmitter
 */
class PortfolioManager extends IPortfolioManager {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   * @param {Array} options.targetTokens - 目标代币配置
   * @param {string} options.blockchain - 区块链ID（可选，用于地址规范化）
   */
  constructor(options = {}) {
    super();

    // 初始化事件发射器功能
    this._events = new Map();

    /** @type {Decimal} 零值 */
    this.ZERO = new Decimal(0);

    /** @type {Object} 日志记录器 */
    this.logger = console;

    /** @type {Map<string, Object>} 投资组合映射 */
    this.portfolios = new Map();

    /** @type {number} 下一个投资组合ID */
    this.nextPortfolioId = 1;

    /** @type {PortfolioCalculator} 投资组合计算器 */
    this.calculator = new PortfolioCalculator();

    /** @type {PortfolioTracker} 投资组合跟踪器 */
    this.tracker = new PortfolioTracker({
      autoSnapshot: false,
      persistenceEnabled: false
    });

    /**
     * 时间适配器 - 支持回测场景下的自定义时间
     * 在实时交易中使用系统时间，在回测中使用模拟时间
     * @type {Function|null}
     */
    this.timeAdapter = null;

    /** @type {Array} 目标代币配置（用于获取代币Symbol） */
    this._targetTokens = options.targetTokens || [];

    /** @type {string} 区块链ID（用于地址规范化） */
    this._blockchain = options.blockchain || 'bsc'; // 默认BSC

    // 监听跟踪器事件
    this.tracker.on('snapshot_created', (data) => {
      this.emit('snapshot_created', data);
    });

    this.tracker.on('value_changed', (data) => {
      this.emit('value_changed', data);
    });
  }

  /**
   * 设置时间适配器（用于回测场景）
   * @param {Function} timeAdapter - 时间适配器函数，返回当前时间戳
   */
  setTimeAdapter(timeAdapter) {
    this.timeAdapter = timeAdapter;
  }

  /**
   * 获取当前时间戳（支持时间适配器）
   * @returns {number} 时间戳
   * @private
   */
  _getCurrentTimestamp() {
    return this.timeAdapter ? this.timeAdapter() : Date.now();
  }

  /**
   * 规范化代币地址（用于 Map 键）
   * 对于 EVM 链（BSC、ETH等），地址转为小写
   * @param {string} tokenAddress - 代币地址
   * @returns {string} 规范化后的地址
   * @private
   */
  _normalizeAddress(tokenAddress) {
    // 简化版：统一转为小写
    return tokenAddress.toLowerCase();
  }

  /**
   * 创建投资组合
   * @param {Decimal} initialCash - 初始现金
   * @param {Object} config - 配置
   * @returns {Promise<string>} 投资组合ID
   */
  async createPortfolio(initialCash, config) {
    try {
      this.validateConfig(config);

      const portfolioId = this.generatePortfolioId();
      const now = this._getCurrentTimestamp();

      const portfolio = {
        id: portfolioId,
        cashBalance: new Decimal(initialCash),
        totalValue: new Decimal(initialCash),
        positions: new Map(),
        config: { ...config },
        metadata: {
          ...config,
          createdAt: now,
          updatedAt: now,
          initialBalance: new Decimal(initialCash)
        },
        trades: [],
        stopLoss: config.stopLoss || 10, // 默认10%止损
        takeProfit: config.takeProfit || 50, // 默认50%止盈
        createdAt: now,
        lastUpdated: now,
        status: 'active'
      };

      this.portfolios.set(portfolioId, portfolio);

      // 创建初始快照
      await this.createSnapshot(portfolioId);

      // 设置为当前投资组合（如果还没有设置）
      if (!this.currentPortfolioId) {
        this.currentPortfolioId = portfolioId;
      }

      this.logger.info(`投资组合创建成功: ${portfolioId}, 初始金额: ${initialCash.toString()}`);
      this.emit('portfolio_created', { portfolioId, initialCash, config });

      return portfolioId;

    } catch (error) {
      this.logger.error('创建投资组合失败:', error);
      throw error;
    }
  }

  /**
   * 设置初始持仓（用于实盘交易初始化）
   * @param {string} portfolioId - 投资组合ID
   * @param {Array<{tokenAddress: string, amount: Decimal, price: Decimal, pnl?: Object}>} initialPositions - 初始持仓列表
   * @returns {Promise<void>}
   */
  async setInitialPositions(portfolioId, initialPositions) {
    try {
      const portfolio = this.portfolios.get(portfolioId);
      if (!portfolio) {
        throw new Error(`Portfolio ${portfolioId} not found`);
      }

      if (!initialPositions || initialPositions.length === 0) {
        this.logger.info(`没有初始持仓需要设置 (${portfolioId})`);
        return;
      }

      this.logger.info(`开始设置初始持仓 (${portfolioId}), 持仓数量: ${initialPositions.length}`);

      for (const pos of initialPositions) {
        const { tokenAddress, amount, price, pnl } = pos;
        const tokenAmount = new Decimal(amount);
        const tokenPrice = new Decimal(price);
        const tokenValue = tokenAmount.mul(tokenPrice);

        // 设置初始持仓
        const normalizedAddress = this._normalizeAddress(tokenAddress);
        portfolio.positions.set(normalizedAddress, {
          tokenAddress: normalizedAddress,
          tokenSymbol: this.getTokenSymbol(tokenAddress),
          blockchain: this.getTokenBlockchain(tokenAddress),
          amount: tokenAmount,
          averagePrice: tokenPrice,
          currentPrice: tokenPrice,
          value: tokenValue,
          winRate: 0,
          trades: 0,
          lastUpdated: Date.now(),
          // 🔥 新增：BNB 耗费追踪（初始持仓）
          totalCost: tokenValue,
          totalBuyAmount: tokenAmount,
          totalBuyValue: tokenValue,
          // ✅ AVE PNL数据（如果提供）
          pnl: pnl || null
        });

        this.logger.info(`初始持仓已添加: ${tokenAddress}, 数量: ${tokenAmount}, 价格: ${tokenPrice}`);
      }

      // 更新投资组合总价值
      await this.updatePositionsValue(portfolioId);

      this.logger.info(`初始持仓设置完成 (${portfolioId}), 持仓种类: ${initialPositions.length}`);

    } catch (error) {
      this.logger.error(`设置初始持仓失败 (${portfolioId}):`, error);
      throw error;
    }
  }

  /**
   * 获取投资组合快照
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object|null>} 快照对象
   */
  async getSnapshot(portfolioId) {
    try {
      const portfolio = this.portfolios.get(portfolioId);
      if (!portfolio) {
        return null;
      }

      // 更新持仓价值
      await this.updatePositionsValue(portfolioId);

      const snapshot = await this.createSnapshot(portfolioId);
      return snapshot;

    } catch (error) {
      this.logger.error(`获取快照失败 (${portfolioId}):`, error);
      return null;
    }
  }

  /**
   * 更新持仓
   * @param {string} portfolioId - 投资组合ID
   * @param {string} tokenAddress - 代币地址
   * @param {Decimal} amount - 数量
   * @param {Decimal} price - 价格
   * @param {'buy'|'sell'} type - 类型
   * @returns {Promise<void>}
   */
  async updatePosition(portfolioId, tokenAddress, amount, price, type) {
    try {
      const portfolio = this.portfolios.get(portfolioId);
      if (!portfolio) {
        throw new Error(`投资组合不存在: ${portfolioId}`);
      }

      // 🔥 根据区块链类型规范化地址（EVM用小写，Solana保持原样）
      const normalizedAddress = this._normalizeAddress(tokenAddress);

      const tradeAmount = new Decimal(amount);
      const tradePrice = new Decimal(price);
      const tradeValue = tradeAmount.mul(tradePrice);

      // 计算手续费（简化版）
      const feeRate = 0.001; // 0.1%
      const fee = tradeValue.mul(feeRate);

      if (type === 'buy') {
        // 买入操作
        if (portfolio.cashBalance.lt(tradeValue.add(fee))) {
          throw new Error('现金余额不足');
        }

        portfolio.cashBalance = portfolio.cashBalance.sub(tradeValue.add(fee));

        const existingPosition = portfolio.positions.get(normalizedAddress);
        if (existingPosition) {
          // 更新现有持仓
          const totalAmount = existingPosition.amount.add(tradeAmount);
          const totalCost = existingPosition.amount.mul(existingPosition.averagePrice).add(tradeValue);
          const newAveragePrice = totalCost.div(totalAmount);

          existingPosition.amount = totalAmount;
          existingPosition.averagePrice = newAveragePrice;
          existingPosition.lastUpdated = Date.now();

          // 🔥 累加实验交易成本（只累加本实验买入的）
          if (existingPosition.totalBuyValue) {
            existingPosition.totalBuyValue = existingPosition.totalBuyValue.add(tradeValue);
          } else {
            existingPosition.totalBuyValue = tradeValue;
          }
          if (existingPosition.totalBuyAmount) {
            existingPosition.totalBuyAmount = existingPosition.totalBuyAmount.add(tradeAmount);
          } else {
            existingPosition.totalBuyAmount = tradeAmount;
          }
        } else {
          // 创建新持仓（纯实验买入，无初始持仓）
          portfolio.positions.set(normalizedAddress, {
            tokenAddress: normalizedAddress,  // 🔥 使用小写地址
            tokenSymbol: this.getTokenSymbol(tokenAddress),
            blockchain: this.getTokenBlockchain(tokenAddress),
            amount: tradeAmount,
            averagePrice: tradePrice,
            currentPrice: tradePrice,
            value: tradeValue,
            // ❌ 删除：本地PNL字段初始化，使用AVE PNL数据
            // valueChange, valueChangePercent, unrealizedPnL, realizedPnL, totalPnL
            winRate: 0,
            trades: 1,
            lastUpdated: Date.now(),
            // 🔥 实验交易相关字段
            initialAmount: new Decimal(0),
            initialValue: new Decimal(0),
            totalBuyValue: tradeValue,
            totalBuyAmount: tradeAmount,
            // ✅ AVE PNL数据（如果提供）
            pnl: null
          });
        }

      } else if (type === 'hold') {
        // 持仓同步（用于实盘交易同步现有持仓，不扣除现金余额）
        const existingPosition = portfolio.positions.get(normalizedAddress);
        if (existingPosition) {
          // 更新现有持仓的数量和价格
          existingPosition.amount = tradeAmount;
          existingPosition.averagePrice = tradePrice;
          existingPosition.currentPrice = tradePrice;
          existingPosition.value = tradeValue;
          existingPosition.lastUpdated = Date.now();
        } else {
          // 创建新持仓记录（现有持仓，不是通过本实验买入的）
          portfolio.positions.set(normalizedAddress, {
            tokenAddress: normalizedAddress,
            tokenSymbol: this.getTokenSymbol(tokenAddress),
            blockchain: this.getTokenBlockchain(tokenAddress),
            amount: tradeAmount,
            averagePrice: tradePrice,
            currentPrice: tradePrice,
            value: tradeValue,
            // 🔥 实验交易相关字段（初始持仓标记）
            initialAmount: tradeAmount,
            initialValue: tradeValue,
            totalBuyValue: new Decimal(0),  // 不是通过本实验买入的
            totalBuyAmount: new Decimal(0),
            // ✅ AVE PNL数据（如果提供）
            pnl: null,
            lastUpdated: Date.now()
          });
        }

      } else if (type === 'sell') {
        // 卖出操作
        const existingPosition = portfolio.positions.get(normalizedAddress);
        if (!existingPosition || existingPosition.amount.lt(tradeAmount)) {
          throw new Error('持仓数量不足');
        }

        // ❌ 删除：本地realizedPnL计算，使用AVE PNL数据
        // AVE API会返回realized_profit数据

        portfolio.cashBalance = portfolio.cashBalance.add(tradeValue.sub(fee));

        // 更新持仓
        const remainingAmount = existingPosition.amount.sub(tradeAmount);
        if (remainingAmount.eq(0)) {
          // 完全卖出
          portfolio.positions.delete(normalizedAddress);  // 🔥 使用小写地址
        } else {
          // 部分卖出
          existingPosition.amount = remainingAmount;
          // ❌ 删除：本地realizedPnL累加，使用AVE PNL数据
          existingPosition.trades += 1;
          existingPosition.lastUpdated = Date.now();
        }
      }

      portfolio.lastUpdated = Date.now();

      // 记录交易
      const trade = {
        id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: this._getCurrentTimestamp(),
        tokenAddress: normalizedAddress,  // 🔥 使用小写地址
        tokenSymbol: this.getTokenSymbol(tokenAddress),
        blockchain: this.getTokenBlockchain(tokenAddress),
        type,
        amount: tradeAmount,
        price: tradePrice,
        value: tradeValue,
        fee,
        slippage: this.ZERO, // 简化处理
        metadata: {
          portfolioId
        }
      };

      portfolio.trades.push(trade);

      // 创建快照
      await this.createSnapshot(portfolioId);

      this.emit('position_updated', {
        portfolioId,
        tokenAddress: normalizedAddress,  // 🔥 使用小写地址
        type,
        amount: tradeAmount,
        price: tradePrice,
        trade
      });

    } catch (error) {
      this.logger.error(`更新持仓失败 (${portfolioId}):`, error);
      throw error;
    }
  }

  /**
   * 获取所有持仓
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Map<string, Object>>} 持仓映射
   */
  async getPositions(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return new Map();
    }

    // 更新持仓价值
    await this.updatePositionsValue(portfolioId);

    return new Map(portfolio.positions);
  }

  /**
   * 获取资产配置
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Array<Object>>} 资产配置数组
   */
  async getAssetAllocation(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return [];
    }

    await this.updatePositionsValue(portfolioId);

    const totalValue = portfolio.totalValue;
    const targetAllocation = portfolio.config.targetAllocation || {};

    return this.calculator.calculateAssetAllocation(
      portfolio.positions,
      totalValue,
      targetAllocation
    );
  }

  /**
   * 计算投资组合价值
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Decimal>} 总价值
   */
  async calculatePortfolioValue(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return this.ZERO;
    }

    await this.updatePositionsValue(portfolioId);
    return portfolio.totalValue;
  }

  /**
   * 获取性能指标
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'|'allTime'} [timeframe] - 时间框架
   * @returns {Promise<Object>} 性能指标
   */
  async getPerformanceMetrics(portfolioId, timeframe = 'allTime') {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return this.calculator.getDefaultMetrics();
    }

    const snapshots = await this.tracker.getSnapshots(portfolioId);
    const trades = portfolio.trades;

    return this.calculator.calculatePerformanceMetrics(snapshots, trades, { timeframe });
  }

  /**
   * 获取风险指标
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 风险指标
   */
  async getRiskMetrics(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return {
        valueAtRisk: this.ZERO,
        expectedShortfall: this.ZERO,
        beta: this.ZERO,
        alpha: this.ZERO,
        standardDeviation: this.ZERO,
        correlationMatrix: {},
        concentrationRisk: this.ZERO,
        positionCount: 0,
        maxPositionSize: this.ZERO,
        diversificationScore: 0
      };
    }

    await this.updatePositionsValue(portfolioId);

    const snapshots = await this.tracker.getSnapshots(portfolioId);
    const positions = Array.from(portfolio.positions.values());

    return this.calculator.calculateRiskMetrics(positions, snapshots);
  }

  /**
   * 分析重新平衡需求
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Array<Object>>} 重新平衡建议
   */
  async analyzeRebalanceNeeds(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return [];
    }

    const allocation = await this.getAssetAllocation(portfolioId);
    const recommendations = [];

    for (const item of allocation) {
      if (item.deviation.abs().gt(portfolio.config.rebalanceThreshold || 5)) {
        const suggestedValue = portfolio.totalValue.mul(item.targetPercentage).div(100);
        const currentAmount = item.value.div(item.currentPrice || 1);
        const targetAmount = suggestedValue.div(item.currentPrice || 1);
        const suggestedAmount = targetAmount.sub(currentAmount);

        recommendations.push({
          tokenAddress: item.tokenAddress,
          tokenSymbol: item.tokenSymbol,
          action: item.action,
          currentPercentage: item.currentPercentage,
          targetPercentage: item.targetPercentage,
          deviation: item.deviation,
          suggestedAmount,
          suggestedValue,
          priority: item.deviation.abs().toNumber(),
          reason: `当前配置 ${item.currentPercentage.toFixed(2)}% 与目标配置 ${item.targetPercentage}% 偏差 ${item.deviation.abs().toFixed(2)}%`
        });
      }
    }

    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 执行重新平衡
   * @param {string} portfolioId - 投资组合ID
   * @param {Array<Object>} recommendations - 重新平衡建议
   * @returns {Promise<Array<string>>} 交易ID列表
   */
  async executeRebalance(portfolioId, recommendations) {
    const tradeIds = [];

    for (const rec of recommendations) {
      if (rec.suggestedAmount.eq(0)) continue;

      try {
        const tradeId = `rebalance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 这里应该调用实际的交易执行逻辑
        // 现在只是模拟交易记录
        const portfolio = this.portfolios.get(portfolioId);
        if (portfolio) {
          portfolio.trades.push({
            id: tradeId,
            timestamp: this._getCurrentTimestamp(),
            tokenAddress: rec.tokenAddress,
            tokenSymbol: rec.tokenSymbol,
            blockchain: this.getTokenBlockchain(rec.tokenAddress),
            type: rec.action,
            amount: rec.suggestedAmount.abs(),
            price: rec.currentPrice || new Decimal(1),
            value: rec.suggestedValue,
            fee: rec.suggestedValue.mul(0.001),
            metadata: {
              portfolioId,
              rebalance: true,
              reason: rec.reason
            }
          });
        }

        tradeIds.push(tradeId);

      } catch (error) {
        this.logger.error(`执行重新平衡失败 (${rec.tokenAddress}):`, error);
      }
    }

    return tradeIds;
  }

  /**
   * 记录交易
   * @param {Object} trade - 交易记录
   * @returns {Promise<void>}
   */
  async recordTrade(trade) {
    const portfolio = this.portfolios.get(trade.portfolioId);
    if (portfolio) {
      portfolio.trades.push({
        ...trade,
        timestamp: trade.timestamp || Date.now()
      });
      portfolio.lastUpdated = Date.now();
    }
  }

  /**
   * 执行交易
   * @param {string} portfolioId - 投资组合ID
   * @param {string} tokenAddress - 代币地址
   * @param {string} type - 交易类型 ('buy' 或 'sell')
   * @param {Decimal} amount - 交易数量
   * @param {Decimal} price - 交易价格
   * @param {number} tradingFee - 交易手续费
   * @returns {Promise<Object>} 交易结果
   */
  async executeTrade(portfolioId, tokenAddress, type, amount, price, tradingFee = 0.005) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    // 🔥 规范化代币地址以确保一致性
    const normalizedTokenAddress = this._normalizeAddress(tokenAddress);

    // 确保使用Decimal类型
    const tradeAmount = new Decimal(amount);
    const tradePrice = new Decimal(price);
    const tradeValue = tradeAmount.mul(tradePrice);
    const feeAmount = tradeValue.mul(tradingFee);
    const totalCost = type === 'buy' ? tradeValue.add(feeAmount) : tradeValue.sub(feeAmount);

    // 创建交易记录（使用规范化地址）
    const trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      portfolioId,
      tokenAddress: normalizedTokenAddress,
      type,
      amount: tradeAmount,
      price: tradePrice,
      tradingFee,
      feeAmount,
      totalCost,
      timestamp: this._getCurrentTimestamp(),
      status: 'executed'
    };

    try {
      if (type === 'buy') {
        // 检查现金余额是否足够
        if (portfolio.cashBalance.lt(totalCost)) {
          throw new Error(`Insufficient cash balance. Required: ${totalCost.toString()}, Available: ${portfolio.cashBalance.toString()}`);
        }

        // 直接在这里更新投资组合状态，避免updatePosition的重复扣费
        portfolio.cashBalance = portfolio.cashBalance.sub(totalCost);

        const existingPosition = portfolio.positions.get(normalizedTokenAddress);
        if (existingPosition) {
          // 更新现有持仓
          const totalAmount = existingPosition.amount.add(tradeAmount);
          const totalCost = existingPosition.amount.mul(existingPosition.averagePrice).add(tradeValue);
          const newAveragePrice = totalCost.div(totalAmount);

          existingPosition.amount = totalAmount;
          existingPosition.averagePrice = newAveragePrice;
          existingPosition.currentPrice = tradePrice;
          existingPosition.lastUpdated = Date.now();
          // 🔥 累加实验交易成本（只累加本实验买入的）
          if (existingPosition.totalBuyValue) {
            existingPosition.totalBuyValue = existingPosition.totalBuyValue.add(tradeValue);
          } else {
            existingPosition.totalBuyValue = tradeValue;
          }
          if (existingPosition.totalBuyAmount) {
            existingPosition.totalBuyAmount = existingPosition.totalBuyAmount.add(tradeAmount);
          } else {
            existingPosition.totalBuyAmount = tradeAmount;
          }
        } else {
          // 创建新持仓（纯实验买入，无初始持仓）
          portfolio.positions.set(normalizedTokenAddress, {
            tokenAddress: normalizedTokenAddress,
            tokenSymbol: this.getTokenSymbol(normalizedTokenAddress),
            blockchain: this.getTokenBlockchain(normalizedTokenAddress),
            amount: tradeAmount,
            averagePrice: tradePrice,
            currentPrice: tradePrice,
            value: tradeValue,
            // ❌ 删除：本地PNL字段初始化，使用AVE PNL数据
            winRate: 0,
            trades: 1,
            lastUpdated: Date.now(),
            // 🔥 实验交易相关字段
            initialAmount: new Decimal(0),
            initialValue: new Decimal(0),
            totalBuyValue: tradeValue,
            totalBuyAmount: tradeAmount,
            // ✅ AVE PNL数据（如果提供）
            pnl: null
          });
        }

      } else if (type === 'sell') {
        // 检查持仓是否足够（使用规范化地址查找）
        const currentPosition = portfolio.positions.get(normalizedTokenAddress);
        const currentAmount = currentPosition ? currentPosition.amount : new Decimal(0);

        if (currentAmount.lt(tradeAmount)) {
          throw new Error(`Insufficient token balance. Required: ${tradeAmount.toString()}, Available: ${currentAmount.toString()}`);
        }

        // ❌ 删除：本地realizedPnL计算，使用AVE PNL数据

        // 增加现金收入
        portfolio.cashBalance = portfolio.cashBalance.add(totalCost);

        // 更新持仓
        const remainingAmount = currentAmount.sub(tradeAmount);
        if (remainingAmount.eq(0)) {
          // 完全卖出
          portfolio.positions.delete(normalizedTokenAddress);
        } else {
          // 部分卖出
          currentPosition.amount = remainingAmount;
          // ❌ 删除：本地realizedPnL累加，使用AVE PNL数据
          currentPosition.trades += 1;
          currentPosition.lastUpdated = Date.now();
        }
      }

      // 更新持仓价值并重新计算投资组合总价值
      await this.updatePositionsValue(portfolioId);

      // 记录交易
      await this.recordTrade(trade);

      // 触发交易执行事件
      this.emit('tradeExecuted', {
        portfolioId,
        trade,
        portfolio: await this.getSnapshot(portfolioId)
      });

      return {
        success: true,
        trade,
        portfolio: await this.getSnapshot(portfolioId)
      };

    } catch (error) {
      // 记录失败的交易
      const failedTrade = {
        ...trade,
        status: 'failed',
        error: error.message
      };

      await this.recordTrade(failedTrade);

      this.emit('tradeFailed', {
        portfolioId,
        trade: failedTrade,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 获取交易历史
   * @param {string} portfolioId - 投资组合ID
   * @param {number} [limit] - 限制数量
   * @param {number} [from] - 开始时间
   * @param {number} [to] - 结束时间
   * @returns {Promise<Array<Object>>} 交易记录
   */
  async getTradeHistory(portfolioId, limit, from, to) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return [];
    }

    let trades = [...portfolio.trades].sort((a, b) => b.timestamp - a.timestamp);

    if (from) {
      trades = trades.filter(trade => trade.timestamp >= from);
    }

    if (to) {
      trades = trades.filter(trade => trade.timestamp <= to);
    }

    if (limit) {
      trades = trades.slice(0, limit);
    }

    return trades;
  }

  /**
   * 获取投资组合统计
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 统计信息
   */
  async getPortfolioStats(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return null;
    }

    await this.updatePositionsValue(portfolioId);

    const positions = Array.from(portfolio.positions.values());
    const topPositions = positions
      .sort((a, b) => b.value.sub(a.value).toNumber())
      .slice(0, 10)
      .map(position => ({
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        value: position.value,
        allocation: portfolio.totalValue.gt(0) ? position.value.div(portfolio.totalValue).mul(100) : this.ZERO
      }));

    const performance = await this.getPerformanceMetrics(portfolioId);
    const dailyChange = this.calculateTimeframeChange(portfolioId, 1);
    const weeklyChange = this.calculateTimeframeChange(portfolioId, 7);
    const monthlyChange = this.calculateTimeframeChange(portfolioId, 30);

    return {
      totalValue: portfolio.totalValue,
      totalReturn: performance.totalReturn,
      returnPercent: performance.totalReturnPercent,
      dailyChange,
      weeklyChange,
      monthlyChange,
      positionCount: positions.length,
      topPositions
    };
  }

  /**
   * 设置止损
   * @param {string} portfolioId - 投资组合ID
   * @param {number} stopLoss - 止损百分比
   * @returns {Promise<void>}
   */
  async setStopLoss(portfolioId, stopLoss) {
    const portfolio = this.portfolios.get(portfolioId);
    if (portfolio) {
      portfolio.stopLoss = stopLoss;
      portfolio.lastUpdated = Date.now();
    }
  }

  /**
   * 设置止盈
   * @param {string} portfolioId - 投资组合ID
   * @param {number} takeProfit - 止盈百分比
   * @returns {Promise<void>}
   */
  async setTakeProfit(portfolioId, takeProfit) {
    const portfolio = this.portfolios.get(portfolioId);
    if (portfolio) {
      portfolio.takeProfit = takeProfit;
      portfolio.lastUpdated = Date.now();
    }
  }

  /**
   * 检查风险限制
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 风险检查结果
   */
  async checkRiskLimits(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return { withinLimits: false, violations: [] };
    }

    const violations = [];

    // 检查持仓规模限制
    const maxPositionSize = portfolio.config.maxPositionSize || 20; // 默认20%
    for (const [address, position] of portfolio.positions) {
      const allocation = portfolio.totalValue.gt(0)
        ? position.value.div(portfolio.totalValue).mul(100)
        : this.ZERO;

      if (allocation.gt(maxPositionSize)) {
        violations.push({
          type: 'position_size',
          message: `代币 ${position.tokenSymbol} 持仓比例 ${allocation.toFixed(2)}% 超过限制 ${maxPositionSize}%`,
          severity: allocation.gt(maxPositionSize * 1.5) ? 'high' : 'medium'
        });
      }
    }

    // 检查回撤限制
    const performance = await this.getPerformanceMetrics(portfolioId);
    const maxDrawdownLimit = portfolio.config.maxDrawdown || 20; // 默认20%
    if (performance.maxDrawdown.gt(maxDrawdownLimit)) {
      violations.push({
        type: 'drawdown',
        message: `最大回撤 ${performance.maxDrawdown.toFixed(2)}% 超过限制 ${maxDrawdownLimit}%`,
        severity: performance.maxDrawdown.gt(maxDrawdownLimit * 1.5) ? 'high' : 'medium'
      });
    }

    return {
      withinLimits: violations.length === 0,
      violations
    };
  }

  /**
   * 生成投资组合报告
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'} [timeframe] - 时间框架
   * @returns {Promise<Object>} 报告数据
   */
  async generateReport(portfolioId, timeframe = 'monthly') {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`投资组合不存在: ${portfolioId}`);
    }

    const stats = await this.getPortfolioStats(portfolioId);
    const performance = await this.getPerformanceMetrics(portfolioId, timeframe);
    const risk = await this.getRiskMetrics(portfolioId);

    const positions = Array.from(portfolio.positions.values()).map(position => ({
      tokenAddress: position.tokenAddress,
      tokenSymbol: position.tokenSymbol,
      value: position.value,
      allocation: portfolio.totalValue.gt(0) ? position.value.div(portfolio.totalValue).mul(100) : this.ZERO,
      pnl: position.totalPnL,
      returnPercent: position.averagePrice.gt(0) ? position.currentPrice.sub(position.averagePrice).div(position.averagePrice).mul(100) : this.ZERO
    }));

    const recommendations = await this.generateRecommendations(portfolioId);

    // 确定风险等级
    let riskLevel = 'low';
    if (risk.concentrationRisk.gt(0.5) || risk.maxPositionSize.gt(0.3)) {
      riskLevel = 'high';
    } else if (risk.concentrationRisk.gt(0.3) || risk.maxPositionSize.gt(0.2)) {
      riskLevel = 'medium';
    }

    return {
      summary: {
        portfolioId,
        totalValue: stats.totalValue,
        totalReturn: stats.totalReturn,
        returnPercent: stats.returnPercent,
        riskLevel
      },
      performance,
      risk,
      positions,
      recommendations
    };
  }

  /**
   * 获取指定投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Object|null} 投资组合对象
   */
  getPortfolio(portfolioId) {
    return this.portfolios.get(portfolioId) || null;
  }

  /**
   * 获取当前投资组合
   * @returns {Object|null} 当前投资组合
   */
  getCurrentPortfolio() {
    if (this.currentPortfolioId) {
      return this.portfolios.get(this.currentPortfolioId) || null;
    }
    return null;
  }

  /**
   * 设置当前投资组合
   * @param {string} portfolioId - 投资组合ID
   */
  setCurrentPortfolio(portfolioId) {
    if (this.portfolios.has(portfolioId)) {
      this.currentPortfolioId = portfolioId;
    } else {
      throw new Error(`投资组合不存在: ${portfolioId}`);
    }
  }

  /**
   * 获取投资组合列表
   * @returns {Promise<Array<Object>>} 投资组合列表
   */
  async getPortfolios() {
    const portfolios = [];

    for (const [id, portfolio] of this.portfolios) {
      await this.updatePositionsValue(id);

      portfolios.push({
        id,
        createdAt: portfolio.createdAt,
        lastUpdated: portfolio.lastUpdated,
        currentValue: portfolio.totalValue,
        totalReturn: portfolio.totalValue.sub(portfolio.metadata.initialBalance),
        status: portfolio.status
      });
    }

    return portfolios.sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  /**
   * 删除投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deletePortfolio(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return false;
    }

    // 清理快照
    await this.tracker.cleanupSnapshots(portfolioId, 0);

    // 删除投资组合
    this.portfolios.delete(portfolioId);

    this.emit('portfolio_deleted', { portfolioId });
    return true;
  }

  /**
   * 归档投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>} 是否成功
   */
  async archivePortfolio(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return false;
    }

    portfolio.status = 'archived';
    portfolio.lastUpdated = Date.now();

    this.emit('portfolio_archived', { portfolioId });
    return true;
  }

  /**
   * 复制投资组合
   * @param {string} portfolioId - 投资组合ID
   * @param {Object} [newConfig] - 新配置
   * @returns {Promise<string>} 新投资组合ID
   */
  async duplicatePortfolio(portfolioId, newConfig) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`投资组合不存在: ${portfolioId}`);
    }

    const config = newConfig || { ...portfolio.config };
    const newPortfolioId = await this.createPortfolio(portfolio.cashBalance, config);

    // 复制持仓（复制现金比例）
    const newPortfolio = this.portfolios.get(newPortfolioId);
    if (newPortfolio && portfolio.totalValue.gt(0)) {
      for (const [address, position] of portfolio.positions) {
        const valueRatio = position.value.div(portfolio.totalValue);
        const newPositionValue = newPortfolio.cashBalance.mul(valueRatio);
        const newPositionAmount = newPositionValue.div(position.currentPrice);

        newPortfolio.positions.set(address, {
          ...position,
          amount: newPositionAmount,
          value: newPositionValue,
          trades: 0,
          realizedPnL: this.ZERO,
          totalPnL: this.ZERO
        });
      }
    }

    this.emit('portfolio_duplicated', { portfolioId, newPortfolioId });
    return newPortfolioId;
  }

  /**
   * 导出投资组合数据
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<string>} JSON格式的投资组合数据
   */
  async exportPortfolio(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`投资组合不存在: ${portfolioId}`);
    }

    await this.updatePositionsValue(portfolioId);

    const exportData = {
      portfolio: {
        id: portfolio.id,
        config: portfolio.config,
        metadata: portfolio.metadata,
        cashBalance: portfolio.cashBalance.toString(),
        totalValue: portfolio.totalValue.toString(),
        createdAt: portfolio.createdAt,
        lastUpdated: portfolio.lastUpdated
      },
      positions: Array.from(portfolio.positions.values()).map(position => ({
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        blockchain: position.blockchain,
        amount: position.amount.toString(),
        averagePrice: position.averagePrice.toString(),
        currentPrice: position.currentPrice.toString(),
        value: position.value.toString(),
        realizedPnL: position.realizedPnL.toString(),
        totalPnL: position.totalPnL.toString(),
        trades: position.trades
      })),
      trades: portfolio.trades.map(trade => ({
        id: trade.id,
        timestamp: trade.timestamp,
        tokenAddress: trade.tokenAddress,
        tokenSymbol: trade.tokenSymbol,
        blockchain: trade.blockchain,
        type: trade.type,
        amount: trade.amount.toString(),
        price: trade.price.toString(),
        value: trade.value.toString(),
        fee: trade.fee.toString()
      })),
      snapshots: await this.tracker.getSnapshots(portfolioId),
      exportedAt: Date.now()
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导入投资组合数据
   * @param {string} data - JSON格式的投资组合数据
   * @returns {Promise<string>} 投资组合ID
   */
  async importPortfolio(data) {
    try {
      const importData = JSON.parse(data);

      // 创建新投资组合
      const portfolioId = this.generatePortfolioId();
      const portfolio = {
        id: portfolioId,
        cashBalance: new Decimal(importData.portfolio.cashBalance),
        totalValue: new Decimal(importData.portfolio.totalValue),
        positions: new Map(),
        config: importData.portfolio.config,
        metadata: importData.portfolio.metadata,
        trades: importData.trades.map(trade => ({
          ...trade,
          amount: new Decimal(trade.amount),
          price: new Decimal(trade.price),
          value: new Decimal(trade.value),
          fee: new Decimal(trade.fee)
        })),
        stopLoss: importData.portfolio.config.stopLoss || 10,
        takeProfit: importData.portfolio.config.takeProfit || 50,
        createdAt: importData.portfolio.createdAt,
        lastUpdated: Date.now(),
        status: 'active'
      };

      // 恢复持仓
      for (const position of importData.positions) {
        portfolio.positions.set(position.tokenAddress, {
          ...position,
          amount: new Decimal(position.amount),
          averagePrice: new Decimal(position.averagePrice),
          currentPrice: new Decimal(position.currentPrice),
          value: new Decimal(position.value),
          realizedPnL: new Decimal(position.realizedPnL),
          totalPnL: new Decimal(position.totalPnL)
        });
      }

      this.portfolios.set(portfolioId, portfolio);

      // 恢复快照
      if (importData.snapshots) {
        for (const snapshot of importData.snapshots) {
          await this.tracker.createSnapshot(
            portfolioId,
            portfolio.positions,
            portfolio.cashBalance,
            portfolio.metadata
          );
        }
      }

      this.emit('portfolio_imported', { portfolioId });
      return portfolioId;

    } catch (error) {
      this.logger.error('导入投资组合失败:', error);
      throw new Error('导入投资组合数据格式错误');
    }
  }

  /**
   * 备份所有投资组合
   * @returns {Promise<string>} 备份数据
   */
  async backup() {
    const backupData = {
      portfolios: {},
      snapshots: {},
      backupAt: Date.now()
    };

    for (const [id, portfolio] of this.portfolios) {
      await this.updatePositionsValue(id);

      backupData.portfolios[id] = {
        portfolio: {
          id: portfolio.id,
          config: portfolio.config,
          metadata: portfolio.metadata,
          cashBalance: portfolio.cashBalance.toString(),
          totalValue: portfolio.totalValue.toString(),
          createdAt: portfolio.createdAt,
          lastUpdated: portfolio.lastUpdated
        },
        positions: Array.from(portfolio.positions.values()).map(position => ({
          tokenAddress: position.tokenAddress,
          tokenSymbol: position.tokenSymbol,
          blockchain: position.blockchain,
          amount: position.amount.toString(),
          averagePrice: position.averagePrice.toString(),
          currentPrice: position.currentPrice.toString(),
          value: position.value.toString(),
          realizedPnL: position.realizedPnL.toString(),
          totalPnL: position.totalPnL.toString(),
          trades: position.trades
        })),
        trades: portfolio.trades.map(trade => ({
          id: trade.id,
          timestamp: trade.timestamp,
          tokenAddress: trade.tokenAddress,
          tokenSymbol: trade.tokenSymbol,
          blockchain: trade.blockchain,
          type: trade.type,
          amount: trade.amount.toString(),
          price: trade.price.toString(),
          value: trade.value.toString(),
          fee: trade.fee.toString()
        }))
      };

      backupData.snapshots[id] = await this.tracker.getSnapshots(id);
    }

    return JSON.stringify(backupData, null, 2);
  }

  /**
   * 恢复投资组合
   * @param {string} backup - 备份数据
   * @returns {Promise<number>} 恢复的投资组合数量
   */
  async restore(backup) {
    try {
      const backupData = JSON.parse(backup);
      let restoredCount = 0;

      for (const [id, data] of Object.entries(backupData.portfolios)) {
        try {
          await this.importPortfolio(JSON.stringify(data));
          restoredCount++;
        } catch (error) {
          this.logger.error(`恢复投资组合失败 (${id}):`, error);
        }
      }

      this.emit('portfolios_restored', { count: restoredCount });
      return restoredCount;

    } catch (error) {
      this.logger.error('恢复备份失败:', error);
      throw new Error('备份数据格式错误');
    }
  }

  /**
   * 清理过期数据
   * @param {number} retentionDays - 保留天数
   * @returns {Promise<number>} 清理的记录数
   */
  async cleanup(retentionDays) {
    let cleanedCount = 0;

    for (const portfolioId of this.portfolios.keys()) {
      const count = await this.tracker.cleanupSnapshots(portfolioId, retentionDays);
      cleanedCount += count;
    }

    return cleanedCount;
  }

  // 私有方法

  /**
   * 生成投资组合ID
   * @private
   * @returns {string} 投资组合ID
   */
  generatePortfolioId() {
    return `portfolio_${this.nextPortfolioId++}_${Date.now()}`;
  }

  /**
   * 验证配置
   * @private
   * @param {Object} config - 配置
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('配置不能为空');
    }

    if (!config.blockchain) {
      throw new Error('必须指定区块链');
    }
  }

  /**
   * 创建快照
   * @private
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 快照对象
   */
  async createSnapshot(portfolioId) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`投资组合不存在: ${portfolioId}`);
    }

    return await this.tracker.createSnapshot(
      portfolioId,
      portfolio.positions,
      portfolio.cashBalance,
      portfolio.metadata
    );
  }

  /**
   * 更新持仓价值
   * @private
   * @param {string} portfolioId - 投资组合ID
   * @param {Object} priceData - 价格数据 {tokenAddress: price}
   * @returns {Promise<void>}
   */
  async updatePositionsValue(portfolioId, priceData = null) {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) return;

    let totalValue = portfolio.cashBalance;

    // 更新每个持仓的当前价值
    for (const [address, position] of portfolio.positions) {
      let currentPrice = position.currentPrice;

      // 如果提供了价格数据，使用提供的价格
      if (priceData && priceData[address]) {
        currentPrice = new Decimal(priceData[address]);
        position.currentPrice = currentPrice;
      }

      const currentValue = position.amount.mul(currentPrice);
      position.value = currentValue;

      // 本地PNL计算已删除（AVE PNL 数据源与 WalletService 已随多链支持一并移除）

      totalValue = totalValue.add(currentValue);
    }

    portfolio.totalValue = totalValue;
  }

  /**
   * 获取代币符号
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {string} 代币符号
   */
  getTokenSymbol(tokenAddress) {
    // 从 targetTokens 配置中查找代币Symbol
    if (this._targetTokens && this._targetTokens.length > 0) {
      // 规范化输入地址
      const normalizedInput = this._normalizeAddress(tokenAddress);
      const token = this._targetTokens.find(
        t => {
          if (!t.address) return false;
          // 规范化配置中的地址
          const normalizedConfigAddress = this._normalizeAddress(t.address);
          return normalizedConfigAddress === normalizedInput;
        }
      );
      if (token && token.symbol) {
        return token.symbol;
      }
    }

    // 降级方案：返回地址前缀
    return tokenAddress.slice(0, 8) + '...';
  }

  /**
   * 设置目标代币配置（用于获取代币Symbol）
   * @param {Array} targetTokens - 目标代币配置
   */
  setTargetTokens(targetTokens) {
    this._targetTokens = targetTokens || [];
  }

  /**
   * 获取代币区块链
   * @private
   * @param {string} tokenAddress - 代币地址
   * @returns {string} 区块链
   */
  getTokenBlockchain(tokenAddress) {
    // 简化处理，根据地址前缀判断区块链
    if (tokenAddress.startsWith('0x')) {
      return 'bnb'; // 假设为BSC
    }
    return 'bnb';
  }

  /**
   * 获取目标配置
   * @private
   * @param {Object} config - 配置
   * @returns {Object} 目标配置
   */
  getTargetAllocation(config) {
    return config.targetAllocation || {};
  }

  /**
   * 获取时间范围内的快照
   * @private
   * @param {string} portfolioId - 投资组合ID
   * @param {number} days - 天数
   * @returns {Promise<Array>} 快照数组
   */
  async getSnapshotsInTimeframe(portfolioId, days) {
    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);
    return await this.tracker.getSnapshotsInRange(portfolioId, startTime, endTime);
  }

  /**
   * 计算时间框架变化
   * @private
   * @param {string} portfolioId - 投资组合ID
   * @param {number} days - 天数
   * @returns {Decimal} 变化百分比
   */
  async calculateTimeframeChange(portfolioId, days) {
    const snapshots = await this.getSnapshotsInTimeframe(portfolioId, days);
    if (snapshots.length < 2) return this.ZERO;

    const firstSnapshot = snapshots[0];
    const latestSnapshot = snapshots[snapshots.length - 1];

    const firstValue = new Decimal(firstSnapshot.totalValue);
    const latestValue = new Decimal(latestSnapshot.totalValue);

    return firstValue.gt(0)
      ? latestValue.sub(firstValue).div(firstValue).mul(100)
      : this.ZERO;
  }

  /**
   * 生成建议
   * @private
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Array>} 建议数组
   */
  async generateRecommendations(portfolioId) {
    const recommendations = [];

    // 分析重新平衡需求
    const rebalanceNeeds = await this.analyzeRebalanceNeeds(portfolioId);
    if (rebalanceNeeds.length > 0) {
      recommendations.push({
        type: 'rebalance',
        message: `发现 ${rebalanceNeeds.length} 个持仓偏离目标配置，建议重新平衡`,
        priority: 'medium'
      });
    }

    // 风险检查
    const riskCheck = await this.checkRiskLimits(portfolioId);
    if (!riskCheck.withinLimits) {
      recommendations.push({
        type: 'risk_management',
        message: `发现 ${riskCheck.violations.length} 个风险限制违规`,
        priority: riskCheck.violations.some(v => v.severity === 'high') ? 'high' : 'medium'
      });
    }

    return recommendations;
  }

  // EventEmitter方法实现
  /**
   * 添加事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   */
  on(event, listener) {
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    this._events.get(event).push(listener);
    return this;
  }

  /**
   * 添加一次性事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   */
  once(event, listener) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * 移除事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   */
  off(event, listener) {
    const listeners = this._events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this._events.delete(event);
        }
      }
    }
    return this;
  }

  /**
   * 发射事件
   * @param {string} event - 事件名称
   * @param {...any} args - 事件参数
   */
  emit(event, ...args) {
    const listeners = this._events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Event listener error for event '${event}':`, error);
        }
      });
    }
    return this;
  }

  /**
   * Initialize PortfolioManager (async initialization method)
   * @returns {Promise<void>}
   */
  async initialize() {
    // 异步初始化方法（兼容 TradingEngine 的要求）
    return Promise.resolve();
  }
}

module.exports = {
  PortfolioManager
};