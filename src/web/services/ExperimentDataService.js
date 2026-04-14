/**
 * 实验数据服务层 - 统一管理信号与交易实体
 * 用于 fourmeme 交易实验
 */

const { Trade } = require('../../trading-engine/entities/Trade');
const { TradeSignal } = require('../../trading-engine/entities/TradeSignal');
const { dbManager } = require('../../services/dbManager');
const { extractNarrativeMaterialId } = require('../../narrative/utils/material-id-extractor.mjs');
const { buildLLMAnalysis } = require('../../narrative/analyzer/parsers/response-parser.mjs');

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
      // 🔥 Supabase 单次查询最多返回 1000 行，需要分页获取
      const offset = parseInt(options.offset) || 0;
      const maxLimit = 10000; // 设置最大返回数量上限
      let limit = parseInt(options.limit) || 100;

      // 防止 limit 过大导致性能问题
      if (limit > maxLimit) {
        console.warn(`[getTrades] 请求的 limit (${limit}) 超过最大限制 (${maxLimit})，已自动调整为 ${maxLimit}`);
        limit = maxLimit;
      }

      // Supabase 分页大小限制
      const PAGE_SIZE = 1000;
      const allData = [];
      let currentOffset = offset;
      let remaining = limit;

      // 循环获取数据，直到获取足够数量或没有更多数据
      while (remaining > 0) {
        const pageSize = Math.min(PAGE_SIZE, remaining);

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

        // 分页
        query = query.range(currentOffset, currentOffset + pageSize - 1);

        // 排序
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) throw error;

        if (!data || data.length === 0) {
          break; // 没有更多数据
        }

        allData.push(...data);
        remaining -= data.length;
        currentOffset += data.length;

        // 如果返回的数据少于请求的数量，说明已经到末尾了
        if (data.length < pageSize) {
          break;
        }
      }

      // 转换为Trade实体
      return allData.map(tradeData => Trade.fromDatabaseFormat(tradeData));

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
      // 🔥 Supabase 单次查询最多返回 1000 行，需要分页获取
      const offset = parseInt(options.offset) || 0;
      const maxLimit = 10000; // 设置最大返回数量上限
      let limit = parseInt(options.limit) || 1000;

      // 提高默认 limit 以确保 BUY 信号不被遗漏
      if (!options.limit && limit === 100) {
        limit = 1000;
      }

      // 防止 limit 过大导致性能问题
      if (limit > maxLimit) {
        console.warn(`[getSignals] 请求的 limit (${limit}) 超过最大限制 (${maxLimit})，已自动调整为 ${maxLimit}`);
        limit = maxLimit;
      }

      // Supabase 分页大小限制
      const PAGE_SIZE = 1000;
      const allData = [];
      let currentOffset = offset;
      let remaining = limit;

      // 循环获取数据，直到获取足够数量或没有更多数据
      while (remaining > 0) {
        const pageSize = Math.min(PAGE_SIZE, remaining);

        let query = this.supabase
          .from('strategy_signals')
          .select('*')
          .eq('experiment_id', experimentId);

        // 添加筛选条件
        if (options.tokenAddress) {
          query = query.eq('token_address', options.tokenAddress);
        }
        if (options.action) {
          query = query.eq('action', options.action);
        }
        if (options.signalType) {
          query = query.eq('signal_type', options.signalType);
        }

        // 分页
        query = query.range(currentOffset, currentOffset + pageSize - 1);

        // 排序：当指定了tokenAddress时，只按时间排序；否则优先显示BUY信号
        if (options.tokenAddress) {
          // 按特定代币查询时，按时间降序排列（买入和卖出信号混合）
          query = query.order('created_at', { ascending: false });
        } else {
          // 查询全部信号时，优先显示BUY信号，然后按时间降序
          query = query.order('action', { ascending: false })
                    .order('created_at', { ascending: false });
        }

        const { data, error } = await query;

        if (error) throw error;

        if (!data || data.length === 0) {
          break; // 没有更多数据
        }

        allData.push(...data);
        remaining -= data.length;
        currentOffset += data.length;

        // 如果返回的数据少于请求的数量，说明已经到末尾了
        if (data.length < pageSize) {
          break;
        }
      }

      // 转换为TradeSignal实体
      return allData.map(signalData => TradeSignal.fromDatabaseFormat(signalData));

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
   * 更新交易信号
   * @param {TradeSignal} signal - 信号实体
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateSignal(signal) {
    try {
      const { error } = await this.supabase
        .from('strategy_signals')
        .update(signal.toDatabaseFormat())
        .eq('id', signal.id);

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('更新信号失败:', error);
      return false;
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
   * 更新交易记录
   * @param {string} tradeId - 交易ID
   * @param {Object} updates - 要更新的字段
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateTrade(tradeId, updates) {
    try {
      const { error } = await this.supabase
        .from('trades')
        .update(updates)
        .eq('id', tradeId);

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('更新交易记录失败:', error);
      return false;
    }
  }

  /**
   * 清理实验数据
   * @param {string} experimentId - 实验ID
   * @returns {Promise<boolean>} 是否清理成功
   */
  async clearExperimentData(experimentId) {
    try {
      // 时序数据表使用分批删除（数据量大）
      const timeSeriesResult = await this._deleteTableInBatches(experimentId, 'experiment_time_series_data', 500);

      // 其他表直接删除（数据量小）
      const smallTables = ['trades', 'strategy_signals', 'portfolio_snapshots', 'experiment_tokens', 'token_holders', 'early_participant_trades'];
      const results = [timeSeriesResult];

      for (const table of smallTables) {
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
      console.log(`清理实验数据完成: ${successCount}/${results.length} 个表成功`);

      return successCount === results.length;

    } catch (error) {
      console.error('清理实验数据失败:', error);
      return false;
    }
  }

  /**
   * 分批删除表数据（避免超时）
   * @private
   * @param {string} experimentId - 实验ID
   * @param {string} table - 表名
   * @param {number} batchSize - 批次大小
   * @returns {Promise<Object>} 删除结果
   */
  async _deleteTableInBatches(experimentId, table, batchSize = 500) {
    const maxAttempts = 3;
    let attempt = 0;
    let totalDeleted = 0;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        // 检查剩余数据
        const { count, error: countError } = await this.supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('experiment_id', experimentId);

        if (countError) {
          console.warn(`   检查 ${table} 剩余数据失败: ${countError.message}`);
        }

        const remaining = count || 0;

        if (remaining === 0) {
          console.log(`✅ ${table}: 全部删除完成 (${totalDeleted} 条)`);
          return { table, success: true, deletedCount: totalDeleted };
        }

        // 删除一批数据（必须指定 order）
        const { error } = await this.supabase
          .from(table)
          .delete()
          .eq('experiment_id', experimentId)
          .order('id', { ascending: true })
          .limit(batchSize);

        if (error) {
          console.warn(`   ${table} 批次删除失败: ${error.message}`);
          if (attempt >= maxAttempts) {
            return { table, success: false, error: error.message };
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        totalDeleted += batchSize;
        if (totalDeleted > remaining) totalDeleted = remaining;

        console.log(`   ${table}: 进度 ${totalDeleted}/${remaining}`);

        // 重置尝试次数
        attempt = 0;

      } catch (err) {
        console.error(`   ${table} 删除异常: ${err.message}`);
        if (attempt >= maxAttempts) {
          return { table, success: false, error: err.message };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return { table, success: false, error: '超过最大尝试次数' };
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

  // ========== 代币相关方法 ==========

  /**
   * 记录代币被发现
   * @param {string} experimentId - 实验ID
   * @param {Object} token - 代币信息
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveToken(experimentId, token) {
    try {
      const insertData = {
        experiment_id: experimentId,
        token_address: token.token,
        token_symbol: token.symbol || '',
        blockchain: token.chain || 'bsc',
        platform: token.platform || 'fourmeme',
        discovered_at: new Date(token.created_at * 1000).toISOString(),
        status: token.status || 'monitoring'
      };

      // 如果有原始 API 数据，添加到插入数据中
      if (token.raw_api_data) {
        insertData.raw_api_data = token.raw_api_data;
      }

      // 如果有合约风险数据，添加到插入数据中
      if (token.contract_risk_raw_ave_data) {
        insertData.contract_risk_raw_ave_data = token.contract_risk_raw_ave_data;
      }

      // 如果有创建者地址，添加到插入数据中
      if (token.creator_address) {
        insertData.creator_address = token.creator_address;
      }

      // 自动提取叙事表征语料ID
      if (token.raw_api_data) {
        try {
          const materialId = extractNarrativeMaterialId(token.raw_api_data);
          if (materialId) {
            insertData.narrative_material_id = materialId;
          }
        } catch (err) {
          console.warn('[ExperimentDataService] 提取narrative_material_id失败:', err.message);
        }
      }

      const { error } = await this.supabase
        .from('experiment_tokens')
        .insert(insertData);

      if (error) {
        // 如果是唯一约束冲突，说明已存在，返回成功
        if (error.code === '23505') {
          return true;
        }
        throw error;
      }

      return true;

    } catch (error) {
      console.error('保存代币失败:', error);
      return false;
    }
  }

  /**
   * 更新代币状态
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @param {string} status - 状态 (monitoring, bought, exited)
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateTokenStatus(experimentId, tokenAddress, status) {
    try {
      const { error } = await this.supabase
        .from('experiment_tokens')
        .update({ status: status, updated_at: new Date().toISOString() })
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress);

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('更新代币状态失败:', error);
      return false;
    }
  }

  /**
   * 更新代币的 creator_address
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @param {string} creatorAddress - 创建者地址
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateTokenCreatorAddress(experimentId, tokenAddress, creatorAddress) {
    try {
      const { error } = await this.supabase
        .from('experiment_tokens')
        .update({ creator_address: creatorAddress, updated_at: new Date().toISOString() })
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress);

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('更新代币 creator_address 失败:', error);
      return false;
    }
  }

  /**
   * 批量补充代币的叙事表征语料ID
   * 增量更新：跳过已有 narrative_material_id 的 token
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 补充结果统计
   */
  async backfillNarrativeMaterialId(experimentId) {
    try {
      const pageSize = 1000;
      let offset = 0;
      let hasMore = true;
      let allTokens = [];

      // 分页查询所有缺少 material_id 的代币
      while (hasMore) {
        const { data, error } = await this.supabase
          .from('experiment_tokens')
          .select('id, token_address, token_symbol, raw_api_data')
          .eq('experiment_id', experimentId)
          .is('narrative_material_id', null)
          .range(offset, offset + pageSize - 1);

        if (error) throw new Error(`查询代币失败: ${error.message}`);
        if (data && data.length > 0) {
          allTokens = allTokens.concat(data);
          offset += pageSize;
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      console.log(`[MaterialID补全] 实验下共 ${allTokens.length} 个代币缺少 material_id`);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const token of allTokens) {
        if (!token.raw_api_data) {
          skipped++;
          continue;
        }

        try {
          const materialId = extractNarrativeMaterialId(token.raw_api_data);
          if (materialId) {
            const { error: updateError } = await this.supabase
              .from('experiment_tokens')
              .update({ narrative_material_id: materialId })
              .eq('id', token.id);

            if (updateError) {
              failed++;
              console.warn(`[MaterialID补全] 更新失败 ${token.token_symbol}: ${updateError.message}`);
            } else {
              updated++;
            }
          } else {
            skipped++;
          }
        } catch (err) {
          failed++;
          console.warn(`[MaterialID补全] 提取失败 ${token.token_symbol}: ${err.message}`);
        }
      }

      console.log(`[MaterialID补全] 完成: 更新${updated}, 跳过${skipped}, 失败${failed}`);

      return {
        success: true,
        data: { total: allTokens.length, updated, skipped, failed }
      };
    } catch (error) {
      console.error('[MaterialID补全] 失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取实验的代币列表
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 代币列表
   */
  async getTokens(experimentId, options = {}) {
    try {
      // 🔥 对于回测实验，自动使用源实验的代币数据
      const targetExperimentId = await this._getTargetExperimentIdForTokens(experimentId);

      const sortBy = options.sortBy || 'discovered_at';
      const sortOrder = options.sortOrder || 'desc';
      const offset = parseInt(options.offset) || 0;
      const maxLimit = 10000; // 设置最大返回数量上限
      let limit = parseInt(options.limit) || 100;

      // 防止 limit 过大导致性能问题
      if (limit > maxLimit) {
        console.warn(`请求的 limit (${limit}) 超过最大限制 (${maxLimit})，已自动调整为 ${maxLimit}`);
        limit = maxLimit;
      }

      // 如果 limit <= 1000，直接查询
      if (limit <= 1000) {
        return await this._getTokensSingleQuery(targetExperimentId, options, offset, limit);
      }

      // 否则使用分页循环获取所有数据
      const pageSize = 1000;
      let allTokens = [];
      let currentOffset = offset;
      let remaining = limit;

      while (remaining > 0) {
        const currentPageSize = Math.min(remaining, pageSize);
        const pageTokens = await this._getTokensSingleQuery(targetExperimentId, options, currentOffset, currentPageSize);
        allTokens = allTokens.concat(pageTokens);

        if (pageTokens.length < currentPageSize) {
          // 没有更多数据了
          break;
        }

        remaining -= pageTokens.length;
        currentOffset += pageTokens.length;
      }

      return allTokens;

    } catch (error) {
      console.error('获取代币列表失败:', error);
      return [];
    }
  }

  /**
   * 获取代币数据的实际实验ID（回测实验使用源实验ID）
   * @private
   * @param {string} experimentId - 实验ID
   * @returns {Promise<string>} 目标实验ID
   */
  async _getTargetExperimentIdForTokens(experimentId) {
    try {
      console.log(`[_getTargetExperimentIdForTokens] 开始查询实验信息: ${experimentId}`);

      // 查询实验信息
      const { data: expConfig, error } = await this.supabase
        .from('experiments')
        .select('config')
        .eq('id', experimentId)
        .single();

      console.log(`[_getTargetExperimentIdForTokens] 查询结果: error=${error}, expConfig=${!!expConfig}`);

      if (error || !expConfig) {
        console.warn(`[getTokens] 无法获取实验信息: ${experimentId}, 使用原ID`);
        return experimentId;
      }

      console.log(`[_getTargetExperimentIdForTokens] expConfig keys: ${Object.keys(expConfig)}`);
      console.log(`[_getTargetExperimentIdForTokens] expConfig.config type: ${typeof expConfig.config}`);

      // 处理 config 字段（Supabase返回的原始数据）
      let config = expConfig.config;
      console.log(`[_getTargetExperimentIdForTokens] 原始config type: ${typeof config}, value: ${config}`);

      if (typeof config === 'string') {
        console.log(`[_getTargetExperimentIdForTokens] 解析 JSON config`);
        config = JSON.parse(config);
      }

      console.log(`[_getTargetExperimentIdForTokens] 解析后的config:`, config);
      console.log(`[_getTargetExperimentIdForTokens] config.backtest:`, config?.backtest);
      console.log(`[_getTargetExperimentIdForTokens] sourceExperimentId:`, config?.backtest?.sourceExperimentId);

      // 如果是回测实验且有源实验ID，使用源实验ID
      if (config?.backtest?.sourceExperimentId) {
        const sourceId = config.backtest.sourceExperimentId;
        console.log(`[getTokens] 回测实验使用源实验代币数据: ${experimentId} -> ${sourceId}`);
        return sourceId;
      }

      console.log(`[getTokens] 非回测实验或无源实验ID，使用原ID: ${experimentId}`);
      return experimentId;
    } catch (error) {
      console.error(`[getTokens] 判断源实验ID失败: ${error.message}`, error);
      return experimentId;
    }
  }

  /**
   * 单次查询获取代币列表
   * @private
   */
  async _getTokensSingleQuery(experimentId, options, offset, limit) {
    try {
      let query = this.supabase
        .from('experiment_tokens')
        .select('*')
        .eq('experiment_id', experimentId);

      // 状态筛选
      if (options.status) {
        query = query.eq('status', options.status);
      }

      // 排序
      const sortBy = options.sortBy || 'discovered_at';
      const sortOrder = options.sortOrder || 'desc';
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      // 分页
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        // 如果表不存在，返回空数组
        if (error.code === '42P01') {
          return [];
        }
        throw error;
      }

      return data || [];

    } catch (error) {
      console.error('获取代币列表失败:', error);
      return [];
    }
  }

  /**
   * 获取格式化的代币数据（用于前端API）
   * @param {string} experimentId - 实验ID
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>} 格式化的响应数据
   */
  async getFormattedTokens(experimentId, options = {}) {
    const tokens = await this.getTokens(experimentId, options);

    // 统计各状态数量
    const stats = {
      total: tokens.length,
      monitoring: tokens.filter(t => t.status === 'monitoring').length,
      bought: tokens.filter(t => t.status === 'bought').length,
      exited: tokens.filter(t => t.status === 'exited').length
    };

    return {
      success: true,
      data: tokens,
      tokens: tokens,
      count: tokens.length,
      stats: stats,
      metadata: {
        experimentId,
        timestamp: new Date().toISOString(),
        filters: options
      }
    };
  }

  /**
   * 获取单个代币详情
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @returns {Promise<Object|null>} 代币详情
   */
  async getToken(experimentId, tokenAddress) {
    try {
      // 🔥 对于回测实验，使用源实验的代币数据
      const targetExperimentId = await this._getTargetExperimentIdForTokens(experimentId);

      const { data, error } = await this.supabase
        .from('experiment_tokens')
        .select('*')
        .eq('experiment_id', targetExperimentId)
        .eq('token_address', tokenAddress)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;

    } catch (error) {
      console.error('获取代币详情失败:', error);
      return null;
    }
  }

  /**
   * 获取代币列表（包含信号标记）
   * 从 experiment_tokens 表获取所有代币，同时关联 strategy_signals 表标记哪些代币有交易信号
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 代币列表及信号信息
   */
  async getTokensWithSignals(experimentId) {
    try {
      // 检查是否是回测实验，如果是则使用源实验的代币列表
      let dataExperimentId = experimentId;
      const { data: experiment } = await this.supabase
        .from('experiments')
        .select('config')
        .eq('id', experimentId)
        .single();

      if (experiment?.config?.backtest?.sourceExperimentId) {
        dataExperimentId = experiment.config.backtest.sourceExperimentId;
        console.log(`getTokensWithSignals: 回测实验 ${experimentId}，使用源实验 ${dataExperimentId} 的代币列表`);
      }

      // 获取所有代币
      const tokens = await this.getTokens(dataExperimentId, { limit: 10000 });

      // 获取所有信号（使用源实验的信号）
      const signals = await this.getSignals(dataExperimentId, { limit: 10000 });

      // 统计每个代币的信号数量
      const tokenSignalMap = new Map();
      for (const signal of signals) {
        const addr = signal.tokenAddress;
        if (!tokenSignalMap.has(addr)) {
          tokenSignalMap.set(addr, {
            total: 0,
            buy: 0,
            sell: 0
          });
        }
        const stats = tokenSignalMap.get(addr);
        stats.total++;
        if (signal.signalType === 'BUY') stats.buy++;
        if (signal.signalType === 'SELL') stats.sell++;
      }

      // 组合数据
      const tokensWithSignals = tokens.map(token => {
        const signalStats = tokenSignalMap.get(token.token_address) || { total: 0, buy: 0, sell: 0 };
        return {
          token_address: token.token_address,
          token_symbol: token.token_symbol || token.raw_api_data?.symbol || 'Unknown',
          address: token.token_address,  // 兼容旧字段名
          symbol: token.token_symbol || token.raw_api_data?.symbol || 'Unknown',  // 兼容旧字段名
          status: token.status,
          discovered_at: token.discovered_at,
          discoveredAt: token.discovered_at,  // 兼容旧字段名
          hasSignals: signalStats.total > 0,
          signalCount: signalStats.total,
          buySignalCount: signalStats.buy,
          sellSignalCount: signalStats.sell,
          raw_api_data: token.raw_api_data
        };
      });

      // 按发现时间倒序排序
      tokensWithSignals.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));

      return {
        success: true,
        data: tokensWithSignals,
        count: tokensWithSignals.length
      };

    } catch (error) {
      console.error('获取代币列表（含信号）失败:', error);
      return {
        success: false,
        error: error.message,
        data: [],
        count: 0
      };
    }
  }

  /**
   * 获取代币统计（关联交易数据）
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 统计数据
   */
  async getTokenStats(experimentId) {
    try {
      // 获取所有代币
      const tokens = await this.getTokens(experimentId, { limit: 10000 });

      // 获取所有交易
      const trades = await this.getTrades(experimentId, { limit: 10000 });

      // 为每个代币统计交易次数
      const tokenTradeStats = {};
      trades.forEach(trade => {
        const addr = trade.tokenAddress;
        if (!tokenTradeStats[addr]) {
          tokenTradeStats[addr] = { buyCount: 0, sellCount: 0 };
        }
        if (trade.direction === 'buy') tokenTradeStats[addr].buyCount++;
        if (trade.direction === 'sell') tokenTradeStats[addr].sellCount++;
      });

      // 组合数据
      const tokensWithStats = tokens.map(token => ({
        ...token,
        tradeCount: (tokenTradeStats[token.token_address]?.buyCount || 0) +
                     (tokenTradeStats[token.token_address]?.sellCount || 0),
        buyCount: tokenTradeStats[token.token_address]?.buyCount || 0,
        sellCount: tokenTradeStats[token.token_address]?.sellCount || 0
      }));

      // 计算总体统计
      return {
        total: tokensWithStats.length,
        monitoring: tokensWithStats.filter(t => t.status === 'monitoring').length,
        bought: tokensWithStats.filter(t => t.status === 'bought').length,
        exited: tokensWithStats.filter(t => t.status === 'exited').length,
        buyRate: tokens.length > 0 ? (tokensWithStats.filter(t => t.status === 'bought').length / tokens.length * 100).toFixed(1) : '0',
        tokens: tokensWithStats
      };

    } catch (error) {
      console.error('获取代币统计失败:', error);
      return {
        total: 0,
        monitoring: 0,
        bought: 0,
        exited: 0,
        buyRate: '0',
        tokens: []
      };
    }
  }

  /**
   * 获取拒绝信号统计
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 拒绝统计数据
   */
  async getRejectionStats(experimentId) {
    try {
      // 获取所有信号（在JavaScript中过滤，因为Supabase JSONB查询不稳定）
      const { data, error } = await this.supabase
        .from('strategy_signals')
        .select('id, metadata, reason')
        .eq('experiment_id', experimentId);

      if (error) throw error;

      const byReason = {};
      let totalRejected = 0;

      if (data && data.length > 0) {
        // 过滤出被拒绝的信号
        const rejectedSignals = data.filter(signal =>
          signal.metadata?.execution_status === 'failed'
        );

        totalRejected = rejectedSignals.length;

        for (const signal of rejectedSignals) {
          let reason = signal.metadata?.execution_reason || signal.reason || '未知原因';

          // 简化和分类拒绝原因
          const category = this._categorizeRejectionReason(reason);
          byReason[category] = (byReason[category] || 0) + 1;
        }
      }

      return {
        totalRejected,
        byReason
      };

    } catch (error) {
      console.error('获取拒绝统计失败:', error);
      return {
        totalRejected: 0,
        byReason: {}
      };
    }
  }

  /**
   * 分类拒绝原因
   * @private
   * @param {string} reason - 原始拒绝原因
   * @returns {string} 分类后的原因
   */
  _categorizeRejectionReason(reason) {
    if (!reason) return '未知原因';

    const r = reason.toLowerCase();

    if (r.includes('negative_dev') || r.includes('负面dev')) return 'Dev钱包负面';
    if (r.includes('黑名单') || r.includes('blacklist')) return '黑/白名单检查';
    if (r.includes('早期参与者') || r.includes('pretrader') || r.includes('volumepermin') || r.includes('countpermin') || r.includes('highvaluepermin')) {
      return '早期参与者指标';
    }
    if (r.includes('dev持仓') || r.includes('devholding')) return 'Dev持仓超标';
    if (r.includes('大额持仓') || r.includes('maxholding') || r.includes('largeholding')) return '大额持仓超标';
    if (r.includes('预检查失败')) return '预检查失败';

    // 如果原始原因比较短，直接使用
    if (reason.length < 30) return reason;

    return '其他原因';
  }

  /**
   * 获取实验的叙事分析数据
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 叙事数据
   */
  async getExperimentNarratives(experimentId) {
    try {
      console.log(`[getExperimentNarratives] experimentId=${experimentId}`);

      // 对于回测实验，使用源实验的代币数据
      const targetExperimentId = await this._getTargetExperimentIdForTokens(experimentId);
      console.log(`[getExperimentNarratives] targetExperimentId=${targetExperimentId}`);

      // 获取目标实验的代币列表
      const tokens = await this.getTokens(targetExperimentId, { limit: 10000 });
      console.log(`[getExperimentNarratives] tokens.length=${tokens.length}`);

      if (tokens.length === 0) {
        return {
          success: true,
          data: [],
          count: 0,
          stats: {
            total_tokens: 0,
            narrative_tokens: 0,
            high_quality_count: 0,
            mid_quality_count: 0,
            low_quality_count: 0,
            unrated_count: 0,
            avg_max_change: 0
          }
        };
      }

      // 转换为小写地址，因为 token_narrative 表的 token_address 存储为小写
      const addresses = tokens.map(t => t.token_address.toLowerCase());

      // 分批查询叙事数据（避免 URL 过长导致 414 错误）
      const batchSize = 200;
      const allNarratives = [];
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        const { data: batchNarratives, error: batchError } = await this.supabase
          .from('token_narrative')
          .select('*')
          .in('token_address', batch);

        if (batchError) {
          console.error(`获取叙事数据失败（批次 ${i / batchSize + 1}）:`, batchError);
          throw batchError;
        }

        if (batchNarratives) {
          allNarratives.push(...batchNarratives);
        }
      }

      const narratives = allNarratives;
      console.log(`[getExperimentNarratives] narratives.length=${narratives.length}`);

      // 构建叙事数据映射（键使用小写地址，保留最新的记录）
      const narrativeMap = new Map();
      for (const narrative of (narratives || [])) {
        const addr = narrative.token_address.toLowerCase();
        const existing = narrativeMap.get(addr);
        // 如果没有记录，或者新记录的 analyzed_at 更新，则替换
        if (!existing || new Date(narrative.analyzed_at) > new Date(existing.analyzed_at)) {
          narrativeMap.set(addr, narrative);
        }
      }

      console.log(`[getExperimentNarratives] narrativeMap.size=${narrativeMap.size}`);

      // 调试：检查第一个 token 的字段
      if (tokens.length > 0) {
        console.log(`[getExperimentNarratives] 第一个代币字段:`, Object.keys(tokens[0]));
        console.log(`[getExperimentNarratives] 第一个代币的 human_judges:`, tokens[0].human_judges);
        console.log(`[getExperimentNarratives] 第一个代币的 analysis_results:`, tokens[0].analysis_results);
      }

      // 组合数据：只返回有叙事数据的代币
      const combinedData = tokens
        .filter(token => narrativeMap.has(token.token_address.toLowerCase()))
        .map(token => {
          const narrative = narrativeMap.get(token.token_address.toLowerCase());

          // 使用统一结果生成模块构建 llmAnalysis
          const llmAnalysis = buildLLMAnalysis(narrative);
          const rating = llmAnalysis?.summary?.numericRating ?? null;

          return {
            token_address: token.token_address,
            token_symbol: token.token_symbol || 'Unknown',
            platform: token.platform || 'fourmeme',
            blockchain: token.blockchain || 'bsc',
            discovered_at: token.discovered_at,
            narrative: {
              rating: rating,
              experiment_id: narrative.experiment_id,
              analyzed_at: narrative.analyzed_at,
              llmAnalysis: llmAnalysis
            },
            human_judge: token.human_judges || null,
            max_change_percent: token.analysis_results?.max_change_percent || null
          };
        });

      console.log(`[getExperimentNarratives] combinedData.length=${combinedData.length}`);

      // 计算统计数据
      const stats = {
        total_tokens: tokens.length,
        narrative_tokens: combinedData.length,
        high_quality_count: combinedData.filter(d => d.narrative.rating === 3).length,
        mid_quality_count: combinedData.filter(d => d.narrative.rating === 2).length,
        low_quality_count: combinedData.filter(d => d.narrative.rating === 1).length,
        unrated_count: combinedData.filter(d => d.narrative.rating === 9).length
      };

      // 计算平均最大涨幅（只统计有值的）
      const validMaxChanges = combinedData
        .map(d => d.max_change_percent)
        .filter(v => v !== null && v !== undefined && !isNaN(v));
      stats.avg_max_change = validMaxChanges.length > 0
        ? (validMaxChanges.reduce((a, b) => a + b, 0) / validMaxChanges.length).toFixed(2)
        : 0;

      return {
        success: true,
        data: combinedData,
        count: combinedData.length,
        stats: stats
      };

    } catch (error) {
      console.error('获取实验叙事数据失败:', error);
      return {
        success: false,
        error: error.message,
        data: [],
        count: 0,
        stats: {
          total_tokens: 0,
          narrative_tokens: 0,
          high_quality_count: 0,
          mid_quality_count: 0,
          low_quality_count: 0,
          unrated_count: 0,
          avg_max_change: 0
        }
      };
    }
  }
}

module.exports = { ExperimentDataService };
