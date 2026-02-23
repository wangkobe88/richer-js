/**
 * 代币涨幅分析服务
 * 用于分析代币的最终涨幅和最高涨幅
 */

const { dbManager } = require('../../services/dbManager');

class TokenAnalysisService {
  constructor() {
    this.supabase = dbManager.getClient();
  }

  /**
   * 分析实验的所有代币
   * @param {string} experimentId - 实验ID
   * @param {Function} progressCallback - 进度回调 (current, total)
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeExperimentTokens(experimentId, progressCallback = null) {
    try {
      // 获取所有代币
      const tokens = await this.getAllTokens(experimentId);

      let analyzed = 0;
      let failed = 0;
      const results = [];

      for (const token of tokens) {
        try {
          const analysis = await this.analyzeToken(experimentId, token.token_address);
          results.push(analysis);
          analyzed++;

          if (progressCallback) {
            progressCallback(analyzed, tokens.length);
          }
        } catch (error) {
          console.error(`分析代币失败 ${token.token_address}:`, error.message);
          failed++;
        }
      }

      return {
        success: true,
        total: tokens.length,
        analyzed,
        failed,
        results
      };
    } catch (error) {
      console.error('分析实验代币失败:', error);
      throw error;
    }
  }

  /**
   * 分析单个代币
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeToken(experimentId, tokenAddress) {
    try {
      // 获取时序数据
      const timeSeriesData = await this.getTokenTimeSeries(experimentId, tokenAddress);

      if (!timeSeriesData || timeSeriesData.length === 0) {
        return {
          token_address: tokenAddress,
          success: false,
          reason: 'no_time_series_data'
        };
      }

      // 按时间排序
      timeSeriesData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // 获取初始价格（第一条记录）
      const initialPrice = parseFloat(timeSeriesData[0].price_usd) || 0;

      if (initialPrice === 0) {
        return {
          token_address: tokenAddress,
          success: false,
          reason: 'invalid_initial_price'
        };
      }

      // 获取最终价格（最后一条记录）
      const finalPrice = parseFloat(timeSeriesData[timeSeriesData.length - 1].price_usd) || 0;

      // 获取最高价格
      const maxPrice = Math.max(...timeSeriesData.map(d => parseFloat(d.price_usd) || 0));

      // 计算涨幅百分比
      const finalChangePercent = initialPrice > 0 ? ((finalPrice - initialPrice) / initialPrice) * 100 : 0;
      const maxChangePercent = initialPrice > 0 ? ((maxPrice - initialPrice) / initialPrice) * 100 : 0;

      const analysisResult = {
        final_change_percent: parseFloat(finalChangePercent.toFixed(2)),
        max_change_percent: parseFloat(maxChangePercent.toFixed(2)),
        final_price: parseFloat(finalPrice.toFixed(10)),
        max_price: parseFloat(maxPrice.toFixed(10)),
        initial_price: parseFloat(initialPrice.toFixed(10)),
        analyzed_at: new Date().toISOString(),
        data_points: timeSeriesData.length
      };

      // 保存到数据库
      await this.saveAnalysisResult(experimentId, tokenAddress, analysisResult);

      return {
        token_address: tokenAddress,
        success: true,
        data: analysisResult
      };
    } catch (error) {
      console.error(`分析代币失败 ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * 获取实验的所有代币
   */
  async getAllTokens(experimentId) {
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    let allTokens = [];

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('experiment_tokens')
        .select('token_address')
        .eq('experiment_id', experimentId)
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`查询代币列表失败: ${error.message}`);
      }

      if (data && data.length > 0) {
        allTokens = allTokens.concat(data);
        offset += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    return allTokens;
  }

  /**
   * 获取代币的时序数据
   */
  async getTokenTimeSeries(experimentId, tokenAddress) {
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    let allData = [];

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('experiment_time_series_data')
        .select('timestamp, price_usd')
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress)
        .order('timestamp', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        // 表不存在或没有数据
        if (error.code === '42P01' || error.code === 'PGRST116') {
          return [];
        }
        throw new Error(`查询时序数据失败: ${error.message}`);
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        offset += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    return allData;
  }

  /**
   * 保存分析结果到数据库
   */
  async saveAnalysisResult(experimentId, tokenAddress, analysisResult) {
    const { error } = await this.supabase
      .from('experiment_tokens')
      .update({ analysis_results: analysisResult })
      .eq('experiment_id', experimentId)
      .eq('token_address', tokenAddress);

    if (error) {
      throw new Error(`保存分析结果失败: ${error.message}`);
    }
  }

  /**
   * 批量更新分析结果
   * @param {string} experimentId - 实验ID
   * @param {Array} results - 分析结果数组 [{ tokenAddress, data }]
   */
  async batchSaveResults(experimentId, results) {
    const batchSize = 100;
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);

      const promises = batch.map(result =>
        this._saveAnalysisResult(experimentId, result.token_address, result.data)
      );

      await Promise.all(promises);
    }
  }
}

module.exports = { TokenAnalysisService };
