/**
 * PumpFun WebSocket Token Collector (Helius Enhanced)
 *
 * 通过 Helius transactionSubscribe 实时监控 PumpFun 新代币创建
 * 检测速度：~0.5-1 秒（vs AVE API 轮询的 ~18-19 秒）
 *
 * 优势：
 * - 服务端过滤：accountInclude 只接收 PumpFun 相关交易，无需客户端过滤全部日志
 * - 完整交易数据：一次消息包含所有 accountKeys、logs、meta，无需额外 RPC 调用
 * - jsonParsed 编码：account keys 直接以字符串形式提供
 * - 无需 @solana/web3.js Connection：彻底避免双 WS 连接冲突
 *
 * 工作流程：
 * 1. 使用 Helius transactionSubscribe 订阅 PumpFun 程序交易
 * 2. 过滤包含 "InitializeMint2" 的日志（新代币创建标志）
 * 3. 从交易 accountKeys 直接提取 mint 地址和创建者钱包
 * 4. 立即以最小数据加入 TokenPool
 * 5. 异步从 AVE API 补全完整数据（价格、市值、pairAddress 等）
 */

const WebSocket = require('ws');
const { AveTokenAPI } = require('../core/ave-api/token-api');
const { PlatformPairResolver } = require('../core/PlatformPairResolver');
const { BlockchainConfig } = require('../utils/BlockchainConfig');

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

class PumpFunWsCollector {
    constructor(config, logger, tokenPool) {
        this.config = (config.pumpfunCollectors?.ws) || (config.pumpfunWs) || {};
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.enabled = this.config.enabled === true;

        // Helius API Key
        this.heliusApiKey = this._getHeliusApiKey();

        // WebSocket 连接
        this._ws = null;
        this.subId = null;

        // AVE API（用于补全数据）
        this.aveApi = new AveTokenAPI(
            config.ave?.apiUrl || 'https://prod.ave-api.com',
            config.ave?.timeout || 30000,
            process.env.AVE_API_KEY
        );

        // Pair 地址解析器
        this.pairResolver = new PlatformPairResolver(logger);

        // 补全队列：mintAddress -> { retryCount, addedAt }
        this.pendingEnrichment = new Map();
        this.enrichmentIntervalId = null;

        // 心跳
        this.heartbeatIntervalId = null;
        this.pingIntervalId = null;

        // 重连
        this.reconnectDelay = this.config.reconnectBaseDelay || 2000;
        this.maxReconnectDelay = this.config.reconnectMaxDelay || 60000;
        this.reconnectTimer = null;

        // 统计
        this.stats = {
            detected: 0,
            enriched: 0,
            enrichmentFailed: 0,
            duplicate: 0,
            parseFailed: 0,
            reconnects: 0,
            txReceived: 0,
            createDetected: 0,
            lastDetectedAt: null,
            lastEnrichedAt: null,
            startTime: null
        };
    }

    /**
     * 获取 Helius API Key
     * 优先使用 HELIUS_API_KEY 环境变量
     * 否则从 RPC URL 中提取
     */
    _getHeliusApiKey() {
        if (process.env.HELIUS_API_KEY) {
            return process.env.HELIUS_API_KEY;
        }
        const rpcUrl = process.env.SOLANA_RPC_ENDPOINT ||
            BlockchainConfig.CHAIN_CONFIGS.solana.network.rpcUrl;
        const match = rpcUrl.match(/api-key=([a-f0-9-]+)/i);
        if (match) {
            return match[1];
        }
        this.logger.warn('[PumpFunWsCollector] 无法获取 Helius API Key，请设置 HELIUS_API_KEY 或使用 Helius RPC URL');
        return null;
    }

    /**
     * 构建 Helius WebSocket URL
     */
    _buildWsUrl() {
        if (!this.heliusApiKey) {
            throw new Error('Helius API Key 不可用');
        }
        return `wss://mainnet.helius-rpc.com?api-key=${this.heliusApiKey}`;
    }

    /**
     * 启动 WS 收集器
     */
    start() {
        if (!this.enabled) {
            this.logger.info('[PumpFunWsCollector] 已禁用，跳过启动');
            return;
        }

        if (!this.heliusApiKey) {
            this.logger.error('[PumpFunWsCollector] Helius API Key 不可用，无法启动');
            this.enabled = false;
            return;
        }

        this.stats.startTime = Date.now();
        this._subscribe();
        this._startEnrichmentWorker();
        this._startHeartbeat();

        this.logger.info('[PumpFunWsCollector] 已启动，通过 Helius transactionSubscribe 监控 PumpFun 新代币');
    }

    /**
     * 停止 WS 收集器
     */
    stop() {
        if (this._ws) {
            // 发送取消订阅
            if (this.subId !== null) {
                try {
                    this._ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: 2,
                        method: 'transactionUnsubscribe',
                        params: [this.subId]
                    }));
                } catch (_) {}
            }
            this._ws.removeAllListeners();
            this._ws.close();
            this._ws = null;
        }

        if (this.enrichmentIntervalId) {
            clearInterval(this.enrichmentIntervalId);
            this.enrichmentIntervalId = null;
        }

        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }

        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.logger.info('[PumpFunWsCollector] 已停止', this.stats);
    }

    /**
     * 使用 Helius transactionSubscribe 订阅 PumpFun 交易
     * - accountInclude: 服务端过滤，只接收包含 PumpFun 程序的交易
     * - jsonParsed: account keys 直接以字符串形式提供
     * - failed: false: 排除失败交易
     */
    _subscribe() {
        const wsUrl = this._buildWsUrl();
        const programId = this.config.programId || PUMP_FUN_PROGRAM;

        this.logger.info('[PumpFunWsCollector] 连接 Helius WebSocket', { wsUrl: wsUrl.replace(/api-key=.+/, 'api-key=***') });

        this._ws = new WebSocket(wsUrl);

        this._ws.on('open', () => {
            this.logger.info('[PumpFunWsCollector] WebSocket 已连接');

            // 发送 Helius transactionSubscribe 请求
            this._ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'transactionSubscribe',
                params: [
                    {
                        failed: false,
                        accountInclude: [programId]
                    },
                    {
                        commitment: this.config.commitment || 'confirmed',
                        encoding: 'jsonParsed',
                        transactionDetails: 'full',
                        maxSupportedTransactionVersion: 0
                    }
                ]
            }));

            // 定期 ping 保持连接
            this.pingIntervalId = setInterval(() => {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    this._ws.ping();
                }
            }, 10000);
        });

        this._ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());

            // 订阅确认
            if (msg.id === 1 && msg.result !== undefined) {
                this.subId = msg.result;
                this.logger.info('[PumpFunWsCollector] transactionSubscribe 订阅成功', { subId: this.subId });
                return;
            }

            // 交易通知
            if (msg.method === 'transactionNotification' && msg.params?.result) {
                this._handleTransaction(msg.params.result);
            }
        });

        this._ws.on('error', (error) => {
            this.logger.error('[PumpFunWsCollector] WebSocket 错误', { error: error.message });
        });

        this._ws.on('close', (code, reason) => {
            this.logger.warn('[PumpFunWsCollector] WebSocket 关闭', { code, reason: reason?.toString() });
            this._scheduleReconnect();
        });
    }

    /**
     * 处理接收到的交易通知
     * 从 Helius transactionSubscribe 返回的 jsonParsed 数据中提取代币信息
     */
    _handleTransaction(result) {
        this.stats.txReceived++;

        try {
            const meta = result.transaction?.meta;
            const txMessage = result.transaction?.transaction?.message;

            if (!meta || !txMessage) {
                this.stats.parseFailed++;
                return;
            }

            const logs = meta.logMessages || [];

            // 检测 PumpFun 新代币创建：只匹配 CreateV2（PumpFun 特有指令）
            // 不使用 InitializeMint2 / Create，它们不是 PumpFun 特有的，
            // 会导致误判非 pump 代币（如一笔交易同时涉及 PumpFun 买/卖和另一个代币创建）
            const isPumpCreate = logs.some(log =>
                log.includes('Instruction: CreateV2')
            );

            if (!isPumpCreate) return;

            this.stats.createDetected++;

            // jsonParsed 格式下 accountKeys 直接包含 pubkey 字符串
            const accountKeys = txMessage.accountKeys || [];
            const keys = accountKeys.map(k => {
                if (typeof k === 'string') return k;
                return k.pubkey || k.toString();
            });

            if (keys.length < 2) {
                this.stats.parseFailed++;
                return;
            }

            const signature = result.signature;
            const devWallet = keys[0];
            const mintAddress = keys[1];

            if (!mintAddress || !devWallet) {
                this.stats.parseFailed++;
                return;
            }

            // 二次验证：PumpFun 代币地址以 "pump" 结尾
            if (!mintAddress.endsWith('pump')) {
                this.stats.filteredNonPump = (this.stats.filteredNonPump || 0) + 1;
                return;
            }

            this._handleNewToken(signature, mintAddress, devWallet);

        } catch (error) {
            this.logger.error('[PumpFunWsCollector] 解析交易失败', { error: error.message });
            this.stats.parseFailed++;
        }
    }

    /**
     * 处理检测到的新代币
     * 所有数据已从 WebSocket 消息中获取，无需额外 RPC 调用
     */
    _handleNewToken(signature, mintAddress, devWallet) {
        // 去重检查
        const existingToken = this.tokenPool.getToken(mintAddress, 'solana');
        if (existingToken) {
            this.stats.duplicate++;
            return;
        }

        const now = Date.now();
        this.stats.detected++;
        this.stats.lastDetectedAt = now;

        // 创建最小 token 对象并加入池
        const minimalToken = {
            token: mintAddress,
            chain: 'solana',
            platform: 'pumpfun',
            name: '',
            symbol: '',
            created_at: Math.floor(now / 1000),
            current_price_usd: null,
            creator_address: devWallet
        };

        const added = this.tokenPool.addToken(minimalToken);
        if (added) {
            this.logger.info('[PumpFunWsCollector] 新代币入池', {
                mint: mintAddress,
                dev: devWallet,
                signature: signature?.slice(0, 20) + '...',
                poolSize: this.tokenPool.getStats().total
            });

            // 加入补全队列
            this.pendingEnrichment.set(mintAddress, {
                retryCount: 0,
                addedAt: now,
                devWallet,
                signature
            });
        } else {
            this.stats.duplicate++;
        }
    }

    /**
     * 启动补全工作线程
     */
    _startEnrichmentWorker() {
        const interval = this.config.enrichmentInterval || 3000;
        this.enrichmentIntervalId = setInterval(() => {
            this._processEnrichmentQueue();
        }, interval);
    }

    /**
     * 处理补全队列
     */
    async _processEnrichmentQueue() {
        if (this.pendingEnrichment.size === 0) return;

        const maxRetries = this.config.enrichmentMaxRetries || 3;
        const maxAge = this.config.enrichmentMaxAge || 60000;
        const now = Date.now();
        const toProcess = [];

        for (const [mintAddress, state] of this.pendingEnrichment.entries()) {
            // 超龄清理
            if (now - state.addedAt > maxAge) {
                this.pendingEnrichment.delete(mintAddress);
                continue;
            }
            // 超过重试次数
            if (state.retryCount >= maxRetries) {
                this.pendingEnrichment.delete(mintAddress);
                this.stats.enrichmentFailed++;
                continue;
            }
            toProcess.push([mintAddress, state]);
        }

        // 串行处理，避免 AVE API 限流
        for (const [mintAddress, state] of toProcess) {
            try {
                await this._enrichToken(mintAddress, state);
            } catch (_) {
                // _enrichToken 内部已处理
            }
        }
    }

    /**
     * 补全单个代币数据
     */
    async _enrichToken(mintAddress, state) {
        const tokenId = `${mintAddress}-solana`;
        state.retryCount++;

        try {
            // 1. 从 AVE API 获取 token detail
            const detail = await this.aveApi.getTokenDetail(tokenId);
            const tokenData = detail.token || {};

            // 2. 解析 pairAddress
            let pairAddress = null;
            try {
                const pairResult = await this.pairResolver.resolvePairAddress(mintAddress, 'pumpfun', 'solana');
                pairAddress = pairResult.pairAddress;
            } catch (_) {
                // pair 解析可能失败，新代币还没建池
            }

            // 3. 构建补全数据
            const enrichedData = {
                ...tokenData,
                pairAddress,
                creator_address: state.devWallet || tokenData.creator_address
            };

            // 4. 更新池中 token
            const enriched = this.tokenPool.enrichToken(mintAddress, 'solana', enrichedData);

            if (enriched) {
                this.pendingEnrichment.delete(mintAddress);
                this.stats.enriched++;
                this.stats.lastEnrichedAt = Date.now();

                const token = this.tokenPool.getToken(mintAddress, 'solana');
                this.logger.info('[PumpFunWsCollector] 代币数据补全成功', {
                    mint: mintAddress,
                    symbol: token?.symbol || '',
                    pairAddress: pairAddress || 'N/A',
                    price: token?.currentPrice || 'N/A'
                });
            }

        } catch (error) {
            this.logger.debug('[PumpFunWsCollector] 补全失败，等待重试', {
                mint: mintAddress,
                retry: state.retryCount,
                error: error.message
            });
        }
    }

    /**
     * 启动心跳检测
     * 使用 WS ping/pong 检测连接存活
     */
    _startHeartbeat() {
        this.heartbeatIntervalId = setInterval(() => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this.logger.warn('[PumpFunWsCollector] WebSocket 未连接，触发重连');
                this._scheduleReconnect();
                return;
            }
            // 连接正常，重置重连延迟
            this.reconnectDelay = this.config.reconnectBaseDelay || 2000;
        }, 30000);
    }

    /**
     * 安排重连
     */
    _scheduleReconnect() {
        if (this.reconnectTimer) return; // 已在重连中

        this.stats.reconnects++;

        // 清理旧 WebSocket
        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.close();
            this._ws = null;
        }

        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }

        this.subId = null;

        this.logger.info('[PumpFunWsCollector] 计划重连', {
            delay: `${this.reconnectDelay}ms`,
            attempt: this.stats.reconnects
        });

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._subscribe();
        }, this.reconnectDelay);

        // 指数退避
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            enabled: this.enabled,
            ...this.stats,
            pendingEnrichment: this.pendingEnrichment.size,
            connected: this._ws?.readyState === WebSocket.OPEN,
            uptimeSeconds: this.stats.startTime
                ? Math.floor((Date.now() - this.stats.startTime) / 1000)
                : 0
        };
    }
}

module.exports = PumpFunWsCollector;
