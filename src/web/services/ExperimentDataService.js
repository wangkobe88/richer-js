/**
 * 实验数据服务层 - 统一管理信号与交易实体
 * 用于 fourmeme 交易实验
 */

const { Trade } = require('../../trading-engine/entities/Trade');
const { TradeSignal } = require('../../trading-engine/entities/TradeSignal');
const { dbManager } = require('../../services/dbManager');

/**
 * 实验数据服务类
 * @class
 */
class ExperimentDataService {
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 获取实验的交易数据
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Trade[]>} 交易实体数组
   */
  async getTrades(experimentId, options = {}) {
    try {
      let query = this.supabase
        .from('trades')
        .select('*')
        .eq('experiment_id', experimentId);

      // 添加筛选条件
      if (options.success !== undefined) {
        query = query.eq('success', options.success === 'true');
      }
      if (options.direction) {
        query = query.eq('direction', options.direction);
      }
      if (options.tradeType) {
        query = query.eq('trade_type', options.tradeType);
      }

      // 添加分页
      const offset = parseInt(options.offset) || 0;
      const limit = parseInt(options.limit) || 100;
      query = query.range(offset, offset + limit - 1);

      // 排序
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      // 转换为Trade实体
      return (data || []).map(tradeData => Trade.fromDatabaseFormat(tradeData));

    } catch (error) {
      console.error('获取交易数据失败:', error);
      return [];
    }
  }

  /**
   * 获取实验的信号数据
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<TradeSignal[]>} 信号实体数组
   */
  async getSignals(experimentId, options = {}) {
    try {
      let query = this.supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', experimentId);

      // 添加筛选条件
      if (options.action) {
        query = query.eq('action', options.action);
      }
      if (options.signalType) {
        query = query.eq('signal_type', options.signalType);
      }

      // 添加分页
      const offset = parseInt(options.offset) || 0;
      const limit = parseInt(options.limit) || 100;
      query = query.range(offset, offset + limit - 1);

      // 排序
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      // 转换为TradeSignal实体
      return (data || []).map(signalData => TradeSignal.fromDatabaseFormat(signalData));

    } catch (error) {
      console.error('获取信号数据失败:', error);
      return [];
    }
  }

  /**
   * 获取格式化的交易数据（用于前端API）
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 格式化的响应数据
   */
  async getFormattedTrades(experimentId, options = {}) {
    const trades = await this.getTrades(experimentId, options);

    return {
      success: true,
      data: trades.map(trade => trade.toJSON()),
      trades: trades.map(trade => trade.toJSON()),
      count: trades.length,
      metadata: {
        experimentId,
        timestamp: new Date().toISOString(),
        filters: options
      }
    };
  }

  /**
   * 获取格式化的信号数据（用于前端API）
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 格式化的响应数据
   */
  async getFormattedSignals(experimentId, options = {}) {
    const signals = await this.getSignals(experimentId, options);

    return {
      success: true,
      signals: signals.map(signal => signal.toJSON()),
      count: signals.length,
      metadata: {
        experimentId,
        timestamp: new Date().toISOString(),
        filters: options
      }
    };
  }

  /**
   * 获取实验的统计数据
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 统计数据
   */
  async getExperimentStats(experimentId) {
    try {
      // 并行获取交易和信号数据
      const [trades, signals] = await Promise.all([
        this.getTrades(experimentId, { limit: 10000 }),
        this.getSignals(experimentId, { limit: 10000 })
      ]);

      // 计算交易统计
      const totalTrades = trades.length;
      const successfulTrades = trades.filter(trade => trade.success).length;
      const buyTrades = trades.filter(trade => trade.direction === 'buy').length;
      const sellTrades = trades.filter(trade => trade.direction === 'sell').length;
      const virtualTrades = trades.filter(trade => trade.tradeType === 'virtual').length;
      const liveTrades = trades.filter(trade => trade.tradeType === 'live').length;

      // 计算信号统计
      const totalSignals = signals.length;
      const buySignals = signals.filter(signal => signal.signalType === 'BUY').length;
      const sellSignals = signals.filter(signal => signal.signalType === 'SELL').length;

      // 计算成功率
      const successRate = totalTrades > 0 ? (successfulTrades / totalTrades * 100).toFixed(2) : '0';

      return {
        trades: {
          total: totalTrades,
          successful: successfulTrades,
          failed: totalTrades - successfulTrades,
          successRate: parseFloat(successRate),
          buy: buyTrades,
          sell: sellTrades,
          virtual: virtualTrades,
          live: liveTrades
        },
        signals: {
          total: totalSignals,
          buy: buySignals,
          sell: sellSignals
        },
        summary: {
          totalTrades,
          totalSignals,
          successRate: parseFloat(successRate)
        }
      };

    } catch (error) {
      console.error('获取实验统计数据失败:', error);
      return {
        trades: { total: 0, successful: 0, failed: 0, successRate: 0, buy: 0, sell: 0, virtual: 0, live: 0 },
        signals: { total: 0, buy: 0, sell: 0 },
        summary: { totalTrades: 0, totalSignals: 0, successRate: 0 }
      };
    }
  }

  /**
   * 保存交易信号
   * @param {TradeSignal} signal - 信号实体
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveSignal(signal) {
    try {
      const { error } = await this.supabase
        .from('strategy_signals')
        .insert(signal.toDatabaseFormat());

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('保存信号失败:', error);
      return false;
    }
  }

  /**
   * 批量保存交易信号
   * @param {TradeSignal[]} signals - 信号实体数组
   * @returns {Promise<number>} 成功保存的数量
   */
  async saveSignals(signals) {
    try {
      const dbData = signals.map(s => s.toDatabaseFormat());
      const { error } = await this.supabase
        .from('strategy_signals')
        .insert(dbData);

      if (error) throw error;
      return signals.length;

    } catch (error) {
      console.error('批量保存信号失败:', error);
      return 0;
    }
  }

  /**
   * 保存交易记录
   * @param {Trade} trade - 交易实体
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveTrade(trade) {
    try {
      const { error } = await this.supabase
        .from('trades')
        .insert(trade.toDatabaseFormat());

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('保存交易失败:', error);
      return false;
    }
  }

  /**
   * 批量保存交易记录
   * @param {Trade[]} trades - 交易实体数组
   * @returns {Promise<number>} 成功保存的数量
   */
  async saveTrades(trades) {
    try {
      const dbData = trades.map(t => t.toDatabaseFormat());
      const { error } = await this.supabase
        .from('trades')
        .insert(dbData);

      if (error) throw error;
      return trades.length;

    } catch (error) {
      console.error('批量保存交易失败:', error);
      return 0;
    }
  }

  /**
   * 清理实验数据
   * @param {string} experimentId - 实验ID
   * @returns {Promise<boolean>} 是否清理成功
   */
  async clearExperimentData(experimentId) {
    try {
      const tables = ['trades', 'strategy_signals', 'runtime_metrics', 'portfolio_snapshots'];
      const results = [];

      for (const table of tables) {
        const { error } = await this.supabase
          .from(table)
          .delete()
          .eq('experiment_id', experimentId);

        results.push({
          table,
          success: !error,
          error: error?.message
        });
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`清理实验数据完成: ${successCount}/${tables.length} 个表成功`);

      return successCount === tables.length;

    } catch (error) {
      console.error('清理实验数据失败:', error);
      return false;
    }
  }

  /**
   * 获取运行时指标
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 指标数据
   */
  async getRuntimeMetrics(experimentId, options = {}) {
    try {
      let query = this.supabase
        .from('runtime_metrics')
        .select('*')
        .eq('experiment_id', experimentId);

      // 添加筛选条件
      if (options.metricName) {
        query = query.eq('metric_name', options.metricName);
      }

      // 添加分页
      const offset = parseInt(options.offset) || 0;
      const limit = parseInt(options.limit) || 100;
      query = query.range(offset, offset + limit - 1);

      // 排序
      query = query.order('recorded_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      return data || [];

    } catch (error) {
      console.error('获取运行时指标失败:', error);
      return [];
    }
  }

  /**
   * 保存运行时指标
   * @param {string} experimentId - 实验ID
   * @param {string} metricName - 指标名称
   * @param {number} metricValue - 指标值
   * @param {Object} metadata - 额外元数据
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveRuntimeMetric(experimentId, metricName, metricValue, metadata = {}) {
    try {
      const { error } = await this.supabase
        .from('runtime_metrics')
        .insert({
          experiment_id: experimentId,
          metric_name: metricName,
          metric_value: metricValue,
          metadata: metadata
        });

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('保存运行时指标失败:', error);
      return false;
    }
  }

  /**
   * 获取投资组合快照数据
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 投资组合快照数据
   */
  async getPortfolioSnapshots(experimentId, options = {}) {
    try {
      const limit = parseInt(options.limit) || 1000;

      // 尝试从数据库获取
      let query = this.supabase
        .from('portfolio_snapshots')
        .select('*')
        .eq('experiment_id', experimentId)
        .order('snapshot_time', { ascending: true })
        .limit(limit);

      const { data, error } = await query;

      if (error) {
        // 如果表不存在，返回空数组
        if (error.code === '42P01') {
          console.log('portfolio_snapshots 表不存在，返回空数据');
          return {
            success: true,
            snapshots: [],
            count: 0
          };
        }
        throw error;
      }

      return {
        success: true,
        snapshots: data || [],
        count: (data || []).length
      };

    } catch (error) {
      console.error('获取投资组合快照失败:', error);
      return {
        success: false,
        error: error.message,
        snapshots: [],
        count: 0
      };
    }
  }

  /**
   * 保存投资组合快照
   * @param {string} experimentId - 实验ID
   * @param {Object} snapshot - 快照数据
   * @returns {Promise<boolean>} 是否保存成功
   */
  async savePortfolioSnapshot(experimentId, snapshot) {
    try {
      const { error } = await this.supabase
        .from('portfolio_snapshots')
        .insert({
          experiment_id: experimentId,
          snapshot_time: new Date(snapshot.timestamp).toISOString(),
          total_value: snapshot.totalValue?.toString() || '0',
          total_value_change: snapshot.totalValueChange?.toString() || '0',
          total_value_change_percent: snapshot.totalValueChangePercent?.toString() || '0',
          cash_balance: snapshot.cashBalance?.toString() || '0',
          cash_native_balance: snapshot.cashBalance?.toString() || '0',
          total_portfolio_value_native: snapshot.totalValue?.toString() || '0',
          token_positions: JSON.stringify(snapshot.positions || []),
          positions_count: snapshot.positions?.length || 0,
          metadata: snapshot.metadata || {},
          created_at: new Date().toISOString()
        });

      if (error) {
        // 如果表不存在，尝试创建
        if (error.code === '42P01') {
          console.log('portfolio_snapshots 表不存在，跳过保存');
          return false;
        }
        throw error;
      }

      return true;

    } catch (error) {
      console.error('保存投资组合快照失败:', error);
      return false;
    }
  }
}

module.exports = { ExperimentDataService };
