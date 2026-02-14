/**
 * Fourmeme Token Collector
 *
 * Collects new tokens from four.meme platform every 10 seconds
 */

const { AveTokenAPI } = require('../core/ave-api');
const { WalletDataService } = require('../web/services/WalletDataService');

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

        // Initialize WalletService for dev wallet filtering
        this.walletService = new WalletDataService();

        // Track collected tokens to avoid duplicates
        this.collectedTokens = new Set();

        // Dev wallet cache (refresh every minute)
        this.devWallets = [];
        this.lastDevWalletRefresh = 0;

        // Statistics
        this.stats = {
            totalCollected: 0,
            totalAdded: 0,
            totalSkipped: 0,
            totalDevFiltered: 0,
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

            // Filter and add new tokens
            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            this.logger.debug(`获取到 ${tokens.length} 个four.meme代币`);

            // 添加详细日志：显示 API 返回的最新代币创建时间
            if (tokens.length > 0) {
                const latestCreatedAt = Math.max(...tokens.map(t => t.created_at || 0));
                const latestAgeSeconds = (now - latestCreatedAt * 1000) / 1000;
                const oldestCreatedAt = Math.min(...tokens.map(t => t.created_at || 0));
                const oldestAgeSeconds = (now - oldestCreatedAt * 1000) / 1000;
                this.logger.debug(`API 返回代币时间范围 | 最新: ${latestAgeSeconds.toFixed(0)}秒前, 最旧: ${oldestAgeSeconds.toFixed(0)}秒前`);
            }

            let addedCount = 0;
            let skippedCount = 0;
            let alreadyInPoolCount = 0;

            // 统计年龄分布
            const ageRanges = {
                '0-30s': 0,
                '30-60s': 0,
                '1-2m': 0,
                '2-5m': 0,
                '5m+': 0
            };

            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;

                // 统计年龄分布（移到 continue 之前，确保所有代币都被统计）
                const tokenAge = now - (token.created_at * 1000);
                const tokenAgeSeconds = tokenAge / 1000;

                if (tokenAgeSeconds < 30) {
                    ageRanges['0-30s']++;
                } else if (tokenAgeSeconds < 60) {
                    ageRanges['30-60s']++;
                } else if (tokenAgeSeconds < 120) {
                    ageRanges['1-2m']++;
                } else if (tokenAgeSeconds < 300) {
                    ageRanges['2-5m']++;
                } else {
                    ageRanges['5m+']++;
                }

                // Skip if already collected
                if (this.collectedTokens.has(tokenKey)) {
                    continue;
                }

                // 检查代币是否已在池中（用于统计）
                const existingToken = this.tokenPool.getToken(token.token, token.chain);
                if (existingToken) {
                    alreadyInPoolCount++;
                }

                // Only add tokens younger than maxAgeSeconds (1 minute)
                if (tokenAge < maxAgeMs) {
                    // 调用 getContractRisk API 获取合约风险数据
                    let contractRiskData = null;
                    try {
                        const tokenId = `${token.token}-${token.chain}`;
                        contractRiskData = await this.aveApi.getContractRisk(tokenId);
                        // 提取创建者地址添加到 token 对象
                        if (contractRiskData.creator_address) {
                            token.creator_address = contractRiskData.creator_address;
                        }
                    } catch (riskError) {
                        // 风险数据获取失败不影响代币添加
                        this.logger.warn('获取合约风险数据失败', {
                            token: token.token,
                            symbol: token.symbol,
                            error: riskError.message
                        });
                    }

                    // 将风险数据添加到 token 对象
                    if (contractRiskData) {
                        token.contract_risk_raw_ave_data = contractRiskData;
                    }

                    // 检查创建者是否为 Dev 钱包
                    let isDevCreator = false;
                    if (token.creator_address) {
                        isDevCreator = await this.isDevWallet(token.creator_address);
                    }

                    if (isDevCreator) {
                        // 标记为 negative_dev 状态
                        token.status = 'negative_dev';
                        this.stats.totalDevFiltered++;
                        this.logger.info('代币创建者为Dev钱包，标记为negative_dev', {
                            token: token.token,
                            symbol: token.symbol,
                            creator: token.creator_address
                        });
                    }

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
                alreadyInPool: alreadyInPoolCount,
                ageRanges: ageRanges,
                maxAgeSeconds: this.collectorConfig.maxAgeSeconds,
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
     * Check if creator address is a dev wallet
     * @param {string} creatorAddress - Creator wallet address
     * @returns {Promise<boolean>} True if creator is in dev wallet list
     */
    async isDevWallet(creatorAddress) {
        if (!creatorAddress) return false;

        // Refresh dev wallet cache every 60 seconds
        const now = Date.now();
        if (now - this.lastDevWalletRefresh > 60000) {
            try {
                const allWallets = await this.walletService.getWallets();
                this.devWallets = allWallets.filter(w => w.category === 'dev');
                this.lastDevWalletRefresh = now;
                this.logger.debug('刷新Dev钱包缓存', {
                    count: this.devWallets.length
                });
            } catch (error) {
                this.logger.warn('刷新Dev钱包缓存失败', { error: error.message });
            }
        }

        // Check if creator is in dev wallet list
        return this.devWallets.some(w =>
            w.address.toLowerCase() === creatorAddress.toLowerCase()
        );
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
