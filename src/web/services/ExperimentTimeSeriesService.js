/**
 * 实验时序数据服务
 * 用于记录和查询实验运行过程中的时间序列数据
 * 参考 rich-js 实现
 */

const { dbManager } = require('../../services/dbManager');

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
   * @param {Object} data.factorValues - 因子值对象（仅包含常规因子：基础因子 + 趋势因子）
   * @param {string} [data.blockchain] - 区块链类型
   * @returns {Promise<boolean>} 是否成功
   */
  async recordRoundData(data) {
    try {
      // 立即记录方法被调用（用于调试）
      console.log(`🔍 [时序数据] recordRoundData 被调用 | ${data.tokenSymbol}`);

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
        blockchain: data.blockchain || 'bsc'
      };

      const { error } = await supabase
        .from('experiment_time_series_data')
        .insert([record]);

      if (error) {
        // 使用 console.error 确保错误输出
        console.error('❌ [时序数据] 插入失败:', error.message, '|', JSON.stringify({
          experimentId: data.experimentId,
          tokenSymbol: data.tokenSymbol,
          error: error
        }));
        return false;
      }

      // 使用 console.log 确保输出到标准输出
      console.log(`✅ [时序数据] 插入成功 | ${data.tokenSymbol} (${data.tokenAddress})`);

      return true;
    } catch (error) {
      console.error('❌ [时序数据] 异常:', error.message);
      return false;
    }
  }

  /**
   * 获取实验的时序数据（优化版，支持重试）
   * @param {string} experimentId - 实验ID
   * @param {string|Array<string>} [tokenAddress] - 代币地址或地址数组（可选）
   * @param {Object} [options] - 查询选项
   * @returns {Promise<Array>} 时序数据数组
   */
  async getExperimentTimeSeries(experimentId, tokenAddress = null, options = {}) {
    try {
      const supabase = dbManager.getClient();

      // 根据重试次数调整超时和分页大小
      const retryAttempt = options.retryAttempt || 1;
      const maxRetries = options.maxRetries || 3;

      // 增加超时时间：首次60秒，最少30秒
      const BASE_PAGE_SIZE = 100;
      const PAGE_SIZE = Math.max(50, Math.floor(BASE_PAGE_SIZE / retryAttempt));
      const MAX_PAGES = 20000;
      const QUERY_TIMEOUT = Math.max(30000, Math.floor(60000 / retryAttempt)); // 首次60秒，最少30秒

      let allData = [];
      let page = 0;
      let hasMore = true;
      let consecutiveErrors = 0;
      let consecutiveEmptyPages = 0;
      let currentTimeoutRetries = 0; // 当前页的超时重试计数
      const MAX_CONSECUTIVE_ERRORS = 3;
      const MAX_CONSECUTIVE_EMPTY_PAGES = 5; // 连续5页空数据后停止
      const MAX_TIMEOUT_RETRIES = 2; // 超时重试次数

      // 日志中显示筛选信息
      const tokenFilterInfo = Array.isArray(tokenAddress)
        ? `${tokenAddress.length} 个代币`
        : tokenAddress || '全部';
      console.log(`📊 [时序数据] 开始查询 (重试 ${retryAttempt}/${maxRetries}, 分页大小: ${PAGE_SIZE}, 超时: ${QUERY_TIMEOUT}ms, 代币: ${tokenFilterInfo})`);

      let lastTimestamp = null; // 用于游标分页

      while (hasMore && page < MAX_PAGES) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        try {
          // 创建查询 - 使用游标分页避免 range() 的问题
          let query = supabase
            .from('experiment_time_series_data')
            .select('id, experiment_id, token_address, token_symbol, timestamp, loop_count, price_usd, price_native, factor_values, blockchain')
            .eq('experiment_id', experimentId)
            .order('timestamp', { ascending: true })
            .range(from, to);

          // 支持单个地址（字符串）或多个地址（数组）过滤
          if (tokenAddress) {
            if (Array.isArray(tokenAddress)) {
              if (tokenAddress.length > 0) {
                query = query.in('token_address', tokenAddress);
              }
            } else {
              query = query.eq('token_address', tokenAddress);
            }
          }

          if (options.startTime) {
            query = query.gte('timestamp', options.startTime);
          }

          if (options.endTime) {
            query = query.lte('timestamp', options.endTime);
          }

          // 执行查询（带超时）
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout')), QUERY_TIMEOUT);
          });

          const { data, error } = await Promise.race([query, timeoutPromise]);

          // 调试日志：每页都输出
          console.log(`📊 [时序数据] 第 ${page + 1} 页 (range ${from}-${to}): ${data?.length || 0} 条, hasMore=${hasMore}`);

          if (error) {
            if (error.message === 'Query timeout' || error.message?.includes('timeout')) {
              currentTimeoutRetries++;
              if (currentTimeoutRetries <= MAX_TIMEOUT_RETRIES) {
                console.warn(`⚠️ [时序数据] 查询超时 (页 ${page + 1}), 重试 ${currentTimeoutRetries}/${MAX_TIMEOUT_RETRIES}...`);
                continue; // 重试当前页（不增加page）
              }
              console.warn(`⚠️ [时序数据] 查询超时 (页 ${page + 1}, from=${from}, to=${to})，已重试 ${MAX_TIMEOUT_RETRIES} 次，已获取 ${allData.length} 条数据`);
              // 超时时返回已获取的数据
              if (allData.length > 0) {
                console.log(`📊 [时序数据] 返回部分数据: ${allData.length} 条`);
                return allData;
              }
              throw new Error(`查询超时且无数据返回`);
            }

            // 其他错误
            console.warn(`⚠️ [时序数据] 查询错误 (页 ${page + 1}):`, error.message);
            consecutiveErrors++;

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.warn(`⚠️ [时序数据] 连续错误 ${consecutiveErrors} 次，停止查询`);
              break;
            }

            hasMore = false;
            break;
          }

          // 重置连续错误计数和超时重试计数
          consecutiveErrors = 0;
          currentTimeoutRetries = 0;

          if (data && data.length > 0) {
            allData = allData.concat(data);
            consecutiveEmptyPages = 0; // 重置空页计数

            // 记录最后一个时间戳，用于后续查询
            if (data.length > 0) {
              lastTimestamp = data[data.length - 1].timestamp;
            }

            // 如果返回的数据少于PAGE_SIZE，说明已经是最后一页
            hasMore = data.length === PAGE_SIZE;
          } else {
            // 返回空数据
            consecutiveEmptyPages++;
            console.warn(`⚠️ [时序数据] 第 ${page + 1} 页返回空数据 (连续空页: ${consecutiveEmptyPages}/${MAX_CONSECUTIVE_EMPTY_PAGES})`);

            // 连续多次空数据，可能已经没有更多数据了
            if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
              console.warn(`⚠️ [时序数据] 连续 ${MAX_CONSECUTIVE_EMPTY_PAGES} 页空数据，停止查询`);
              hasMore = false;
            }
          }

          page++;

          // 显示进度（每20页显示一次，避免过多输出）
          if (page % 20 === 0) {
            console.log(`📊 [时序数据] 已获取 ${allData.length} 条数据...`);
          }

          // 如果设置了limit且已获取足够数据，提前退出
          if (options.limit && allData.length >= options.limit) {
            console.log(`📊 [时序数据] 达到 limit 限制 (${options.limit})，提前退出`);
            allData = allData.slice(0, options.limit);
            break;
          }

        } catch (queryError) {
          if (queryError.message === 'Query timeout' || queryError.message?.includes('timeout')) {
            currentTimeoutRetries++;
            if (currentTimeoutRetries <= MAX_TIMEOUT_RETRIES) {
              console.warn(`⚠️ [时序数据] 查询超时 (页 ${page + 1}), 重试 ${currentTimeoutRetries}/${MAX_TIMEOUT_RETRIES}...`);
              continue; // 重试当前页（不增加page）
            }
            console.warn(`⚠️ [时序数据] 查询超时 (页 ${page + 1})，已重试 ${MAX_TIMEOUT_RETRIES} 次，已获取 ${allData.length} 条数据`);
            if (allData.length > 0) {
              console.log(`📊 [时序数据] 返回部分数据: ${allData.length} 条`);
              return allData;
            }
            throw new Error(`查询超时且无数据返回`);
          }

          console.error(`❌ [时序数据] 查询异常 (页 ${page + 1}):`, queryError.message);
          consecutiveErrors++;

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.warn(`⚠️ [时序数据] 连续错误 ${consecutiveErrors} 次，停止查询`);
            break;
          }

          hasMore = false;
          break;
        }
      }

      console.log(`📊 [时序数据] 查询循环结束: page=${page}, hasMore=${hasMore}, allData.length=${allData.length}`);
      console.log(`📊 [时序数据] 查询循环结束: page=${page}, hasMore=${hasMore}, allData.length=${allData.length}`);
      console.log(`📊 [时序数据] 共获取 ${allData.length} 条数据 (实验: ${experimentId}, 代币: ${tokenAddress || '全部'})`);
      return allData;

    } catch (error) {
      console.error('❌ [时序数据] 获取失败:', error.message);
      throw error; // 抛出错误，让调用者处理重试
    }
  }

  /**
   * 获取有数据的实验列表
   * @returns {Promise<Array>} 实验列表
   */
  async getExperimentsWithData() {
    try {
      const supabase = dbManager.getClient();

      // 使用更高效的查询：直接统计每个实验的数据点数量
      // 使用 RPC 调用或者分组查询来减少数据传输
      const { data, error } = await supabase
        .from('experiment_time_series_data')
        .select('experiment_id, blockchain')
        .limit(10000); // 增加限制，但只获取必要字段

      // 表不存在时返回空数组
      if (error) {
        console.warn('⚠️ [时序数据] 表不存在或查询失败:', error.message);
        return [];
      }

      // 使用 Set 去重，统计唯一实验
      const experimentsMap = new Map();

      for (const record of data || []) {
        const expId = record.experiment_id;
        if (!experimentsMap.has(expId)) {
          experimentsMap.set(expId, {
            experimentId: expId,
            blockchain: record.blockchain || 'bsc',
            dataPointCount: 0,
            tokenCount: 0
          });
        }
        experimentsMap.get(expId).dataPointCount++;
      }

      // 如果数据很多，说明可能有更完整的数据，再查询详细信息
      const result = Array.from(experimentsMap.values());

      // 只返回有足够数据的实验（至少100个数据点）
      return result.filter(exp => exp.dataPointCount >= 100);

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

      // 表不存在或没有数据时返回空数组
      if (error) {
        console.warn('⚠️ [时序数据] 表不存在或查询失败:', error.message);
        return [];
      }

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

  /**
   * 获取可用的因子列表
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Array>} 因子名称数组
   */
  async getAvailableFactors(experimentId, tokenAddress) {
    try {
      const data = await this.getExperimentTimeSeries(experimentId, tokenAddress);

      const factorSet = new Set();
      for (const record of data) {
        if (record.factor_values && typeof record.factor_values === 'object') {
          Object.keys(record.factor_values).forEach(key => factorSet.add(key));
        }
      }

      return Array.from(factorSet).sort();
    } catch (error) {
      console.error('❌ [时序数据] 获取因子列表失败:', error.message);
      return [];
    }
  }

  /**
   * 分页获取时序数据
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @param {Object} options - 分页选项
   * @param {number} options.page - 页码（从1开始）
   * @param {number} options.pageSize - 每页大小
   * @returns {Promise<Object>} 分页结果
   */
  async getPaginatedTimeSeries(experimentId, tokenAddress, options = {}) {
    try {
      const page = options.page || 1;
      const pageSize = options.pageSize || 50;

      // 获取所有数据
      const allData = await this.getExperimentTimeSeries(experimentId, tokenAddress);

      const total = allData.length;
      const totalPages = Math.ceil(total / pageSize);
      const offset = (page - 1) * pageSize;

      const paginatedData = allData.slice(offset, offset + pageSize);

      return {
        data: paginatedData,
        total,
        page,
        pageSize,
        totalPages
      };
    } catch (error) {
      console.error('❌ [时序数据] 分页查询失败:', error.message);
      return {
        data: [],
        total: 0,
        page: options.page || 1,
        pageSize: options.pageSize || 50,
        totalPages: 0
      };
    }
  }
}

module.exports = { ExperimentTimeSeriesService };
