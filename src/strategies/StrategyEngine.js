/**
 * 策略引擎
 *
 * 管理基于因子的交易策略
 * 评估策略条件并选择最优策略
 */

const { ConditionEvaluator } = require('./ConditionEvaluator');

class StrategyEngine {
    /**
     * @param {Object} config - 策略引擎配置
     * @param {Array} config.strategies - 策略定义数组
     */
    constructor(config = {}) {
        this._strategies = [];
        this._evaluator = new ConditionEvaluator();

        // 初始化策略
        if (config.strategies) {
            this.loadStrategies(config.strategies);
        }
    }

    /**
     * 加载策略定义
     * @param {Array<Object>} strategyConfigs - 策略配置数组
     * @param {Set<string>} availableFactorIds - 可用的因子ID集合
     */
    loadStrategies(strategyConfigs, availableFactorIds = new Set()) {
        this._strategies = [];

        for (let i = 0; i < strategyConfigs.length; i++) {
            const config = strategyConfigs[i];

            try {
                // 验证必需字段
                if (!config.id) {
                    throw new Error(`策略[${i}]缺少id`);
                }
                if (!config.name) {
                    throw new Error(`策略[${i}]缺少name`);
                }
                if (!config.action) {
                    throw new Error(`策略[${i}]缺少action`);
                }
                if (!config.condition) {
                    throw new Error(`策略[${i}]缺少condition`);
                }
                if (config.priority === undefined) {
                    throw new Error(`策略[${i}]缺少priority`);
                }

                // 验证 action
                if (!['buy', 'sell'].includes(config.action)) {
                    throw new Error(`策略[${config.id}]的action必须是 'buy' 或 'sell'`);
                }

                // 解析条件
                const condition = this._evaluator.parseCondition(config.condition);

                // 验证条件
                const validation = this._evaluator.validateCondition(condition, availableFactorIds);
                if (!validation.valid) {
                    console.warn(`策略[${config.id}]条件验证警告: ${validation.errors.join(', ')}`);
                }

                // 构建策略对象
                const strategy = {
                    id: config.id,
                    name: config.name,
                    description: config.description || '',
                    action: config.action, // 'buy' | 'sell'
                    priority: config.priority,
                    condition,
                    enabled: config.enabled !== false,
                    maxExecutions: config.maxExecutions || null,
                    preBuyCheckCondition: config.preBuyCheckCondition || null,
                    repeatBuyCheckCondition: config.repeatBuyCheckCondition || null
                };

                this._strategies.push(strategy);

                // 输出策略加载信息
                const enabledText = strategy.enabled ? '启用' : '禁用';
                const actionText = strategy.action === 'buy' ? '买入' : '卖出';
                const maxExecText = strategy.maxExecutions ? ` ×${strategy.maxExecutions}` : '';
                console.log(`✅ [${enabledText}] ${strategy.name}: ${actionText}${maxExecText} | 优先级:${strategy.priority}`);
                console.log(`   条件: ${config.condition}`);

            } catch (error) {
                console.error(`❌ 加载策略失败 [${i}]: ${error.message}`);
                throw error;
            }
        }

        // 按优先级排序（数值越小优先级越高）
        this._strategies.sort((a, b) => a.priority - b.priority);

        console.log(`📊 加载了 ${this._strategies.length} 个策略`);
    }

    /**
     * 评估所有策略，返回触发的最优策略
     * @param {Map<string, Object>|Object} factorResults - 因子计算结果
     * @param {string} tokenAddress - 代币地址
     * @param {number} timestamp - 当前时间戳
     * @param {Object} tokenData - 代币数据（用于检查执行次数）
     * @returns {Object|null} 触发的策略对象，如果没有则返回null
     */
    evaluate(factorResults, tokenAddress, timestamp = Date.now(), tokenData = null) {
        const triggeredStrategies = [];

        for (const strategy of this._strategies) {
            // 检查是否启用
            if (!strategy.enabled) {
                continue;
            }

            // 检查执行次数限制
            if (strategy.maxExecutions && tokenData && tokenData.strategyExecutions) {
                const execution = tokenData.strategyExecutions[strategy.id];
                if (execution && execution.count >= strategy.maxExecutions) {
                    continue;  // 已达到最大执行次数，跳过
                }
            }

            // 评估条件
            const conditionMet = this._evaluator.evaluate(strategy.condition, factorResults);

            if (conditionMet) {
                triggeredStrategies.push(strategy);
            }
        }

        // 如果没有触发的策略
        if (triggeredStrategies.length === 0) {
            return null;
        }

        // 返回优先级最高的策略（数组已排序，第一个就是最高优先级）
        return triggeredStrategies[0];
    }

    /**
     * 获取策略
     * @param {string} strategyId - 策略ID
     * @returns {Object|undefined}
     */
    getStrategy(strategyId) {
        return this._strategies.find(s => s.id === strategyId);
    }

    /**
     * 获取所有策略
     * @returns {Array<Object>}
     */
    getAllStrategies() {
        return [...this._strategies];
    }

    /**
     * 启用/禁用策略
     * @param {string} strategyId - 策略ID
     * @param {boolean} enabled - 是否启用
     * @returns {boolean} 操作是否成功
     */
    setStrategyEnabled(strategyId, enabled) {
        const strategy = this.getStrategy(strategyId);
        if (strategy) {
            strategy.enabled = enabled;
            console.log(`${enabled ? '启用' : '禁用'}策略: ${strategy.name}`);
            return true;
        }
        return false;
    }

    /**
     * 获取策略状态
     * @param {string} strategyId - 策略ID
     * @param {string} tokenAddress - 代币地址
     * @param {number} timestamp - 当前时间戳
     * @returns {Object|null}
     */
    getStrategyStatus(strategyId, tokenAddress, timestamp = Date.now()) {
        const strategy = this.getStrategy(strategyId);
        if (!strategy) {
            return null;
        }

        return {
            id: strategy.id,
            name: strategy.name,
            action: strategy.action,
            priority: strategy.priority,
            enabled: strategy.enabled
        };
    }

    /**
     * 获取所有策略状态
     * @param {string} tokenAddress - 代币地址
     * @param {number} timestamp - 当前时间戳
     * @returns {Array<Object>}
     */
    getAllStrategiesStatus(tokenAddress, timestamp = Date.now()) {
        return this._strategies.map(strategy =>
            this.getStrategyStatus(strategy.id, tokenAddress, timestamp)
        );
    }

    /**
     * 获取策略数量
     * @returns {number}
     */
    getStrategyCount() {
        return this._strategies.length;
    }

    /**
     * 获取状态摘要
     * @returns {Object}
     */
    getStatusSummary() {
        return {
            totalStrategies: this._strategies.length,
            enabledStrategies: this._strategies.filter(s => s.enabled).length,
            strategies: this._strategies.map(s => ({
                id: s.id,
                name: s.name,
                action: s.action,
                maxExecutions: s.maxExecutions,
                priority: s.priority,
                enabled: s.enabled
            }))
        };
    }
}

module.exports = { StrategyEngine };
