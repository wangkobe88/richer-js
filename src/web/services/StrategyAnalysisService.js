/**
 * 策略分析服务
 * 用于分析交易策略在代币时序数据上的匹配情况
 */

const { dbManager } = require('../../services/dbManager');
const ConditionEvaluator = require('../../strategies/ConditionEvaluator').ConditionEvaluator;

class StrategyAnalysisService {
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

      // 2. 获取策略配置
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

      // 3. 获取代币时序数据
      const timeSeriesData = await this._getTimeSeriesData(experimentId, tokenAddress);
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

      // 4. 解析条件表达式
      const evaluator = new ConditionEvaluator();
      const ast = evaluator.parseCondition(strategy.condition);
      const subConditions = this._extractSubConditions(ast);

      // 5. 计算每个时间点的匹配结果（简化版，只保留图表需要的数据）
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

      // 6. 预计算第一个时间点的详情（用于初始展示）
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

    return data || [];
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
      cards: strategy.cards,
      priority: strategy.priority,
      cooldown: strategy.cooldown,
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
