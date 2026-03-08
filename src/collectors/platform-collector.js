/**
 * Platform Token Collector
 *
 * Collects new tokens from four.meme and flap platforms every 10 seconds
 */

const { AveTokenAPI } = require('../core/ave-api');
const { FourMemeTokenAPI } = require('../core/fourmeme-api');
const { WalletDataService } = require('../web/services/WalletDataService');
const { TokenHolderService } = require('../trading-engine/holders/TokenHolderService');
const { PlatformPairResolver } = require('../core/PlatformPairResolver');
const { dbManager } = require('../services/dbManager');

class PlatformCollector {
    constructor(config, logger, tokenPool, experimentId = null) {
        this.config = config;
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.experimentId = experimentId;  // 保存实验ID
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

        // Initialize WalletService for dev wallet filtering
        this.walletService = new WalletDataService();

        // Initialize TokenHolderService for holder blacklist filtering
        const supabase = dbManager.getClient();
        this.tokenHolderService = new TokenHolderService(supabase, this.logger);

        // Initialize PlatformPairResolver for resolving pair addresses
        this.pairResolver = new PlatformPairResolver(this.logger);

        // Track collected tokens to avoid duplicates
        this.collectedTokens = new Set();

        // Dev wallet cache (refresh every minute)
        this.devWallets = [];
        this.lastDevWalletRefresh = 0;

        // Statistics (按平台分别统计)
        this.stats = {
            fourmeme: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            flap: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            bankr: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            pumpfun: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
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
     */
    async collect() {
        try {
            const startTime = Date.now();

            // 顺序调用：先收集 fourmeme
            await this.collectFourmemeTokens();

            // === Flap平台暂时关闭 ===
            if (this.collectorConfig.enableFlap !== false) {
                await this.collectFlapTokens();
            } else {
                this.logger.info('Flap平台数据采集已通过配置关闭 (config.collector.enableFlap = false)');
            }
            // === Flap平台关闭结束 ===

            // 收集 bankr 平台 (Base 链)
            if (this.collectorConfig.enableBankr !== false) {
                await this.collectBankrTokens();
            } else {
                this.logger.info('Bankr平台数据采集已通过配置关闭 (config.collector.enableBankr = false)');
            }

            // 收集 pumpfun 平台 (Solana 链)
            if (this.collectorConfig.enablePumpfun !== false) {
                await this.collectPumpfunTokens();
            } else {
                this.logger.info('Pumpfun平台数据采集已通过配置关闭 (config.collector.enablePumpfun = false)');
            }

            this.stats.lastCollectionTime = new Date().toISOString();

            const duration = Date.now() - startTime;
            this.logger.debug('多平台收集完成', {
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

                    // === Dev 钱包检测模块 ===
                    let isDevCreator = false;
                    if (token.creator_address) {
                        console.log(`[Dev钱包检测] 检查代币 ${token.symbol} (${token.token}) 创建者: ${token.creator_address}`);
                        isDevCreator = await this.isDevWallet(token.creator_address);
                        console.log(`[Dev钱包检测] ${token.symbol} - ${isDevCreator ? '❌ 是Dev钱包' : '✅ 通过'}`);
                        this.logger.info('[Dev钱包检测] 检查完成', {
                            token: token.token,
                            symbol: token.symbol,
                            creator_address: token.creator_address,
                            is_dev_wallet: isDevCreator
                        });
                    } else {
                        console.log(`[Dev钱包检测] ⚠️ ${token.symbol} 无创建者地址，跳过检查`);
                        this.logger.warn('[Dev钱包检测] 代币没有 creator_address', {
                            token: token.token,
                            symbol: token.symbol
                        });
                    }

                    if (isDevCreator) {
                        token.status = 'negative_dev';
                        this.stats.fourmeme.totalDevFiltered++;
                        console.log(`[Dev钱包检测] 🚫 ${token.symbol} 创建者为Dev钱包，已拒绝`);
                        this.logger.info('[Dev钱包检测] 拒绝Dev钱包创建的代币', {
                            token: token.token,
                            symbol: token.symbol,
                            creator: token.creator_address,
                            status: 'negative_dev'
                        });
                    }

                    // Dev钱包跳过添加
                    if (isDevCreator) {
                        skippedCount++;
                    } else {
                        const added = this.tokenPool.addToken(token);
                        if (added) {
                            addedCount++;
                            this.collectedTokens.add(tokenKey);
                        }
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
                    // === Dev 钱包检测模块 ===
                    // Flap 平台无创建者地址，跳过 Dev 钱包检测
                    const isDevCreator = false;
                    console.log(`[Flap平台] ${token.symbol} 无创建者地址，跳过Dev钱包检测`);

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
                    // Bankr 平台暂无 Dev 钱包检测
                    const isDevCreator = false;

                    if (!isDevCreator) {
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
                    // Pumpfun 平台暂无 Dev 钱包检测
                    const isDevCreator = false;

                    if (!isDevCreator) {
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
            fourmeme: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            flap: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            bankr: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            pumpfun: {
                totalCollected: 0,
                totalAdded: 0,
                totalSkipped: 0,
                totalDevFiltered: 0
            },
            lastCollectionTime: null
        };
    }
}

module.exports = PlatformCollector;
