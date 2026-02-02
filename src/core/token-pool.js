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

        const collectionTime = Date.now();

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
            currentPrice: currentPrice, // 存储 AVE API 返回的当前价格
            collectionPrice: currentPrice, // 收集时的价格（作为基准价格）
            collectionTime: collectionTime, // 收集时间（用于计算 age）
            priceHistory: [], // 价格历史记录
            entryMetrics: null
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
     */
    updatePrice(tokenAddress, chain, price, timestamp) {
        const key = this.getTokenKey({ token: tokenAddress, chain });
        const token = this.pool.get(key);

        if (token) {
            token.currentPrice = price;
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
     * Clean up old tokens (exceeded max age)
     *
     * 规则：
     * - 所有代币（无论是否交易）：30分钟后淘汰（用于数据分析）
     * - 已退出 (exited) 的代币：立即移除
     *
     * @returns {Array} Array of removed token keys
     */
    cleanup() {
        const now = Date.now();
        const toRemove = [];

        // 时间常量（毫秒）- 所有代币统一监控30分钟
        const MAX_AGE = 30 * 60 * 1000;  // 30分钟

        for (const [key, token] of this.pool.entries()) {
            let removeReason = null;

            // 已退出：立即移除
            if (token.status === 'exited') {
                removeReason = '已退出';
            }
            // 监控中或已购买：30分钟后淘汰
            else if (token.status === 'monitoring' || token.status === 'bought') {
                const age = now - token.createdAt * 1000;  // 使用代币创建时间
                if (age > MAX_AGE) {
                    removeReason = `监控超时(${(age / 60000).toFixed(1)}分钟)`;
                }
            }

            if (removeReason) {
                toRemove.push({ key, reason: removeReason, symbol: token.symbol });
            }
        }

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
}

module.exports = TokenPool;
