/**
 * Fourmeme Token Collector
 *
 * Collects new tokens from four.meme platform every 10 seconds
 */

const { AveTokenAPI } = require('../core/ave-api');

class FourmemeCollector {
    constructor(config, logger, tokenPool) {
        this.config = config;
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.collectorConfig = config.collector;
        this.aveConfig = config.ave;

        // Initialize AVE API client
        const apiKey = process.env.AVE_API_KEY;
        this.aveApi = new AveTokenAPI(
            this.aveConfig.apiUrl,
            this.aveConfig.timeout,
            apiKey
        );

        // Track collected tokens to avoid duplicates
        this.collectedTokens = new Set();

        // Statistics
        this.stats = {
            totalCollected: 0,
            totalAdded: 0,
            totalSkipped: 0,
            lastCollectionTime: null
        };

        this.logger.info('Fourmeme收集器初始化完成', {
            interval: this.collectorConfig.interval,
            platform: this.collectorConfig.platform,
            chain: this.collectorConfig.chain,
            maxAgeSeconds: this.collectorConfig.maxAgeSeconds
        });
    }

    /**
     * Start the collector
     */
    start() {
        this.logger.info('启动Fourmeme收集器');
        this.collect(); // First collection

        // Set up interval
        this.intervalId = setInterval(() => {
            this.collect();
        }, this.collectorConfig.interval);
    }

    /**
     * Stop the collector
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.logger.info('Fourmeme收集器已停止');
        }
    }

    /**
     * Collect new tokens from four.meme
     */
    async collect() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集four.meme新代币');

            // Fetch new tokens from AVE API
            const tag = 'fourmeme_in_new';
            const chain = this.collectorConfig.chain;
            const limit = this.collectorConfig.fetchLimit;
            const orderby = 'created_at';

            const tokens = await this.aveApi.getPlatformTokens(tag, chain, limit, orderby);

            this.stats.totalCollected += tokens.length;
            this.stats.lastCollectionTime = new Date().toISOString();

            this.logger.debug(`获取到 ${tokens.length} 个four.meme代币`);

            // Filter and add new tokens
            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            let addedCount = 0;
            let skippedCount = 0;

            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;

                // Skip if already collected
                if (this.collectedTokens.has(tokenKey)) {
                    continue;
                }

                // Check token age
                const tokenAge = now - (token.created_at * 1000);

                // Only add tokens younger than maxAgeSeconds (1 minute)
                if (tokenAge < maxAgeMs) {
                    const added = this.tokenPool.addToken(token);
                    if (added) {
                        addedCount++;
                        this.collectedTokens.add(tokenKey);
                    }
                } else {
                    skippedCount++;
                }

                // Always add to collected set to avoid reprocessing
                this.collectedTokens.add(tokenKey);
            }

            this.stats.totalAdded += addedCount;
            this.stats.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('收集完成', {
                fetched: tokens.length,
                added: addedCount,
                skipped: skippedCount,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('收集four.meme代币失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Get collector statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            ...this.stats,
            poolSize: this.tokenPool.getAllTokens().length,
            monitoringCount: this.tokenPool.getTokensByStatus('monitoring').length,
            boughtCount: this.tokenPool.getTokensByStatus('bought').length
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalCollected: 0,
            totalAdded: 0,
            totalSkipped: 0,
            lastCollectionTime: null
        };
    }
}

module.exports = FourmemeCollector;
