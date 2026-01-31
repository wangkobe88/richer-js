/**
 * K-line Monitor
 *
 * Monitors K-line data for tokens in the pool
 */

const { AveKlineAPI } = require('../core/ave-api');

class KlineMonitor {
    constructor(config, logger, tokenPool) {
        this.config = config;
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.monitorConfig = config.monitor;
        this.aveConfig = config.ave;

        // Initialize AVE K-line API client
        const apiKey = process.env.AVE_API_KEY;
        this.klineApi = new AveKlineAPI(
            this.aveConfig.apiUrl,
            this.aveConfig.timeout,
            apiKey
        );

        // Statistics
        this.stats = {
            totalUpdates: 0,
            successfulUpdates: 0,
            failedUpdates: 0,
            lastUpdateTime: null
        };

        this.logger.info('K线监控器初始化完成', {
            interval: this.monitorConfig.interval,
            klineLimit: this.monitorConfig.klineLimit
        });
    }

    /**
     * Start the monitor
     */
    start() {
        this.logger.info('启动K线监控器');
        this.monitor(); // First run

        this.intervalId = setInterval(() => {
            this.monitor();
        }, this.monitorConfig.decisionCheckInterval);
    }

    /**
     * Stop the monitor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.logger.info('K线监控器已停止');
        }
    }

    /**
     * Monitor all tokens in the pool and update their K-line data
     */
    async monitor() {
        try {
            const startTime = Date.now();
            const tokens = this.tokenPool.getMonitoringTokens();

            if (tokens.length === 0) {
                this.logger.debug('没有代币需要监控');
                return;
            }

            this.logger.debug(`开始监控 ${tokens.length} 个代币的K线数据`);

            let successCount = 0;
            let failCount = 0;

            for (const token of tokens) {
                try {
                    await this.updateTokenKline(token);
                    successCount++;
                } catch (error) {
                    failCount++;
                    this.logger.debug('更新代币K线失败', {
                        symbol: token.symbol,
                        address: token.token,
                        error: error.message
                    });
                }
            }

            this.stats.totalUpdates += tokens.length;
            this.stats.successfulUpdates += successCount;
            this.stats.failedUpdates += failCount;
            this.stats.lastUpdateTime = new Date().toISOString();

            const duration = Date.now() - startTime;
            this.logger.debug('K线监控完成', {
                total: tokens.length,
                success: successCount,
                failed: failCount,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('K线监控失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Update K-line data for a single token
     * @param {Object} token - Token data from pool
     */
    async updateTokenKline(token) {
        const tokenId = `${token.token}-${token.chain}`;
        const interval = 1; // 1-minute K-line
        const limit = this.monitorConfig.klineLimit;

        // Fetch K-line data from AVE API
        const klineData = await this.klineApi.getKlineDataByToken(tokenId, interval, limit);

        if (!klineData || !klineData.points || klineData.points.length === 0) {
            this.logger.debug('未获取到K线数据', {
                symbol: token.symbol,
                tokenId
            });
            return;
        }

        // Format K-line data
        const formattedPoints = AveKlineAPI.formatKlinePoints(klineData.points);

        // Update token's K-line data in pool
        this.tokenPool.updateKlineData(token.token, token.chain, formattedPoints);

        this.logger.debug('K线数据已更新', {
            symbol: token.symbol,
            pointsCount: formattedPoints.length
        });
    }

    /**
     * Get monitor statistics
     * @returns {Object} Statistics
     */
    getStats() {
        const poolStats = this.tokenPool.getStats();
        return {
            ...this.stats,
            ...poolStats
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalUpdates: 0,
            successfulUpdates: 0,
            failedUpdates: 0,
            lastUpdateTime: null
        };
    }
}

module.exports = KlineMonitor;
