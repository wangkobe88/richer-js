/**
 * 投资组合快照跟踪器
 * 负责管理投资组合快照的生成、存储和检索
 */

const Decimal = require('decimal.js');
const EventEmitter = require('events');
const { PortfolioCalculator } = require('../calculators/PortfolioCalculator');

/**
 * 投资组合快照跟踪器类
 * @class
 * @extends EventEmitter
 */
class PortfolioTracker extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} [config] - 配置选项
   */
  constructor(config = {}) {
    super();

    /** @type {Decimal} 零值 */
    this.ZERO = new Decimal(0);

    /** @type {Object} 配置 */
    this.config = {
      autoSnapshot: config.autoSnapshot || false,
      snapshotInterval: config.snapshotInterval || 300000, // 5分钟
      maxSnapshots: config.maxSnapshots || 1000,
      enableRealtimeUpdates: config.enableRealtimeUpdates || true,
      persistenceEnabled: config.persistenceEnabled || true,
      storageType: config.storageType || 'memory', // 'supabase' | 'local' | 'memory'
      ...config
    };

    /** @type {Map<string, Array<Object>>} 投资组合快照 */
    this.snapshots = new Map();

    /** @type {Map<string, Object>} 最后更新时间 */
    this.lastUpdates = new Map();

    /** @type {PortfolioCalculator} 投资组合计算器 */
    this.calculator = new PortfolioCalculator();

    /** @type {number} 快照计时器ID */
    this.snapshotTimer = null;

    /** @type {Object} 存储适配器 */
    this.storageAdapter = null;

    // 初始化存储适配器
    this.initializeStorage();

    // 启动自动快照
    if (this.config.autoSnapshot) {
      this.startAutoSnapshot();
    }
  }

  /**
   * 初始化存储
   * @private
   */
  async initializeStorage() {
    switch (this.config.storageType) {
      case 'supabase':
        this.storageAdapter = new SupabaseStorageAdapter();
        break;
      case 'local':
        this.storageAdapter = new LocalStorageAdapter();
        break;
      case 'memory':
      default:
        this.storageAdapter = new MemoryStorageAdapter();
        break;
    }

    try {
      await this.storageAdapter.initialize();
    } catch (error) {
      console.error('初始化存储适配器失败:', error);
      // 降级到内存存储
      this.storageAdapter = new MemoryStorageAdapter();
      await this.storageAdapter.initialize();
    }
  }

  /**
   * 创建投资组合快照
   * @param {string} portfolioId - 投资组合ID
   * @param {Map} positions - 持仓映射
   * @param {Decimal} cashBalance - 现金余额
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 快照对象
   */
  async createSnapshot(portfolioId, positions, cashBalance, metadata = {}) {
    try {
      // 优先使用历史时间戳，否则使用当前时间
      const timestamp = metadata.backtestTime || metadata.historicalTime || Date.now();

      // 计算持仓价值
      const updatedPositions = new Map();
      for (const [address, position] of positions) {
        // 从缓存获取当前价格，如果没有则使用position中的价格
        const currentPrice = this.calculator.getPriceFromCache(address) || position.currentPrice;
        const updatedPosition = this.calculator.calculatePositionValue(position, currentPrice);
        updatedPositions.set(address, updatedPosition);
      }

      // 计算总价值
      const totalValue = this.calculator.calculateTotalPortfolioValue(updatedPositions, cashBalance);

      // 获取前一个快照计算价值变化
      const previousSnapshots = this.snapshots.get(portfolioId) || [];
      let totalValueChange = this.ZERO;
      let totalValueChangePercent = this.ZERO;

      if (previousSnapshots.length > 0) {
        const lastSnapshot = previousSnapshots[previousSnapshots.length - 1];
        totalValueChange = totalValue.sub(new Decimal(lastSnapshot.totalValue));
        totalValueChangePercent = lastSnapshot.totalValue > 0
          ? totalValueChange.div(new Decimal(lastSnapshot.totalValue)).mul(100)
          : this.ZERO;
      }

      // 获取历史快照计算性能指标
      const allSnapshots = [...previousSnapshots];
      const performance = this.calculatePerformance(allSnapshots);

      const snapshot = {
        id: this.generateSnapshotId(),
        portfolioId,
        timestamp,
        totalValue,
        totalValueChange,
        totalValueChangePercent,
        positions: Array.from(updatedPositions.values()),
        cashBalance,
        blockchain: metadata.blockchain || 'bnb',
        performance,
        metadata: {
          walletAddress: metadata.walletAddress,
          blockchain: metadata.blockchain,
          tradingMode: metadata.tradingMode,
          strategy: metadata.strategy,
          experimentId: metadata.experimentId,
          version: metadata.version || '1.0.0',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      };

      // 添加到内存缓存
      if (!this.snapshots.has(portfolioId)) {
        this.snapshots.set(portfolioId, []);
      }

      const portfolioSnapshots = this.snapshots.get(portfolioId);
      portfolioSnapshots.push(snapshot);

      // 限制快照数量
      if (portfolioSnapshots.length > this.config.maxSnapshots) {
        portfolioSnapshots.shift(); // 移除最旧的快照
      }

      // 更新最后更新时间
      this.lastUpdates.set(portfolioId, timestamp);

      // 持久化存储
      if (this.config.persistenceEnabled) {
        try {
          await this.storageAdapter.saveSnapshot(snapshot);
        } catch (error) {
          console.error('保存快照失败:', error);
        }
      }

      // 触发快照创建事件
      this.emit('snapshot_created', {
        portfolioId,
        snapshot,
        totalValue,
        change: totalValueChangePercent
      });

      // 触发价值变化事件
      if (totalValueChangePercent.abs().gt(0.1)) { // 0.1%阈值
        this.emit('value_changed', {
          portfolioId,
          totalValue,
          change: totalValueChangePercent,
          timestamp
        });
      }

      return snapshot;

    } catch (error) {
      console.error('创建快照失败:', error);
      throw error;
    }
  }

  /**
   * 获取快照
   * @param {string} portfolioId - 投资组合ID
   * @param {number} [limit] - 限制数量
   * @param {number} [from] - 开始时间戳
   * @param {number} [to] - 结束时间戳
   * @returns {Promise<Array<Object>>} 快照数组
   */
  async getSnapshots(portfolioId, limit, from, to) {
    try {
      // 从内存获取
      let snapshots = this.snapshots.get(portfolioId) || [];

      // 如果内存中没有且启用了持久化，从存储加载
      if (snapshots.length === 0 && this.config.persistenceEnabled) {
        snapshots = await this.storageAdapter.getSnapshots(portfolioId, limit, from, to);
        this.snapshots.set(portfolioId, snapshots);
      }

      // 应用过滤条件
      let filteredSnapshots = snapshots;

      if (from) {
        filteredSnapshots = filteredSnapshots.filter(snapshot => snapshot.timestamp >= from);
      }

      if (to) {
        filteredSnapshots = filteredSnapshots.filter(snapshot => snapshot.timestamp <= to);
      }

      // 应用数量限制
      if (limit && limit > 0) {
        filteredSnapshots = filteredSnapshots.slice(-limit);
      }

      return filteredSnapshots.sort((a, b) => a.timestamp - b.timestamp);

    } catch (error) {
      console.error('获取快照失败:', error);
      return [];
    }
  }

  /**
   * 获取最新快照
   * @param {string} portfolioId - 投资组合ID
   * @returns {Promise<Object|null>} 最新快照
   */
  async getLatestSnapshot(portfolioId) {
    try {
      const snapshots = await this.getSnapshots(portfolioId, 1);
      return snapshots.length > 0 ? snapshots[0] : null;

    } catch (error) {
      console.error('获取最新快照失败:', error);
      return null;
    }
  }

  /**
   * 获取指定时间范围内的快照
   * @param {string} portfolioId - 投资组合ID
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {Promise<Array<Object>>} 快照数组
   */
  async getSnapshotsInRange(portfolioId, startTime, endTime) {
    return await this.getSnapshots(portfolioId, null, startTime, endTime);
  }

  /**
   * 删除快照
   * @param {string} portfolioId - 投资组合ID
   * @param {string} snapshotId - 快照ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteSnapshot(portfolioId, snapshotId) {
    try {
      // 从内存删除
      const snapshots = this.snapshots.get(portfolioId) || [];
      const index = snapshots.findIndex(snapshot => snapshot.id === snapshotId);

      if (index !== -1) {
        snapshots.splice(index, 1);

        // 从持久化存储删除
        if (this.config.persistenceEnabled) {
          await this.storageAdapter.deleteSnapshot(snapshotId);
        }

        this.emit('snapshot_deleted', { portfolioId, snapshotId });
        return true;
      }

      return false;

    } catch (error) {
      console.error('删除快照失败:', error);
      return false;
    }
  }

  /**
   * 清理过期快照
   * @param {string} portfolioId - 投资组合ID
   * @param {number} retentionDays - 保留天数
   * @returns {Promise<number>} 删除的快照数量
   */
  async cleanupSnapshots(portfolioId, retentionDays) {
    try {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      const snapshots = this.snapshots.get(portfolioId) || [];

      const toDelete = snapshots.filter(snapshot => snapshot.timestamp < cutoffTime);
      let deletedCount = 0;

      for (const snapshot of toDelete) {
        await this.deleteSnapshot(portfolioId, snapshot.id);
        deletedCount++;
      }

      return deletedCount;

    } catch (error) {
      console.error('清理快照失败:', error);
      return 0;
    }
  }

  /**
   * 计算性能指标
   * @private
   * @param {Array} snapshots - 快照数组
   * @returns {Object} 性能指标
   */
  calculatePerformance(snapshots) {
    if (snapshots.length < 2) {
      return {
        totalReturn: this.ZERO,
        totalReturnPercent: this.ZERO,
        dailyReturn: this.ZERO,
        dailyReturnPercent: this.ZERO,
        weeklyReturn: this.ZERO,
        weeklyReturnPercent: this.ZERO,
        monthlyReturn: this.ZERO,
        monthlyReturnPercent: this.ZERO,
        yearlyReturn: this.ZERO,
        yearlyReturnPercent: this.ZERO,
        maxDrawdown: this.ZERO,
        maxDrawdownPercent: this.ZERO,
        sharpeRatio: this.ZERO,
        volatility: this.ZERO,
        winRate: 0,
        profitFactor: this.ZERO
      };
    }

    const firstSnapshot = snapshots[0];
    const currentSnapshot = snapshots[snapshots.length - 1];

    const initialValue = new Decimal(firstSnapshot.totalValue);
    const currentValue = new Decimal(currentSnapshot.totalValue);
    const totalReturn = currentValue.sub(initialValue);
    const totalReturnPercent = initialValue.gt(0) ? totalReturn.div(initialValue).mul(100) : this.ZERO;

    // 计算其他指标（简化版）
    return {
      totalReturn,
      totalReturnPercent,
      dailyReturn: this.ZERO,
      dailyReturnPercent: this.ZERO,
      weeklyReturn: this.ZERO,
      weeklyReturnPercent: this.ZERO,
      monthlyReturn: this.ZERO,
      monthlyReturnPercent: this.ZERO,
      yearlyReturn: this.ZERO,
      yearlyReturnPercent: this.ZERO,
      maxDrawdown: this.ZERO,
      maxDrawdownPercent: this.ZERO,
      sharpeRatio: this.ZERO,
      volatility: this.ZERO,
      winRate: 0,
      profitFactor: this.ZERO
    };
  }

  /**
   * 启动自动快照
   */
  startAutoSnapshot() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }

    this.snapshotTimer = setInterval(() => {
      this.emit('auto_snapshot_trigger');
    }, this.config.snapshotInterval);
  }

  /**
   * 停止自动快照
   */
  stopAutoSnapshot() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /**
   * 生成快照ID
   * @private
   * @returns {string} 快照ID
   */
  generateSnapshotId() {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取快照统计
   * @param {string} portfolioId - 投资组合ID
   * @returns {Object} 统计信息
   */
  getSnapshotStats(portfolioId) {
    const snapshots = this.snapshots.get(portfolioId) || [];
    const lastUpdate = this.lastUpdates.get(portfolioId) || 0;

    return {
      totalSnapshots: snapshots.length,
      lastSnapshot: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : 0,
      lastUpdate,
      oldestSnapshot: snapshots.length > 0 ? snapshots[0].timestamp : 0,
      newestSnapshot: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : 0
    };
  }

  /**
   * 销毁跟踪器
   */
  async destroy() {
    this.stopAutoSnapshot();

    if (this.storageAdapter) {
      try {
        await this.storageAdapter.cleanup();
      } catch (error) {
        console.error('清理存储适配器失败:', error);
      }
    }

    this.snapshots.clear();
    this.lastUpdates.clear();
    this.removeAllListeners();
  }
}

/**
 * 内存存储适配器
 * @class
 */
class MemoryStorageAdapter {
  constructor() {
    this.snapshots = new Map();
  }

  async initialize() {
    // 初始化逻辑
  }

  async saveSnapshot(snapshot) {
    if (!this.snapshots.has(snapshot.portfolioId)) {
      this.snapshots.set(snapshot.portfolioId, []);
    }
    this.snapshots.get(snapshot.portfolioId).push(snapshot);
  }

  async getSnapshots(portfolioId, limit, from, to) {
    const snapshots = this.snapshots.get(portfolioId) || [];
    let filtered = snapshots;

    if (from) filtered = filtered.filter(s => s.timestamp >= from);
    if (to) filtered = filtered.filter(s => s.timestamp <= to);
    if (limit) filtered = filtered.slice(-limit);

    return filtered;
  }

  async deleteSnapshot(snapshotId) {
    for (const [portfolioId, snapshots] of this.snapshots) {
      const index = snapshots.findIndex(s => s.id === snapshotId);
      if (index !== -1) {
        snapshots.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  async cleanup() {
    this.snapshots.clear();
  }
}

/**
 * 本地存储适配器
 * @class
 */
class LocalStorageAdapter {
  constructor() {
    this.storageKey = 'portfolio_snapshots';
  }

  async initialize() {
    // 初始化逻辑
  }

  async saveSnapshot(snapshot) {
    const data = this.loadData();
    if (!data[snapshot.portfolioId]) {
      data[snapshot.portfolioId] = [];
    }
    data[snapshot.portfolioId].push(snapshot);
    this.saveData(data);
  }

  async getSnapshots(portfolioId, limit, from, to) {
    const data = this.loadData();
    const snapshots = data[portfolioId] || [];
    let filtered = snapshots;

    if (from) filtered = filtered.filter(s => s.timestamp >= from);
    if (to) filtered = filtered.filter(s => s.timestamp <= to);
    if (limit) filtered = filtered.slice(-limit);

    return filtered;
  }

  async deleteSnapshot(snapshotId) {
    const data = this.loadData();
    for (const [portfolioId, snapshots] of Object.entries(data)) {
      const index = snapshots.findIndex(s => s.id === snapshotId);
      if (index !== -1) {
        snapshots.splice(index, 1);
        this.saveData(data);
        return true;
      }
    }
    return false;
  }

  loadData() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  saveData(data) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('保存到localStorage失败:', error);
    }
  }

  async cleanup() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('清理localStorage失败:', error);
    }
  }
}

/**
 * Supabase存储适配器
 * @class
 */
class SupabaseStorageAdapter {
  constructor() {
    this.supabase = null; // 需要注入Supabase客户端
  }

  async initialize() {
    // 初始化Supabase客户端
    // this.supabase = createClient(...);
  }

  async saveSnapshot(snapshot) {
    if (!this.supabase) {
      throw new Error('Supabase客户端未初始化');
    }

    const { error } = await this.supabase
      .from('portfolio_snapshots')
      .insert([snapshot]);

    if (error) throw error;
  }

  async getSnapshots(portfolioId, limit, from, to) {
    if (!this.supabase) {
      throw new Error('Supabase客户端未初始化');
    }

    let query = this.supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('timestamp', { ascending: true });

    if (from) query = query.gte('timestamp', from);
    if (to) query = query.lte('timestamp', to);
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  }

  async deleteSnapshot(snapshotId) {
    if (!this.supabase) {
      throw new Error('Supabase客户端未初始化');
    }

    const { error } = await this.supabase
      .from('portfolio_snapshots')
      .delete()
      .eq('id', snapshotId);

    if (error) throw error;
    return true;
  }

  async cleanup() {
    // 清理逻辑
  }
}

module.exports = {
  PortfolioTracker,
  MemoryStorageAdapter,
  LocalStorageAdapter,
  SupabaseStorageAdapter
};