/**
 * 策略引擎
 *
 * 管理基于因子的交易策略
 * 评估策略条件并选择最优策略
 */

const { ConditionEvaluator } = require('./ConditionEvaluator');

/**
 * 卡牌张数归一化（迁自 rich-js 卡牌仓位机制）
 * 正整数张数；卖腿额外接受 'all'（全清）；其余（含买腿 'all'、0/负/小数/空串）→ null=旧语义。
 * UI number/text 输入天然是字符串，'8' 归一为 8。
 * @param {*} raw - 配置原始值
 * @param {string} action - 'buy' | 'sell'
 * @returns {number|'all'|null}
 */
function normalizeCards(raw, action) {
    if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase();
        if (s === 'all' && action === 'sell') return 'all';
        const n = Number(s);
        return Number.isInteger(n) && n > 0 ? n : null;
    }
    if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw > 0 ? raw : null;
    }
    return null;
}

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
     * @param {Set<string>|null} availableFactorIds - 可用的因子ID集合；null=不校验
     *   （constructor 便捷路径与单测用；引擎路径必须显式传入）
     * @param {Set<string>|null} preBuyAvailableFactorIds - preBuy/repeat 买检查条件的
     *   可用因子集合（PreBuyCheckService.getConditionFactorKeys()）。缺省 null =
     *   preBuy 系条件跳过校验（不能拿 FA 因子集去校 preBuy 专有键，会误报）。
     *   ⚠️ 2026-10-03 hg55 事故裁定（用户）：条件引用未知因子 = 因子名写错，
     *   fail-fast throw 拒绝启动——原 console.warn 放行让 (X >= 55 OR X IS NULL)
     *   形状的写错门恒真，hg55 门配对回测整组作废。
     */
    loadStrategies(strategyConfigs, availableFactorIds = null, preBuyAvailableFactorIds = null, gmgnAvailableFactorIds = null) {
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

                // 已删除机制的配置字段 fail-fast（cycle 分桶路由 2026-10-15 删除）：
                // groups/cycle 字段静默失效 = 腿从分桶可见变恒可见，是危险方向的静默
                // 变化——携带旧字段的存量实验/库条目直接拒绝启动，由用户清理后重跑
                const _legacyFields = [];
                if (config.groups != null && String(config.groups).trim() !== '') _legacyFields.push('groups');
                if (config.cycle != null) _legacyFields.push('cycle');
                if (_legacyFields.length > 0) {
                    throw new Error(`策略[${config.id}] 携带已删除机制的配置字段 ${_legacyFields.join('/')}（cycle 周期分桶路由，2026-10-15 删除）——静默失效会让腿恒可见（危险方向），拒绝启动；请删除该字段（如需活跃度维度改用 act* 滑窗因子族）`);
                }

                // 解析条件
                const condition = this._evaluator.parseCondition(config.condition);

                // 验证条件（availableFactorIds 传入才校验；未知因子 = 写错名 → throw）
                if (availableFactorIds) {
                    const validation = this._evaluator.validateCondition(condition, availableFactorIds);
                    if (!validation.valid) {
                        throw new Error(`策略[${config.id}] condition 引用未知因子: ${validation.errors.join(', ')}——因子名写错会让子句静默失效（比较恒 false / IS NULL 恒 true），拒绝启动`);
                    }
                }

                // 附属条件字段校验（2026-10-03 hg55 事故同款防线；空串跳过）：
                //   preBuyCheckCondition / repeatBuyCheckCondition 的评估上下文是
                //   PreBuyCheckService 组装的 preBuy 因子表（narrativeRating /
                //   earlyTrades* / platform 等），用 preBuy 键集校验；两集未传则跳过。
                //   narrativeCallCondition 的评估上下文与主 condition 同为 fire
                //   factors（FA 因子表），用 availableFactorIds 校验。
                if (preBuyAvailableFactorIds) {
                    for (const field of ['preBuyCheckCondition', 'repeatBuyCheckCondition']) {
                        const raw = config[field];
                        if (typeof raw !== 'string' || raw.trim() === '') continue;
                        const v = this._evaluator.validateCondition(
                            this._evaluator.parseCondition(raw), preBuyAvailableFactorIds);
                        if (!v.valid) {
                            throw new Error(`策略[${config.id}] ${field} 引用未知因子: ${v.errors.join(', ')}——因子名写错会让子句静默失效，拒绝启动`);
                        }
                    }
                }
                if (availableFactorIds) {
                    // narrativePrefetchCondition（N3 预触发，2026-10-13 叙事提速案）：
                    // 评估上下文与 narrativeCallCondition 同为 fire factors，同集校验；
                    // narrativeTriggerCondition（C84 2026-10-17 叙事发起条件）同集
                    for (const field of ['narrativeCallCondition', 'narrativePrefetchCondition', 'narrativeTriggerCondition']) {
                        const raw = config[field];
                        if (typeof raw === 'string' && raw.trim() !== '') {
                            const v = this._evaluator.validateCondition(
                                this._evaluator.parseCondition(raw), availableFactorIds);
                            if (!v.valid) {
                                throw new Error(`策略[${config.id}] ${field} 引用未知因子: ${v.errors.join(', ')}——因子名写错会让子句静默失效，拒绝启动`);
                            }
                        }
                    }
                }

                // C84 互斥 fail-fast（2026-10-17）：narrativeTriggerCondition（新模型：
                // 触发轮后台分析+单一买条件）与 narrativeCallCondition（legacy：fire 同步
                // 直调）语义互斥——同腿并存 = 旧链同步直调块与新链状态机同时激活，
                // 行为未定义。groups/cycle 先例风格：携带即拒启，由用户清理
                if (String(config.narrativeTriggerCondition || '').trim() !== ''
                    && String(config.narrativeCallCondition || '').trim() !== '') {
                    throw new Error(`策略[${config.id}] 同时携带 narrativeTriggerCondition 与 narrativeCallCondition（C84 互斥）：前者=触发轮后台分析+单一买条件新链，后者=fire 同步直调旧链，拒绝启动`);
                }

                // gmgnCheckCondition（买腿第三层 GMGN 条件，FAKER 团伙盘案 2026-10-14）：
                // 评估上下文是 GmgnRiskCheckService 的固定键集（gmgnIssuerTokenCount /
                // gmgnBundlerWalletRatio / gmgnRiskCovered / gmgnVisitingCount），
                // 独立键集校验；未传集则跳过
                if (gmgnAvailableFactorIds) {
                    const raw = config.gmgnCheckCondition;
                    if (typeof raw === 'string' && raw.trim() !== '') {
                        const v = this._evaluator.validateCondition(
                            this._evaluator.parseCondition(raw), gmgnAvailableFactorIds);
                        if (!v.valid) {
                            throw new Error(`策略[${config.id}] gmgnCheckCondition 引用未知因子: ${v.errors.join(', ')}——因子名写错会让子句静默失效，拒绝启动`);
                        }
                    }
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
                    repeatBuyCheckCondition: config.repeatBuyCheckCondition || null,
                    // 买腿第三层 GMGN 条件（FAKER 团伙盘案 2026-10-14）：前两层全过、
                    // 下单前实时调 GMGN API 构建因子评估；fail-closed 拒买。null=零调用
                    gmgnCheckCondition: config.gmgnCheckCondition || null,
                    narrativeCallCondition: config.narrativeCallCondition || null,
                    // 叙事预触发条件（N3，2026-10-13 叙事提速案）：不配 = 预触发用
                    // narrativeCallCondition；配更宽松条件 = 更早发起（API 消耗与提前量
                    // 由策略侧权衡）；fire 时直调仍按 narrativeCallCondition
                    narrativePrefetchCondition: config.narrativePrefetchCondition || null,
                    // 叙事分析发起条件（C84 2026-10-17 买腿重构）：FA 因子表达式（如
                    // `buyVolumeBnb >= 0.5 OR narrativeRetryDue == 1`）满足即后台发起
                    // 叙事分析（触发态状态机驱动，含账号型重试轮）；携带此字段的腿 =
                    // 新模型腿（无 fire 同步直调/无 preBuy 检查，narrativeRating 门在
                    // 主 condition 内）。与 narrativeCallCondition 互斥（上方 fail-fast）
                    narrativeTriggerCondition: config.narrativeTriggerCondition || null,
                    // pumpfun 回迁批 2 卖腿机制字段（引擎侧消费：去抖分流/止损闩锁/累亏闩锁）
                    bypassDebounce: !!config.bypassDebounce,
                    lockTokenAfterSell: !!config.lockTokenAfterSell,
                    cumulativeLossLockPct: typeof config.cumulativeLossLockPct === 'number'
                        ? config.cumulativeLossLockPct : null,
                    // E5 卖侧：卖出比例（执行时点余仓的比例，(0,1]；缺省/非法 → 1=全仓=旧语义）
                    sellPercentage: (typeof config.sellPercentage === 'number'
                        && config.sellPercentage > 0 && config.sellPercentage <= 1)
                        ? config.sellPercentage : 1,
                    // 卡牌仓位（迁自 rich-js）：本腿买/卖张数；卖腿 'all'=全清。实验未配置
                    // positionManagement.perCardBNB 时引擎侧整体忽略（null=旧语义）
                    cards: normalizeCards(config.cards, config.action),
                    // 冷却（秒，独立于卡牌可用）：本腿成交后 N 秒内不再触发，期满可再触发；
                    // 与 maxExecutions 共存（限间隔 vs 限总次数）。正数否则 null=不冷却
                    cooldownSec: (() => {
                        const n = Number(config.cooldownSec);
                        return Number.isFinite(n) && n > 0 ? n : null;
                    })()
                };

                this._strategies.push(strategy);

                // 输出策略加载信息
                const enabledText = strategy.enabled ? '启用' : '禁用';
                const actionText = strategy.action === 'buy' ? '买入' : '卖出';
                const maxExecText = strategy.maxExecutions ? ` ×${strategy.maxExecutions}` : '';
                const cardsText = strategy.cards != null
                    ? (strategy.cards === 'all' ? ' | 全清卡' : ` | ${strategy.cards}卡`) : '';
                const cooldownText = strategy.cooldownSec != null ? ` | 冷却${strategy.cooldownSec}s` : '';
                console.log(`✅ [${enabledText}] ${strategy.name}: ${actionText}${maxExecText} | 优先级:${strategy.priority}${cardsText}${cooldownText}`);
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
     * @param {string|null} [actionFilter] - 只评估指定动作的策略（'buy'|'sell'），null 为混合（旧语义）
     * @returns {Object|null} 触发的策略对象，如果没有则返回null
     */
    evaluate(factorResults, tokenAddress, timestamp = Date.now(), tokenData = null, actionFilter = null) {
        const triggeredStrategies = [];

        for (const strategy of this._strategies) {
            // 动作过滤（事件驱动引擎分腿评估用：持仓中只看卖腿，避免同优先级买策略遮蔽卖出）
            if (actionFilter && strategy.action !== actionFilter) {
                continue;
            }

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

            // 检查冷却（迁自 rich-js 卡牌机制，独立于卡牌可用）：本腿上次成交后 cooldownSec
            // 秒内跳过，期满恢复触发。lastExecuted 由 recordStrategyExecution 写入（引擎传
            // 评估时点——回测为虚拟时钟），timestamp 是本次评估时刻。冷却中跳过与
            // maxExecutions 跳过同语义：高优先级腿冷却中被跳过 → 低优先级腿可顶上
            if (strategy.cooldownSec != null && tokenData && tokenData.strategyExecutions) {
                const execution = tokenData.strategyExecutions[strategy.id];
                if (execution && execution.lastExecuted != null
                    && (timestamp - execution.lastExecuted) < strategy.cooldownSec * 1000) {
                    continue;  // 冷却期内，跳过
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
     * 评估任意条件表达式（fire 因子上下文）
     * 供买腿叙事直调触发（narrativeCallCondition）等按需评估场景复用，
     * 与策略 condition 用同一评估器（ConditionEvaluator，含 AST 缓存）。
     * fail-closed：表达式损坏/因子缺失时返回 false（不触发）。
     * @param {string} condition - 条件表达式（语法同策略 condition：AND/OR、比较、括号、IS NULL）
     * @param {Object} factorResults - 因子计算结果（fire 时点因子）
     * @returns {boolean} 是否满足
     */
    evaluateCondition(condition, factorResults) {
        try {
            return !!this._evaluator.evaluate(condition, factorResults);
        } catch (error) {
            console.warn(`[StrategyEngine] 条件表达式评估失败(fail-closed): ${condition} - ${error.message}`);
            return false;
        }
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
