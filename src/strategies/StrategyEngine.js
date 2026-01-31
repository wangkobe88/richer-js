/**
 * 策略引擎
 *
 * 管理基于因子的交易策略
 * 评估策略条件并选择最优策略
 * 参考 rich-js strategies/core/StrategyEngine.js 的简化版本
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
        this._cooldownTrackers = new Map(); // strategyId -> tokenAddress -> lastExecuted

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
                    cooldown: config.cooldown || 300, // 默认5分钟
                    condition,
                    enabled: config.enabled !== false // 默认启用
                };

                this._strategies.push(strategy);

                // 输出策略加载信息
                const enabledText = strategy.enabled ? '启用' : '禁用';
                const actionText = strategy.action === 'buy' ? '买入' : '卖出';
                console.log(`✅ [${enabledText}] ${strategy.name}: ${actionText} | 优先级:${strategy.priority} | 冷却:${strategy.cooldown}秒`);
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
     * @param {string} tokenAddress - 代币地址（用于冷却追踪）
     * @param {number} timestamp - 当前时间戳
     * @returns {Object|null} 触发的策略对象，如果没有则返回null
     */
    evaluate(factorResults, tokenAddress, timestamp = Date.now()) {
        const triggeredStrategies = [];

        for (const strategy of this._strategies) {
            // 检查是否启用
            if (!strategy.enabled) {
                continue;
            }

            // 检查冷却期
            if (this.isInCooldown(strategy, tokenAddress, timestamp)) {
                continue;
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
        const selectedStrategy = triggeredStrategies[0];

        // 记录执行时间
        this.recordExecution(selectedStrategy, tokenAddress, timestamp);

        return selectedStrategy;
    }

    /**
     * 检查策略是否在冷却期
     * @param {Object} strategy - 策略对象
     * @param {string} tokenAddress - 代币地址
     * @param {number} timestamp - 当前时间戳
     * @returns {boolean}
     */
    isInCooldown(strategy, tokenAddress, timestamp) {
        const key = this.getCooldownKey(strategy.id, tokenAddress);
        const lastExecuted = this._cooldownTrackers.get(key);

        if (!lastExecuted) {
            return false;
        }

        const elapsed = (timestamp - lastExecuted) / 1000; // 转换为秒
        return elapsed < strategy.cooldown;
    }

    /**
     * 记录策略执行时间
     * @param {Object} strategy - 策略对象
     * @param {string} tokenAddress - 代币地址
     * @param {number} timestamp - 执行时间戳
     */
    recordExecution(strategy, tokenAddress, timestamp = Date.now()) {
        const key = this.getCooldownKey(strategy.id, tokenAddress);
        this._cooldownTrackers.set(key, timestamp);
    }

    /**
     * 生成冷却追踪key
     * @param {string} strategyId - 策略ID
     * @param {string} tokenAddress - 代币地址
     * @returns {string}
     */
    getCooldownKey(strategyId, tokenAddress) {
        // 使用代币地址前8位确保每个代币有独立的冷却期
        const tokenPrefix = tokenAddress ? tokenAddress.substring(0, 8) : 'global';
        return `${tokenPrefix}_${strategyId}`;
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
     * 清除冷却记录
     * @param {string} strategyId - 策略ID（可选，不传则清除所有）
     * @param {string} tokenAddress - 代币地址（可选）
     */
    clearCooldown(strategyId = null, tokenAddress = null) {
        if (strategyId && tokenAddress) {
            // 清除特定策略和代币的冷却
            const key = this.getCooldownKey(strategyId, tokenAddress);
            this._cooldownTrackers.delete(key);
        } else if (strategyId) {
            // 清除特定策略的所有代币冷却
            for (const key of this._cooldownTrackers.keys()) {
                if (key.endsWith(`_${strategyId}`)) {
                    this._cooldownTrackers.delete(key);
                }
            }
        } else {
            // 清除所有冷却
            this._cooldownTrackers.clear();
        }
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

        const key = this.getCooldownKey(strategyId, tokenAddress);
        const lastExecuted = this._cooldownTrackers.get(key);

        return {
            id: strategy.id,
            name: strategy.name,
            action: strategy.action,
            priority: strategy.priority,
            cooldown: strategy.cooldown,
            enabled: strategy.enabled,
            lastExecuted,
            remainingCooldown: lastExecuted
                ? Math.max(0, strategy.cooldown - (timestamp - lastExecuted) / 1000)
                : 0,
            isInCooldown: this.isInCooldown(strategy, tokenAddress, timestamp)
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
                priority: s.priority,
                cooldown: s.cooldown,
                enabled: s.enabled
            }))
        };
    }
}

module.exports = { StrategyEngine };
