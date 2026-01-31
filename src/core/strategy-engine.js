/**
 * Strategy Engine
 *
 * Implements the trading strategy based on historical data analysis
 * Strategy: Buy at 1 minute if earlyReturn is 80-120%, use ladder take-profit
 */

class StrategyEngine {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.strategy = config.strategy;
    }

    /**
     * Calculate earlyReturn based on K-line data
     * earlyReturn = (close at N minutes - first open) / first open * 100%
     *
     * @param {Array} klineData - K-line data
     * @param {number} buyMinutes - Buy time in minutes (default: 1)
     * @returns {Object|null} earlyReturn result or null if insufficient data
     */
    calculateEarlyReturn(klineData, buyMinutes = 1) {
        if (!klineData || klineData.length < buyMinutes + 1) {
            return null;
        }

        // Sort by timestamp to ensure correct order
        const sorted = [...klineData].sort((a, b) => a.timestamp - b.timestamp);

        const firstOpen = sorted[0].open;
        if (!firstOpen || firstOpen <= 0) {
            return null;
        }

        // Find the K-line at buyMinutes
        // K-line timestamps are in seconds, buyMinutes is in minutes
        const firstTimestamp = sorted[0].timestamp;
        const targetTimestamp = firstTimestamp + (buyMinutes * 60);

        // Find the K-line closest to target time
        let buyKline = null;
        for (const kline of sorted) {
            if (kline.timestamp >= targetTimestamp) {
                buyKline = kline;
                break;
            }
        }

        if (!buyKline) {
            // Use the last available K-line before target time
            for (let i = sorted.length - 1; i >= 0; i--) {
                if (sorted[i].timestamp < targetTimestamp) {
                    buyKline = sorted[i];
                    break;
                }
            }
        }

        if (!buyKline) {
            return null;
        }

        const closePrice = buyKline.close;
        const earlyReturn = ((closePrice - firstOpen) / firstOpen) * 100;

        // Additional metrics
        let maxReturn = 0;
        let minReturn = 0;
        let consecutiveUp = 0;
        let maxConsecutiveUp = 0;

        for (const kline of sorted) {
            if (kline.timestamp > buyKline.timestamp) break;

            const highRet = ((kline.high - firstOpen) / firstOpen) * 100;
            if (highRet > maxReturn) maxReturn = highRet;

            const lowRet = ((kline.low - firstOpen) / firstOpen) * 100;
            if (lowRet < minReturn) minReturn = lowRet;

            if (kline.close > kline.open) {
                consecutiveUp++;
                if (consecutiveUp > maxConsecutiveUp) {
                    maxConsecutiveUp = consecutiveUp;
                }
            } else {
                consecutiveUp = 0;
            }
        }

        return {
            earlyReturn: parseFloat(earlyReturn.toFixed(2)),
            maxReturn: parseFloat(maxReturn.toFixed(2)),
            minReturn: parseFloat(minReturn.toFixed(2)),
            maxConsecutiveUp,
            buyPrice: parseFloat(buyKline.close),
            firstTimestamp: sorted[0].timestamp,
            buyTimestamp: buyKline.timestamp
        };
    }

    /**
     * Check if buy conditions are met
     * Conditions:
     * - earlyReturn in [earlyReturnMin, earlyReturnMax]
     * - At buyTimeMinutes (1 minute)
     *
     * @param {Array} klineData - K-line data
     * @param {number} buyMinutes - Buy time in minutes
     * @returns {Object|null} Buy decision or null if conditions not met
     */
    checkBuyConditions(klineData, buyMinutes = 1) {
        if (buyMinutes !== this.strategy.buyTimeMinutes) {
            return null;
        }

        const result = this.calculateEarlyReturn(klineData, buyMinutes);
        if (!result) {
            return null;
        }

        const { earlyReturn } = result;

        // Check if earlyReturn is in the target range
        if (earlyReturn >= this.strategy.earlyReturnMin &&
            earlyReturn < this.strategy.earlyReturnMax) {
            return {
                shouldBuy: true,
                earlyReturn,
                buyPrice: result.buyPrice,
                reason: `earlyReturn在${this.strategy.earlyReturnMin}-${this.strategy.earlyReturnMax}%区间`,
                metrics: result
            };
        }

        return {
            shouldBuy: false,
            earlyReturn,
            reason: `earlyReturn=${earlyReturn.toFixed(1)}%，不在目标区间`
        };
    }

    /**
     * Check sell conditions for a bought token
     * Ladder take-profit:
     * - +30%: sell 50%
     * - +50%: sell remaining 50%
     * - 5 minutes without +30%: hold to end
     * - 30 minutes: force exit
     *
     * @param {Object} tokenData - Token data from pool
     * @param {Array} klineData - Current K-line data
     * @returns {Object|null} Sell decision or null if no action needed
     */
    checkSellConditions(tokenData, klineData) {
        if (tokenData.status !== 'bought' || !tokenData.buyPrice) {
            return null;
        }

        if (!klineData || klineData.length === 0) {
            return null;
        }

        const buyPrice = tokenData.buyPrice;
        const latestKline = klineData[klineData.length - 1];
        const currentPrice = latestKline.close;
        const currentReturn = ((currentPrice - buyPrice) / buyPrice) * 100;

        const now = Date.now();
        const buyTime = tokenData.buyTime || tokenData.addedAt;
        const minutesSinceBuy = (now - buyTime) / (60 * 1000);
        const minutesSinceBuyInt = Math.floor(minutesSinceBuy);

        // Calculate max return since buy
        let maxReturn = currentReturn;
        for (const kline of klineData) {
            const klineTime = kline.timestamp * 1000;
            if (klineTime >= buyTime) {
                const ret = ((kline.high - buyPrice) / buyPrice) * 100;
                if (ret > maxReturn) maxReturn = ret;
            }
        }

        // Check take profit 1: +30%, sell 50%
        if (currentReturn >= this.strategy.takeProfit1) {
            // Check if we already sold 50%
            const sold50 = tokenData.sold50 || false;

            if (!sold50) {
                return {
                    shouldSell: true,
                    sellPercentage: this.strategy.takeProfit1Sell,
                    reason: `触发+${this.strategy.takeProfit1}%止盈`,
                    currentReturn: parseFloat(currentReturn.toFixed(2)),
                    action: 'first_take_profit'
                };
            }

            // Check take profit 2: +50%, sell remaining
            if (currentReturn >= this.strategy.takeProfit2) {
                return {
                    shouldSell: true,
                    sellPercentage: 1.0, // Sell all remaining
                    reason: `触发+${this.strategy.takeProfit2}%止盈`,
                    currentReturn: parseFloat(currentReturn.toFixed(2)),
                    action: 'second_take_profit'
                };
            }
        }

        // Check timeout: 5 minutes without reaching +30%
        if (minutesSinceBuyInt >= this.strategy.stopLossMinutes && maxReturn < this.strategy.takeProfit1) {
            // Hold to end (30 minutes)
            return {
                shouldHold: true,
                reason: `${this.strategy.stopLossMinutes}分钟内未达到+${this.strategy.takeProfit1}%，持有到结束`,
                currentReturn: parseFloat(currentReturn.toFixed(2)),
                minutesSinceBuy: minutesSinceBuyInt
            };
        }

        // Check force exit: 30 minutes
        if (minutesSinceBuyInt >= 30) {
            return {
                shouldSell: true,
                sellPercentage: 1.0,
                reason: '超过30分钟观察窗口',
                currentReturn: parseFloat(currentReturn.toFixed(2)),
                action: 'timeout'
            };
        }

        // No action needed
        return {
            shouldSell: false,
            currentReturn: parseFloat(currentReturn.toFixed(2)),
            minutesSinceBuy: minutesSinceBuyInt,
            maxReturn: parseFloat(maxReturn.toFixed(2))
        };
    }

    /**
     * Simulate the ladder take-profit strategy for backtesting
     *
     * @param {number} buyPrice - Buy price
     * @param {Array} futureKlines - Future K-line data after buy
     * @returns {Object} Simulation result
     */
    simulateLadderStrategy(buyPrice, futureKlines) {
        let triggered30 = false;
        let triggered50 = false;
        let cash = 0;
        let remainingShares = 100;

        for (const kline of futureKlines) {
            const currentReturn = ((kline.close - buyPrice) / buyPrice) * 100;

            // First take profit: +30%, sell 50%
            if (!triggered30 && currentReturn >= 30) {
                triggered30 = true;
                cash += remainingShares * 0.5 * kline.close;
                remainingShares = remainingShares * 0.5;
            }

            // Second take profit: +50%, sell remaining
            if (triggered30 && !triggered50 && currentReturn >= 50) {
                triggered50 = true;
                cash += remainingShares * kline.close;
                remainingShares = 0;
                break;
            }

            // 5 minutes without +30%: hold to end
            const timeFromBuy = (kline.timestamp - futureKlines[0].timestamp) / 60;
            if (timeFromBuy >= 5 && !triggered30) {
                cash += remainingShares * futureKlines[futureKlines.length - 1].close;
                remainingShares = 0;
                break;
            }

            // 30 minutes: force exit
            if (timeFromBuy >= 30) {
                cash += remainingShares * kline.close;
                remainingShares = 0;
                break;
            }
        }

        // If loop ends without selling, use last close price
        if (remainingShares > 0) {
            cash += remainingShares * futureKlines[futureKlines.length - 1].close;
        }

        const finalReturn = ((cash - 100 * buyPrice) / (100 * buyPrice)) * 100;

        return {
            triggered30,
            triggered50,
            finalReturn: parseFloat(finalReturn.toFixed(2))
        };
    }
}

module.exports = StrategyEngine;
