/**
 * 策略分析服务
 * 用于分析交易策略在代币时序数据上的匹配情况
 */

const { dbManager } = require('../../services/dbManager');
const ConditionEvaluator = require('../../strategies/ConditionEvaluator').ConditionEvaluator;
const { buildFactorsFromTimeSeries } = require('../../trading-engine/core/FactorBuilder');
const TrendDetector = require('../../trading-engine/TrendDetector');

class StrategyAnalysisService {

  constructor() {
    this._trendDetector = new TrendDetector({
      minDataPoints: 6,
      maxDataPoints: Infinity,
      cvThreshold: 0.005,
      scoreThreshold: 30,
      totalReturnThreshold: 5,
      riseRatioThreshold: 0.5
    });
  }
  /**
   * 分析策略在代币时序数据上的匹配情况
   * @param {string} experimentId - 实验ID
   * @param {string} tokenAddress - 代币地址
   * @param {string} strategyType - 策略类型 ('buy' | 'sell')
   * @param {number} strategyIndex - 策略索引
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeStrategy(experimentId, tokenAddress, strategyType, strategyIndex) {
    try {
      // 1. 获取实验配置
      const experiment = await this._getExperimentConfig(experimentId);
      if (!experiment) {
        throw new Error('实验不存在');
      }

      // 2. 获取策略配置（使用实验本身的策略配置）
      const strategiesConfig = experiment.config?.strategiesConfig;
      if (!strategiesConfig) {
        throw new Error('实验没有策略配置');
      }

      const strategies = strategyType === 'buy'
        ? (strategiesConfig.buyStrategies || [])
        : (strategiesConfig.sellStrategies || []);

      if (!strategies[strategyIndex]) {
        throw new Error(`策略索引 ${strategyIndex} 不存在`);
      }

      const strategy = strategies[strategyIndex];

      // 3. 确定时序数据来源的实验ID
      // 如果是回测实验，使用源实验的时序数据
      let dataExperimentId = experimentId;
      if (experiment.config?.backtest?.sourceExperimentId) {
        dataExperimentId = experiment.config.backtest.sourceExperimentId;
        console.log(`回测实验，使用源实验 ${dataExperimentId} 的时序数据`);
      }

      // 4. 获取代币时序数据
      const timeSeriesData = await this._getTimeSeriesData(dataExperimentId, tokenAddress);
      if (!timeSeriesData || timeSeriesData.length === 0) {
        return {
          success: true,
          data: {
            strategy: this._formatStrategy(strategy, strategyType, strategyIndex),
            tokenAddress,
            timePoints: []
          }
        };
      }

      // 4. 从精简时序数据重建完整因子
      this._rebuildFactorsFromTimeSeries(timeSeriesData);

      // 5. 解析条件表达式
      const evaluator = new ConditionEvaluator();
      const ast = evaluator.parseCondition(strategy.condition);
      const subConditions = this._extractSubConditions(ast);

      // 6. 重算 trendRiseRatio（使用 >= 而非 >）
      this._recalculateRiseRatio(timeSeriesData);

      // 7. 计算每个时间点的匹配结果（简化版，只保留图表需要的数据）
      const timePoints = timeSeriesData.map(point => {
        const matchResult = this._evaluateTimePoint(point, subConditions, ast, evaluator);
        return {
          timestamp: point.timestamp,
          // 只保留图表需要的数据，不保留完整的 data 和 subConditions
          satisfiedCount: matchResult.satisfiedCount,
          totalCount: matchResult.totalCount,
          satisfied: matchResult.satisfied,
          // 保留原始数据引用用于详情展示
          data: point
        };
      });

      // 8. 预计算第一个时间点的详情（用于初始展示）
      let firstPointDetails = null;
      if (timePoints.length > 0) {
        const firstPoint = timeSeriesData[0];
        const matchResult = this._evaluateTimePoint(firstPoint, subConditions, ast, evaluator);
        firstPointDetails = {
          timestamp: firstPoint.timestamp,
          matchResult: {
            satisfiedCount: matchResult.satisfiedCount,
            totalCount: matchResult.totalCount,
            satisfied: matchResult.satisfied,
            subConditions: matchResult.subConditions
          }
        };
      }

      return {
        success: true,
        data: {
          strategy: this._formatStrategy(strategy, strategyType, strategyIndex),
          tokenAddress,
          totalConditions: subConditions.length,
          timePoints,
          firstPointDetails,
          subConditions // 保存子条件定义，用于前端显示
        }
      };

    } catch (error) {
      console.error('策略分析失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 从精简时序数据重建完整因子
   * 精简数据只存储 currentPrice/txVolumeU24h/holders/tvl/fdv/marketCap/dataCollectionRound
   * 需要从价格历史推导趋势因子、earlyReturn 等
   * @private
   */
  _rebuildFactorsFromTimeSeries(timeSeriesData) {
    if (!timeSeriesData || timeSeriesData.length === 0) return;

    // 第一轮：构建价格历史，计算 firstPrice、age、earlyReturn 等基础因子
    const priceHistory = [];
    const firstPrice = timeSeriesData[0].price_usd;
    const tokenCreatedAt = timeSeriesData[0].created_at
      ? new Date(timeSeriesData[0].created_at).getTime()
      : null;

    for (let i = 0; i < timeSeriesData.length; i++) {
      const point = timeSeriesData[i];
      const fv = point.factor_values || {};
      const priceUsd = parseFloat(point.price_usd) || 0;
      const now = new Date(point.timestamp).getTime();

      // 累积价格历史
      priceHistory.push(priceUsd);

      // firstPrice: 使用第一个时序数据点的价格
      fv.firstPrice = fv.firstPrice ?? firstPrice;
      fv.collectionPrice = fv.collectionPrice ?? fv.firstPrice;
      fv.launchPrice = fv.launchPrice ?? fv.firstPrice;

      // earlyReturn
      if (fv.earlyReturn === undefined || fv.earlyReturn === null) {
        fv.earlyReturn = (fv.firstPrice > 0 && priceUsd > 0)
          ? ((priceUsd - fv.firstPrice) / fv.firstPrice) * 100
          : 0;
      }

      // age
      if (fv.age === undefined || fv.age === null) {
        if (tokenCreatedAt) {
          fv.age = (now - tokenCreatedAt) / 1000 / 60;
        }
      }

      // riseSpeed
      if (fv.riseSpeed === undefined || fv.riseSpeed === null) {
        fv.riseSpeed = (fv.age > 0) ? fv.earlyReturn / fv.age : 0;
      }

      // price_usd -> currentPrice 兼容
      fv.currentPrice = fv.currentPrice ?? priceUsd;

      // 趋势因子：从价格历史重建（与 BacktestEngine._buildFactorsFromData 逻辑一致）
      if (!fv.trendCV || fv.trendCV === null) {
        const maxPoints = 8;
        const _prices = priceHistory.slice(-maxPoints);

        fv.trendDataPoints = _prices.length;

        if (_prices.length >= 2) {
          const p0 = _prices[0];
          const pLast = _prices[_prices.length - 1];
          fv.trendTotalReturn = p0 > 0 ? ((pLast - p0) / p0) * 100 : 0;

          let riseCount = 0;
          for (let j = 1; j < _prices.length; j++) {
            if (_prices[j] >= _prices[j - 1]) riseCount++;
          }
          fv.trendRiseRatio = riseCount / Math.max(1, _prices.length - 1);

          fv.trendCV = this._trendDetector._calculateCV(_prices);

          // 最近的下跌统计
          const _checkSize = Math.min(5, _prices.length);
          const _recentPrices = _prices.slice(-_checkSize);
          let _downCount = 0;
          for (let j = 1; j < _recentPrices.length; j++) {
            if (_recentPrices[j] < _recentPrices[j - 1]) _downCount++;
          }
          fv.trendRecentDownCount = _downCount;
          fv.trendRecentDownRatio = _downCount / Math.max(1, _recentPrices.length - 1);

          // 连续下跌次数
          let _consecutiveDowns = 0;
          for (let j = _prices.length - 1; j > 0; j--) {
            if (_prices[j] < _prices[j - 1]) {
              _consecutiveDowns++;
            } else {
              break;
            }
          }
          fv.trendConsecutiveDowns = _consecutiveDowns;

          // 当前价格距离窗口最高价的回撤
          const _windowMaxPrice = Math.max(..._prices);
          fv.trendDrawdownFromWindowHigh = _windowMaxPrice > 0 ? ((_prices[_prices.length - 1] - _windowMaxPrice) / _windowMaxPrice) * 100 : 0;

          // 至少 4 个数据点的指标
          if (_prices.length >= 4) {
            const _direction = this._trendDetector._confirmDirection(_prices);
            fv.trendPriceUp = _direction.trendPriceUp;
            fv.trendMedianUp = _direction.trendMedianUp;
            fv.trendSlope = _direction.relativeSlope || 0;

            const _strength = this._trendDetector._calculateTrendStrength(_prices);
            fv.trendStrengthScore = _strength.score;
          }
        }
      }

      point.factor_values = fv;
    }
  }

  /**
   * 获取实验配置
   * @private
   */
  async _getExperimentConfig(experimentId) {
    const supabase = dbManager.getClient();
    const { data, error } = await supabase
      .from('experiments')
      .select('id, experiment_name, config')
      .eq('id', experimentId)
      .single();

    if (error) {
      throw new Error(`获取实验配置失败: ${error.message}`);
    }

    return data;
  }

  /**
   * 获取代币时序数据
   * @private
   */
  async _getTimeSeriesData(experimentId, tokenAddress) {
    const supabase = dbManager.getClient();
    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', tokenAddress)
      .order('timestamp', { ascending: true })
      .limit(500); // 限制最多500条数据

    if (error) {
      throw new Error(`获取时序数据失败: ${error.message}`);
    }

    // 为每个时间点添加因子序号（基于loop_count分组）
    const dataWithIndex = [];
    let currentLoopCount = null;
    let factorIndex = 0;

    (data || []).forEach(point => {
      if (currentLoopCount !== point.loop_count) {
        currentLoopCount = point.loop_count;
        factorIndex++;
      }
      dataWithIndex.push({
        ...point,
        factorIndex
      });
    });

    return dataWithIndex;
  }

  /**
   * 提取子条件（所有 COMPARISON 节点）
   * @private
   */
  _extractSubConditions(ast) {
    const conditions = [];

    const traverse = (node, parentInfo = null) => {
      if (!node) return;

      if (node.type === 'AND' || node.type === 'OR') {
        traverse(node.left, { type: node.type, parent: parentInfo });
        traverse(node.right, { type: node.type, parent: parentInfo });
      } else if (node.type === 'COMPARISON') {
        conditions.push({
          raw: `${node.left} ${node.operator} ${node.right}`,
          variable: node.left,
          operator: node.operator,
          value: node.right,
          parentType: parentInfo?.type || null
        });
      }
    };

    traverse(ast);
    return conditions;
  }

  /**
   * 评估单个时间点
   * @private
   */
  _evaluateTimePoint(data, subConditions, ast, evaluator) {
    // 因子值存储在 factor_values 字段中
    const factorValues = data.factor_values || {};

    // 计算每个子条件的满足情况
    const subConditionResults = subConditions.map(sc => {
      const actualValue = factorValues[sc.variable];
      const satisfied = this._compare(actualValue, sc.operator, sc.value);

      return {
        condition: sc.raw,
        variable: sc.variable,
        operator: sc.operator,
        expectedValue: sc.value,
        actualValue: actualValue,
        satisfied
      };
    });

    // 计算满足的子条件数
    const satisfiedCount = subConditionResults.filter(r => r.satisfied).length;

    // 计算整体是否满足（使用原始表达式）
    // 需要将 factor_values 合并到 data 中用于评估
    let overallSatisfied = false;
    try {
      const evalData = { ...data, ...factorValues };
      overallSatisfied = evaluator.evaluate(ast, evalData);
    } catch (e) {
      console.warn('评估条件失败:', e.message);
    }

    return {
      satisfiedCount,
      totalCount: subConditions.length,
      satisfied: overallSatisfied,
      subConditions: subConditionResults
    };
  }

  /**
   * 重算 trendRiseRatio（使用 >= 而非原始的 >）
   * 收集每个 token 的价格序列，用最近8个价格按 >= 逻辑重算
   * @private
   */
  _recalculateRiseRatio(timeSeriesData) {
    if (!timeSeriesData || timeSeriesData.length === 0) return;

    // 按 factorIndex 排列价格（同一轮次内的价格点）
    const prices = [];
    for (const point of timeSeriesData) {
      if (point.factor_values && point.price_usd) {
        prices.push(point.price_usd);
      }
    }

    // 对每个时间点，用其所在位置之前的最近8个价格重算 trendRiseRatio
    let priceIdx = 0;
    for (const point of timeSeriesData) {
      if (!point.factor_values || !point.price_usd) continue;

      const fv = point.factor_values;
      const dp = fv.trendDataPoints;
      if (!dp || dp < 2 || priceIdx === 0) {
        priceIdx++;
        continue;
      }

      // 取当前及之前的最近 dp 个价格
      const start = Math.max(0, priceIdx - dp + 1);
      const window = prices.slice(start, priceIdx + 1);
      if (window.length >= 2) {
        let riseCount = 0;
        for (let i = 1; i < window.length; i++) {
          if (window[i] >= window[i - 1]) riseCount++;
        }
        fv.trendRiseRatio = riseCount / (window.length - 1);
      }
      priceIdx++;
    }
  }

  /**
   * 比较值
   * @private
   */
  _compare(actual, operator, expected) {
    const actualNum = parseFloat(actual);
    const expectedNum = parseFloat(expected);

    if (isNaN(actualNum) || isNaN(expectedNum)) {
      return false;
    }

    switch (operator) {
      case '>': return actualNum > expectedNum;
      case '<': return actualNum < expectedNum;
      case '>=': return actualNum >= expectedNum;
      case '<=': return actualNum <= expectedNum;
      case '==': return actualNum === expectedNum;
      case '!=': return actualNum !== expectedNum;
      default: return false;
    }
  }

  /**
   * 格式化策略信息
   * @private
   */
  _formatStrategy(strategy, strategyType, strategyIndex) {
    return {
      type: strategyType,
      index: strategyIndex,
      condition: strategy.condition,
      description: strategy.description || `策略${strategyIndex + 1}`,
      priority: strategy.priority,
      maxExecutions: strategy.maxExecutions
    };
  }

  /**
   * 获取实验的策略列表
   * @param {string} experimentId - 实验ID
   * @returns {Promise<Object>} 策略列表
   */
  async getStrategies(experimentId) {
    try {
      const experiment = await this._getExperimentConfig(experimentId);
      const strategiesConfig = experiment.config?.strategiesConfig;

      if (!strategiesConfig) {
        return {
          success: true,
          data: { buyStrategies: [], sellStrategies: [] }
        };
      }

      return {
        success: true,
        data: {
          buyStrategies: strategiesConfig.buyStrategies || [],
          sellStrategies: strategiesConfig.sellStrategies || []
        }
      };

    } catch (error) {
      console.error('获取策略列表失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { StrategyAnalysisService };
