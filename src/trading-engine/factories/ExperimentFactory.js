/**
 * 实验工厂类 - 负责创建和管理实验实例
 * 用于 fourmeme 交易实验
 */

const { Experiment } = require('../entities/Experiment');
const { dbManager } = require('../../services/dbManager');

/**
 * 实验工厂类
 * @class
 */
class ExperimentFactory {
  /**
   * 构造函数
   */
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 从配置创建实验并保存到数据库
   * @param {Object} config - 引擎配置
   * @param {string} tradingMode - 交易模式 ('virtual' | 'live')
   * @returns {Promise<Experiment>} 创建的实验实例
   */
  async createFromConfig(config, tradingMode) {
    try {
      // 创建实验实例
      const experiment = Experiment.fromConfig(config, tradingMode);

      // 验证实验数据
      const validation = experiment.validate();
      if (!validation.valid) {
        throw new Error(`实验数据验证失败: ${validation.errors.join(', ')}`);
      }

      // 保存到数据库
      await this.save(experiment);

      console.log(`✅ 实验创建成功: ${experiment.id}`);
      console.log(`📊 实验名称: ${experiment.experimentName}`);
      console.log(`🎯 交易模式: ${tradingMode}`);
      console.log(`📈 策略类型: ${experiment.strategyType}`);
      console.log(`🕐 K线类型: ${experiment.klineType}`);

      return experiment;

    } catch (error) {
      console.error('❌ 创建实验失败:', error.message);
      throw error;
    }
  }

  /**
   * 从数据库加载实验
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Experiment|null>} 实验实例，不存在返回null
   */
  async load(experimentId) {
    try {
      const { data, error } = await this.supabase
        .from('experiments')
        .select('*')
        .eq('id', experimentId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return Experiment.fromDatabaseFormat(data);

    } catch (error) {
      console.error('❌ 加载实验失败:', error.message);
      return null;
    }
  }

  /**
   * 保存实验到数据库
   * @param {Experiment} experiment - 实验实例
   * @returns {Promise<boolean>} 是否保存成功
   */
  async save(experiment) {
    try {
      const dbData = experiment.toDatabaseFormat();

      const { data, error } = await this.supabase
        .from('experiments')
        .upsert(dbData, {
          onConflict: 'id',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // 更新实验实例的时间戳
      if (data) {
        experiment.createdAt = new Date(data.created_at);
        experiment.startedAt = new Date(data.started_at);
        if (data.stopped_at) {
          experiment.stoppedAt = new Date(data.stopped_at);
        }
      }

      return true;

    } catch (error) {
      console.error('❌ 保存实验失败:', error.message);
      return false;
    }
  }

  /**
   * 更新实验状态
   * @param {string} experimentId - 实验ID
   * @param {string} status - 新状态
   * @param {Object} additionalData - 额外的更新数据
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateStatus(experimentId, status, additionalData = {}) {
    try {
      const updateData = {
        status: status
      };

      // 如果是完成或停止状态，设置停止时间
      if (['completed', 'failed', 'stopped'].includes(status)) {
        updateData.stopped_at = new Date().toISOString();
      }

      // 合并额外数据
      if (Object.keys(additionalData).length > 0) {
        Object.assign(updateData, additionalData);
      }

      const { error } = await this.supabase
        .from('experiments')
        .update(updateData)
        .eq('id', experimentId);

      if (error) {
        throw error;
      }

      return true;

    } catch (error) {
      console.error('❌ 更新实验状态失败:', error.message);
      return false;
    }
  }

  /**
   * 列出实验
   * @param {Object} filters - 筛选条件
   * @returns {Promise<Array>} 实验列表
   */
  async list(filters = {}) {
    try {
      let query = this.supabase
        .from('experiments')
        .select('*')
        .order('created_at', { ascending: false });

      // 应用筛选条件
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.tradingMode) {
        query = query.eq('trading_mode', filters.tradingMode);
      }
      if (filters.blockchain) {
        query = query.eq('blockchain', filters.blockchain);
      }
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return (data || []).map(row => Experiment.fromDatabaseFormat(row));

    } catch (error) {
      console.error('❌ 获取实验列表失败:', error.message);
      return [];
    }
  }

  /**
   * 删除实验
   * @param {string} experimentId - 实验ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  async delete(experimentId) {
    try {
      const { error } = await this.supabase
        .from('experiments')
        .delete()
        .eq('id', experimentId);

      if (error) {
        throw error;
      }

      return true;

    } catch (error) {
      console.error('❌ 删除实验失败:', error.message);
      return false;
    }
  }

  /**
   * 获取实验统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    try {
      const { data: experiments, error } = await this.supabase
        .from('experiments')
        .select('status, trading_mode, blockchain, created_at');

      if (error) {
        throw error;
      }

      const stats = {
        total: experiments?.length || 0,
        by_status: {},
        by_mode: {},
        by_blockchain: {},
        recent: experiments?.slice(-10) || []
      };

      // 统计分析
      experiments?.forEach(exp => {
        stats.by_status[exp.status] = (stats.by_status[exp.status] || 0) + 1;
        stats.by_mode[exp.trading_mode] = (stats.by_mode[exp.trading_mode] || 0) + 1;
        stats.by_blockchain[exp.blockchain] = (stats.by_blockchain[exp.blockchain] || 0) + 1;
      });

      return stats;

    } catch (error) {
      console.error('❌ 获取实验统计失败:', error.message);
      return {
        total: 0,
        by_status: {},
        by_mode: {},
        by_blockchain: {},
        recent: []
      };
    }
  }

  /**
   * 更新实验配置
   * @param {string} experimentId - 实验ID
   * @param {Object} config - 新的配置对象
   * @param {Object} options - 额外选项
   * @returns {Promise<{success: boolean, error?: string}>} 更新结果
   */
  async updateConfig(experimentId, config, options = {}) {
    try {
      // 验证实验是否存在
      const exists = await this.exists(experimentId);
      if (!exists) {
        return {
          success: false,
          error: '实验不存在'
        };
      }

      // 构建更新数据
      const updateData = {
        config: config,
        updated_at: new Date().toISOString()
      };

      // 可选：更新实验名称和描述
      if (options.experimentName !== undefined) {
        updateData.experiment_name = options.experimentName;
      }
      if (options.experimentDescription !== undefined) {
        updateData.experiment_description = options.experimentDescription;
      }

      const { error } = await this.supabase
        .from('experiments')
        .update(updateData)
        .eq('id', experimentId);

      if (error) {
        throw error;
      }

      console.log(`✅ 实验配置更新成功: ${experimentId}`);
      return { success: true };

    } catch (error) {
      console.error('❌ 更新实验配置失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 检查实验是否存在
   * @param {string} experimentId - 实验ID
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(experimentId) {
    try {
      const { data, error } = await this.supabase
        .from('experiments')
        .select('id')
        .eq('id', experimentId)
        .single();

      if (error) {
        return false;
      }

      return !!data;

    } catch (error) {
      return false;
    }
  }

  /**
   * 获取实验单例实例
   * @returns {ExperimentFactory} 工厂实例
   */
  static getInstance() {
    if (!ExperimentFactory.instance) {
      ExperimentFactory.instance = new ExperimentFactory();
    }
    return ExperimentFactory.instance;
  }
}

module.exports = { ExperimentFactory };
