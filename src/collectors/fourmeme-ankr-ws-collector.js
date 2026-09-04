/**
 * FourMeme ankr WSS Collector
 *
 * 通过 ankr Advanced API WSS（标准 eth_subscribe）实时监控 four.meme BSC 内盘事件。
 * 订阅 TokenManager2 合约的全部 logs（发现 + 价格 + 毕业）+ newHeads（块时间回填）。
 *
 * 功能：
 * 1. TokenCreate  → 新代币发现：TokenPool.addToken(data_source='wss') + 回调 onTokenCreate（引擎负责落库 experiment_tokens）
 * 2. TokenPurchase/TokenSale → tick：事件 price 字段直接是成交价（BNB wei）
 *    → tick 缓冲批量落库 wss_price_ticks + TokenPool.updatePrice + FactorAggregator.processTick
 * 3. LiquidityAdded → 毕业：回调 onGraduation
 *
 * 事件口径（Phase 0 实测验证，docs/fourmeme-events.md）：
 * - 全部事件无 indexed 参数（topics 只有 topic0），业务参数全在 data
 * - TokenCreate(creator, token, requestId, name, symbol, totalSupply, launchTime, launchFee)
 *   launchTime/launchFee 实测恒 0 —— 代币年龄用事件块时间
 * - TokenPurchase/TokenSale(token, account, price, amount, cost, fee, offers, funds)
 *   price 为每 token 的 BNB 价（18 decimals wei）；fee = cost 的 1%
 *
 * 模式参考 pumpfun-wss-trader 的 pumpfun-ws-collector（去重/重连/毒 tick 二分/批量缓冲）。
 */

const WebSocket = require('ws');
const { ethers } = require('ethers');

// ── 事件签名（Phase 0 验证，全 data 无 indexed）──
const EVENT_SIGS = {
    TokenCreate: 'TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)',
    TokenPurchase: 'TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)',
    TokenSale: 'TokenSale(address,address,uint256,uint256,uint256,uint256,uint256,uint256)',
    LiquidityAdded: 'LiquidityAdded(address,uint256,address,uint256)',
    TradeStop: 'TradeStop(address)',
};

// topic0 → 事件名（模块加载时本地 keccak 计算，与 Phase 0 实测值一致）
const TOPIC0_MAP = new Map();
for (const [name, sig] of Object.entries(EVENT_SIGS)) {
    TOPIC0_MAP.set(ethers.id(sig), name);
}

const TRADE_DATA_TYPES = ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'];
const CREATE_DATA_TYPES = ['address', 'address', 'uint256', 'string', 'string', 'uint256', 'uint256', 'uint256'];
const LIQ_ADDED_DATA_TYPES = ['address', 'uint256', 'address', 'uint256'];
const TRADE_STOP_DATA_TYPES = ['address'];

// BSC PancakeSwap V2 Router（BNB/USD 换算：WBNB→USDT getAmountsOut）
const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB_BSC = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'; // BSC 上 18 decimals
const ROUTER_ABI = ['function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'];

// logs 事件可能先于对应 newHeads 到达：未知块时间的 log 进 pending 队列，
// 由后续 head 回填；超过 15s 仍无 head 的走 RPC eth_getBlockByNumber 兜底
const PENDING_LOG_MAX_WAIT_MS = 15000;
const BLOCK_TIME_CACHE_SIZE = 600; // BSC ~0.75s/块 → 覆盖 ~7.5 分钟

function lowerAddr(a) {
    return (a || '').toLowerCase();
}

class FourMemeAnkrWsCollector {
    /**
     * @param {Object} config - 全局配置（读取 config.fourmemeWs 段）
     * @param {Object} logger - 引擎 logger（info/warn/error/debug）
     * @param {Object} tokenPool - TokenPool 实例
     * @param {Object|null} factorAggregator - FourMemeFactorAggregator 实例
     * @param {Object} callbacks - { onTokenCreate(info), onTick(tick), onGraduation(info) } 均可选
     */
    constructor(config, logger, tokenPool, factorAggregator = null, callbacks = {}) {
        this.config = config.fourmemeWs || {};
        this.logger = logger;
        this.tokenPool = tokenPool;
        this._factorAggregator = factorAggregator;
        this._callbacks = callbacks || {};

        const contracts = this.config.contracts || {};
        this._tokenManagerV2 = lowerAddr(contracts.tokenManagerV2);
        this._tokenManagerV1 = lowerAddr(contracts.tokenManagerV1);
        this._subscribeV1 = this.config.subscribeV1 === true;

        // WSS 端点：env 优先
        this._wsUrl = this.config.endpointFrom === 'env'
            ? (process.env.ANKR_WS_URL || (process.env.ANKR_API_KEY ? `wss://rpc.ankr.com/bsc/ws/${process.env.ANKR_API_KEY}` : null))
            : this.config.endpoint || null;

        this._pingIntervalMs = this.config.pingIntervalMs || 10000;
        this._reconnectMinDelay = this.config.reconnect?.minDelayMs || 2000;
        this._reconnectMaxDelay = this.config.reconnect?.maxDelayMs || 60000;
        this._tickBufferCfg = this.config.tickBuffer || {};
        this._tickFlushIntervalMs = this._tickBufferCfg.flushIntervalMs || 2000;
        this._tickFlushThreshold = this._tickBufferCfg.flushThreshold || 100;
        this._tickBatchSize = this._tickBufferCfg.batchSize || 500;
        this._bnbUsdRefreshMs = this.config.bnbUsd?.refreshMs || 60000;

        // 小额 tick 过滤：低于阈值的交易仍落表但不参与因子计算（尘价污染防护）
        this._minTickBnb = this.config.minTickBnb ?? 0.001;

        this._ws = null;
        this._logSubId = null;
        this._headSubId = null;
        this._rpcId = 100; // eth_getBlockByNumber 等请求 id；订阅请求用 1/2
        this._blockTimeRequests = new Map(); // rpcId → blockNumber

        this._reconnectDelay = this._reconnectMinDelay;
        this._reconnectTimer = null;
        this._pingTimer = null;
        this._heartbeatTimer = null;

        // 块时间缓存：blockNumber → 秒级时间戳
        this._blockTimes = new Map();
        // 未知块时间的待处理 log
        this._pendingLogs = [];

        // 去重：(txHash, logIndex) —— 同 tx 可有多条同类型事件（聚合交易）
        this._processedTickKeys = new Set();

        this._tickBuffer = [];
        this._tickFlushTimer = null;
        this._flushInProgress = false;
        this._supabase = null;

        this._bnbUsd = 0;
        this._bnbUsdTimer = null;
        this._routerContract = null;

        this._experimentId = null;

        this.stats = {
            startTime: null,
            lastMessageAt: null,
            headsReceived: 0,
            logsReceived: 0,
            createDecoded: 0,
            purchaseDecoded: 0,
            saleDecoded: 0,
            liquidityAdded: 0,
            tradeStop: 0,
            unknownEvents: 0,
            decodeFailed: 0,
            duplicateTicks: 0,
            tokensAddedToPool: 0,
            poolUpdates: 0,
            pendingLogsResolved: 0,
            pendingLogsFallbackRpc: 0,
            ticksBuffered: 0,
            ticksWritten: 0,
            ticksFlushFailed: 0,
            bnbUsdUpdates: 0,
            reconnects: 0,
        };
    }

    setExperimentId(experimentId) {
        this._experimentId = experimentId;
    }

    getLastMessageAt() {
        return this.stats.lastMessageAt;
    }

    getBnbUsd() {
        return this._bnbUsd;
    }

    // ═══════════════ 生命周期 ═══════════════

    start() {
        if (!this._wsUrl) {
            throw new Error('[FourMemeAnkrWsCollector] 缺少 ankr WSS 端点（config/.env ANKR_WS_URL 或 ANKR_API_KEY）');
        }
        this.stats.startTime = Date.now();
        this._connect();

        this._tickFlushTimer = setInterval(() => {
            this._flushTickBuffer();
        }, this._tickFlushIntervalMs);

        this._fetchBnbUsd();
        this._bnbUsdTimer = setInterval(() => this._fetchBnbUsd(), this._bnbUsdRefreshMs);

        this._startHeartbeat();
        this.logger.info('', 'FourMemeAnkrWsCollector', `已启动：TokenManager2=${this._tokenManagerV2} 订阅V1=${this._subscribeV1}`);
    }

    async stop() {
        if (this._ws) {
            this._ws.removeAllListeners();
            // CONNECTING 态 close() 会 emit 'error'（监听器已摘 → 未捕获崩进程），改 terminate
            if (this._ws.readyState === WebSocket.CONNECTING) {
                this._ws.terminate();
            } else {
                this._ws.close();
            }
            this._ws = null;
        }
        for (const t of [this._pingTimer, this._heartbeatTimer, this._tickFlushTimer, this._bnbUsdTimer, this._reconnectTimer]) {
            if (t) { clearInterval(t); clearTimeout(t); }
        }
        this._pingTimer = this._heartbeatTimer = this._tickFlushTimer = this._bnbUsdTimer = this._reconnectTimer = null;

        await this._flushTickBuffer(); // 关闭前把缓冲写完
        this.logger.info('', 'FourMemeAnkrWsCollector', '已停止', this.stats);
    }

    // ═══════════════ WSS 连接与订阅 ═══════════════

    _connect() {
        this.logger.info('', 'FourMemeAnkrWsCollector',
            `连接 ankr WSS: ${this._wsUrl.replace(/\/ws\/[^/?]+/, '/ws/***')}`);

        this._ws = new WebSocket(this._wsUrl);

        this._ws.on('open', () => {
            this.logger.info('', 'FourMemeAnkrWsCollector', 'WSS 已连接，发送订阅请求');
            this._send({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] });

            const logAddresses = this._subscribeV1 && this._tokenManagerV1
                ? [this._tokenManagerV2, this._tokenManagerV1]
                : [this._tokenManagerV2];
            this._send({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', { address: logAddresses }] });

            this._pingTimer = setInterval(() => {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    this._ws.ping();
                }
            }, this._pingIntervalMs);
        });

        this._ws.on('message', (data) => {
            try {
                this._onMessage(data);
            } catch (err) {
                this.stats.decodeFailed++;
                this.logger.error('', 'FourMemeAnkrWsCollector', `消息处理异常: ${err.message}`);
            }
        });

        this._ws.on('error', (err) => {
            this.logger.error('', 'FourMemeAnkrWsCollector', `WSS 错误: ${err.message}`);
        });

        this._ws.on('close', (code, reason) => {
            this.logger.warn('', 'FourMemeAnkrWsCollector', `WSS 关闭: ${code} ${reason?.toString() || ''}`);
            this._scheduleReconnect();
        });
    }

    _send(payload) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(payload));
        }
    }

    _onMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            this.stats.decodeFailed++;
            return;
        }
        this.stats.lastMessageAt = Date.now();

        // 订阅确认帧
        if (msg.id !== undefined && msg.result !== undefined && typeof msg.result === 'string') {
            if (msg.id === 1) this._headSubId = msg.result;
            if (msg.id === 2) this._logSubId = msg.result;
            if (msg.id === 1 || msg.id === 2) {
                this.logger.info('', 'FourMemeAnkrWsCollector', `订阅确认 id=${msg.id} subId=${msg.result}`);
            }
            return;
        }

        // RPC 响应（eth_getBlockByNumber 兜底）
        if (msg.id !== undefined && msg.id >= 100) {
            this._onBlockTimeResponse(msg);
            return;
        }

        if (msg.method === 'eth_subscription' && msg.params) {
            if (msg.params.subscription === this._headSubId) {
                this._handleHead(msg.params.result);
            } else if (msg.params.subscription === this._logSubId) {
                this._handleLog(msg.params.result);
            }
            return;
        }

        if (msg.error) {
            this.logger.warn('', 'FourMemeAnkrWsCollector', `RPC 错误帧: ${JSON.stringify(msg.error).slice(0, 200)}`);
        }
    }

    // ═══════════════ newHeads：块时间缓存 + pending log 回填 ═══════════════

    _handleHead(head) {
        this.stats.headsReceived++;
        const blockNumber = parseInt(head.number, 16);
        const ts = parseInt(head.timestamp, 16);
        if (Number.isNaN(blockNumber) || Number.isNaN(ts)) return;

        this._blockTimes.set(blockNumber, ts);
        if (this._blockTimes.size > BLOCK_TIME_CACHE_SIZE) {
            const keys = [...this._blockTimes.keys()].sort((a, b) => a - b);
            for (const k of keys.slice(0, keys.length - BLOCK_TIME_CACHE_SIZE)) {
                this._blockTimes.delete(k);
            }
        }

        // 回填 pending logs
        if (this._pendingLogs.length > 0) {
            const remain = [];
            for (const item of this._pendingLogs) {
                if (this._blockTimes.has(item.blockNumber)) {
                    this.stats.pendingLogsResolved++;
                    this._processLog(item.logEntry, this._blockTimes.get(item.blockNumber));
                } else {
                    remain.push(item);
                }
            }
            this._pendingLogs = remain;
            this._maybeFallbackPendingBlocks();
        }
    }

    /** pending 超时的 log 用 RPC eth_getBlockByNumber 主动查块时间 */
    _maybeFallbackPendingBlocks() {
        const now = Date.now();
        for (const item of this._pendingLogs) {
            if (now - item.receivedAt < PENDING_LOG_MAX_WAIT_MS) continue;
            if (item.rpcRequested) continue;
            item.rpcRequested = true;
            this.stats.pendingLogsFallbackRpc++;
            const rpcId = this._rpcId++;
            this._blockTimeRequests.set(rpcId, item.blockNumber);
            this._send({
                jsonrpc: '2.0', id: rpcId, method: 'eth_getBlockByNumber',
                params: [`0x${item.blockNumber.toString(16)}`, false],
            });
        }
    }

    _onBlockTimeResponse(msg) {
        const blockNumber = this._blockTimeRequests.get(msg.id);
        this._blockTimeRequests.delete(msg.id);
        if (blockNumber === undefined) return;
        const ts = msg.result?.timestamp ? parseInt(msg.result.timestamp, 16) : NaN;
        if (Number.isNaN(ts)) return;

        this._blockTimes.set(blockNumber, ts);
        const remain = [];
        for (const item of this._pendingLogs) {
            if (this._blockTimes.has(item.blockNumber)) {
                this.stats.pendingLogsResolved++;
                this._processLog(item.logEntry, this._blockTimes.get(item.blockNumber));
            } else {
                remain.push(item);
            }
        }
        this._pendingLogs = remain;
    }

    // ═══════════════ logs：事件解码与分发 ═══════════════

    _handleLog(logEntry) {
        this.stats.logsReceived++;
        const topic0 = (logEntry.topics && logEntry.topics[0]) || null;
        const eventName = topic0 ? TOPIC0_MAP.get(topic0) : null;
        if (!eventName) {
            this.stats.unknownEvents++;
            return; // 未知伴随事件（Phase 0 已确认存在，安全忽略并计数）
        }

        const blockNumber = logEntry.blockNumber != null ? parseInt(logEntry.blockNumber, 16) : null;
        if (blockNumber == null) {
            this.stats.decodeFailed++;
            return;
        }

        const blockTimeSec = this._blockTimes.get(blockNumber);
        if (blockTimeSec === undefined) {
            // 块时间未知：进 pending 队列等 head 回填
            this._pendingLogs.push({ logEntry, blockNumber, receivedAt: Date.now() });
            if (this._pendingLogs.length > 2000) {
                this._pendingLogs.splice(0, this._pendingLogs.length - 2000);
            }
            this._maybeFallbackPendingBlocks();
            return;
        }
        this._processLog(logEntry, blockTimeSec);
    }

    _processLog(logEntry, blockTimeSec) {
        const eventName = TOPIC0_MAP.get(logEntry.topics[0]);
        if (!eventName) return;
        const data = logEntry.data || '0x';
        const blockNumber = parseInt(logEntry.blockNumber, 16);
        const blockTimeMs = blockTimeSec * 1000;

        try {
            if (eventName === 'TokenCreate') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(CREATE_DATA_TYPES, data);
                this.stats.createDecoded++;
                this._handleTokenCreate({
                    creator: lowerAddr(d[0]),
                    token: lowerAddr(d[1]),
                    requestId: d[2].toString(),
                    name: d[3],
                    symbol: d[4],
                    totalSupply: Number(ethers.formatEther(d[5])), // 18 decimals → UI 数量
                    // d[6]=launchTime 恒 0，d[7]=launchFee 恒 0（Phase 0 实测，不用）
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                });
                return;
            }

            if (eventName === 'TokenPurchase' || eventName === 'TokenSale') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(TRADE_DATA_TYPES, data);
                if (eventName === 'TokenPurchase') this.stats.purchaseDecoded++;
                else this.stats.saleDecoded++;

                const priceBnb = Number(ethers.formatEther(d[2]));
                const tokenAmount = Number(ethers.formatEther(d[3]));
                const bnbAmount = Number(ethers.formatEther(d[4]));

                const tickKey = `${logEntry.transactionHash}-${parseInt(logEntry.logIndex, 16)}`;
                if (this._processedTickKeys.has(tickKey)) {
                    this.stats.duplicateTicks++;
                    return;
                }
                this._processedTickKeys.add(tickKey);
                if (this._processedTickKeys.size > 200000) {
                    const entries = [...this._processedTickKeys];
                    this._processedTickKeys = new Set(entries.slice(entries.length / 2));
                }

                this._emitTick({
                    token: lowerAddr(d[0]),
                    tradeType: eventName === 'TokenPurchase' ? 'buy' : 'sell',
                    trader: lowerAddr(d[1]),
                    priceBnb,
                    tokenAmount,
                    bnbAmount,
                    offers: Number(ethers.formatEther(d[6])),
                    fundsBnb: Number(ethers.formatEther(d[7])),
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                    logIndex: parseInt(logEntry.logIndex, 16),
                });
                return;
            }

            if (eventName === 'LiquidityAdded') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(LIQ_ADDED_DATA_TYPES, data);
                this.stats.liquidityAdded++;
                // ⚠ Phase 0 未观察到样本，签名来自官方文档；上线后自然验证
                this.logger.info('', 'FourMemeAnkrWsCollector',
                    `毕业事件: token=${lowerAddr(d[0])} funds=${ethers.formatEther(d[3])} BNB tx=${logEntry.transactionHash}`);
                if (this._callbacks.onGraduation) {
                    this._callbacks.onGraduation({
                        token: lowerAddr(d[0]),
                        offers: Number(ethers.formatEther(d[1])),
                        quote: lowerAddr(d[2]), // address(0) 表示 BNB 计价
                        fundsBnb: Number(ethers.formatEther(d[3])),
                        blockNumber,
                        blockTimeMs,
                        txHash: logEntry.transactionHash,
                    });
                }
                return;
            }

            if (eventName === 'TradeStop') {
                this.stats.tradeStop++;
                const d = ethers.AbiCoder.defaultAbiCoder().decode(TRADE_STOP_DATA_TYPES, data);
                this.logger.info('', 'FourMemeAnkrWsCollector', `交易停止: token=${lowerAddr(d[0])} tx=${logEntry.transactionHash}`);
                return;
            }
        } catch (err) {
            this.stats.decodeFailed++;
            this.logger.error('', 'FourMemeAnkrWsCollector',
                `[${eventName}] 解码失败: ${err.message} tx=${logEntry.transactionHash}`);
        }
    }

    // ═══════════════ TokenCreate：发现 ═══════════════

    _handleTokenCreate(info) {
        // 注册到 FactorAggregator（代币年龄基准 = 创建事件块时间；totalSupply 供 marketCap）
        if (this._factorAggregator) {
            this._factorAggregator.registerToken(info.token, {
                createdAtMs: info.blockTimeMs,
                totalSupply: info.totalSupply,
                name: info.name,
                symbol: info.symbol,
                creatorAddress: info.creator,
            });
        }

        const existing = this.tokenPool ? this.tokenPool.getToken(info.token, 'bsc') : null;
        if (!existing && this.tokenPool) {
            const added = this.tokenPool.addToken({
                token: info.token,
                chain: 'bsc',
                platform: 'fourmeme',
                data_source: 'wss',
                name: info.name || '',
                symbol: info.symbol || '',
                created_at: Math.floor(info.blockTimeMs / 1000),
                current_price_usd: null,
                creator_address: info.creator,
            });
            if (added) {
                this.stats.tokensAddedToPool++;
                this.logger.info('', 'FourMemeAnkrWsCollector',
                    `新代币入池: ${info.symbol || info.name || ''} ${info.token} creator=${info.creator} block=${info.blockNumber}`);
            }
        }

        if (this._callbacks.onTokenCreate) {
            this._callbacks.onTokenCreate(info);
        }
    }

    // ═══════════════ tick：单一咽喉点三路输出 ═══════════════

    _emitTick(decoded) {
        const bnbUsd = this._bnbUsd;
        const priceUsd = bnbUsd > 0 ? decoded.priceBnb * bnbUsd : null;
        const receivedAt = Date.now();

        // 1) TokenPool 价格更新（只对已在池中的代币；USD 价有效才更新。
        //    AVE 专属因子 txVolumeU24h/holders/tvl/fdv 不再由价格轮询注入，由 FA 从 tick 自建）
        if (this.tokenPool && priceUsd && priceUsd > 0) {
            const token = this.tokenPool.getToken(decoded.token, 'bsc');
            if (token) {
                this.tokenPool.updatePrice(decoded.token, 'bsc', priceUsd, receivedAt, {});
                this.stats.poolUpdates++;
            }
        }

        // 2) tick 缓冲落库（行对象引用交给 FA 标记 price_outlier 后再 flush）
        const tickRow = {
            experiment_id: this._experimentId,
            token_address: decoded.token,
            tx_hash: decoded.txHash,
            log_index: decoded.logIndex,
            trade_type: decoded.tradeType,
            trader_address: decoded.trader,
            price_bnb: decoded.priceBnb,
            price_usd: priceUsd,
            bnb_amount: decoded.bnbAmount,
            token_amount: decoded.tokenAmount,
            price_outlier: false,
            block_number: decoded.blockNumber,
            block_time: new Date(decoded.blockTimeMs).toISOString(),
            received_at: new Date(receivedAt).toISOString(),
        };
        this.stats.ticksBuffered++;
        this._tickBuffer.push(tickRow);
        if (this._tickBuffer.length >= this._tickFlushThreshold) {
            this._flushTickBuffer();
        }

        // 3) FactorAggregator（小额尘 tick 不参与因子计算，仍落表）
        let faResult = null;
        if (this._factorAggregator && decoded.bnbAmount >= this._minTickBnb) {
            faResult = this._factorAggregator.processTick({
                token_address: decoded.token,
                trade_type: decoded.tradeType,
                trader_address: decoded.trader,
                price_bnb: decoded.priceBnb,
                price_usd: priceUsd,
                bnb_amount: decoded.bnbAmount,
                token_amount: decoded.tokenAmount,
                offers: decoded.offers,
                funds_bnb: decoded.fundsBnb,
                block_number: decoded.blockNumber,
                timestamp: decoded.blockTimeMs,
                tx_hash: decoded.txHash,
                log_index: decoded.logIndex,
            });
        }

        // FA 离群价判定回写落表行（flush 前生效）
        if (faResult && faResult.priceOutlier) {
            tickRow.price_outlier = true;
        }

        if (this._callbacks.onTick) {
            this._callbacks.onTick({
                token_address: decoded.token,
                trade_type: decoded.tradeType,
                price_bnb: decoded.priceBnb,
                price_usd: priceUsd,
                timestamp: decoded.blockTimeMs,
            });
        }
    }

    // ═══════════════ tick 批量落库 ═══════════════

    /**
     * upsert 一批 tick。成功/duplicate 返回 written=batch.length。
     * 「数据错误」（字段溢出/类型非法）二分降级定位并丢弃坏 tick——避免单条坏 tick 卡死整批写入。
     * 非「数据错误」（网络/未知）throw，交由上层 unshift 重试。
     */
    async _upsertTickBatch(batch) {
        if (batch.length === 0) return { written: 0, failed: 0 };
        const { error } = await this._supabase
            .from('wss_price_ticks')
            .upsert(batch, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true });
        if (!error) return { written: batch.length, failed: 0 };
        if (error.code === '23505' || (error.message || '').includes('duplicate')) {
            return { written: batch.length, failed: 0 };
        }
        const isDataError = /out of range|invalid input syntax|does not exist|bad value/i.test(error.message || '');
        if (isDataError) {
            if (batch.length === 1) {
                const t = batch[0];
                this.logger.warn('', 'FourMemeAnkrWsCollector',
                    `tick 字段非法已丢弃: token=${t.token_address} price_bnb=${t.price_bnb} block=${t.block_number} tx=${t.tx_hash} err=${error.message}`);
                this.stats.ticksFlushFailed++;
                return { written: 0, failed: 1 };
            }
            const mid = Math.floor(batch.length / 2);
            const r1 = await this._upsertTickBatch(batch.slice(0, mid));
            const r2 = await this._upsertTickBatch(batch.slice(mid));
            return { written: r1.written + r2.written, failed: r1.failed + r2.failed };
        }
        throw error;
    }

    async _flushTickBuffer() {
        if (this._tickBuffer.length === 0) return;
        if (this._flushInProgress) return;
        // 无实验上下文（dry-run 模式）：不写库，丢弃缓冲
        if (!this._experimentId) {
            this._tickBuffer = [];
            return;
        }
        this._flushInProgress = true;

        if (!this._supabase) {
            try {
                const { dbManager } = require('../services/dbManager');
                this._supabase = dbManager.getClient();
            } catch {
                this._flushInProgress = false;
                return;
            }
        }

        let totalWritten = 0;
        while (this._tickBuffer.length > 0) {
            const batch = this._tickBuffer.splice(0, this._tickBatchSize);
            if (batch.length === 0) break;
            try {
                const r = await this._upsertTickBatch(batch);
                totalWritten += r.written;
            } catch (err) {
                this.logger.warn('', 'FourMemeAnkrWsCollector',
                    `tick 写入失败(将重试): ${err.message} batchSize=${batch.length}`);
                this.stats.ticksFlushFailed += batch.length;
                this._tickBuffer.unshift(...batch);
                break;
            }
        }

        this.stats.ticksWritten += totalWritten;
        this._flushInProgress = false;
    }

    // ═══════════════ BNB/USD ═══════════════

    async _fetchBnbUsd() {
        try {
            if (!this._routerContract) {
                const { BlockchainConfig } = require('../utils/BlockchainConfig');
                const rpcUrl = BlockchainConfig.CHAIN_CONFIGS.bsc.network.rpcUrl;
                const provider = new ethers.JsonRpcProvider(rpcUrl);
                this._routerContract = new ethers.Contract(PANCAKE_V2_ROUTER, ROUTER_ABI, provider);
            }
            const amounts = await this._routerContract.getAmountsOut(ethers.parseEther('1'), [WBNB_BSC, USDT_BSC]);
            const price = Number(ethers.formatEther(amounts[1])); // BSC USDT 18 decimals
            if (price > 0) {
                this._bnbUsd = price;
                this.stats.bnbUsdUpdates++;
            }
        } catch (err) {
            this.logger.warn('', 'FourMemeAnkrWsCollector', `BNB/USD 获取失败(沿用缓存 ${this._bnbUsd}): ${err.message}`);
        }
    }

    // ═══════════════ 心跳与重连 ═══════════════

    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this.logger.warn('', 'FourMemeAnkrWsCollector', 'WebSocket 未连接，触发重连');
                this._scheduleReconnect();
                return;
            }
            // 连接正常，重置退避
            this._reconnectDelay = this._reconnectMinDelay;
        }, 30000);
    }

    _ensureIntervals() {
        if (!this._heartbeatTimer) this._startHeartbeat();
        if (!this._tickFlushTimer) {
            this._tickFlushTimer = setInterval(() => this._flushTickBuffer(), this._tickFlushIntervalMs);
        }
        if (!this._bnbUsdTimer) {
            this._fetchBnbUsd();
            this._bnbUsdTimer = setInterval(() => this._fetchBnbUsd(), this._bnbUsdRefreshMs);
        }
    }

    /**
     * [wss-down-guard 自愈] 强制重连：静默僵尸连接（无 close 也无消息）由此复活。幂等。
     */
    forceReconnect() {
        if (this._reconnectTimer) return false; // 已在重连循环中
        this.logger.warn('', 'FourMemeAnkrWsCollector', '强制重连（断流守护触发）');
        this._ensureIntervals();
        this._scheduleReconnect();
        return true;
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return; // 已在重连中

        this.stats.reconnects++;

        if (this._ws) {
            this._ws.removeAllListeners();
            if (this._ws.readyState === WebSocket.CONNECTING) {
                this._ws.terminate();
            } else {
                this._ws.close();
            }
            this._ws = null;
        }
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
        this._logSubId = null;
        this._headSubId = null;

        this.logger.info('', 'FourMemeAnkrWsCollector',
            `计划重连: delay=${this._reconnectDelay}ms attempt=${this.stats.reconnects}`);

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._connect();
        }, this._reconnectDelay);

        this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._reconnectMaxDelay);
    }

    getStats() {
        return {
            ...this.stats,
            connected: this._ws?.readyState === WebSocket.OPEN,
            bnbUsd: this._bnbUsd,
            tickBufferLength: this._tickBuffer.length,
            pendingLogs: this._pendingLogs.length,
            blockTimeCacheSize: this._blockTimes.size,
            dedupeSetSize: this._processedTickKeys.size,
            uptimeSeconds: this.stats.startTime
                ? Math.floor((Date.now() - this.stats.startTime) / 1000)
                : 0,
        };
    }
}

module.exports = { FourMemeAnkrWsCollector, TOPIC0_MAP };
