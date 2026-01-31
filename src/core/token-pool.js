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

        const poolData = {
            token: tokenData.token,
            tokenAddress: tokenData.token,
            chain: tokenData.chain,
            name: tokenData.name,
            symbol: tokenData.symbol,
            createdAt: tokenData.created_at || Date.now() / 1000,
            addedAt: Date.now(),
            klineData: [],
            status: 'monitoring', // monitoring, bought, selling, exited
            buyDecision: null,
            buyPrice: null,
            buyTime: null,
            currentPrice: null,
            entryMetrics: null
        };

        this.pool.set(key, poolData);
        this.logger.debug(`Token added to pool`, {
            symbol: tokenData.symbol,
            address: tokenData.token,
            chain: tokenData.chain
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
     * @returns {Array} Array of removed token keys
     */
    cleanup() {
        const now = Date.now();
        const toRemove = [];

        for (const [key, token] of this.pool.entries()) {
            const age = now - token.addedAt;

            // Remove if exceeded max age or already exited
            if (age > this.maxAge || token.status === 'exited') {
                toRemove.push(key);
            }
        }

        for (const key of toRemove) {
            const token = this.pool.get(key);
            this.logger.debug(`Token removed from pool`, {
                symbol: token.symbol,
                address: token.token,
                reason: age > this.maxAge ? '超时' : '已退出'
            });
            this.pool.delete(key);
        }

        return toRemove;
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
