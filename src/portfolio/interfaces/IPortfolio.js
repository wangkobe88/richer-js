/**
 * 投资组合接口定义
 */

const Decimal = require('decimal.js');

/**
 * 持仓信息
 * @typedef {Object} Position
 * @property {import('../../types/common').Address} tokenAddress - 代币地址
 * @property {string} tokenSymbol - 代币符号
 * @property {import('../../types/common').Blockchain} blockchain - 区块链
 * @property {Decimal} amount - 持仓数量
 * @property {Decimal} averagePrice - 平均价格
 * @property {Decimal} currentPrice - 当前价格
 * @property {Decimal} value - 当前价值
 * @property {Decimal} valueChange - 价值变化
 * @property {Decimal} valueChangePercent - 价值变化百分比
 * @property {Decimal} unrealizedPnL - 未实现盈亏
 * @property {Decimal} realizedPnL - 已实现盈亏
 * @property {Decimal} totalPnL - 总盈亏
 * @property {number} winRate - 胜率
 * @property {number} trades - 交易次数
 * @property {import('../../types/common').Timestamp} lastUpdated - 最后更新时间
 */

/**
 * 投资组合快照
 * @typedef {Object} PortfolioSnapshot
 * @property {string} id - 快照ID
 * @property {import('../../types/common').Timestamp} timestamp - 时间戳
 * @property {Decimal} totalValue - 总价值
 * @property {Decimal} totalValueChange - 总价值变化
 * @property {Decimal} totalValueChangePercent - 总价值变化百分比
 * @property {Position[]} positions - 持仓列表
 * @property {Decimal} cashBalance - 现金余额
 * @property {import('../../types/common').Blockchain} blockchain - 区块链
 * @property {PortfolioPerformance} performance - 性能指标
 * @property {PortfolioMetadata} metadata - 元数据
 */

/**
 * 投资组合性能
 * @typedef {Object} PortfolioPerformance
 * @property {Decimal} totalReturn - 总回报
 * @property {Decimal} totalReturnPercent - 总回报百分比
 * @property {Decimal} dailyReturn - 日回报
 * @property {Decimal} dailyReturnPercent - 日回报百分比
 * @property {Decimal} weeklyReturn - 周回报
 * @property {Decimal} weeklyReturnPercent - 周回报百分比
 * @property {Decimal} monthlyReturn - 月回报
 * @property {Decimal} monthlyReturnPercent - 月回报百分比
 * @property {Decimal} yearlyReturn - 年回报
 * @property {Decimal} yearlyReturnPercent - 年回报百分比
 * @property {Decimal} maxDrawdown - 最大回撤
 * @property {Decimal} maxDrawdownPercent - 最大回撤百分比
 * @property {Decimal} sharpeRatio - 夏普比率
 * @property {Decimal} volatility - 波动率
 * @property {number} winRate - 胜率
 * @property {Decimal} profitFactor - 盈利因子
 */

/**
 * 投资组合元数据
 * @typedef {Object} PortfolioMetadata
 * @property {string} walletAddress - 钱包地址
 * @property {import('../../types/common').Blockchain} blockchain - 区块链
 * @property {string} tradingMode - 交易模式
 * @property {string} strategy - 策略
 * @property {string} [experimentId] - 实验ID
 * @property {string} version - 版本
 * @property {import('../../types/common').Timestamp} createdAt - 创建时间
 * @property {import('../../types/common').Timestamp} updatedAt - 更新时间
 */

/**
 * 投资组合配置
 * @typedef {Object} PortfolioConfig
 * @property {import('../../types/common').Blockchain} blockchain - 区块链
 * @property {Decimal} initialBalance - 初始余额
 * @property {Decimal} rebalanceThreshold - 重新平衡阈值
 * @property {number} maxPositions - 最大持仓数
 * @property {'low'|'medium'|'high'} riskTolerance - 风险承受能力
 * @property {Record<string, Decimal>} targetAllocation - 目标配置
 */

/**
 * 资产配置
 * @typedef {Object} AssetAllocation
 * @property {import('../../types/common').Address} tokenAddress - 代币地址
 * @property {string} tokenSymbol - 代币符号
 * @property {Decimal} targetPercentage - 目标百分比
 * @property {Decimal} currentPercentage - 当前百分比
 * @property {Decimal} value - 价值
 * @property {Decimal} deviation - 偏差
 * @property {'buy'|'sell'|'hold'} action - 建议操作
 */

/**
 * 性能指标
 * @typedef {Object} PerformanceMetrics
 * @property {Decimal} totalReturn - 总回报
 * @property {Decimal} totalReturnPercent - 总回报百分比
 * @property {Decimal} dailyReturn - 日回报
 * @property {Decimal} weeklyReturn - 周回报
 * @property {Decimal} monthlyReturn - 月回报
 * @property {Decimal} yearlyReturn - 年回报
 * @property {Decimal} volatility - 波动率
 * @property {Decimal} maxDrawdown - 最大回撤
 * @property {Decimal} sharpeRatio - 夏普比率
 * @property {Decimal} sortinoRatio - 索提诺比率
 * @property {number} winRate - 胜率
 * @property {Decimal} profitFactor - 盈利因子
 * @property {number} totalTrades - 总交易数
 * @property {number} winningTrades - 盈利交易数
 * @property {Decimal} averageWin - 平均盈利
 * @property {Decimal} averageLoss - 平均亏损
 * @property {number} consecutiveWins - 连续盈利次数
 * @property {number} consecutiveLosses - 连续亏损次数
 * @property {number} averageHoldingPeriod - 平均持仓周期
 */

/**
 * 风险指标
 * @typedef {Object} RiskMetrics
 * @property {Decimal} valueAtRisk - 风险价值
 * @property {Decimal} expectedShortfall - 预期缺口
 * @property {Decimal} beta - 贝塔系数
 * @property {Decimal} alpha - 阿尔法系数
 * @property {Decimal} standardDeviation - 标准差
 * @property {Record<string, Record<string, Decimal>>} correlationMatrix - 相关性矩阵
 * @property {Decimal} concentrationRisk - 集中度风险
 * @property {number} positionCount - 持仓数量
 * @property {Decimal} maxPositionSize - 最大持仓规模
 * @property {number} diversificationScore - 多样化评分
 */

/**
 * 交易记录
 * @typedef {Object} TradeRecord
 * @property {string} id - 交易ID
 * @property {import('../../types/common').Timestamp} timestamp - 时间戳
 * @property {import('../../types/common').Address} tokenAddress - 代币地址
 * @property {string} tokenSymbol - 代币符号
 * @property {import('../../types/common').Blockchain} blockchain - 区块链
 * @property {'buy'|'sell'} type - 交易类型
 * @property {Decimal} amount - 数量
 * @property {Decimal} price - 价格
 * @property {Decimal} value - 价值
 * @property {Decimal} fee - 手续费
 * @property {Decimal} slippage - 滑点
 * @property {string} [txHash] - 交易哈希
 * @property {string} [strategy] - 策略
 * @property {Object} [metadata] - 元数据
 */

/**
 * 重新平衡建议
 * @typedef {Object} RebalanceRecommendation
 * @property {import('../../types/common').Address} tokenAddress - 代币地址
 * @property {string} tokenSymbol - 代币符号
 * @property {'buy'|'sell'} action - 操作类型
 * @property {Decimal} currentPercentage - 当前百分比
 * @property {Decimal} targetPercentage - 目标百分比
 * @property {Decimal} deviation - 偏差
 * @property {Decimal} suggestedAmount - 建议数量
 * @property {Decimal} suggestedValue - 建议价值
 * @property {number} priority - 优先级
 * @property {string} reason - 原因
 */

/**
 * 投资组合管理器接口
 * @interface
 */
class IPortfolioManager {
  /**
   * 创建投资组合
   * @param {Decimal} initialCash - 初始现金
   * @param {PortfolioConfig} config - 配置
   * @returns {Promise<string>} 投资组合ID
   */
  async createPortfolio(initialCash, config) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取投资组合快照
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<PortfolioSnapshot|null>}
   */
  async getSnapshot(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 更新持仓
   * @param {string} portfolioId - 投资组合ID
   * @param {import('../../types/common').Address} tokenAddress - 代币地址
   * @param {Decimal} amount - 数量
   * @param {Decimal} price - 价格
   * @param {'buy'|'sell'} type - 类型
   * @returns {Promise<void>}
   */
  async updatePosition(portfolioId, tokenAddress, amount, price, type) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取所有持仓
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Map<import('../../types/common').Address, Position>>}
   */
  async getPositions(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取资产配置
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<AssetAllocation[]>}
   */
  async getAssetAllocation(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 计算投资组合价值
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Decimal>}
   */
  async calculatePortfolioValue(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取性能指标
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'|'allTime'} [timeframe] - 时间框架
   * @returns {Promise<PerformanceMetrics>}
   */
  async getPerformanceMetrics(portfolioId, timeframe) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取风险指标
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<RiskMetrics>}
   */
  async getRiskMetrics(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 分析重新平衡需求
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<RebalanceRecommendation[]>}
   */
  async analyzeRebalanceNeeds(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 执行重新平衡
   * @param {string} portfolioId - 投资组合ID
   * @param {RebalanceRecommendation[]} recommendations - 重新平衡建议
   * @returns {Promise<string[]>} 交易ID列表
   */
  async executeRebalance(portfolioId, recommendations) {
    throw new Error('Method must be implemented');
  }

  /**
   * 记录交易
   * @param {TradeRecord} trade - 交易记录
   * @returns {Promise<void>}
   */
  async recordTrade(trade) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取交易历史
   * @param {string} portfolioId - 投资组合ID
   * @param {number} [limit] - 限制数量
   * @param {import('../../types/common').Timestamp} [from] - 开始时间
   * @param {import('../../types/common').Timestamp} [to] - 结束时间
   * @returns {Promise<TradeRecord[]>}
   */
  async getTradeHistory(portfolioId, limit, from, to) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取投资组合统计
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>}
   */
  async getPortfolioStats(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 设置止损
   * @param {string} portfolioId - 投资组合ID
   * @param {number} stopLoss - 止损百分比
   * @returns {Promise<void>}
   */
  async setStopLoss(portfolioId, stopLoss) {
    throw new Error('Method must be implemented');
  }

  /**
   * 设置止盈
   * @param {string} portfolioId - 投资组合ID
   * @param {number} takeProfit - 止盈百分比
   * @returns {Promise<void>}
   */
  async setTakeProfit(portfolioId, takeProfit) {
    throw new Error('Method must be implemented');
  }

  /**
   * 检查风险限制
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object>}
   */
  async checkRiskLimits(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 生成投资组合报告
   * @param {string} portfolioId - 投资组合ID
   * @param {'daily'|'weekly'|'monthly'} [timeframe] - 时间框架
   * @returns {Promise<Object>}
   */
  async generateReport(portfolioId, timeframe) {
    throw new Error('Method must be implemented');
  }

  /**
   * 获取投资组合列表
   * @returns {Promise<Array<Object>>}
   */
  async getPortfolios() {
    throw new Error('Method must be implemented');
  }

  /**
   * 删除投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>}
   */
  async deletePortfolio(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 归档投资组合
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<boolean>}
   */
  async archivePortfolio(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 复制投资组合
   * @param {string} portfolioId - 投资组合ID
   * @param {PortfolioConfig} [newConfig] - 新配置
   * @returns {Promise<string>} 新投资组合ID
   */
  async duplicatePortfolio(portfolioId, newConfig) {
    throw new Error('Method must be implemented');
  }

  /**
   * 导出投资组合数据
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<string>} JSON格式的投资组合数据
   */
  async exportPortfolio(portfolioId) {
    throw new Error('Method must be implemented');
  }

  /**
   * 导入投资组合数据
   * @param {string} data - JSON格式的投资组合数据
   * @returns {Promise<string>} 投资组合ID
   */
  async importPortfolio(data) {
    throw new Error('Method must be implemented');
  }

  /**
   * 备份所有投资组合
   * @returns {Promise<string>} 备份数据
   */
  async backup() {
    throw new Error('Method must be implemented');
  }

  /**
   * 恢复投资组合
   * @param {string} backup - 备份数据
   * @returns {Promise<number>} 恢复的投资组合数量
   */
  async restore(backup) {
    throw new Error('Method must be implemented');
  }

  /**
   * 清理过期数据
   * @param {number} retentionDays - 保留天数
   * @returns {Promise<number>} 清理的记录数
   */
  async cleanup(retentionDays) {
    throw new Error('Method must be implemented');
  }
}

module.exports = {
  IPortfolioManager
};