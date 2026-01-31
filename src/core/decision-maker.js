/**
 * Decision Maker
 *
 * Orchestrates buy/sell decisions based on strategy engine output
 */

class DecisionMaker {
    constructor(config, logger, tokenPool, strategyEngine) {
        this.config = config;
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.strategyEngine = strategyEngine;
    }

    /**
     * Check and make buy decision for a monitoring token
     * @param {Object} tokenData - Token data from pool
     * @returns {Object|null} Decision result
     */
    checkBuyDecision(tokenData) {
        if (tokenData.status !== 'monitoring') {
            return null;
        }

        const klineData = tokenData.klineData;
        if (!klineData || klineData.length === 0) {
            return null;
        }

        // Check if we're at the right time (1 minute)
        const now = Date.now();
        const tokenAge = (now - tokenData.addedAt) / 1000; // seconds
        const buyTimeMinutes = this.config.strategy.buyTimeMinutes;

        // We want to check around buyTimeMinutes (with some tolerance)
        const targetTime = buyTimeMinutes * 60; // seconds
        const tolerance = 30; // 30 seconds tolerance

        if (Math.abs(tokenAge - targetTime) > tolerance) {
            return { shouldCheck: false, reason: `未到${buyTimeMinutes}分钟决策点` };
        }

        // Check buy conditions
        const decision = this.strategyEngine.checkBuyConditions(klineData, buyTimeMinutes);

        if (decision && decision.shouldBuy) {
            // Mark token as bought
            this.tokenPool.markAsBought(tokenData.token, tokenData.chain, {
                earlyReturn: decision.earlyReturn,
                buyPrice: decision.buyPrice,
                timestamp: now,
                metrics: decision.metrics
            });

            // Log the buy decision
            this.logger.buyDecision(tokenData, decision.reason, {
                earlyReturn: decision.earlyReturn,
                buyPrice: decision.buyPrice,
                ...decision.metrics
            });

            return {
                decision: 'BUY',
                token: tokenData.symbol,
                address: tokenData.token,
                earlyReturn: decision.earlyReturn,
                buyPrice: decision.buyPrice
            };
        }

        return {
            decision: 'HOLD',
            reason: decision.reason
        };
    }

    /**
     * Check and make sell decision for a bought token
     * @param {Object} tokenData - Token data from pool
     * @returns {Object|null} Decision result
     */
    checkSellDecision(tokenData) {
        if (tokenData.status !== 'bought') {
            return null;
        }

        const klineData = tokenData.klineData;
        if (!klineData || klineData.length === 0) {
            return null;
        }

        // Filter K-line data after buy time
        const buyTime = tokenData.buyTime || tokenData.addedAt;
        const futureKlines = klineData.filter(k => k.timestamp * 1000 >= buyTime);

        if (futureKlines.length === 0) {
            return null;
        }

        // Update current price
        const latestKline = futureKlines[futureKlines.length - 1];
        this.tokenPool.updateCurrentPrice(tokenData.token, tokenData.chain, latestKline.close);

        // Check sell conditions
        const decision = this.strategyEngine.checkSellConditions(tokenData, futureKlines);

        if (!decision) {
            return null;
        }

        if (decision.shouldSell) {
            // Mark appropriate action
            if (decision.action === 'first_take_profit') {
                tokenData.sold50 = true;
                tokenData.status = 'selling';
            } else if (decision.action === 'second_take_profit' || decision.action === 'timeout') {
                this.tokenPool.markAsExited(tokenData.token, tokenData.chain);
            }

            // Log the sell decision
            this.logger.sellDecision(tokenData, decision.reason, {
                currentReturn: decision.currentReturn,
                buyPrice: tokenData.buyPrice,
                currentPrice: latestKline.close
            }, decision.sellPercentage);

            return {
                decision: 'SELL',
                token: tokenData.symbol,
                address: tokenData.token,
                sellPercentage: decision.sellPercentage,
                reason: decision.reason,
                currentReturn: decision.currentReturn,
                action: decision.action
            };
        }

        if (decision.shouldHold) {
            return {
                decision: 'HOLD',
                token: tokenData.symbol,
                reason: decision.reason,
                currentReturn: decision.currentReturn
            };
        }

        return {
            decision: 'MONITORING',
            token: tokenData.symbol,
            currentReturn: decision.currentReturn,
            minutesSinceBuy: decision.minutesSinceBuy
        };
    }

    /**
     * Process all monitoring tokens and make decisions
     * @returns {Object} Summary of decisions made
     */
    processDecisions() {
        const summary = {
            buyDecisions: 0,
            sellDecisions: 0,
            holdDecisions: 0,
            details: []
        };

        // Check monitoring tokens for buy decision
        const monitoringTokens = this.tokenPool.getTokensByStatus('monitoring');
        for (const token of monitoringTokens) {
            const decision = this.checkBuyDecision(token);
            if (decision) {
                summary.details.push(decision);
                if (decision.decision === 'BUY') {
                    summary.buyDecisions++;
                }
            }
        }

        // Check bought tokens for sell decision
        const boughtTokens = this.tokenPool.getTokensByStatus('bought');
        for (const token of boughtTokens) {
            const decision = this.checkSellDecision(token);
            if (decision) {
                summary.details.push(decision);
                if (decision.decision === 'SELL') {
                    summary.sellDecisions++;
                } else if (decision.decision === 'HOLD') {
                    summary.holdDecisions++;
                }
            }
        }

        return summary;
    }

    /**
     * Check for timeout tokens and log them
     * @returns {Array} Timed out tokens
     */
    checkTimeouts() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        const timeouts = [];

        for (const token of this.tokenPool.getMonitoringTokens()) {
            const age = now - token.addedAt;

            if (age > maxAge) {
                const metrics = this.getFinalMetrics(token);
                this.logger.tokenTimeout(token, '超过30分钟观察窗口', metrics);
                this.tokenPool.markAsExited(token.token, token.chain);
                timeouts.push(token);
            }
        }

        return timeouts;
    }

    /**
     * Get final metrics for a token
     * @param {Object} tokenData - Token data
     * @returns {Object} Final metrics
     */
    getFinalMetrics(tokenData) {
        const metrics = {
            inPoolDuration: Date.now() - tokenData.addedAt,
            status: tokenData.status
        };

        if (tokenData.buyPrice && tokenData.currentPrice) {
            metrics.finalReturn = ((tokenData.currentPrice - tokenData.buyPrice) / tokenData.buyPrice * 100).toFixed(2);
            metrics.buyPrice = tokenData.buyPrice;
            metrics.finalPrice = tokenData.currentPrice;
        }

        if (tokenData.buyDecision) {
            metrics.earlyReturn = tokenData.buyDecision.earlyReturn;
        }

        return metrics;
    }
}

module.exports = DecisionMaker;
