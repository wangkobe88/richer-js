/**
 * Platform Token Collector
 *
 * Collects new tokens from four.meme and flap platforms every 10 seconds
 */

const { AveTokenAPI } = require('../core/ave-api');
const { FourMemeTokenAPI } = require('../core/fourmeme-api');
const { PlatformPairResolver } = require('../core/PlatformPairResolver');
const { GMGNMarketAPI } = require('../core/gmgn-api/market-api');

class PlatformCollector {
    constructor(config, logger, tokenPool, experimentId = null, blockchain = 'bsc') {
        this.config = config;
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.experimentId = experimentId;  // 保存实验ID
        this.blockchain = blockchain;  // 保存区块链配置
        this.collectorConfig = config.collector;
        this.aveConfig = config.ave;

        // Initialize AVE API client (for getting platform tokens)
        const apiKey = process.env.AVE_API_KEY;
        this.aveApi = new AveTokenAPI(
            this.aveConfig.apiUrl,
            this.aveConfig.timeout,
            apiKey
        );

        // Initialize FourMeme API client (for getting creator address)
        this.fourMemeApi = new FourMemeTokenAPI(
            config.fourmeme?.apiUrl || 'https://four.meme',
            config.fourmeme?.timeout || 30000
        );

        // Initialize PlatformPairResolver for resolving pair addresses
        this.pairResolver = new PlatformPairResolver(this.logger);

        // Initialize GMGN Market API client (for ETH trending tokens supplement)
        const gmgnApiKey = process.env.GMGN_API_KEY;
        const gmgnProxy = process.env.GMGN_SOCKS_PROXY;
        if (gmgnApiKey) {
            this.gmgnMarketApi = new GMGNMarketAPI({ apiKey: gmgnApiKey, socksProxy: gmgnProxy });
        } else {
            this.gmgnMarketApi = null;
        }

        // Track collected tokens to avoid duplicates
        this.collectedTokens = new Set();

        // Statistics (按平台分别统计)
        this.stats = {
            fourmeme: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            flap: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            bankr: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            pumpfun: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            eth: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            lastCollectionTime: null
        };

        this.logger.info('多平台收集器初始化完成', {
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
        this.logger.info('启动多平台收集器');
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
            this.logger.info('多平台收集器已停止');
        }
    }

    /**
     * Collect new tokens from all platforms (fourmeme, flap, bankr, pumpfun)
     * 根据 blockchain 配置过滤应该收集的平台
     */
    async collect() {
        try {
            const startTime = Date.now();

            // 根据 blockchain 配置决定收集哪些平台
            if (this.blockchain === 'bsc') {
                // BSC 链：fourmeme 和 flap
                await this.collectFourmemeTokens();

                // === Flap平台暂时关闭 ===
                if (this.collectorConfig.enableFlap !== false) {
                    await this.collectFlapTokens();
                } else {
                    this.logger.info('Flap平台数据采集已通过配置关闭 (config.collector.enableFlap = false)');
                }
                // === Flap平台关闭结束 ===

            } else if (this.blockchain === 'base') {
                // Base 链：bankr
                if (this.collectorConfig.enableBankr !== false) {
                    await this.collectBankrTokens();
                } else {
                    this.logger.info('Bankr平台数据采集已通过配置关闭 (config.collector.enableBankr = false)');
                }

            } else if (this.blockchain === 'solana') {
                // Solana 链：pumpfun
                if (this.collectorConfig.enablePumpfun !== false) {
                    await this.collectPumpfunTokens();
                } else {
                    this.logger.info('Pumpfun平台数据采集已通过配置关闭 (config.collector.enablePumpfun = false)');
                }

            } else if (this.blockchain === 'ethereum') {
                // ETH 链：通过 AVE API trending 端点获取热门新币
                await this.collectEthNewTokens();

            } else {
                this.logger.warn(`未知的区块链配置: ${this.blockchain}，跳过代币收集`);
            }

            this.stats.lastCollectionTime = new Date().toISOString();

            const duration = Date.now() - startTime;
            this.logger.debug('多平台收集完成', {
                blockchain: this.blockchain,
                duration: `${duration}ms`,
                fourmeme: this.stats.fourmeme,
                flap: this.stats.flap,
                bankr: this.stats.bankr,
                pumpfun: this.stats.pumpfun
            });

        } catch (error) {
            this.logger.error('收集代币失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Collect new tokens from four.meme platform
     */
    async collectFourmemeTokens() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集four.meme新代币');

            // Fetch new tokens from AVE API
            const tag = 'fourmeme_in_new';
            const chain = this.collectorConfig.chain;
            const limit = this.collectorConfig.fetchLimit;
            const orderby = 'created_at';

            const tokens = await this.aveApi.getPlatformTokens(tag, chain, limit, orderby);

            this.stats.fourmeme.totalCollected += tokens.length;

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
                    // 调用 FourMeme API 获取创建者地址
                    let creatorInfo = null;
                    try {
                        creatorInfo = await this.fourMemeApi.getCreatorAddress(token.token);

                        // 详细日志：记录 API 返回的 creator_address
                        const apiCreatorAddress = creatorInfo.creator_address || null;
                        this.logger.debug('获取创建者地址成功', {
                            token: token.token,
                            symbol: token.symbol,
                            creator_address: apiCreatorAddress,
                            has_creator: !!apiCreatorAddress
                        });

                        // 提取创建者地址添加到 token 对象
                        if (apiCreatorAddress) {
                            token.creator_address = apiCreatorAddress;
                            this.logger.debug('设置创建者地址', {
                                token: token.token,
                                symbol: token.symbol,
                                creator_address: apiCreatorAddress
                            });
                        } else {
                            this.logger.warn('FourMeme API 返回的创建者地址为空', {
                                token: token.token,
                                symbol: token.symbol
                            });
                        }
                    } catch (riskError) {
                        // 创建者地址获取失败不影响代币添加
                        this.logger.warn('获取创建者地址失败', {
                            token: token.token,
                            symbol: token.symbol,
                            error: riskError.message
                        });
                    }

                    // 将创建者信息添加到 token 对象（备用）
                    if (creatorInfo) {
                        token.fourmeme_creator_info = creatorInfo;
                    }

                    // 添加代币到监控池
                    const added = this.tokenPool.addToken(token);
                    if (added) {
                        addedCount++;
                        this.collectedTokens.add(tokenKey);
                    } else {
                        skippedCount++;
                    }
                } else {
                    skippedCount++;
                }

                // Always add to collected set to avoid reprocessing
                this.collectedTokens.add(tokenKey);
            }

            // 为 fourmeme 平台的代币添加 platform 字段和 pairAddress
            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;
                if (this.collectedTokens.has(tokenKey)) {
                    const poolToken = this.tokenPool.getToken(token.token, token.chain);
                    if (poolToken && !poolToken.platform) {
                        poolToken.platform = 'fourmeme';
                        // fourmeme 使用直接拼接策略
                        const pairAddress = `${token.token}_fo`;
                        poolToken.pairAddress = pairAddress;
                    }
                }
            }

            this.stats.fourmeme.totalAdded += addedCount;
            this.stats.fourmeme.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('four.meme平台收集完成', {
                platform: 'fourmeme',
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
     * Collect new tokens from flap platform
     */
    async collectFlapTokens() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集flap新代币');

            // Fetch new tokens from AVE API
            const tag = 'flap_in_new';
            const chain = this.collectorConfig.chain;
            const limit = this.collectorConfig.fetchLimit;
            const orderby = 'created_at';

            const tokens = await this.aveApi.getPlatformTokens(tag, chain, limit, orderby);

            this.stats.flap.totalCollected += tokens.length;

            // Filter and add new tokens
            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            this.logger.debug(`获取到 ${tokens.length} 个flap代币`);

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

                // 统计年龄分布
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

                // 设置平台字段
                token.platform = 'flap';
                // Flap 平台无创建者地址（跳过 Four.meme API 调用）
                token.creator_address = null;

                // Only add tokens younger than maxAgeSeconds (1 minute)
                if (tokenAge < maxAgeMs) {
                    // 添加代币到 tokenPool
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

            // 为 flap 平台的代币添加 platform 字段和 pairAddress
            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;
                if (this.collectedTokens.has(tokenKey)) {
                    const poolToken = this.tokenPool.getToken(token.token, token.chain);
                    if (poolToken && !poolToken.platform) {
                        poolToken.platform = 'flap';
                        // flap 使用直接拼接策略
                        const pairAddress = `${token.token}_iportal`;
                        poolToken.pairAddress = pairAddress;
                    }
                }
            }

            this.stats.flap.totalAdded += addedCount;
            this.stats.flap.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('flap平台收集完成', {
                platform: 'flap',
                fetched: tokens.length,
                added: addedCount,
                skipped: skippedCount,
                alreadyInPool: alreadyInPoolCount,
                ageRanges: ageRanges,
                maxAgeSeconds: this.collectorConfig.maxAgeSeconds,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('收集flap代币失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Collect new tokens from bankr platform (Base chain)
     */
    async collectBankrTokens() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集bankr新代币');

            // Fetch new tokens from AVE API
            const tag = 'bankr_in_new';
            const chain = 'base';
            const limit = this.collectorConfig.fetchLimit;
            const orderby = 'created_at';

            const tokens = await this.aveApi.getPlatformTokens(tag, chain, limit, orderby);

            this.stats.bankr.totalCollected += tokens.length;

            // Filter and add new tokens
            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            this.logger.debug(`获取到 ${tokens.length} 个bankr代币`);

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

            const ageRanges = {
                '0-30s': 0,
                '30-60s': 0,
                '1-2m': 0,
                '2-5m': 0,
                '5m+': 0
            };

            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;

                // 统计年龄分布
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

                if (this.collectedTokens.has(tokenKey)) {
                    continue;
                }

                const existingToken = this.tokenPool.getToken(token.token, token.chain);
                if (existingToken) {
                    alreadyInPoolCount++;
                }

                // 设置平台字段
                token.platform = 'bankr';

                // Bankr 平台暂无创建者地址检测
                token.creator_address = null;

                if (tokenAge < maxAgeMs) {
                    // 在添加到池之前解析 pairAddress（同步等待）
                    try {
                        const pairResult = await this.pairResolver.resolvePairAddress(token.token, 'bankr', 'base');
                        token.pairAddress = pairResult.pairAddress;
                        this.logger.debug('解析 bankr pair 地址成功', {
                            token: token.token,
                            pair_address: token.pairAddress
                        });
                    } catch (error) {
                        this.logger.warn('解析 bankr pair 地址失败，跳过此代币', {
                            token: token.token,
                            error: error.message
                        });
                        skippedCount++;
                        this.collectedTokens.add(tokenKey);
                        continue;
                    }

                    const added = this.tokenPool.addToken(token);
                    if (added) {
                        addedCount++;
                        this.collectedTokens.add(tokenKey);
                    }
                } else {
                    skippedCount++;
                }

                this.collectedTokens.add(tokenKey);
            }

            // 为 bankr 平台的代币添加 platform 字段
            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;
                if (this.collectedTokens.has(tokenKey)) {
                    const poolToken = this.tokenPool.getToken(token.token, token.chain);
                    if (poolToken && !poolToken.platform) {
                        poolToken.platform = 'bankr';
                        // pairAddress 已在添加到池之前设置
                    }
                }
            }

            this.stats.bankr.totalAdded += addedCount;
            this.stats.bankr.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('bankr平台收集完成', {
                platform: 'bankr',
                fetched: tokens.length,
                added: addedCount,
                skipped: skippedCount,
                alreadyInPool: alreadyInPoolCount,
                ageRanges: ageRanges,
                maxAgeSeconds: this.collectorConfig.maxAgeSeconds,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('收集bankr代币失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Collect new tokens from pumpfun platform (Solana chain)
     */
    async collectPumpfunTokens() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集pumpfun新代币');

            // Fetch new tokens from AVE API
            const tag = 'pump_in_new';
            const chain = 'solana';
            const limit = this.collectorConfig.fetchLimit;
            const orderby = 'created_at';

            const tokens = await this.aveApi.getPlatformTokens(tag, chain, limit, orderby);

            this.stats.pumpfun.totalCollected += tokens.length;

            // Filter and add new tokens
            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            this.logger.debug(`获取到 ${tokens.length} 个pumpfun代币`);

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

            const ageRanges = {
                '0-30s': 0,
                '30-60s': 0,
                '1-2m': 0,
                '2-5m': 0,
                '5m+': 0
            };

            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;

                // 统计年龄分布
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

                if (this.collectedTokens.has(tokenKey)) {
                    continue;
                }

                const existingToken = this.tokenPool.getToken(token.token, token.chain);
                if (existingToken) {
                    alreadyInPoolCount++;
                }

                // 设置平台字段
                token.platform = 'pumpfun';

                // Pumpfun 平台暂无创建者地址检测
                token.creator_address = null;

                if (tokenAge < maxAgeMs) {
                    // 在添加到池之前解析 pairAddress（同步等待）
                    try {
                        const pairResult = await this.pairResolver.resolvePairAddress(token.token, 'pumpfun', 'solana');
                        token.pairAddress = pairResult.pairAddress;
                        this.logger.debug('解析 pumpfun pair 地址成功', {
                            token: token.token,
                            pair_address: token.pairAddress
                        });
                    } catch (error) {
                        this.logger.warn('解析 pumpfun pair 地址失败，跳过此代币', {
                            token: token.token,
                            error: error.message
                        });
                        skippedCount++;
                        this.collectedTokens.add(tokenKey);
                        continue;
                    }

                    const added = this.tokenPool.addToken(token);
                    if (added) {
                        addedCount++;
                        this.collectedTokens.add(tokenKey);
                    }
                } else {
                    skippedCount++;
                }

                this.collectedTokens.add(tokenKey);
            }

            // 为 pumpfun 平台的代币添加 platform 字段
            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;
                if (this.collectedTokens.has(tokenKey)) {
                    const poolToken = this.tokenPool.getToken(token.token, token.chain);
                    if (poolToken && !poolToken.platform) {
                        poolToken.platform = 'pumpfun';
                        // pairAddress 已在添加到池之前设置
                    }
                }
            }

            this.stats.pumpfun.totalAdded += addedCount;
            this.stats.pumpfun.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('pumpfun平台收集完成', {
                platform: 'pumpfun',
                fetched: tokens.length,
                added: addedCount,
                skipped: skippedCount,
                alreadyInPool: alreadyInPoolCount,
                ageRanges: ageRanges,
                maxAgeSeconds: this.collectorConfig.maxAgeSeconds,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('收集pumpfun代币失败', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    /**
     * Collect new tokens from ETH chain via AVE API (tag=new, chain=eth)
     */
    async collectEthNewTokens() {
        try {
            const startTime = Date.now();
            this.logger.debug('开始收集ETH链新代币');

            // === 数据源 1: AVE API ===
            const ethFetchLimit = this.collectorConfig.ethFetchLimit || 300;
            const aveTokens = await this.aveApi.getChainNewTokens('eth', ethFetchLimit);
            this.logger.debug(`[AVE] 获取到 ${aveTokens.length} 个ETH新代币`);

            // === 数据源 2: GMGN Trending（按创建时间倒序） ===
            let gmgnTokens = [];
            if (this.gmgnMarketApi) {
                try {
                    const result = await this.gmgnMarketApi.getTrendingSwaps('eth', '1m', {
                        limit: 50,
                        order_by: 'creation_timestamp',
                        direction: 'desc'
                    });
                    const rankList = result?.data?.rank || [];
                    gmgnTokens = rankList.map(t => ({
                        token: t.address,
                        chain: 'eth',
                        name: t.name || '',
                        symbol: t.symbol || '',
                        current_price_usd: t.price || 0,
                        created_at: t.creation_timestamp,  // Unix秒
                        market_cap: t.market_cap || 0,
                        tvl: t.liquidity || 0,
                        tx_volume_u_24h: t.volume || 0,
                        platform: 'uniswap',
                        creator_address: null,
                        _source: 'gmgn'
                    }));
                    this.logger.debug(`[GMGN] 获取到 ${gmgnTokens.length} 个ETH热门代币`);
                } catch (gmgnError) {
                    this.logger.warn('GMGN ETH trending 获取失败，继续使用 AVE 数据', {
                        error: gmgnError.message
                    });
                }
            }

            // === 合并去重（按地址小写去重，AVE 优先） ===
            const seenAddresses = new Set(aveTokens.map(t => (t.token || '').toLowerCase()));
            const tokens = [...aveTokens];
            let gmgnAdded = 0;
            for (const t of gmgnTokens) {
                const addr = (t.token || '').toLowerCase();
                if (!seenAddresses.has(addr)) {
                    seenAddresses.add(addr);
                    tokens.push(t);
                    gmgnAdded++;
                }
            }

            this.stats.eth.totalCollected += tokens.length;

            const now = Date.now();
            const maxAgeMs = this.collectorConfig.maxAgeSeconds * 1000;

            this.logger.debug(`ETH代币合并完成`, {
                ave: aveTokens.length,
                gmgn: gmgnTokens.length,
                gmgnNew: gmgnAdded,
                total: tokens.length
            });

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

                // 解析 created_at（可能是时间戳秒数或 ISO 字符串）
                let createdAtMs;
                if (typeof token.created_at === 'number') {
                    createdAtMs = token.created_at * 1000;
                } else if (typeof token.created_at === 'string' && token.created_at) {
                    createdAtMs = new Date(token.created_at).getTime();
                } else {
                    createdAtMs = 0;
                }
                const tokenAge = now - createdAtMs;
                const tokenAgeSeconds = tokenAge / 1000;

                // 统计年龄分布
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

                // 检查代币是否已在池中
                const existingToken = this.tokenPool.getToken(token.token, token.chain);
                if (existingToken) {
                    alreadyInPoolCount++;
                }

                // 设置平台字段（AVE 返回的 token 缺少这些字段，GMGN 映射时已设置）
                if (!token.platform) token.platform = 'uniswap';
                if (token.creator_address === undefined) token.creator_address = null;

                // Only add tokens younger than maxAgeSeconds
                if (tokenAge < maxAgeMs) {
                    // 在添加到池之前解析 pairAddress
                    try {
                        const pairResult = await this.pairResolver.resolvePairAddress(token.token, 'uniswap', 'ethereum');
                        token.pairAddress = pairResult.pairAddress;
                        this.logger.debug('解析 ETH pair 地址成功', {
                            token: token.token,
                            symbol: token.symbol,
                            pair_address: token.pairAddress
                        });
                    } catch (error) {
                        this.logger.warn('解析 ETH pair 地址失败，跳过此代币', {
                            token: token.token,
                            symbol: token.symbol,
                            error: error.message
                        });
                        skippedCount++;
                        this.collectedTokens.add(tokenKey);
                        continue;
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

            // 为 ETH 平台的代币设置 platform 字段
            for (const token of tokens) {
                const tokenKey = `${token.token}-${token.chain}`;
                if (this.collectedTokens.has(tokenKey)) {
                    const poolToken = this.tokenPool.getToken(token.token, token.chain);
                    if (poolToken && !poolToken.platform) {
                        poolToken.platform = 'uniswap';
                    }
                }
            }

            this.stats.eth.totalAdded += addedCount;
            this.stats.eth.totalSkipped += skippedCount;

            const duration = Date.now() - startTime;
            this.logger.debug('ETH链代币收集完成', {
                platform: 'uniswap',
                fetched: tokens.length,
                aveCount: aveTokens.length,
                gmgnNew: gmgnAdded,
                added: addedCount,
                skipped: skippedCount,
                alreadyInPool: alreadyInPoolCount,
                ageRanges: ageRanges,
                maxAgeSeconds: this.collectorConfig.maxAgeSeconds,
                duration: `${duration}ms`
            });

        } catch (error) {
            this.logger.error('收集ETH链代币失败', {
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
            fourmeme: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            flap: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            bankr: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            pumpfun: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            eth: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0
            },
            lastCollectionTime: null
        };
    }
}

module.exports = PlatformCollector;
