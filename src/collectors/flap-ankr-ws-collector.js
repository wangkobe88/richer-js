/**
 * Flap ankr WSS Collector
 *
 * 通过 ankr Advanced API WSS（标准 eth_subscribe）实时监控 flap.sh BSC 内盘事件。
 * 订阅 Portal 合约的全部 logs（发现 + 价格 + 毕业）+ newHeads（块时间回填）。
 *
 * ⚠️ 机制层（重连/心跳/块时间回填/pending RPC 兜底/去重/tickBuffer/毒 tick 二分/BNB-USD）
 * 复制自 fourmeme-ankr-ws-collector.js——改动任一份的机制逻辑须评估另一份。
 *
 * 功能：
 * 1. TokenCreated → 新代币发现：TokenPool.addToken(data_source='wss') + 回调 onTokenCreate（引擎负责落库 experiment_tokens）
 * 2. TokenBought/TokenSold → tick：postPrice 字段直接可用（18 decimals BNB/token）
 *    → tick 缓冲批量落库 wss_price_ticks + TokenPool.updatePrice + FactorAggregator.processTick
 * 3. LaunchedToDEX → 毕业：回调 onGraduation
 * 4. TokenQuoteSet → 计价币识别：非 BNB 计价（如 USD1/QQQB 等 meme quote）的代币照常发现记录，
 *    其 tick 按 quote→BNB 实时汇率换算后落库（2026-09-27 用户裁定覆盖：链上大量代币属此类，
 *    不换算=整类盲区）。汇率源 = PancakeSwap V2 quote/WBNB 池 reserves（TTL 缓存 +
 *    stale-while-revalidate + 无池负缓存），换算失败才跳过；wss_price_ticks.quote_token 留溯源。
 *    进程启动时回放最近 N 分钟 TokenQuoteSet 重建计价表（否则冷启动窗口会按 BNB 错采）。
 *    实测 TokenQuoteSet 的 logIndex 后于 TokenCreated，计价币在 create 之后才可知
 *
 * 事件口径（2026-09 实测验证，90s 订阅 1851 事件 / 18 新币 / 254 买 / 177 卖）：
 * - 全部事件无 indexed 参数（topics 只有 topic0），业务参数全在 data
 * - TokenCreated(ts, creator, nonce, token, name, symbol, meta)
 *   ts 为秒级时间戳（仅存档，代币年龄统一用事件块时间）；totalSupply 固定 1e9
 * - TokenBought/TokenSold(ts, token, trader, amount, eth, fee, postPrice)
 *   postPrice 为「成交后」价格（four.meme 是成交时价）——作为 tick 序列等价
 *   （下一 tick 前价 ≈ 上一 postPrice），实时与回测同源同口径；
 *   eth 即该笔 BNB 金额（1% 协议费已含其中，与 four.meme cost 口径对齐）
 * - LaunchedToDEX(token, pool, amount, eth)：签名来自官方文档，尚无实测样本，上线自然验证
 * - TokenQuoteSet(token, quoteToken)：quoteToken 零地址 = BNB 计价；topic0 待 dry-run 实测确认
 * - 税币地址后缀 7777（标准币 8888）：eth/amount/postPrice 口径不受税结构影响，仅标记不过滤
 */

const WebSocket = require('ws');
const { ethers } = require('ethers');

// ── 事件签名（TokenCreated/Bought/Sold 实测验证；LaunchedToDEX/TokenQuoteSet 待大样本确认）──
const EVENT_SIGS = {
    TokenCreated: 'TokenCreated(uint256,address,uint256,address,string,string,string)',
    TokenBought: 'TokenBought(uint256,address,address,uint256,uint256,uint256,uint256)',
    TokenSold: 'TokenSold(uint256,address,address,uint256,uint256,uint256,uint256)',
    LaunchedToDEX: 'LaunchedToDEX(address,address,uint256,uint256)',
    TokenQuoteSet: 'TokenQuoteSet(address,address)',
};

// topic0 → 事件名（模块加载时本地 keccak 计算）
const TOPIC0_MAP = new Map();
for (const [name, sig] of Object.entries(EVENT_SIGS)) {
    TOPIC0_MAP.set(ethers.id(sig), name);
}

const CREATE_DATA_TYPES = ['uint256', 'address', 'uint256', 'address', 'string', 'string', 'string'];
const TRADE_DATA_TYPES = ['uint256', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256'];
const LAUNCHED_DEX_DATA_TYPES = ['address', 'address', 'uint256', 'uint256'];
const QUOTE_SET_DATA_TYPES = ['address', 'address'];

// flap 内盘代币固定总量 1B（与 four.meme 相同量级，供 marketCap 因子）
const FLAP_TOTAL_SUPPLY = 1e9;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);

// BSC PancakeSwap V2 Router（BNB/USD 换算：WBNB→USDT getAmountsOut）
const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB_BSC = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'; // BSC 上 18 decimals
const ROUTER_ABI = ['function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'];

// PancakeSwap V2 Factory（非 BNB 计价盘的 quote→BNB 汇率源：quote/WBNB 池 reserves；
// 实证 2026-09-27：QQQB 池毕业块汇率 0.9628，笑笑牛 1362 笔换算后 graduation 池资金
// 14.26 BNB 与 BNB 计价盘毕业线同量级）
const PCS_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = [
    'function getReserves() view returns (uint112,uint112,uint32)',
    'function token0() view returns (address)',
];
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];
// BSC 出块 ~0.75s：120min ≈ 9600 块（TokenQuoteSet 回放窗口块深）
const QUOTE_BACKFILL_BLOCKS_PER_MIN = 80;

// logs 事件可能先于对应 newHeads 到达：未知块时间的 log 进 pending 队列，
// 由后续 head 回填；超过 15s 仍无 head 的走 RPC eth_getBlockByNumber 兜底
const PENDING_LOG_MAX_WAIT_MS = 15000;
const BLOCK_TIME_CACHE_SIZE = 600; // BSC ~0.75s/块 → 覆盖 ~7.5 分钟

function lowerAddr(a) {
    return (a || '').toLowerCase();
}

class FlapAnkrWsCollector {
    /**
     * @param {Object} config - 全局配置（读取 config.flapWs 段）
     * @param {Object} logger - 引擎 logger（info/warn/error/debug）
     * @param {Object} tokenPool - TokenPool 实例
     * @param {Object|null} factorAggregator - FourMemeFactorAggregator 实例
     * @param {Object} callbacks - { onTokenCreate(info), onTick(tick), onGraduation(info) } 均可选
     */
    constructor(config, logger, tokenPool = null, factorAggregator = null, callbacks = {}) {
        this.config = config.flapWs || {};
        this.logger = logger;
        this.tokenPool = tokenPool;
        this._factorAggregator = factorAggregator;
        this._callbacks = callbacks || {};
        // dry-run：显式丢缓冲不写库（脚本真实流验证用；watcher/实验模式缺省写库，experiment_id 为 null）
        this._dryRun = this.config.dryRun === true;

        const contracts = this.config.contracts || {};
        this._portal = lowerAddr(contracts.portal);

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

        // 非 BNB 计价代币（如 USD1/QQQB quote）：token → quoteToken 地址。
        // 仅记录已确认为非 BNB 的；未记录的默认按 BNB 处理（冷启动窗口由启动回放兜住）
        this._nonBnbQuoteTokens = new Map();
        // token → [blockNumber, logIndex]：已应用的最近一条 TokenQuoteSet 位置——
        // 启动回放与实时订阅存在块重叠，按 (block, logIndex) 单调去重，旧事件晚到不回退状态
        this._quoteSetBlocks = new Map();
        // quote→BNB 换算缓存（2026-09-27 覆盖裁定）：quote → {rate, fetchedAtMs, negative}
        this._quoteRates = new Map();
        this._quoteRateInflight = new Map(); // quote → Promise（并发去重；同 quote 的 tick 序列保序）
        this._quoteDecimalsCache = new Map(); // quote → decimals
        this._pcsFactoryContract = null;      // 惰性（首次换算时建）
        this._quoteBackfilled = false;        // 启动回放 TokenQuoteSet 只跑一次（重连不重跑）
        this._quoteBackfillRetryTimer = null; // 回放失败退避重试定时器（stop 清理）
        const qrCfg = this.config.quoteRate || {};
        this._quoteRateTtlMs = qrCfg.ttlMs ?? 30000;
        this._quoteRateStaleMaxMs = qrCfg.staleMaxMs ?? 300000;
        this._quoteRateNegTtlMs = qrCfg.negTtlMs ?? 60000;
        this._quoteBackfillMinutes = qrCfg.backfillMinutes ?? 120;
        this._quoteBackfillRpcUrl = qrCfg.backfillRpcUrl ?? null;

        this._tickBuffer = [];
        this._tickFlushTimer = null;
        this._flushInProgress = false;
        this._supabase = null;

        this._bnbUsd = 0;
        this._bnbUsdTimer = null;
        this._routerContract = null;

        this._experimentId = null;

        // 未知 topic0 计数分布（确认未验证事件签名用，dry-run 结束打印）
        this._unknownTopic0Counts = new Map();

        this.stats = {
            startTime: null,
            lastMessageAt: null,
            headsReceived: 0,
            logsReceived: 0,
            tokenCreated: 0,
            tokenBought: 0,
            tokenSold: 0,
            launchedToDex: 0,
            quoteSetEvents: 0,
            nonBnbQuoteSkipped: 0,
            quoteConverted: 0,
            quoteRateUnavailable: 0,
            quoteSetBackfilled: 0,
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
            throw new Error('[FlapAnkrWsCollector] 缺少 ankr WSS 端点（config/.env ANKR_WS_URL 或 ANKR_API_KEY）');
        }
        this.stats.startTime = Date.now();
        this._connect();

        this._tickFlushTimer = setInterval(() => {
            this._flushTickBuffer();
        }, this._tickFlushIntervalMs);

        this._fetchBnbUsd();
        this._bnbUsdTimer = setInterval(() => this._fetchBnbUsd(), this._bnbUsdRefreshMs);

        this._startHeartbeat();
        this.logger.info('', 'FlapAnkrWsCollector', `已启动：Portal=${this._portal}`);
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
        for (const t of [this._pingTimer, this._heartbeatTimer, this._tickFlushTimer, this._bnbUsdTimer, this._reconnectTimer, this._quoteBackfillRetryTimer]) {
            if (t) { clearInterval(t); clearTimeout(t); }
        }
        this._pingTimer = this._heartbeatTimer = this._tickFlushTimer = this._bnbUsdTimer = this._reconnectTimer = this._quoteBackfillRetryTimer = null;

        await this._flushTickBuffer(); // 关闭前把缓冲写完
        this.logger.info('', 'FlapAnkrWsCollector', '已停止', this.stats);
    }

    // ═══════════════ WSS 连接与订阅 ═══════════════

    _connect() {
        this.logger.info('', 'FlapAnkrWsCollector',
            `连接 ankr WSS: ${this._wsUrl.replace(/\/ws\/[^/?]+/, '/ws/***')}`);

        this._ws = new WebSocket(this._wsUrl);

        this._ws.on('open', () => {
            this.logger.info('', 'FlapAnkrWsCollector', 'WSS 已连接，发送订阅请求');
            this._send({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] });
            this._send({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', { address: [this._portal] }] });

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
                this.logger.error('', 'FlapAnkrWsCollector', `消息处理异常: ${err.message}`);
            }
        });

        this._ws.on('error', (err) => {
            this.logger.error('', 'FlapAnkrWsCollector', `WSS 错误: ${err.message}`);
        });

        this._ws.on('close', (code, reason) => {
            this.logger.warn('', 'FlapAnkrWsCollector', `WSS 关闭: ${code} ${reason?.toString() || ''}`);
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
            if (msg.id === 2) {
                this._logSubId = msg.result;
                // 首次订阅成功后回放最近 N 分钟 TokenQuoteSet 重建计价表——否则冷启动
                // 窗口内非 BNB 盘的 tick 会按 BNB 错采（污染 price_bnb 口径）。只跑一次
                //（重连不重跑）；失败仅告警，已回放部分与实时事件继续维持状态
                if (!this._quoteBackfilled) {
                    this._quoteBackfilled = true;
                    this._scheduleQuoteBackfill();
                }
            }
            if (msg.id === 1 || msg.id === 2) {
                this.logger.info('', 'FlapAnkrWsCollector', `订阅确认 id=${msg.id} subId=${msg.result}`);
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
            this.logger.warn('', 'FlapAnkrWsCollector', `RPC 错误帧: ${JSON.stringify(msg.error).slice(0, 200)}`);
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
            this._unknownTopic0Counts.set(topic0, (this._unknownTopic0Counts.get(topic0) || 0) + 1);
            return; // 未知伴随事件（实测确认 Portal 大量配置类事件，安全忽略并计数）
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

    async _processLog(logEntry, blockTimeSec) {
        const eventName = TOPIC0_MAP.get(logEntry.topics[0]);
        if (!eventName) return;
        const data = logEntry.data || '0x';
        const blockNumber = parseInt(logEntry.blockNumber, 16);
        const blockTimeMs = blockTimeSec * 1000;

        try {
            if (eventName === 'TokenCreated') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(CREATE_DATA_TYPES, data);
                this.stats.tokenCreated++;
                const token = lowerAddr(d[3]);
                // TokenQuoteSet 的 logIndex 后于 TokenCreated（实测），create 时无法预知计价币：
                // 一律入池落库（用户决策：非 BNB 币照常发现记录），仅 tick 层按计价币跳过
                this._handleTokenCreate({
                    eventTsSec: Number(d[0]), // 事件自带秒级时间戳，仅存档（年龄统一用块时间）
                    creator: lowerAddr(d[1]),
                    nonce: d[2].toString(),
                    token,
                    name: d[4],
                    symbol: d[5],
                    meta: d[6], // IPFS 元数据 URL
                    taxToken: token.endsWith('7777'), // 税币地址后缀 7777（标准币 8888）
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                });
                return;
            }

            if (eventName === 'TokenBought' || eventName === 'TokenSold') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(TRADE_DATA_TYPES, data);
                const token = lowerAddr(d[1]);
                // postPrice = 成交后价格（18 decimals 计价币/token）；eth 即该笔计价币金额（1% fee 已含）
                let priceBnb = Number(ethers.formatEther(d[6]));
                let bnbAmount = Number(ethers.formatEther(d[4]));
                let quoteToken = null;
                const quote = this._nonBnbQuoteTokens.get(token);
                if (quote !== undefined) {
                    const conv = await this._getQuoteConversion(quote);
                    if (!conv) {
                        this.stats.nonBnbQuoteSkipped++;
                        return; // 无池/汇率不可得：跳过（宁漏不污染 price_bnb 口径）
                    }
                    priceBnb *= conv.rate;
                    bnbAmount *= conv.rate;
                    quoteToken = quote;
                    this.stats.quoteConverted++;
                }
                if (eventName === 'TokenBought') this.stats.tokenBought++;
                else this.stats.tokenSold++;

                const tokenAmount = Number(ethers.formatEther(d[3]));

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
                    token,
                    tradeType: eventName === 'TokenBought' ? 'buy' : 'sell',
                    trader: lowerAddr(d[2]),
                    priceBnb,
                    tokenAmount,
                    bnbAmount,
                    quoteToken,
                    // flap 事件无 offers/funds 字段：不传（FA 的 `> 0` 守卫容忍 undefined，tvl 因子恒 0）
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                    logIndex: parseInt(logEntry.logIndex, 16),
                });
                return;
            }

            if (eventName === 'TokenQuoteSet') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(QUOTE_SET_DATA_TYPES, data);
                this.stats.quoteSetEvents++;
                const token = lowerAddr(d[0]);
                const quoteToken = lowerAddr(d[1]);
                const applied = this._applyQuoteSet(token, quoteToken,
                    blockNumber, parseInt(logEntry.logIndex, 16));
                if (applied && quoteToken !== ZERO_ADDRESS) {
                    this.logger.info('', 'FlapAnkrWsCollector',
                        `非 BNB 计价代币: token=${token} quote=${quoteToken} tx=${logEntry.transactionHash}`);
                }
                return;
            }

            if (eventName === 'LaunchedToDEX') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(LAUNCHED_DEX_DATA_TYPES, data);
                this.stats.launchedToDex++;
                // ⚠ 签名来自官方文档，尚无实测样本；上线自然验证
                // 非 BNB 计价盘：eth 是 quote 币金额——换算成 BNB 落 fundsBnb；
                // 换算不可得时 fundsBnb=null + fundsQuote 留原值（诚实语义，不冒充 BNB）
                const gradToken = lowerAddr(d[0]);
                let fundsBnb = Number(ethers.formatEther(d[3]));
                let fundsQuote = null;
                let quoteToken = null;
                const quote = this._nonBnbQuoteTokens.get(gradToken);
                if (quote !== undefined) {
                    fundsQuote = fundsBnb;
                    quoteToken = quote;
                    const conv = await this._getQuoteConversion(quote);
                    if (conv) {
                        fundsBnb *= conv.rate;
                        this.stats.quoteConverted++;
                    } else {
                        fundsBnb = null;
                        this.stats.quoteRateUnavailable++;
                    }
                }
                const fundsDesc = fundsBnb != null
                    ? `${fundsBnb.toFixed(6)} BNB`
                    : `${fundsQuote} ${quoteToken}(未换算)`;
                this.logger.info('', 'FlapAnkrWsCollector',
                    `毕业事件: token=${gradToken} pool=${lowerAddr(d[1])} funds=${fundsDesc} tx=${logEntry.transactionHash}`);
                if (this._callbacks.onGraduation) {
                    this._callbacks.onGraduation({
                        token: gradToken,
                        dexPool: lowerAddr(d[1]),
                        tokenAmount: Number(ethers.formatEther(d[2])),
                        fundsBnb,
                        fundsQuote,
                        quoteToken,
                        blockNumber,
                        blockTimeMs,
                        txHash: logEntry.transactionHash,
                    });
                }
                return;
            }
        } catch (err) {
            this.stats.decodeFailed++;
            this.logger.error('', 'FlapAnkrWsCollector',
                `[${eventName}] 解码失败: ${err.message} tx=${logEntry.transactionHash}`);
        }
    }

    // ═══════════════ 非 BNB 计价：quote→BNB 换算 + 启动回放（2026-09-27） ═══════════════

    /**
     * 应用一条 TokenQuoteSet（实时/回放共用）。按 (blockNumber, logIndex) 单调去重：
     * 启动回放与实时订阅存在块重叠窗口，旧事件晚到不得回退新状态。
     * @returns {boolean} 是否实际应用（false=旧事件被忽略）
     */
    _applyQuoteSet(token, quoteToken, blockNumber, logIndex) {
        const last = this._quoteSetBlocks.get(token);
        if (last && (blockNumber < last[0] || (blockNumber === last[0] && logIndex <= last[1]))) {
            return false;
        }
        this._quoteSetBlocks.set(token, [blockNumber, logIndex]);
        if (quoteToken === ZERO_ADDRESS) {
            this._nonBnbQuoteTokens.delete(token); // BNB 计价
        } else {
            this._nonBnbQuoteTokens.set(token, quoteToken);
        }
        return true;
    }

    /**
     * 取 quote→BNB 汇率（TTL 缓存 + stale-while-revalidate + 负缓存 + inflight 去重）。
     * @returns {Promise<{rate:number}|null>} null=无池/无储备/负缓存期内（调用方跳过该 tick）
     */
    async _getQuoteConversion(quote) {
        const now = Date.now();
        const cached = this._quoteRates.get(quote);
        if (cached) {
            const age = now - cached.fetchedAtMs;
            if (cached.negative) {
                if (age < this._quoteRateNegTtlMs) return null;
            } else if (age < this._quoteRateTtlMs) {
                return { rate: cached.rate };
            } else if (age < this._quoteRateStaleMaxMs) {
                // stale-while-revalidate：旧值先用（容忍一个 TTL 的汇率滞后），后台刷新；
                // 刷新失败只落负缓存（负缓存过期前后续 tick 跳过，不影响本次返回）
                this._refreshQuoteRate(quote).catch(() => {});
                return { rate: cached.rate };
            }
        }
        return this._refreshQuoteRate(quote);
    }

    /**
     * 刷新汇率（inflight 去重；同 quote 并发共享同一 Promise——注册序即完成序，
     * 同 token 的 tick 序列在换算点保序）。内部全 catch 绝不 reject：
     * _processLog 的 await 段需要这层保护（unhandled rejection 会崩 watcher）。
     */
    async _refreshQuoteRate(quote) {
        const inflight = this._quoteRateInflight.get(quote);
        if (inflight) return inflight;

        const p = (async () => {
            try {
                const rate = await this._fetchQuoteRateFromRpc(quote);
                this._quoteRates.set(quote, { rate, fetchedAtMs: Date.now(), negative: rate == null });
                return rate == null ? null : { rate };
            } catch (err) {
                this.logger.warn('', 'FlapAnkrWsCollector',
                    `quote 汇率获取失败(负缓存${Math.round(this._quoteRateNegTtlMs / 1000)}s): quote=${quote} ${err.message}`);
                this._quoteRates.set(quote, { rate: null, fetchedAtMs: Date.now(), negative: true });
                return null;
            }
        })();

        this._quoteRateInflight.set(quote, p);
        try {
            return await p;
        } finally {
            this._quoteRateInflight.delete(quote);
        }
    }

    /**
     * 链上汇率：PancakeSwap V2 getPair(quote, WBNB) → getReserves。
     * rate = WBNB 储备 / quote 储备（各自按 decimals 归一到 whole-token 单位）。
     * 无池（零地址）/储备为 0 → null。
     */
    async _fetchQuoteRateFromRpc(quote) {
        if (!this._pcsFactoryContract) {
            const { BlockchainConfig } = require('../utils/BlockchainConfig');
            const rpcUrl = BlockchainConfig.CHAIN_CONFIGS.bsc.network.rpcUrl;
            this._pcsProvider = new ethers.JsonRpcProvider(rpcUrl);
            this._pcsFactoryContract = new ethers.Contract(PCS_V2_FACTORY, FACTORY_ABI, this._pcsProvider);
        }
        const pair = await this._pcsFactoryContract.getPair(quote, WBNB_BSC);
        if (!pair || pair === ethers.ZeroAddress) return null; // quote 未上 PCS V2 对 WBNB 池
        const pairContract = new ethers.Contract(pair, PAIR_ABI, this._pcsProvider);
        const [reserves, token0] = await Promise.all([pairContract.getReserves(), pairContract.token0()]);
        const [reserve0, reserve1] = reserves; // bigint（uint112）
        if (reserve0 === 0n || reserve1 === 0n) return null; // 无流动性
        const decimals = await this._quoteDecimalsOf(quote);
        const decExp = 10n ** BigInt(decimals);
        const rate = lowerAddr(token0) === quote
            ? Number(reserve1 * decExp) / Number(reserve0 * 10n ** 18n) // token0=quote → r1 是 WBNB
            : Number(reserve0 * decExp) / Number(reserve1 * 10n ** 18n); // token0=WBNB → r0 是 WBNB
        return rate > 0 ? rate : null;
    }

    /** quote 币 decimals（缓存；provider 由 _fetchQuoteRateFromRpc 先行创建） */
    async _quoteDecimalsOf(quote) {
        let dec = this._quoteDecimalsCache.get(quote);
        if (dec !== undefined) return dec;
        const erc20 = new ethers.Contract(quote, ERC20_DECIMALS_ABI, this._pcsProvider);
        dec = Number(await erc20.decimals());
        this._quoteDecimalsCache.set(quote, dec);
        return dec;
    }

    /**
     * 启动回放调度：失败退避重试（30s 起 ×2 上限 5min，不设轮次上限）。
     * 回放缺失不是无害缺口——窗口内存量非 BNB 盘不再发 TokenQuoteSet，其 tick 会按
     * quote 价冒充 BNB 价落库（口径污染），必须重试到成功；_applyQuoteSet 的
     * (block,logIndex) 单调去重保证重跑幂等（182 实测 ankr getLogs 批量限流
     * -32005 即此设计依据）。成功即静默（完成日志在 _backfillQuoteSets 内）。
     */
    _scheduleQuoteBackfill(retryDelayMs = 0) {
        this._backfillQuoteSets().catch((err) => {
            const nextDelayMs = retryDelayMs === 0 ? 30000 : Math.min(retryDelayMs * 2, 300000);
            this.logger.warn('', 'FlapAnkrWsCollector',
                `TokenQuoteSet 启动回放失败(${Math.round(nextDelayMs / 1000)}s 后重试): ${err.message}`);
            this._quoteBackfillRetryTimer = setTimeout(
                () => this._scheduleQuoteBackfill(nextDelayMs), nextDelayMs);
        });
    }

    /**
     * 回放 RPC 端点解析：config `backfillRpcUrl` = 'ankrFromEnv'（从 ANKR_WS_URL /
     * ANKR_API_KEY 推导 ankr HTTP 端点）| 显式 url | null（回退主 rpcUrl）。
     * 182 实证：主 rpcUrl（binance dataseed）对 eth_getLogs 恒 -32005 限流
     * （batch 与单发都拒），ankr 带 key 323ms/2000 块。
     */
    _resolveBackfillRpcUrl() {
        if (this._quoteBackfillRpcUrl === 'ankrFromEnv') {
            const wsUrl = process.env.ANKR_WS_URL || '';
            const wsKey = wsUrl.split('/').pop();
            // 无 key 的 wss://rpc.ankr.com/bsc/ws 尾段 'ws' 不是 key——合格才用，否则回退 ANKR_API_KEY
            const key = (wsKey && wsKey.length >= 20 ? wsKey : '')
                || (process.env.ANKR_API_KEY && process.env.ANKR_API_KEY.length >= 20 ? process.env.ANKR_API_KEY : '');
            if (key) return `https://rpc.ankr.com/bsc/${key}`;
            return null;
        }
        return this._quoteBackfillRpcUrl || null;
    }

    /**
     * 启动回放：getLogs 拉最近 backfillMinutes 的 TokenQuoteSet 重建计价表。
     * 只补表不补 tick——历史缺口不回填（WSS 本就不回放），回放只为让后续实时 tick 判对计价。
     */
    async _backfillQuoteSets() {
        const { BlockchainConfig } = require('../utils/BlockchainConfig');
        const rpcUrl = this._resolveBackfillRpcUrl() || BlockchainConfig.CHAIN_CONFIGS.bsc.network.rpcUrl;
        // batchMaxCount=1：RPC 请求不打 JSON-RPC batch（getLogs in batch 是独立限流面）；
        // staticNetwork 56 免网络 detect 往返
        const provider = new ethers.JsonRpcProvider(rpcUrl, 56, { batchMaxCount: 1 });
        const toBlock = await provider.getBlockNumber();
        const depth = Math.ceil(this._quoteBackfillMinutes * QUOTE_BACKFILL_BLOCKS_PER_MIN);
        const fromBlock = Math.max(0, toBlock - depth);
        const logs = await this._fetchQuoteSetLogs(provider, fromBlock, toBlock);
        this._applyQuoteSetLogs(logs);
        this.logger.info('', 'FlapAnkrWsCollector',
            `TokenQuoteSet 启动回放完成: blocks ${fromBlock}→${toBlock} events=${logs.length} applied后非BNB计价=${this._nonBnbQuoteTokens.size} rpc=${new URL(rpcUrl).host}`);
    }

    /** 分块 getLogs（规避 RPC 单次块深上限）；按块序拼接；chunk 间 500ms 摊开（ankr 批量限流） */
    async _fetchQuoteSetLogs(provider, fromBlock, toBlock) {
        const CHUNK = 2000;
        const topic0 = ethers.id(EVENT_SIGS.TokenQuoteSet);
        const out = [];
        for (let start = fromBlock; start <= toBlock; start += CHUNK) {
            const end = Math.min(start + CHUNK - 1, toBlock);
            const logs = await provider.getLogs({
                address: this._portal,
                topics: [topic0],
                fromBlock: start,
                toBlock: end,
            });
            out.push(...logs);
            if (end < toBlock) await new Promise((r) => setTimeout(r, 500));
        }
        return out;
    }

    /** 应用回放日志（与实时共用 _applyQuoteSet 的单调去重） */
    _applyQuoteSetLogs(logs) {
        let applied = 0;
        for (const log of logs) {
            const d = ethers.AbiCoder.defaultAbiCoder().decode(QUOTE_SET_DATA_TYPES, log.data);
            if (this._applyQuoteSet(lowerAddr(d[0]), lowerAddr(d[1]),
                parseInt(log.blockNumber, 16), parseInt(log.logIndex, 16))) {
                applied++;
            }
        }
        this.stats.quoteSetBackfilled = applied;
    }

    // ═══════════════ TokenCreated：发现 ═══════════════

    _handleTokenCreate(info) {
        // 注册到 FactorAggregator（代币年龄基准 = 创建事件块时间；totalSupply 供 marketCap）
        if (this._factorAggregator) {
            this._factorAggregator.registerToken(info.token, {
                createdAtMs: info.blockTimeMs,
                totalSupply: FLAP_TOTAL_SUPPLY,
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
                platform: 'flap',
                data_source: 'wss',
                name: info.name || '',
                symbol: info.symbol || '',
                created_at: Math.floor(info.blockTimeMs / 1000),
                current_price_usd: null,
                creator_address: info.creator,
            });
            if (added) {
                this.stats.tokensAddedToPool++;
                this.logger.info('', 'FlapAnkrWsCollector',
                    `新代币入池: ${info.symbol || info.name || ''} ${info.token}${info.taxToken ? ' [税币]' : ''} creator=${info.creator} block=${info.blockNumber}`);
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

        // 1) TokenPool 价格更新（只对已在池中的代币；USD 价有效才更新）
        if (this.tokenPool && priceUsd && priceUsd > 0) {
            const token = this.tokenPool.getToken(decoded.token, 'bsc');
            if (token) {
                this.tokenPool.updatePrice(decoded.token, 'bsc', priceUsd, receivedAt, {});
                this.stats.poolUpdates++;
            }
        }

        // 2) tick 缓冲落库（行对象引用交给 FA 标记 price_outlier 后再 flush）
        const tickRow = {
            experiment_id: this._experimentId ?? null,
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
            platform: 'flap',
            // 非 BNB 计价盘的计价币（price_bnb/bnb_amount 已按 quote→BNB 汇率换算；BNB 盘 null）
            quote_token: decoded.quoteToken ?? null,
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
                // flap 事件无 offers/funds 字段：不传（undefined 守卫容忍，tvl 恒 0）
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
                this.logger.warn('', 'FlapAnkrWsCollector',
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
        // dry-run 模式（config dryRun=true）：不写库，丢弃缓冲
        if (this._dryRun) {
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
                this.logger.warn('', 'FlapAnkrWsCollector',
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
            this.logger.warn('', 'FlapAnkrWsCollector', `BNB/USD 获取失败(沿用缓存 ${this._bnbUsd}): ${err.message}`);
        }
    }

    // ═══════════════ 心跳与重连 ═══════════════

    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this.logger.warn('', 'FlapAnkrWsCollector', 'WebSocket 未连接，触发重连');
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
        this.logger.warn('', 'FlapAnkrWsCollector', '强制重连（断流守护触发）');
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

        this.logger.info('', 'FlapAnkrWsCollector',
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
            nonBnbQuoteTracked: this._nonBnbQuoteTokens.size,
            quoteRateCacheSize: this._quoteRates.size,
            uptimeSeconds: this.stats.startTime
                ? Math.floor((Date.now() - this.stats.startTime) / 1000)
                : 0,
            // 未匹配 topic0 的分布（dry-run 验证事件签名覆盖用）
            unknownTopic0: Object.fromEntries(this._unknownTopic0Counts),
        };
    }
}

module.exports = { FlapAnkrWsCollector, TOPIC0_MAP, FLAP_TOTAL_SUPPLY };
