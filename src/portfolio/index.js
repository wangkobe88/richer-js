/**
 * 投资组合模块统一入口
 * 提供投资组合管理功能
 */

// 接口和类型定义
const {
  Position,
  PortfolioSnapshot,
  PortfolioPerformance,
  PortfolioMetadata,
  PortfolioConfig,
  AssetAllocation,
  PerformanceMetrics,
  RiskMetrics,
  TradeRecord,
  RebalanceRecommendation,
  PortfolioAnalysis,
  PortfolioComparison,
  OptimizationSuggestion,
  IPortfolioManager
} = require('./interfaces/IPortfolio');

// 核心组件
const { PortfolioManager } = require('./core/PortfolioManager');
const { PortfolioCalculator } = require('./calculators/PortfolioCalculator');
const { PortfolioTracker } = require('./trackers/PortfolioTracker');

// 服务层
const { PortfolioService } = require('./services/PortfolioService');

// 全局实例
let portfolioManagerInstance = null;
let portfolioServiceInstance = null;

// 重新导出所有组件
module.exports = {
  // 类型定义
  Position,
  PortfolioSnapshot,
  PortfolioPerformance,
  PortfolioMetadata,
  PortfolioConfig,
  AssetAllocation,
  PerformanceMetrics,
  RiskMetrics,
  TradeRecord,
  RebalanceRecommendation,
  PortfolioAnalysis,
  PortfolioComparison,
  OptimizationSuggestion,

  // 接口和核心类
  IPortfolioManager,
  PortfolioManager,
  PortfolioCalculator,
  PortfolioTracker,

  // 服务层
  PortfolioService,

  // 全局实例管理
  /**
   * 获取全局投资组合管理器
   * @returns {IPortfolioManager} 投资组合管理器实例
   */
  getPortfolioManager() {
    if (!portfolioManagerInstance) {
      portfolioManagerInstance = new PortfolioManager();
    }
    return portfolioManagerInstance;
  },

  /**
   * 获取全局投资组合服务
   * @returns {PortfolioService} 投资组合服务实例
   */
  getPortfolioService() {
    if (!portfolioServiceInstance) {
      portfolioServiceInstance = new PortfolioService();
    }
    return portfolioServiceInstance;
  },

  // 便捷方法

  /**
   * 创建投资组合
   * @param {Decimal} initialCash - 初始现金
   * @param {PortfolioConfig} config - 配置
   * @returns {Promise<string>} 投资组合ID
   */
  createPortfolio: async (initialCash, config) => {
    const manager = getPortfolioManager();
    return await manager.createPortfolio(initialCash, config);
  },

  /**
   * 创建投资组合快照
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<PortfolioSnapshot|null>} 快照对象
   */
  createSnapshot: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.getSnapshot(portfolioId);
  },

  /**
   * 获取投资组合统计
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 统计信息
   */
  getPortfolioStats: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.getPortfolioStats(portfolioId);
  },

  /**
   * 获取投资组合性能指标
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'|'allTime'} [timeframe] - 时间框架
   * @returns {Promise<PerformanceMetrics>} 性能指标
   */
  getPerformanceMetrics: async (portfolioId, timeframe) => {
    const manager = getPortfolioManager();
    return await manager.getPerformanceMetrics(portfolioId, timeframe);
  },

  /**
   * 获取投资组合风险指标
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<RiskMetrics>} 风险指标
   */
  getRiskMetrics: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.getRiskMetrics(portfolioId);
  },

  /**
   * 分析重新平衡需求
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<RebalanceRecommendation[]>} 重新平衡建议
   */
  analyzeRebalanceNeeds: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.analyzeRebalanceNeeds(portfolioId);
  },

  /**
   * 执行重新平衡
   * @param {string} portfolioId - 投资组合ID
   * @param {RebalanceRecommendation[]} recommendations - 重新平衡建议
   * @returns {Promise<string[]>} 交易ID列表
   */
  executeRebalance: async (portfolioId, recommendations) => {
    const manager = getPortfolioManager();
    return await manager.executeRebalance(portfolioId, recommendations);
  },

  /**
   * 从模板创建投资组合
   * @param {Object} template - 投资组合模板
   * @param {Decimal} initialCash - 初始现金
   * @returns {Promise<string>} 投资组合ID
   */
  createPortfolioFromTemplate: async (template, initialCash) => {
    const service = getPortfolioService();
    return await service.createPortfolioFromTemplate(template, initialCash);
  },

  /**
   * 比较投资组合
   * @param {string} portfolioId1 - 投资组合ID1
   * @param {string} portfolioId2 - 投资组合ID2
   * @returns {Promise<PortfolioComparison>} 比较结果
   */
  comparePortfolios: async (portfolioId1, portfolioId2) => {
    const service = getPortfolioService();
    return await service.comparePortfolios(portfolioId1, portfolioId2);
  },

  /**
   * 分析投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<PortfolioAnalysis>} 分析结果
   */
  analyzePortfolio: async (portfolioId) => {
    const service = getPortfolioService();
    return await service.analyzePortfolio(portfolioId);
  },

  /**
   * 智能重新平衡
   * @param {string} portfolioId - 投资组合ID
   * @param {Object} marketConditions - 市场状况
   * @returns {Promise<Object>} 重新平衡建议
   */
  smartRebalance: async (portfolioId, marketConditions) => {
    const service = getPortfolioService();
    return await service.smartRebalance(portfolioId, marketConditions);
  },

  /**
   * 批量操作
   * @param {Array<Object>} operations - 操作数组
   * @returns {Promise<Array<Object>>} 操作结果
   */
  batchOperation: async (operations) => {
    const service = getPortfolioService();
    return await service.batchOperation(operations);
  },

  /**
   * 获取投资组合仪表板数据
   * @param {string[]} [portfolioIds] - 投资组合ID数组
   * @returns {Promise<Object>} 仪表板数据
   */
  getDashboardData: async (portfolioIds) => {
    const service = getPortfolioService();
    return await service.getDashboardData(portfolioIds);
  },

  /**
   * 生成投资组合报告
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'} [timeframe] - 时间框架
   * @param {'json'|'html'|'pdf'} [format] - 格式
   * @returns {Promise<string>} 报告内容
   */
  generatePortfolioReport: async (portfolioId, timeframe, format) => {
    const service = getPortfolioService();
    return await service.generatePortfolioReport(portfolioId, timeframe, format);
  },

  /**
   * 获取投资组合模板
   * @returns {Array<Object>} 投资组合模板数组
   */
  getPortfolioTemplates: () => {
    const service = getPortfolioService();
    return service.getPortfolioTemplates();
  },

  /**
   * 获取所有投资组合
   * @returns {Promise<Array<Object>>} 投资组合数组
   */
  getPortfolios: async () => {
    const manager = getPortfolioManager();
    return await manager.getPortfolios();
  },

  /**
   * 删除投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>} 是否成功
   */
  deletePortfolio: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.deletePortfolio(portfolioId);
  },

  /**
   * 归档投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>} 是否成功
   */
  archivePortfolio: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.archivePortfolio(portfolioId);
  },

  /**
   * 复制投资组合
   * @param {string} portfolioId - 投资组合ID
   * @param {PortfolioConfig} [newConfig] - 新配置
   * @returns {Promise<string>} 新投资组合ID
   */
  duplicatePortfolio: async (portfolioId, newConfig) => {
    const manager = getPortfolioManager();
    return await manager.duplicatePortfolio(portfolioId, newConfig);
  },

  /**
   * 导出投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<string>} JSON格式的投资组合数据
   */
  exportPortfolio: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.exportPortfolio(portfolioId);
  },

  /**
   * 导入投资组合
   * @param {string} data - JSON格式的投资组合数据
   * @returns {Promise<string>} 投资组合ID
   */
  importPortfolio: async (data) => {
    const manager = getPortfolioManager();
    return await manager.importPortfolio(data);
  },

  /**
   * 备份所有投资组合
   * @returns {Promise<string>} 备份数据
   */
  backupPortfolios: async () => {
    const manager = getPortfolioManager();
    return await manager.backup();
  },

  /**
   * 恢复投资组合
   * @param {string} backup - 备份数据
   * @returns {Promise<number>} 恢复的投资组合数量
   */
  restorePortfolios: async (backup) => {
    const manager = getPortfolioManager();
    return await manager.restore(backup);
  },

  /**
   * 更新持仓
   * @param {string} portfolioId - 投资组合ID
   * @param {string} tokenAddress - 代币地址
   * @param {Decimal} amount - 数量
   * @param {Decimal} price - 价格
   * @param {'buy'|'sell'} type - 类型
   * @returns {Promise<void>}
   */
  updatePosition: async (portfolioId, tokenAddress, amount, price, type) => {
    const manager = getPortfolioManager();
    return await manager.updatePosition(portfolioId, tokenAddress, amount, price, type);
  },

  /**
   * 获取持仓
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Map<string, Position>>} 持仓映射
   */
  getPositions: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.getPositions(portfolioId);
  },

  /**
   * 获取资产配置
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<AssetAllocation[]>} 资产配置数组
   */
  getAssetAllocation: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.getAssetAllocation(portfolioId);
  },

  /**
   * 计算投资组合价值
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Decimal>} 总价值
   */
  calculatePortfolioValue: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.calculatePortfolioValue(portfolioId);
  },

  /**
   * 记录交易
   * @param {TradeRecord} trade - 交易记录
   * @returns {Promise<void>}
   */
  recordTrade: async (trade) => {
    const manager = getPortfolioManager();
    return await manager.recordTrade(trade);
  },

  /**
   * 获取交易历史
   * @param {string} portfolioId - 投资组合ID
   * @param {number} [limit] - 限制数量
   * @param {number} [from] - 开始时间
   * @param {number} [to] - 结束时间
   * @returns {Promise<TradeRecord[]>} 交易记录
   */
  getTradeHistory: async (portfolioId, limit, from, to) => {
    const manager = getPortfolioManager();
    return await manager.getTradeHistory(portfolioId, limit, from, to);
  },

  /**
   * 设置止损
   * @param {string} portfolioId - 投资组合ID
   * @param {number} stopLoss - 止损百分比
   * @returns {Promise<void>}
   */
  setStopLoss: async (portfolioId, stopLoss) => {
    const manager = getPortfolioManager();
    return await manager.setStopLoss(portfolioId, stopLoss);
  },

  /**
   * 设置止盈
   * @param {string} portfolioId - 投资组合ID
   * @param {number} takeProfit - 止盈百分比
   * @returns {Promise<void>}
   */
  setTakeProfit: async (portfolioId, takeProfit) => {
    const manager = getPortfolioManager();
    return await manager.setTakeProfit(portfolioId, takeProfit);
  },

  /**
   * 检查风险限制
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>} 风险检查结果
   */
  checkRiskLimits: async (portfolioId) => {
    const manager = getPortfolioManager();
    return await manager.checkRiskLimits(portfolioId);
  },

  // 工具方法
  /**
   * 创建投资组合计算器实例
   * @param {Object} [config] - 配置
   * @returns {PortfolioCalculator} 计算器实例
   */
  createCalculator: (config) => {
    return new PortfolioCalculator(config);
  },

  /**
   * 创建投资组合跟踪器实例
   * @param {Object} [config] - 配置
   * @returns {PortfolioTracker} 跟踪器实例
   */
  createTracker: (config) => {
    return new PortfolioTracker(config);
  },

  /**
   * 重置全局实例
   */
  resetInstances: () => {
    portfolioManagerInstance = null;
    portfolioServiceInstance = null;
  },

  // 常量
  RISK_LEVELS: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
  },

  TRADING_MODES: {
    LIVE: 'live',
    VIRTUAL: 'virtual',
    BACKTEST: 'backtest'
  },

  RECOMMENDATION_TYPES: {
    BUY: 'buy',
    SELL: 'sell',
    HOLD: 'hold',
    REBALANCE: 'rebalance',
    RISK_MANAGEMENT: 'risk_management',
    OPPORTUNITY: 'opportunity'
  },

  TIMEFRAMES: {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    ALL_TIME: 'allTime'
  }
};