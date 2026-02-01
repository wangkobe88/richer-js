/**
 * 实验时序数据服务
 * 用于记录和查询实验运行过程中的时间序列数据
 * 参考 rich-js 实现
 */

const { dbManager } = require('../services/dbManager');

/**
 * 实验时序数据服务类
 * @class
 */
class ExperimentTimeSeriesService {
  /**
   * 记录轮次数据
   * @param {Object} data - 时序数据对象
   * @param {string} data.experimentId - 实验ID
   * @param {string} data.tokenAddress - 代币地址
   * @param {string} data.tokenSymbol - 代币符号
   * @param {Date|string} data.timestamp - 时间戳
   * @param {number} data.loopCount - 轮次计数
   * @param {number} data.priceUsd - USD价格
   * @param {number} data.priceNative - 原生币价格
   * @param {Object} data.factorValues - 因子值对象
   * @param {string} [data.signalType] - 信号类型 (BUY/SELL/HOLD)
   * @param {boolean} [data.signalExecuted] - 信号是否执行
   * @param {string} [data.executionReason] - 执行原因或策略信息
   * @param {string} [data.blockchain] - 区块链类型
   * @returns {Promise<boolean>} 是否成功
   */
  async recordRoundData(data) {
    try {
      const supabase = dbManager.getClient();

      const record = {
        experiment_id: data.experimentId,
        token_address: data.tokenAddress,
        token_symbol: data.tokenSymbol,
        timestamp: data.timestamp,
        loop_count: data.loopCount,
        price_usd: data.priceUsd !== null && data.priceUsd !== undefined ? String(data.priceUsd) : null,
        price_native: data.priceNative !== null && data.priceNative !== undefined ? String(data.priceNative) : null,
        factor_values: data.factorValues || {},
        signal_type: data.signalType || null,
        signal_executed: data.signalExecuted !== undefined ? data.signalExecuted : null,
        execution_reason: data.executionReason || null,
        blockchain: data.blockchain || 'bsc'
      };

      const { error } = await supabase
        .from('experiment_time_series_data')
        .insert([record]);

      if (error) {
        console.error('❌ [时序数据] 插入失败:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ [时序数据] 异常:', error.message);
      return false;
    }
  }

  /**
   * 获取实验的时序数据
   * @param {string} experimentId - 实验ID
   * @param {string} [tokenAddress] - 代币地址（可选）
   * @param {Object} [options] - 查询选项
   * @returns {Promise<Array>} 时序数据数组
   */
  async getExperimentTimeSeries(experimentId, tokenAddress = null, options = {}) {
    try {
      const supabase = dbManager.getClient();

      // Supabase max-rows 限制为 1000，使用分页查询
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 100;

      let allData = [];
      let page = 0;
      let hasMore = true;

      while (hasMore && page < MAX_PAGES) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let query = supabase
          .from('experiment_time_series_data')
          .select('*')
          .eq('experiment_id', experimentId)
          .order('timestamp', { ascending: true })
          .range(from, to);

        if (tokenAddress) {
          query = query.eq('token_address', tokenAddress);
        }

        if (options.startTime) {
          query = query.gte('timestamp', options.startTime);
        }

        if (options.endTime) {
          query = query.lte('timestamp', options.endTime);
        }

        const { data, error } = await query;

        if (error) {
          throw error;
        }

        if (data && data.length > 0) {
          allData = allData.concat(data);
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }

        page++;

        if (options.limit && allData.length >= options.limit) {
          allData = allData.slice(0, options.limit);
          break;
        }
      }

      return allData;
    } catch (error) {
      console.error('❌ [时序数据] 获取失败:', error.message);
      return [];
    }
  }

  /**
   * 获取有数据的实验列表
   * @returns {Promise<Array>} 实验列表
   */
  async getExperimentsWithData() {
    try {
      const supabase = dbManager.getClient();

      const { data, error } = await supabase
        .from('experiment_time_series_data')
        .select('experiment_id, token_address, token_symbol, timestamp, blockchain')
        .order('timestamp', { ascending: false })
        .limit(1000);

      if (error) throw error;

      const experimentsMap = new Map();

      for (const record of data || []) {
        if (!experimentsMap.has(record.experiment_id)) {
          experimentsMap.set(record.experiment_id, {
            experimentId: record.experiment_id,
            blockchain: record.blockchain,
            tokens: new Map(),
            dataPointCount: 0
          });
        }

        const exp = experimentsMap.get(record.experiment_id);
        const tokenKey = record.token_address.toLowerCase();

        if (!exp.tokens.has(tokenKey)) {
          exp.tokens.set(tokenKey, {
            address: record.token_address,
            symbol: record.token_symbol,
            dataPointCount: 0
          });
        }

        exp.tokens.get(tokenKey).dataPointCount++;
        exp.dataPointCount++;
      }

      return Array.from(experimentsMap.values());
    } catch (error) {
      console.error('❌ [时序数据] 获取实验列表失败:', error.message);
      return [];
    }
  }

  /**
   * 获取实验的代币列表
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Array>} 代币列表
   */
  async getExperimentTokens(experimentId) {
    try {
      const supabase = dbManager.getClient();

      const { data, error } = await supabase
        .from('experiment_time_series_data')
        .select('token_address, token_symbol')
        .eq('experiment_id', experimentId)
        .limit(1000);

      if (error) throw error;

      const uniqueTokens = new Map();
      for (const record of data || []) {
        const key = record.token_address.toLowerCase();
        if (!uniqueTokens.has(key)) {
          uniqueTokens.set(key, {
            address: record.token_address,
            symbol: record.token_symbol
          });
        }
      }

      return Array.from(uniqueTokens.values());
    } catch (error) {
      console.error('❌ [时序数据] 获取代币列表失败:', error.message);
      return [];
    }
  }

  /**
   * 获取特定因子的时序数据
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @param {string} factorName - 因子名称
   * @returns {Promise<Array>} 因子值数组
   */
  async getFactorTimeSeries(experimentId, tokenAddress, factorName) {
    try {
      const data = await this.getExperimentTimeSeries(experimentId, tokenAddress);

      return data
        .map(record => ({
          timestamp: record.timestamp,
          loopCount: record.loop_count,
          value: record.factor_values?.[factorName] !== undefined
            ? record.factor_values[factorName]
            : null
        }))
        .filter(item => item.value !== null);
    } catch (error) {
      console.error('❌ [时序数据] 获取因子时序数据失败:', error.message);
      return [];
    }
  }
}

module.exports = { ExperimentTimeSeriesService };
