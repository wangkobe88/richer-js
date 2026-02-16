/**
 * Token Pool
 *
 * Manages the pool of tokens being monitored for trading
 */

class TokenPool {
    constructor(logger) {
        this.logger = logger;
        this.pool = new Map(); // tokenAddress -> TokenData
        this.maxAge = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Add a token to the monitoring pool
     * @param {Object} tokenData - Token data from AVE API
     * @returns {boolean} True if added successfully
     */
    addToken(tokenData) {
        const key = this.getTokenKey(tokenData);

        if (this.pool.has(key)) {
            return false; // Already in pool
        }

        // 解析当前价格
        let currentPrice = null;
        if (tokenData.current_price_usd) {
            const price = parseFloat(tokenData.current_price_usd);
            if (!isNaN(price) && price > 0) {
                currentPrice = price;
            }
        }

        // 解析发行价格（作为 earlyReturn 的基准）
        let launchPrice = null;
        if (tokenData.launch_price) {
            const price = parseFloat(tokenData.launch_price);
            if (!isNaN(price) && price > 0) {
                launchPrice = price;
            }
        }

        const collectionTime = Date.now();

        // 保存完整的原始 API 数据（用于后续分析）
        const rawApiData = { ...tokenData };

        const poolData = {
            token: tokenData.token,
            tokenAddress: tokenData.token,
            chain: tokenData.chain,
            name: tokenData.name,
            symbol: tokenData.symbol,
            createdAt: tokenData.created_at || Date.now() / 1000,
            addedAt: collectionTime,
            klineData: [],
            status: 'monitoring', // monitoring, bought, selling, exited
            buyDecision: null,
            buyPrice: null,
            buyTime: null,
            currentPrice: currentPrice, // AVE API 返回的当前价格（会实时更新）
            launchPrice: launchPrice, // 发行价格（作为 earlyReturn 的基准）
            collectionPrice: currentPrice, // 收集时的价格（保留用于兼容）
            collectionTime: collectionTime, // 收集时间（用于计算 age）
            priceHistory: [], // 价格历史记录
            // 历史最高价格追踪
            highestPrice: currentPrice, // 历史最高价格
            highestPriceTimestamp: collectionTime, // 最高价发生时间
            entryMetrics: null,
            rawApiData: rawApiData, // 保存完整的原始 API 数据
            // 新增：AVE API 因子
            txVolumeU24h: parseFloat(tokenData.tx_volume_u_24h) || 0,
            holders: parseInt(tokenData.holders) || 0,
            tvl: parseFloat(tokenData.tvl) || 0,
            fdv: parseFloat(tokenData.fdv) || 0,
            marketCap: parseFloat(tokenData.market_cap) || 0,
            // 新增：合约风险数据
            contractRisk: tokenData.contract_risk_raw_ave_data || null,
            creatorAddress: tokenData.creator_address || null,
            // 卡牌仓位管理
            cardPositionManager: null,
            // 策略执行状态跟踪
            strategyExecutions: {}  // strategyId -> { count: number, lastExecuted: timestamp }
        };

        this.pool.set(key, poolData);
        this.logger.debug(`Token added to pool`, {
            symbol: tokenData.symbol,
            address: tokenData.token,
            chain: tokenData.chain,
            currentPrice: currentPrice
        });

        return true;
    }

    /**
     * Get token data from pool
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @returns {Object|null} Token data or null if not found
     */
    getToken(tokenAddress, chain) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        return this.pool.get(key) || null;
    }

    /**
     * Update token's K-line data
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {Array} klineData - New K-line data points
     */
    updateKlineData(tokenAddress, chain, klineData) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            // Merge new data, avoid duplicates
            const existingTimestamps = new Set(token.klineData.map(k => k.timestamp));
            const newPoints = klineData.filter(k => !existingTimestamps.has(k.timestamp));
            token.klineData.push(...newPoints);
            // Sort by timestamp
            token.klineData.sort((a, b) => a.timestamp - b.timestamp);
        }
    }

    /**
     * Mark token as bought
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {Object} buyDecision - Buy decision details
     */
    markAsBought(tokenAddress, chain, buyDecision) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            token.status = 'bought';
            token.buyDecision = buyDecision;
            token.buyPrice = buyDecision.buyPrice;
            token.buyTime = Date.now();
            token.currentPrice = buyDecision.buyPrice;
        }
    }

    /**
     * Update current price for a bought token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {number} price - Current price
     */
    updateCurrentPrice(tokenAddress, chain, price) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            token.currentPrice = price;
        }
    }

    /**
     * Update price with timestamp
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {number} price - Current price
     * @param {number} timestamp - Update timestamp
     * @param {Object} extraData - Extra data from API (txVolumeU24h, holders, tvl, fdv, marketCap)
     */
    updatePrice(tokenAddress, chain, price, timestamp, extraData = {}) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            token.currentPrice = price;

            // 更新 AVE API 因子
            if (extraData.txVolumeU24h !== undefined) {
                token.txVolumeU24h = extraData.txVolumeU24h;
            }
            if (extraData.holders !== undefined) {
                token.holders = extraData.holders;
            }
            if (extraData.tvl !== undefined) {
                token.tvl = extraData.tvl;
            }
            if (extraData.fdv !== undefined) {
                token.fdv = extraData.fdv;
            }
            if (extraData.marketCap !== undefined) {
                token.marketCap = extraData.marketCap;
            }

            // 更新历史最高价格
            if (price > (token.highestPrice || 0)) {
                token.highestPrice = price;
                token.highestPriceTimestamp = timestamp;
            }

            // 记录价格历史（最多保留100条）
            token.priceHistory.push({
                price: price,
                timestamp: timestamp
            });
            if (token.priceHistory.length > 100) {
                token.priceHistory.shift();
            }
        }
    }

    /**
     * Get price history for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @returns {Array} Price history
     */
    getPriceHistory(tokenAddress, chain) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);
        return token ? token.priceHistory : [];
    }

    /**
     * Mark token as exited
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     */
    markAsExited(tokenAddress, chain) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            token.status = 'exited';
        }
    }

    /**
     * Remove token from pool
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     */
    removeToken(tokenAddress, chain) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        this.pool.delete(key);
    }

    /**
     * Get all tokens in pool
     * @returns {Array} Array of token data
     */
    getAllTokens() {
        return Array.from(this.pool.values());
    }

    /**
     * Get tokens by status
     * @param {string} status - Status to filter by
     * @returns {Array} Array of token data
     */
    getTokensByStatus(status) {
        return this.getAllTokens().filter(t => t.status === status);
    }

    /**
     * Get monitoring tokens (status = 'monitoring' or 'bought')
     * @returns {Array} Array of token data
     */
    getMonitoringTokens() {
        return this.getAllTokens().filter(t =>
            t.status === 'monitoring' || t.status === 'bought'
        );
    }

    /**
     * 清理低收益且无交易的代币（节约存储资源）
     *
     * 规则：
     * - 在监控池中 ≥ 5分钟 (使用 addedAt 判断)
     * - earlyReturn < 5%
     * - status = 'monitoring' (未发生交易)
     *
     * @param {Map} factorResultsMap - tokenAddress -> { earlyReturn, ... }
     * @returns {Array} 被标记为不活跃的代币列表 [{ address, symbol, chain, reason, poolTimeMinutes, earlyReturn }]
     */
    cleanupInactiveTokens(factorResultsMap) {
        const now = Date.now();
        const MIN_POOL_TIME = 5 * 60 * 1000; // 5分钟
        const MAX_EARLY_RETURN = 5; // 5%
        const removed = [];

        for (const [key, token] of this.pool.entries()) {
            // 只处理监控中的代币（已买入的不清理）
            if (token.status !== 'monitoring') {
                continue;
            }

            // 条件1: 在池中 ≥ 5分钟
            const poolTime = now - token.addedAt;
            if (poolTime < MIN_POOL_TIME) {
                continue;
            }

            // 条件2: earlyReturn < 5%
            const factors = factorResultsMap.get(token.token);
            if (!factors || factors.earlyReturn >= MAX_EARLY_RETURN) {
                continue;
            }

            // 条件3: 没有交易行为 (status = 'monitoring' 已保证)

            // 满足条件，标记为不活跃
            token.status = 'inactive'; // 标记状态
            removed.push({
                address: token.token,
                symbol: token.symbol,
                chain: token.chain,
                reason: 'low_return_no_trade',
                poolTimeMinutes: Math.floor(poolTime / 60000),
                earlyReturn: factors.earlyReturn
            });

            this.logger.debug(`Token marked as inactive`, {
                symbol: token.symbol,
                address: token.token,
                poolTimeMinutes: Math.floor(poolTime / 60000),
                earlyReturn: factors.earlyReturn
            });
        }

        return removed;
    }

    /**
     * 获取需要从池中移除的代币列表
     *
     * 移除条件：
     * - status = 'inactive' (新标记的不活跃代币)
     * - 或 超过30分钟的任何代币
     *
     * @returns {Array} 需要移除的代币列表
     */
    getTokensToRemove() {
        const toRemove = [];

        for (const [key, token] of this.pool.entries()) {
            let shouldRemove = false;
            let reason = '';

            if (token.status === 'inactive') {
                shouldRemove = true;
                reason = '低收益无交易';
            } else {
                const now = Date.now();
                const age = now - token.createdAt * 1000;
                const MAX_AGE = 30 * 60 * 1000; // 30分钟
                if (age > MAX_AGE) {
                    shouldRemove = true;
                    reason = `监控超时(${(age / 60000).toFixed(1)}分钟)`;
                }
            }

            if (shouldRemove) {
                toRemove.push({ key, reason, symbol: token.symbol });
            }
        }

        return toRemove;
    }

    /**
     * Clean up old tokens (exceeded max age or marked inactive)
     *
     * 规则：
     * - status = 'inactive' 的代币：立即移除
     * - 所有代币（无论是否交易，包括已退出）：30分钟后淘汰（用于数据分析）
     *
     * @returns {Array} Array of removed token keys
     */
    cleanup() {
        const toRemove = this.getTokensToRemove();

        for (const { key, reason, symbol } of toRemove) {
            const token = this.pool.get(key);
            this.logger.debug(`Token removed from pool`, {
                symbol: symbol,
                address: token.token,
                reason: reason
            });
            this.pool.delete(key);
        }

        return toRemove.map(t => t.key);
    }

    /**
     * Get pool statistics
     * @returns {Object} Statistics
     */
    getStats() {
        const tokens = this.getAllTokens();
        return {
            total: tokens.length,
            monitoring: tokens.filter(t => t.status === 'monitoring').length,
            bought: tokens.filter(t => t.status === 'bought').length,
            selling: tokens.filter(t => t.status === 'selling').length,
            exited: tokens.filter(t => t.status === 'exited').length
        };
    }

    /**
     * Generate unique token key
     * @param {Object} tokenData - Token data
     * @returns {string} Unique key
     */
    getTokenKey(tokenData) {
        return `${tokenData.token}-${tokenData.chain || 'bsc'}`;
    }

    /**
     * Get K-line data for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @returns {Array} K-line data
     */
    getKlineData(tokenAddress, chain) {
        const token = this.getToken(tokenAddress, chain);
        return token ? token.klineData : [];
    }

    /**
     * Set card position manager for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {Object} cardManager - CardPositionManager instance
     */
    setCardPositionManager(tokenAddress, chain, cardManager) {
        const token = this.getToken(tokenAddress, chain);
        if (token) {
            token.cardPositionManager = cardManager;
        }
    }

    /**
     * Get card position manager for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @returns {Object|null} CardPositionManager instance
     */
    getCardPositionManager(tokenAddress, chain) {
        const token = this.getToken(tokenAddress, chain);
        return token ? token.cardPositionManager : null;
    }

    /**
     * Initialize strategy execution tracking for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {Array} strategyIds - Array of strategy IDs to track
     */
    initStrategyExecutions(tokenAddress, chain, strategyIds) {
        const token = this.getToken(tokenAddress, chain);
        if (token) {
            token.strategyExecutions = {};
            for (const strategyId of strategyIds) {
                token.strategyExecutions[strategyId] = {
                    count: 0,
                    lastExecuted: null
                };
            }
        }
    }

    /**
     * Record strategy execution for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {string} strategyId - Strategy ID
     * @returns {boolean} True if recorded successfully
     */
    recordStrategyExecution(tokenAddress, chain, strategyId) {
        const token = this.getToken(tokenAddress, chain);
        if (token && token.strategyExecutions) {
            if (!token.strategyExecutions[strategyId]) {
                token.strategyExecutions[strategyId] = {
                    count: 0,
                    lastExecuted: null
                };
            }
            token.strategyExecutions[strategyId].count++;
            token.strategyExecutions[strategyId].lastExecuted = Date.now();
            return true;
        }
        return false;
    }

    /**
     * Get strategy execution info for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {string} strategyId - Strategy ID
     * @returns {Object|null} Strategy execution info { count, lastExecuted }
     */
    getStrategyExecution(tokenAddress, chain, strategyId) {
        const token = this.getToken(tokenAddress, chain);
        if (token && token.strategyExecutions) {
            return token.strategyExecutions[strategyId] || null;
        }
        return null;
    }

    /**
     * Check if strategy can be executed (based on max executions limit)
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @param {string} strategyId - Strategy ID
     * @param {number} maxExecutions - Maximum allowed executions
     * @returns {boolean} True if strategy can be executed
     */
    canExecuteStrategy(tokenAddress, chain, strategyId, maxExecutions) {
        if (!maxExecutions) return true; // No limit

        const execution = this.getStrategyExecution(tokenAddress, chain, strategyId);
        if (!execution) return true; // Never executed, can execute

        return execution.count < maxExecutions;
    }

    /**
     * Get all strategy executions for a token
     * @param {string} tokenAddress - Token address
     * @param {string} chain - Chain
     * @returns {Object} All strategy executions
     */
    getAllStrategyExecutions(tokenAddress, chain) {
        const token = this.getToken(tokenAddress, chain);
        return token ? (token.strategyExecutions || {}) : {};
    }

    /**
     * Initialize TokenPool (async initialization method)
     * @returns {Promise<void>}
     */
    async initialize() {
        // 异步初始化方法（兼容 TradingEngine 的要求）
        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info('TokenPool initialized', { poolSize: this.pool.size });
        }
        return Promise.resolve();
    }
}

module.exports = TokenPool;
