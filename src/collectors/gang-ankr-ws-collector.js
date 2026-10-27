/**
 * Gang ankr WSS Collector（gang.fun LaunchpadV2）
 *
 * 通过 ankr Advanced API WSS（标准 eth_subscribe）实时监控 gang.fun BSC 内盘事件。
 * 订阅 LaunchpadV2 合约的五类 topic0 白名单 logs + newHeads（块时间回填）。
 *
 * ⚠️ 机制层（重连/心跳/块时间回填/pending RPC 兜底/去重/tickBuffer/毒 tick 二分/BNB-USD/
 * quote 换算三级源）复制自 flap-ankr-ws-collector.js（其机制层又复制自 fourmeme
 * collector）——三份复制关系，改动任一份的机制逻辑须评估其余两份。
 *
 * 与 flap 的平台差异（2026-10-27 调研，合约源码+链上采样逐字段验证）：
 * - 平台为 agent-only launchpad：buy/sell/create 全部链上校验 Agent ID，本工程只做
 *   采集+虚拟+回测（live 另案设计）；交易 tx.from == 事件 trader（BAW 直接作为 tx
 *   发起者，实测复验），现有 sender||trader 钱包口径原样适用
 * - 计价币在 Created 事件终态固定（indexed topics[3]），无 flap 的运行时 QuoteSet——
 *   无链上回放需求；启动重建改读 wss_events token_create 行（48h 窗）恢复 quote map
 * - 事件形状（五 topic0 与源码 keccak 精确对拍；dw 语义为链上采样实测）：
 *   Created(token*, creator*, name, symbol, logoUri, taxed, quote*, refPair, gradAmt)
 *     topics[1]=token [2]=creator [3]=quote（WBNB 实地址 0xbb4c…095c 或 ERC-20；
 *     0x0 亦按 WBNB——合约源码语义）；data 恰 6 word 串：name/symbol/logoUri(https://
 *     cdn.gang.fun/ipfs/…)/taxed(bool)/refPair/gradAmt（毕业阈值 quote 单位，WBNB 盘
 *     实测恒 15e18）
 *   Buy(token*, buyer*, dw0..dw4)：dw0=净入金（毛×0.99，税后入曲线）、dw1=taxDividend、
 *     dw2=taxPlatform、dw3=tokensOut、dw4=曲线累计 realQuote
 *   Sell(token*, seller*, dw0..dw4)：dw0=tokensIn、dw1/dw2=税、dw3=净收款、dw4=累计
 *   Graduated(token*, pair, quote, tokenAmount, quoteAmount)：pair=PCS V2 池
 *   VirtualQuoteLocked(token*, virtualQuote)：仅计数，无业务消费
 * - tick 口径：bnb_amount/token_amount/price_bnb 全部用净额（dw0/dw3）——1% 平台费已
 *   含在事件净额中，无 flap 0.98/1.0204 经验系数问题；totalSupply 恒 1e9（两 V2 token
 *   实测精确一致）
 * - 未知 token trade（Created 未见且 DB 重建未命中）暂存队列：无法区分「BNB 盘」与
 *   「映射缺失」，绝不以 quote 价冒充 BNB 价落库（flap 0xcf91 冒充事故同款防线）；
 *   Created 到达/DB 重建完成按序重放，溢出丢最老（fail-loud 计数）
 * - 非 BNB 计价盘换算源多一档源⓪ refPair（Created 携带的平台参考池，V2 reserves/
 *   V3 slot0+liquidity 门，仅当池两侧恰为 {quote,WBNB} 才采用——bridge 池另一侧非
 *   WBNB 时宁 miss 走三级源不冒充），miss 后走 flap 同款三级源①②③
 * - legacy soft pad（0x315B…）为慢速遗留盘：不订阅不配置（本文件唯一目标 LaunchpadV2）
 */

const WebSocket = require('ws');
const { ethers } = require('ethers');

// ── 事件签名（五 topic0 已与链上采样精确对拍，见头注释）──
const EVENT_SIGS = {
    Created: 'Created(address,address,string,string,string,bool,address,address,uint256)',
    Buy: 'Buy(address,address,uint256,uint256,uint256,uint256,uint256)',
    Sell: 'Sell(address,address,uint256,uint256,uint256,uint256,uint256)',
    Graduated: 'Graduated(address,address,address,uint256,uint256)',
    VirtualQuoteLocked: 'VirtualQuoteLocked(address,uint256)',
};

// topic0 → 事件名（模块加载时本地 keccak 计算）
const TOPIC0_MAP = new Map();
for (const [name, sig] of Object.entries(EVENT_SIGS)) {
    TOPIC0_MAP.set(ethers.id(sig), name);
}

// data 段解码类型（indexed 参数不进 data）：Created=6 段、Buy/Sell=5 段、Graduated=3 段
const CREATE_DATA_TYPES = ['string', 'string', 'string', 'bool', 'address', 'uint256'];
const TRADE_DATA_TYPES = ['uint256', 'uint256', 'uint256', 'uint256', 'uint256'];
// Graduated 三段（2026-10-27 链上 5/5 实证：word0=quote[≠PCS pair，逐票==Created quote]、
// word1=tokenAmount 恒 2e8[毕业注入池 token 储备协议常量]、word2=quoteAmount==Created gradAmt
// 逐票精确全等）。旧四字段形状系调研期构造未实证，对真实事件解码必败（decodeFailed 且
// onGraduation 永不触发=毕业全清卖丢失），M2 前已修——勿再改回
const GRADUATED_DATA_TYPES = ['address', 'uint256', 'uint256'];
const VQL_DATA_TYPES = ['uint256'];

// gang LaunchToken totalSupply 恒 1e9（实测两个 V2 token 精确一致，供 marketCap 因子）
const GANG_TOTAL_SUPPLY = 1e9;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);

// BSC PancakeSwap V2 Router（BNB/USD 换算：WBNB→USDT getAmountsOut）
const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB_BSC = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'; // BSC 上 18 decimals
const ROUTER_ABI = ['function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'];

// PancakeSwap V2/V3 factory（quote→BNB 三级源的①②；复制自 flap collector）
const PCS_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = [
    'function getReserves() view returns (uint112,uint112,uint32)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
];
const PCS_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const V3_FEE_TIERS = [100, 500, 2500, 10000];
const V3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const V3_POOL_ABI = [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() view returns (uint128)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
];
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];

// logs 事件可能先于对应 newHeads 到达：未知块时间的 log 进 pending 队列，
// 由后续 head 回填；超过 15s 仍无 head 的走 RPC eth_getBlockByNumber 兜底
const PENDING_LOG_MAX_WAIT_MS = 15000;
const BLOCK_TIME_CACHE_SIZE = 600; // BSC ~0.75s/块 → 覆盖 ~7.5 分钟

function lowerAddr(a) {
    return (a || '').toLowerCase();
}

// indexed topic 里的地址是 32 字节左填充形态：剥成 20 字节小写（与 data 段解码/
// DB 行/下游 FA·tokenPool 键一致；flap 母版 token 地址走 data 段无此问题——
// gang 三事件 token/trader/quote 全 indexed，必须剥 padding，单测锁定）
function topicAddr(t) {
    return t ? ('0x' + t.slice(-40).toLowerCase()) : t;
}

class GangAnkrWsCollector {
    /**
     * @param {Object} config - 全局配置（读取 config.gangWs 段）
     * @param {Object} logger - 引擎 logger（info/warn/error/debug）
     * @param {Object} tokenPool - TokenPool 实例
     * @param {Object|null} factorAggregator - FourMemeFactorAggregator 实例
     * @param {Object} callbacks - { onTokenCreate(info), onTick(tick), onGraduation(info) } 均可选
     * @param {Object|null} senderResolver - SenderResolver 实例（null=不解析 sender_address，
     *        行为与旧版完全一致——dry-run 脚本传 null）
     */
    constructor(config, logger, tokenPool = null, factorAggregator = null, callbacks = {}, senderResolver = null) {
        this.config = config.gangWs || {};
        this.logger = logger;
        this.tokenPool = tokenPool;
        this._factorAggregator = factorAggregator;
        this._callbacks = callbacks || {};
        this._senderResolver = senderResolver;
        // dry-run：显式丢缓冲不写库 + 跳过 DB quote map 重建（脚本真流验证零 DB）
        this._dryRun = this.config.dryRun === true;

        const contracts = this.config.contracts || {};
        this._launchpad = lowerAddr(contracts.launchpadV2);

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
        // 水位监控（绝不丢行）：超阈告警节流 + 回落恢复 info；默认 10 万行 / 10min 重告
        this._tickAlertThresholdRows = this._tickBufferCfg.alertThresholdRows ?? 100_000;
        this._tickAlertReAlertMs = this._tickBufferCfg.alertReAlertMs ?? 600_000;
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

        // quote map（终态：Created 一次定终身，无 flap 的运行时 QuoteSet）：
        // token → { quote, quoteIsBnb, refPair, gradAmtBnb }
        //   quote=计价币地址（WBNB 或 ERC-20）；quoteIsBnb=true 时 tick 免换算；
        //   gradAmtBnb=毕业阈值 BNB 化（WBNB 盘=gradAmt/1e18；非 WNB 盘=gradAmt×rate，
        //   换算失败 null → FA 侧 ?? 15 兜底）
        this._tokenQuotes = new Map();
        // 未知 token（Created 未见且 DB 重建未命中）的 trade/graduation 暂存队列：
        // 无法区分「BNB 盘」与「映射缺失」，暂存绝不冒充（0xcf91 同款防线）
        this._pendingUnknownTrades = [];
        const qrCfg = this.config.quoteRate || {};
        this._quoteRateTtlMs = qrCfg.ttlMs ?? 30000;
        this._quoteRateStaleMaxMs = qrCfg.staleMaxMs ?? 300000;
        this._quoteRateNegTtlMs = qrCfg.negTtlMs ?? 60000;
        this._quoteMapDbHours = qrCfg.quoteMapDbHours ?? 48; // 启动重建读 wss_events 的窗口
        this._unknownTokenMax = qrCfg.unknownTokenMax ?? 2000;
        this._tokenMapLoadedOnce = false;  // DB 重建只跑一次（重连不重跑）
        this._tokenMapRetryTimer = null;   // 重建失败退避重试定时器（stop 清理）

        // quote→BNB 换算缓存（复制自 flap：TTL + stale-while-revalidate + 负缓存 + inflight 去重）
        this._quoteRates = new Map();
        this._quoteRateInflight = new Map();
        this._quoteDecimalsCache = new Map(); // quote → decimals
        this._pcsFactoryContract = null;      // 惰性（首次换算时建）
        this._pcsV3FactoryContract = null;    // 惰性（V2 miss 时 V3 fallback 用）

        this._tickBuffer = [];
        this._tickFlushTimer = null;
        this._flushInProgress = false;
        this._tickBufferHighWatermark = false; // 当前处于高水位告警态（回落一次性恢复）
        this._tickLastAlertAt = 0;
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
            graduated: 0,
            virtualQuoteLocked: 0,
            nonBnbQuoteSkipped: 0,
            quoteConverted: 0,
            quoteRateUnavailable: 0,
            tokenMapDbLoaded: 0,       // 启动时从 wss_events token_create 重建的 quote map 条数
            unknownTokenPending: 0,    // 未知 token 暂存队列当前长度
            unknownTokenFlushed: 0,    // 重放完成的暂存事件数（累计）
            unknownTokenDropped: 0,    // 暂存队列溢出丢弃数（累计；溢出=Created/DB 重建均不可达）
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
            tickBufferHighWatermarkPeak: 0,
            tickBufferHighWatermarkAlerts: 0,
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
            throw new Error('[GangAnkrWsCollector] 缺少 ankr WSS 端点（config/.env ANKR_WS_URL 或 ANKR_API_KEY）');
        }
        if (!this._launchpad) {
            throw new Error('[GangAnkrWsCollector] 缺少 contracts.launchpadV2（config gangWs 段）');
        }
        this.stats.startTime = Date.now();
        this._connect();

        this._tickFlushTimer = setInterval(() => {
            this._flushTickBuffer();
        }, this._tickFlushIntervalMs);

        this._fetchBnbUsd();
        this._bnbUsdTimer = setInterval(() => this._fetchBnbUsd(), this._bnbUsdRefreshMs);

        this._startHeartbeat();
        this.logger.info('', 'GangAnkrWsCollector', `已启动：LaunchpadV2=${this._launchpad}`);
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
        for (const t of [this._pingTimer, this._heartbeatTimer, this._tickFlushTimer, this._bnbUsdTimer, this._reconnectTimer, this._tokenMapRetryTimer]) {
            if (t) { clearInterval(t); clearTimeout(t); }
        }
        this._pingTimer = this._heartbeatTimer = this._tickFlushTimer = this._bnbUsdTimer = this._reconnectTimer = this._tokenMapRetryTimer = null;

        await this._flushTickBuffer(); // 关闭前把缓冲写完
        // 未知 token 暂存丢弃留痕：计价未知，重放=可能冒充 BNB 价，宁丢不污染
        if (this._pendingUnknownTrades.length) {
            this.logger.warn('', 'GangAnkrWsCollector',
                `停止时未知 token 暂存队列丢弃 ${this._pendingUnknownTrades.length} 条（Created 未见且 DB 重建未命中，计价未知宁丢不污染）`);
            this._pendingUnknownTrades = [];
            this.stats.unknownTokenPending = 0;
        }
        this.logger.info('', 'GangAnkrWsCollector', '已停止', this.stats);
    }

    // ═══════════════ WSS 连接与订阅 ═══════════════

    _connect() {
        this.logger.info('', 'GangAnkrWsCollector',
            `连接 ankr WSS: ${this._wsUrl.replace(/\/ws\/[^/?]+/, '/ws/***')}`);

        this._ws = new WebSocket(this._wsUrl);

        this._ws.on('open', () => {
            this.logger.info('', 'GangAnkrWsCollector', 'WSS 已连接，发送订阅请求');
            this._send({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] });
            // topic0 白名单（ANKR WSS 按推送消息计费）：只订阅五类已知事件；取舍=合约
            // 升级新事件类型不再可发现（unknownTopic0 计数归零），人工诊断时临时去 topics
            this._send({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', { address: [this._launchpad], topics: [Array.from(TOPIC0_MAP.keys())] }] });

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
                this.logger.error('', 'GangAnkrWsCollector', `消息处理异常: ${err.message}`);
            }
        });

        this._ws.on('error', (err) => {
            this.logger.error('', 'GangAnkrWsCollector', `WSS 错误: ${err.message}`);
        });

        this._ws.on('close', (code, reason) => {
            this.logger.warn('', 'GangAnkrWsCollector', `WSS 关闭: ${code} ${reason?.toString() || ''}`);
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
                // 首次订阅成功后从 wss_events 重建 quote map（48h 窗）——否则冷启动窗口内
                // 停机期创建 token 的 trade 全部暂存。只跑一次（重连不重跑）；失败退避重试，
                // 期间未知 token trade 暂存兜底（见 _processLog）
                if (!this._tokenMapLoadedOnce && !this._dryRun) {
                    this._tokenMapLoadedOnce = true;
                    this._scheduleTokenMapLoad();
                }
            }
            if (msg.id === 1 || msg.id === 2) {
                this.logger.info('', 'GangAnkrWsCollector', `订阅确认 id=${msg.id} subId=${msg.result}`);
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
            this.logger.warn('', 'GangAnkrWsCollector', `RPC 错误帧: ${JSON.stringify(msg.error).slice(0, 200)}`);
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
            return; // 白名单订阅下不应出现（新事件类型发现的盲化代价，见 _connect 注释）
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
            if (eventName === 'Created') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(CREATE_DATA_TYPES, data);
                this.stats.tokenCreated++;
                const token = topicAddr(logEntry.topics[1]);
                const creator = topicAddr(logEntry.topics[2]);
                const quote = topicAddr(logEntry.topics[3]);
                // topicAddr 产小写地址：WBNB 比较须同域（checksum 常量直比恒 false）
                const quoteIsBnb = quote === ZERO_ADDRESS || quote === WBNB_BSC.toLowerCase();
                const refPair = lowerAddr(d[4]);
                const gradAmtQuote = Number(ethers.formatEther(d[5]));
                // 毕业阈值 BNB 化：WBNB 盘=gradAmt/1e18 直取（实测恒 15）；非 WNB 盘
                // refPair/三级源换算一次（换算失败 null——FA 侧 ?? 15 兜底，宁 null 不冒充）
                let gradAmtBnb = null;
                if (quoteIsBnb) {
                    gradAmtBnb = gradAmtQuote;
                } else {
                    const conv = await this._getQuoteConversion(quote, refPair);
                    gradAmtBnb = conv ? gradAmtQuote * conv.rate : null;
                    if (!conv) {
                        this.stats.quoteRateUnavailable++;
                        this.logger.warn('', 'GangAnkrWsCollector',
                            `非 WNB 盘毕业阈值换算失败（FA 侧按 15 兜底）: token=${token} quote=${quote} gradAmt=${gradAmtQuote}`);
                    }
                }
                // quote map 终态登记（先于暂存重放——同 tx 紧随的 Buy 立即可判计价）
                this._tokenQuotes.set(token, { quote, quoteIsBnb, refPair, gradAmtBnb });
                this._handleTokenCreate({
                    token,
                    creator,
                    name: d[0],
                    symbol: d[1],
                    logoUri: d[2],        // https://cdn.gang.fun/ipfs/…（叙事语料/展示用）
                    taxed: d[3] === true,  // taxed 币（内盘行为不受影响，仅标记不过滤）
                    quote,
                    quoteIsBnb,
                    refPair,
                    gradAmtBnb,
                    gradAmtQuote,          // quote 单位原值（存档/审计）
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                    logIndex: parseInt(logEntry.logIndex, 16),
                });
                // 该 token 的暂存重放（乱序防御：正常时序 Created logIndex 先于首 Buy，
                // 暂存为空集直接返回）
                await this._flushUnknownTokenTrades(token);
                return;
            }

            if (eventName === 'Buy' || eventName === 'Sell') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(TRADE_DATA_TYPES, data);
                const token = topicAddr(logEntry.topics[1]);
                const trader = topicAddr(logEntry.topics[2]);
                const q = this._tokenQuotes.get(token);
                if (q === undefined) {
                    this._stashUnknownTokenTrade(logEntry, blockTimeSec, token);
                    return;
                }
                const isBuy = eventName === 'Buy';
                // 净额口径（实测）：Buy dw0=净入金 dw3=tokensOut；Sell dw0=tokensIn dw3=净收款
                const tokenAmount = Number(ethers.formatEther(isBuy ? d[3] : d[0]));
                let bnbAmount = Number(ethers.formatEther(isBuy ? d[0] : d[3]));
                let priceBnb;
                let quoteToken = null;
                if (q.quoteIsBnb) {
                    priceBnb = bnbAmount / tokenAmount;
                } else {
                    const conv = await this._getQuoteConversion(q.quote, q.refPair);
                    if (!conv) {
                        this.stats.nonBnbQuoteSkipped++;
                        return; // 无池/汇率不可得：跳过（宁漏不污染 price_bnb 口径）
                    }
                    bnbAmount *= conv.rate;
                    priceBnb = bnbAmount / tokenAmount;
                    quoteToken = q.quote;
                    this.stats.quoteConverted++;
                }
                if (isBuy) this.stats.tokenBought++;
                else this.stats.tokenSold++;

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
                    tradeType: isBuy ? 'buy' : 'sell',
                    trader,
                    priceBnb,
                    tokenAmount,
                    bnbAmount,
                    quoteToken,
                    // gang 事件无 offers/funds 字段：不传（FA 的 `> 0` 守卫容忍 undefined，tvl 因子恒 0）
                    blockNumber,
                    blockTimeMs,
                    txHash: logEntry.transactionHash,
                    logIndex: parseInt(logEntry.logIndex, 16),
                });
                return;
            }

            if (eventName === 'Graduated') {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(GRADUATED_DATA_TYPES, data);
                const token = topicAddr(logEntry.topics[1]);
                const q = this._tokenQuotes.get(token);
                if (q === undefined) {
                    this._stashUnknownTokenTrade(logEntry, blockTimeSec, token);
                    return;
                }
                this.stats.graduated++;
                // quoteAmount 为 quote 单位毕业资金（实证==Created gradAmt 阈值搬运量）：
                // WBNB 盘直取；非 WNB 盘换算成 BNB 落 fundsBnb；换算不可得时 fundsBnb=null
                // + fundsQuote 留原值（诚实语义不冒充）。事件不带 PCS pair（word0 是 quote）
                let fundsBnb = Number(ethers.formatEther(d[2]));
                let fundsQuote = null;
                let quoteToken = null;
                if (!q.quoteIsBnb) {
                    fundsQuote = fundsBnb;
                    quoteToken = q.quote;
                    const conv = await this._getQuoteConversion(q.quote, q.refPair);
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
                this.logger.info('', 'GangAnkrWsCollector',
                    `毕业事件: token=${token} quote=${lowerAddr(d[0])} funds=${fundsDesc} tx=${logEntry.transactionHash}`);
                if (this._callbacks.onGraduation) {
                    this._callbacks.onGraduation({
                        token,
                        tokenAmount: Number(ethers.formatEther(d[1])),
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

            if (eventName === 'VirtualQuoteLocked') {
                // 内盘虚拟 quote 锁定量（毕业迁移 PCS 时锁定的虚拟储备）：仅计数观察
                this.stats.virtualQuoteLocked++;
                return;
            }
        } catch (err) {
            this.stats.decodeFailed++;
            this.logger.error('', 'GangAnkrWsCollector',
                `[${eventName}] 解码失败: ${err.message} tx=${logEntry.transactionHash}`);
        }
    }

    // ═══════════════ 未知 token 暂存队列（计价未知宁丢不污染） ═══════════════

    _stashUnknownTokenTrade(logEntry, blockTimeSec, token) {
        this._pendingUnknownTrades.push({ logEntry, blockTimeSec, token });
        if (this._pendingUnknownTrades.length > this._unknownTokenMax) {
            // 溢出丢最老（保序 + 保留贴近可判定点的最新数据）；溢出 = Created 不可达
            //（早于订阅/DB 48h 窗）且重建持续未成，fail-loud 计数供人工排查
            const dropped = this._pendingUnknownTrades.splice(
                0, this._pendingUnknownTrades.length - this._unknownTokenMax);
            this.stats.unknownTokenDropped += dropped.length;
            if (this.stats.unknownTokenDropped === 1 || this.stats.unknownTokenDropped % 1000 === 0) {
                this.logger.error('', 'GangAnkrWsCollector',
                    `未知 token 暂存队列溢出（上限 ${this._unknownTokenMax}）：已丢弃 ${this.stats.unknownTokenDropped} 条最老事件——Created 不可达或 DB quote map 重建持续失败`);
            }
        }
        this.stats.unknownTokenPending = this._pendingUnknownTrades.length;
    }

    /**
     * 重放暂存的未知 token 事件（Created 到达触发单 token 重放 / DB 重建完成触发全局重放）。
     * 串行按暂存序重放保 tick 顺序；重放中仍未知（map miss）的项会重新入队尾（保序），
     * 由溢出丢最老语义收敛。_processLog 内部全 catch，单条失败不中断余下重放。
     */
    async _flushUnknownTokenTrades(tokenFilter = null) {
        if (!this._pendingUnknownTrades.length) return;
        const replay = [];
        const remain = [];
        for (const item of this._pendingUnknownTrades) {
            if (tokenFilter && item.token !== tokenFilter) remain.push(item);
            else replay.push(item);
        }
        this._pendingUnknownTrades = remain;
        this.stats.unknownTokenPending = remain.length;
        if (!replay.length) return;
        this.stats.unknownTokenFlushed += replay.length;
        this.logger.info('', 'GangAnkrWsCollector',
            `未知 token 暂存重放: ${replay.length} 条（${tokenFilter ? `token=${tokenFilter}` : 'DB 重建完成·全局'}）`);
        for (const item of replay) {
            await this._processLog(item.logEntry, item.blockTimeSec);
        }
        this.stats.unknownTokenPending = this._pendingUnknownTrades.length;
    }

    // ═══════════════ quote map 启动重建（wss_events token_create，48h 窗） ═══════════════

    /**
     * 启动重建调度：失败退避重试（30s 起 ×2 上限 5min，不设轮次上限）。重建缺失不是
     * 无害缺口——停机期创建 token 的 trade 计价无法判定，一律暂存；重试成功后
     * _flushUnknownTokenTrades() 全局重放，数据不丢。
     */
    _scheduleTokenMapLoad(retryDelayMs = 0) {
        this._loadTokenMapFromDb()
            .then(() => this._flushUnknownTokenTrades())
            .catch((err) => {
                const nextDelayMs = retryDelayMs === 0 ? 30000 : Math.min(retryDelayMs * 2, 300000);
                this.logger.warn('', 'GangAnkrWsCollector',
                    `quote map 启动重建失败(${Math.round(nextDelayMs / 1000)}s 后重试): ${err.message}`);
                this._tokenMapRetryTimer = setTimeout(
                    () => this._scheduleTokenMapLoad(nextDelayMs), nextDelayMs);
            });
    }

    /**
     * 从 wss_events 加载 token_create（kind='token_create', platform='gang'）重建 quote map。
     * quote 在 Created 终态固定（无 flap 的 QuoteSet 单调去重需求）；多实验并发写的重复
     * 行幂等（set 同值）。实时 Created 已在册的 token 不覆盖（实时事件是正源）。
     * @returns {Promise<number>} 重建条数
     */
    async _loadTokenMapFromDb() {
        let supabase = this._supabase;
        if (!supabase) {
            const { dbManager } = require('../services/dbManager');
            supabase = dbManager.getClient();
        }
        const sinceIso = new Date(Date.now() - this._quoteMapDbHours * 3600 * 1000).toISOString();
        const rows = [];
        let afterId = 0;
        for (;;) {
            const { data: page, error } = await supabase.from('wss_events')
                .select('id, payload')
                .eq('kind', 'token_create')
                .eq('platform', 'gang')
                .gte('block_time', sinceIso)
                .gt('id', afterId)
                .order('id', { ascending: true })
                .limit(1000);
            if (error) throw new Error(error.message);
            if (!page || !page.length) break;
            rows.push(...page);
            afterId = page[page.length - 1].id;
            if (page.length < 1000) break;
        }
        let applied = 0;
        for (const r of rows) {
            const p = r.payload || {};
            if (!p.token || typeof p.quote !== 'string') continue;
            if (this._tokenQuotes.has(p.token)) { applied++; continue; } // 实时 Created 正源不覆盖
            this._tokenQuotes.set(p.token, {
                quote: lowerAddr(p.quote),
                quoteIsBnb: p.quoteIsBnb === true,
                refPair: p.refPair ? lowerAddr(p.refPair) : null,
                gradAmtBnb: typeof p.gradAmtBnb === 'number' ? p.gradAmtBnb : null,
            });
            applied++;
        }
        this.stats.tokenMapDbLoaded = applied;
        this.logger.info('', 'GangAnkrWsCollector',
            `quote map 启动重建: 窗=${this._quoteMapDbHours}h 行=${rows.length} 应用=${applied} 总在册=${this._tokenQuotes.size}`);
        return applied;
    }

    // ═══════════════ 非 BNB 计价：quote→BNB 换算（源⓪~③，①②③复制自 flap） ═══════════════

    /**
     * 取 quote→BNB 汇率（TTL 缓存 + stale-while-revalidate + 负缓存 + inflight 去重）。
     * @param {string} quote - 计价币地址
     * @param {string|null} refPair - Created 携带的平台参考池（源⓪；同 token 终态恒同值）
     * @returns {Promise<{rate:number}|null>} null=无池/无储备/负缓存期内（调用方跳过该 tick）
     */
    async _getQuoteConversion(quote, refPair = null) {
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
                this._refreshQuoteRate(quote, refPair).catch(() => {});
                return { rate: cached.rate };
            }
        }
        return this._refreshQuoteRate(quote, refPair);
    }

    /**
     * 刷新汇率（inflight 去重；同 quote 并发共享同一 Promise——注册序即完成序，
     * 同 token 的 tick 序列在换算点保序）。内部全 catch 绝不 reject：
     * _processLog 的 await 段需要这层保护（unhandled rejection 会崩进程）。
     */
    async _refreshQuoteRate(quote, refPair = null) {
        const inflight = this._quoteRateInflight.get(quote);
        if (inflight) return inflight;

        const p = (async () => {
            try {
                const rate = await this._fetchQuoteRateFromRpc(quote, refPair);
                this._quoteRates.set(quote, { rate, fetchedAtMs: Date.now(), negative: rate == null });
                return rate == null ? null : { rate };
            } catch (err) {
                this.logger.warn('', 'GangAnkrWsCollector',
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
     * 链上汇率源链（gang 版：源⓪ refPair → flap 同款三级源）：
     * ⓪ Created 携带的 refPair 参考池直读（仅当池两侧恰为 {quote,WBNB}——bridge 池
     *    另一侧非 WBNB 时 miss 走三级源，宁 miss 不冒充）：V2 reserves / V3 slot0+liquidity>0
     * ① PancakeSwap V2 factory quote/WBNB getPair → getReserves
     * ② V3 quote/WBNB 各 fee 档 → liquidity>0 中最深池 slot0（零流动性挂价池不可信）
     * ③ V3 quote/USDT 各 fee 档（同上门槛）→ USDT 价 ÷ bnbUsd → BNB 价
     * rate = 1 quote 值多少 BNB；全 miss → null。
     */
    async _fetchQuoteRateFromRpc(quote, refPair = null) {
        this._ensurePcsContracts();
        if (refPair && refPair !== ZERO_ADDRESS) {
            const viaRef = await this._fetchQuoteRateViaRefPair(refPair, quote);
            if (viaRef != null) return viaRef;
        }
        const rateV2 = await this._fetchQuoteRateV2(quote);
        if (rateV2 != null) return rateV2;
        const rateV3Wbnb = await this._fetchQuoteRateV3(quote, WBNB_BSC);
        if (rateV3Wbnb != null) return rateV3Wbnb;
        const bnbUsd = this._bnbUsd;
        if (bnbUsd <= 0) return null; // USDT 中转依赖 bnbUsd；未就绪走负缓存，下周期重试
        const usdtPerQuote = await this._fetchQuoteRateV3(quote, USDT_BSC);
        if (usdtPerQuote == null) return null;
        return usdtPerQuote / bnbUsd;
    }

    /**
     * 源⓪：refPair 参考池直读。先按 V2 池试（getReserves/token0/token1），revert 或
     * 两侧不含 {quote,WBNB} 再按 V3 池试（liquidity>0 门 + slot0）。两侧形状不匹配
     * （bridge 池另一侧非 WBNB）→ null 走三级源，绝不按未知对冒充。
     */
    async _fetchQuoteRateViaRefPair(refPair, quote) {
        const other = WBNB_BSC.toLowerCase(); // 与 lowerAddr(token0/token1) 同域比较
        // V2 尝试
        try {
            const pairContract = new ethers.Contract(refPair, PAIR_ABI, this._pcsProvider);
            const [reserves, token0, token1] = await Promise.all([
                pairContract.getReserves(), pairContract.token0(), pairContract.token1()]);
            const [reserve0, reserve1] = reserves; // bigint（uint112）
            if (reserve0 === 0n || reserve1 === 0n) return null; // 无流动性
            const t0 = lowerAddr(token0), t1 = lowerAddr(token1);
            if (t0 === quote && t1 === other) {
                const rate = await this._pairReserveRate(reserve0, reserve1, quote);
                if (rate != null) return rate;
            } else if (t0 === other && t1 === quote) {
                const rate = await this._pairReserveRate(reserve1, reserve0, quote);
                if (rate != null) return rate;
            }
        } catch { /* 非 V2 池（revert）→ 试 V3 */ }
        // V3 尝试
        try {
            const poolContract = new ethers.Contract(refPair, V3_POOL_ABI, this._pcsProvider);
            const [liq, slot0, token0, token1] = await Promise.all([
                poolContract.liquidity(), poolContract.slot0(), poolContract.token0(), poolContract.token1()]);
            if (liq <= 0n) return null; // 零流动性挂价池不可信（flap V3 同门）
            const sqrtP = slot0.sqrtPriceX96;
            if (!sqrtP || sqrtP <= 0n) return null;
            const t0 = lowerAddr(token0), t1 = lowerAddr(token1);
            if (t0 !== quote && t1 !== quote) return null;
            if (t0 !== other && t1 !== other) return null;
            const raw = Math.pow(Number(sqrtP) / Math.pow(2, 96), 2); // token1_raw/token0_raw
            const decimals = await this._quoteDecimalsOf(quote);
            let wbnbPerQuote;
            if (t0 === quote) {
                wbnbPerQuote = raw * Math.pow(10, decimals - 18); // token1=WBNB
            } else {
                wbnbPerQuote = 1 / (raw * Math.pow(10, 18 - decimals)); // token0=WBNB，raw=quote_per_wbnb
            }
            if (!(wbnbPerQuote > 0)) return null;
            this.logger.info('', 'GangAnkrWsCollector',
                `quote 汇率源=⓪refPair V3: quote=${quote} refPair=${refPair} rate=${wbnbPerQuote}`);
            return wbnbPerQuote;
        } catch { /* 非 V3 池（revert）→ 走三级源 */ }
        return null;
    }

    /** V2 reserves → WBNB/quote 汇率（quote 储备、WBNB 储备均为 bigint raw，decimals 归一） */
    async _pairReserveRate(quoteReserve, wbnbReserve, quote) {
        const decimals = await this._quoteDecimalsOf(quote);
        const decExp = 10n ** BigInt(decimals);
        const rate = Number(wbnbReserve * decExp) / Number(quoteReserve * 10n ** 18n);
        if (!(rate > 0)) return null;
        this.logger.info('', 'GangAnkrWsCollector',
            `quote 汇率源=⓪refPair V2: quote=${quote} rate=${rate}`);
        return rate;
    }

    /** 惰性创建换算用 provider + V2/V3 factory 合约 */
    _ensurePcsContracts() {
        if (this._pcsFactoryContract) return;
        const { BlockchainConfig } = require('../utils/BlockchainConfig');
        const rpcUrl = BlockchainConfig.CHAIN_CONFIGS.bsc.network.rpcUrl;
        this._pcsProvider = new ethers.JsonRpcProvider(rpcUrl);
        this._pcsFactoryContract = new ethers.Contract(PCS_V2_FACTORY, FACTORY_ABI, this._pcsProvider);
        this._pcsV3FactoryContract = new ethers.Contract(PCS_V3_FACTORY, V3_FACTORY_ABI, this._pcsProvider);
    }

    /**
     * 源①：PancakeSwap V2 quote/WBNB 池 reserves。
     * rate = WBNB 储备 / quote 储备（各自按 decimals 归一到 whole-token 单位）。
     * 无池（零地址）/储备为 0 → null。
     */
    async _fetchQuoteRateV2(quote) {
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

    /**
     * 源②③：PancakeSwap V3 quote/other（WBNB 或 USDT）各 fee 档。
     * liquidity>0 的池中取 liquidity 最大者（同一对 token 的 L 量纲可比），
     * slot0 sqrtPriceX96 换算 other-per-quote（decimals 归一）。
     * @returns {Promise<number|null>} other 计价的 1 quote 价格；无可用池 → null
     */
    async _fetchQuoteRateV3(quote, other) {
        const candidates = [];
        for (const fee of V3_FEE_TIERS) {
            const pool = await this._pcsV3FactoryContract.getPool(quote, other, fee);
            if (!pool || pool === ethers.ZeroAddress) continue;
            const poolContract = new ethers.Contract(pool, V3_POOL_ABI, this._pcsProvider);
            const liq = await poolContract.liquidity();
            if (liq > 0n) candidates.push({ pool, fee, liq, poolContract });
        }
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => (b.liq > a.liq ? 1 : b.liq < a.liq ? -1 : 0));
        const best = candidates[0];
        const [slot0, token0] = await Promise.all([best.poolContract.slot0(), best.poolContract.token0()]);
        const sqrtP = slot0.sqrtPriceX96;
        if (!sqrtP || sqrtP <= 0n) return null;
        // V3 价格 = (sqrtP/2^96)^2 = token1_raw/token0_raw（sqrtP ~2e26，Number 相对误差 1e-16 级）
        const raw = Math.pow(Number(sqrtP) / Math.pow(2, 96), 2);
        const decimals = await this._quoteDecimalsOf(quote);
        const otherDecimals = 18; // WBNB 恒 18；BSC USDT(0x55d3…) 也是 18
        let otherPerQuote;
        if (lowerAddr(token0) === quote) {
            otherPerQuote = raw * Math.pow(10, decimals - otherDecimals); // token1=other
        } else {
            otherPerQuote = 1 / (raw * Math.pow(10, otherDecimals - decimals)); // token0=other，raw=quote_per_other
        }
        if (!(otherPerQuote > 0)) return null;
        this.logger.info('', 'GangAnkrWsCollector',
            `quote 汇率源=PCS V3 ${other === USDT_BSC ? 'USDT 中转' : 'WBNB'}: quote=${quote} pool=${best.pool} fee=${best.fee} rate(other)=${otherPerQuote}`);
        return otherPerQuote;
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

    // ═══════════════ Created：发现 ═══════════════

    _handleTokenCreate(info) {
        // 注册到 FactorAggregator（代币年龄基准 = 创建事件块时间；totalSupply 供 marketCap；
        // graduationThresholdBnb 供 gang 资金口径毕业进度——FA 侧 set-once）
        if (this._factorAggregator) {
            this._factorAggregator.registerToken(info.token, {
                createdAtMs: info.blockTimeMs,
                totalSupply: GANG_TOTAL_SUPPLY,
                name: info.name,
                symbol: info.symbol,
                creatorAddress: info.creator,
                platform: 'gang',
                graduationThresholdBnb: info.gradAmtBnb,
            });
        }

        const existing = this.tokenPool ? this.tokenPool.getToken(info.token, 'bsc') : null;
        if (!existing && this.tokenPool) {
            const added = this.tokenPool.addToken({
                token: info.token,
                chain: 'bsc',
                platform: 'gang',
                data_source: 'wss',
                name: info.name || '',
                symbol: info.symbol || '',
                created_at: Math.floor(info.blockTimeMs / 1000),
                current_price_usd: null,
                creator_address: info.creator,
            });
            if (added) {
                this.stats.tokensAddedToPool++;
                this.logger.info('', 'GangAnkrWsCollector',
                    `新代币入池: ${info.symbol || info.name || ''} ${info.token}${info.taxed ? ' [taxed]' : ''} creator=${info.creator} block=${info.blockNumber}`);
            }
        }

        if (this._callbacks.onTokenCreate) {
            this._callbacks.onTokenCreate(info);
        }
    }

    // ═══════════════ tick：单一咽喉点三路输出 ═══════════════

    _emitTick(decoded) {
        // WSS 快速回执信号：成交 tick 到达即通知——先于 tokenPool/resolver 一切后续处理，
        // 恒同步零延迟（live 引擎注册；未注册时零成本 no-op。gang 本期无 live，接线保留）
        if (this._onTickEmitted) this._onTickEmitted(decoded.txHash);

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
            // 真实交易发起者 tx.from（gang 实测 tx.from == 事件 trader——BAW 直接发起）。
            // resolver 未启用/反查耗尽 → NULL；wallet 段回推补真值（口径地图同 flap）
            sender_address: null,
            price_bnb: decoded.priceBnb,
            price_usd: priceUsd,
            bnb_amount: decoded.bnbAmount,
            token_amount: decoded.tokenAmount,
            price_outlier: false,
            block_number: decoded.blockNumber,
            block_time: new Date(decoded.blockTimeMs).toISOString(),
            received_at: new Date(receivedAt).toISOString(),
            platform: 'gang',
            // 非 WNB 计价盘的计价币（price_bnb/bnb_amount 已按 quote→BNB 汇率换算；WBNB 盘 null）
            quote_token: decoded.quoteToken ?? null,
        };
        if (this._senderResolver) {
            // 两阶段喂食（同 flap：价格段 WSS 到达即喂，wallet 段等 sender 定值后补喂）
            const priceFa = this._feedFa(decoded, tickRow, priceUsd, { deferWallet: true });
            this._senderResolver.submit({
                tickRow,
                trader: decoded.trader,
                txHash: decoded.txHash,
                pushRow: (row) => { this._feedWallet(decoded, row, priceUsd, priceFa); this._pushTickRow(row); },
            });
        } else {
            this._feedFa(decoded, tickRow, priceUsd);
            this._pushTickRow(tickRow);
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

    /**
     * FA 喂食价格段 + 离群价回写（复制自 flap）。尘 tick（< minTickBnb）不进因子计算，
     * 仍照常落表；gang 事件无 offers/funds 字段不传（tvl 恒 0，与回测口径一致）。
     */
    _feedFa(decoded, tickRow, priceUsd, opts = {}) {
        if (!this._factorAggregator || decoded.bnbAmount < this._minTickBnb) return null;
        const faResult = this._factorAggregator.processTick({
            token_address: decoded.token,
            trade_type: decoded.tradeType,
            trader_address: decoded.trader,
            sender_address: tickRow.sender_address || null,
            price_bnb: decoded.priceBnb,
            price_usd: priceUsd,
            bnb_amount: decoded.bnbAmount,
            token_amount: decoded.tokenAmount,
            block_number: decoded.blockNumber,
            timestamp: decoded.blockTimeMs,
            tx_hash: decoded.txHash,
            log_index: decoded.logIndex,
        }, opts);
        // FA 离群价判定回写落表行（行入 buffer 前定值 → INSERT 携带最终 flag）
        if (faResult && faResult.priceOutlier) {
            tickRow.price_outlier = true;
        }
        return faResult;
    }

    /** FA 喂食 wallet 段（两阶段喂食第二段，复制自 flap；state 缺失 FA 侧懒建） */
    _feedWallet(decoded, tickRow, priceUsd, priceFa) {
        if (!this._factorAggregator || decoded.bnbAmount < this._minTickBnb) return null;
        return this._factorAggregator.applyWalletTick({
            token_address: decoded.token,
            trade_type: decoded.tradeType,
            trader_address: decoded.trader,
            sender_address: tickRow.sender_address || null,
            price_bnb: decoded.priceBnb,
            price_usd: priceUsd,
            bnb_amount: decoded.bnbAmount,
            token_amount: decoded.tokenAmount,
            block_number: decoded.blockNumber,
            timestamp: decoded.blockTimeMs,
            tx_hash: decoded.txHash,
            log_index: decoded.logIndex,
            price_accepted: priceFa ? priceFa.priceAccepted === true : false,
        });
    }

    /** tick 行进缓冲（resolver 回推与直推共用的单一咽喉点） */
    _pushTickRow(tickRow) {
        this.stats.ticksBuffered++;
        this._tickBuffer.push(tickRow);
        // TPA live 缓冲钩子：行 push 后同步喂，此时 sender_address 已定值
        if (this._onTickBuffered) this._onTickBuffered(tickRow);
        if (this._tickBuffer.length >= this._tickFlushThreshold) {
            this._flushTickBuffer();
        }
        this._checkTickBufferWatermark();
    }

    /**
     * tickBuffer 水位监控（O(1)，绝不丢行）：超阈 error 告警（节流重告）+ 峰值/计数入
     * stats；回落阈值下一次 push 时恢复 info 恰一次。
     */
    _checkTickBufferWatermark() {
        const len = this._tickBuffer.length;
        if (len >= this._tickAlertThresholdRows) {
            const now = Date.now();
            if (now - this._tickLastAlertAt >= this._tickAlertReAlertMs) {
                this._tickLastAlertAt = now;
                this._tickBufferHighWatermark = true;
                this.stats.tickBufferHighWatermarkPeak = Math.max(this.stats.tickBufferHighWatermarkPeak, len);
                this.stats.tickBufferHighWatermarkAlerts++;
                this.logger.error('', 'GangAnkrWsCollector',
                    `[TickBuffer高水位] buffer=${len} 阈值=${this._tickAlertThresholdRows} 累计写失败=${this.stats.ticksFlushFailed}——落库速度跟不上，绝不丢行`);
                if (this._onTickBufferHighWatermark) {
                    try { this._onTickBufferHighWatermark(len); } catch { /* 回调失败不影响采集 */ }
                }
            }
        } else if (this._tickBufferHighWatermark) {
            this._tickBufferHighWatermark = false;
            this.logger.info('', 'GangAnkrWsCollector',
                `[TickBuffer高水位恢复] buffer=${len} 已回落至阈值 ${this._tickAlertThresholdRows} 以下`);
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
                this.logger.warn('', 'GangAnkrWsCollector',
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
                this.logger.warn('', 'GangAnkrWsCollector',
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
            this.logger.warn('', 'GangAnkrWsCollector', `BNB/USD 获取失败(沿用缓存 ${this._bnbUsd}): ${err.message}`);
        }
    }

    // ═══════════════ 心跳与重连 ═══════════════

    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this.logger.warn('', 'GangAnkrWsCollector', 'WebSocket 未连接，触发重连');
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
        this.logger.warn('', 'GangAnkrWsCollector', '强制重连（断流守护触发）');
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

        this.logger.info('', 'GangAnkrWsCollector',
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
            tokenQuoteMapSize: this._tokenQuotes.size,
            uptimeSeconds: this.stats.startTime
                ? Math.floor((Date.now() - this.stats.startTime) / 1000)
                : 0,
            // 未匹配 topic0 的分布（dry-run 验证事件签名覆盖用）
            unknownTopic0: Object.fromEntries(this._unknownTopic0Counts),
        };
    }
}

module.exports = { GangAnkrWsCollector, TOPIC0_MAP, GANG_TOTAL_SUPPLY };
