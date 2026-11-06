/**
 * SenderResolver —— wss_price_ticks.sender_address（真实交易发起者）解析器
 * （2026-09-30 0x1de460 公共路由案；2026-11-04 块预取 join + GMGN 路由事件映射改造）
 *
 * 背景：flap TokenBought/TokenSold 与 four.meme TokenPurchase/TokenSale 事件的
 * trader 参数是 msg.sender（合约直接调用者）。用户经公共路由（0x1de460…，全 flap
 * ~28.8% 行）交易时 trader_address 落的是 router 合约地址——top1 买入集中度 /
 * sniper 持仓 / TPA 钱包画像全被污染。WSS logs 推送对象只有 transactionHash 钥匙
 * （eth_subscribe 规范无 from 字段，execution-apis#611 提案未实现），真实买家 =
 * 交易对象的 tx.from（BSC 上恒为 EOA，4337 bundler 场景同样）。
 *
 * 方案 X（延迟入 buffer）：_emitTick 构造 tickRow 后分流——
 *   - EOA 缓存命中 → sender=trader 同步直进 buffer（零延迟，大多数行）
 *   - 合约缓存命中 / 未知 → 暂存 resolver，resolve 完成后回推 collector._pushTickRow
 *     （单次 upsert 全字段，省掉回填 UPDATE；代价 = 合约行落库延迟 ~0.3-1s，
 *     vs 90s 因子窗无感）。FA processTick / TokenPool 价格更新不受影响（只有 DB
 *     落库延迟）；price_outlier 回写在 _emitTick 同步段完成，异步回推时已定值
 *
 * 解析链（2026-11-04 起，逐级降级；此前=逐行 getCode 判型 + getTransaction 串行回查；
 * 2026-11-06 CD377 块 join 裸调修复 + 映射竞态复查）：
 *   0) EOA kind 缓存命中 → submit 内同步直推（零延迟零 RPC）
 *   1) 路由事件映射（collector 订阅路由自 emit 事件，topics/data 直接带用户 EOA——
 *      链上实证 24/24 笔 tx.from 恒在 topics 零例外；事件晚于 trade 事件几十 ms
 *      到达，miss 不等待直接走 2）：命中零 RPC
 *   2) txFrom 缓存（同 tx 多 log 共享一次回查结果）
 *   3) 块预取 join（lazy per-block）：同块全部未定值行共享一次
 *      eth_getBlockByNumber(full=true)（CD377：裸调 p.send——ethers getBlock(n,true)
 *      抽象路径实测恒返回 hash 数组致 join 自上线起静默失效一周，blockJoinRows=0），
 *      块 map 到 → 全簇 join；**from 恒 EOA ⇒ sender=from 即答案，getCode 判型链退役**
 *      （EOA 直连时 from===trader 同样正确）。三类失败分治：null block（RPC 端点 lag，
 *      ankr 领先）→ throw 逐出缓存计 blockNotFound 不 failover；形状退化（200-OK 但
 *      transactions=hash 数组/非数组）→ fn 内 throw 走端点 failover，全端点退化 →
 *      该块负缓存（空 Map 留缓存防同块重拉风暴）+ blockShapeDegrades + 连续退化
 *      熔断停预取；网络错误 → failover 后 reject 逐出缓存（现状）
 *   4) 单行 getTransactionByHash fallback（块结果无该 txHash=重组/边缘，或块拉取失败）
 *   5) 重试 retryLimit 次耗尽 → sender=NULL 回推（保数据丢修复，绝不丢行）
 *   路由映射复查（CD377）：3) 块路径未定值后与 4) 单行未定值后各复查一次 map——
 *   RPC 往返窗（100-300ms）内路由事件（几十 ms 到达）几乎必然已进 map，复查零新增
 *   延迟接住竞态 miss（routerMapLateHits/routerMapRetryHits）；与块 join 语义互补：
 *   ankr 领先端点（join null）→ 复查命中；ankr 落后 → 事件先到即时命中或 join 直接定值
 *
 * per-token 观测（waitTokenIdle/pendingFor）：enq/done 双计数 watermark，供
 * CheatCheckService 事件驱动 settle（等 per-token 队列清空而非固定 4s）。
 *
 * 失败语义（绝不污染）：
 *   - 块拉取/单行失败 → 逐级降级不冒充；重试耗尽 → sender=NULL 回推（保数据丢修复）
 *   - 暂存满 backlogLimit → 最老行 NULL 强制落库（同上）
 *
 * 共享实例：引擎进程构造一个传入各 collector（both 实验双平台共享，钱包跨平台
 * 交易 kind 缓存利用率更高）。路由事件映射同挂本实例（双 collector 订阅幂等写）。
 */

'use strict';

const { ethers } = require('ethers');

const KIND_EOA = 'eoa'; // kindCache 唯一值域（getCode 判型随块预取 join 退役——
// 合约 trader 无需显式标记：未知即入队，块 join/单行反查直接拿 tx.from 定值）

// 默认 RPC 池：binance dataseed 多域名轮询 + per-call failover（免费、单发调用不限）
const DEFAULT_RPC_URLS = [
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed2.defibit.io/',
];

/**
 * 从 env 推导 ankr HTTP 端点（同 flap collector _resolveBackfillRpcUrl 先例）：
 * ANKR_WS_URL 尾段（无 key 的 'ws' 不合格）→ ANKR_API_KEY → null。
 */
function resolveAnkrHttpUrlFromEnv() {
    const wsUrl = process.env.ANKR_WS_URL || '';
    const wsKey = wsUrl.split('/').pop();
    const key = (wsKey && wsKey.length >= 20 ? wsKey : '')
        || (process.env.ANKR_API_KEY && process.env.ANKR_API_KEY.length >= 20 ? process.env.ANKR_API_KEY : '');
    return key ? `https://rpc.ankr.com/bsc/${key}` : null;
}

class SenderResolver {
    /**
     * @param {Object} cfg - config.senderResolve 段（enabled 由引擎侧判定，构造即工作）
     * @param {Object} logger - { info, warn, error }
     */
    constructor(cfg, logger) {
        this._cfg = cfg || {};
        this._logger = logger || console;

        this._rpcMode = this._cfg.rpcMode || 'urls';
        this._rpcUrlsCfg = Array.isArray(this._cfg.rpcUrls) ? this._cfg.rpcUrls : null;
        this._concurrency = this._cfg.concurrency ?? 4;
        this._backlogLimit = this._cfg.backlogLimit ?? 20000;
        this._retryLimit = this._cfg.retryLimit ?? 2;
        this._retryDelayMs = this._cfg.retryDelayMs ?? 3000;
        this._kindCacheLimit = this._cfg.kindCacheLimit ?? 200000;
        this._txFromCacheLimit = this._cfg.txFromCacheLimit ?? 50000;
        this._logEvery = this._cfg.logEvery ?? 10000;
        // 2026-11-04 块预取 join + 路由事件映射 + per-call 超时
        this._blockCacheLimit = this._cfg.blockCacheLimit ?? 16;
        this._routerEventMapLimit = this._cfg.routerEventMapLimit ?? 50000;
        this._callTimeoutMs = this._cfg.callTimeoutMs ?? 0; // 0=关（缺省现状）
        this._seqCacheLimit = this._cfg.seqCacheLimit ?? 100000;
        // CD377 形状退化熔断（全端点退化连续 N 块 → 停块预取 X 分钟，行直落单行 fallback）
        this._shapeBreakerThreshold = this._cfg.shapeBreakerThreshold ?? 10;
        this._shapeBreakerPauseMs = this._cfg.shapeBreakerPauseMs ?? 10 * 60 * 1000;
        this._shapeDegradeStreak = 0;      // 连续全端点形状退化块数（成功即归零）
        this._prefetchPausedUntil = 0;     // 熔断截止时刻（Date.now 墙钟——回查链非 FA 周期判定无前视约束）
        this._warnTs = new Map();          // 限频 warn（key → 上次打印时刻）

        // trader 地址 → 'eoa'（终身缓存；填充源=块 join/单行反查的 tx.from 反哺——
        // BSC from 恒 EOA；合约 trader 永不落此缓存=每笔入队 per-tx 解析，语义正确）
        this._kindCache = new Map();
        // txHash → tx.from（同 tx 多 log 共享；填充源=块 join 命中行/单行反查成功）
        this._txFromCache = new Map();
        // blockNumber → Promise<Map<txHash, from>>（lazy：有未知行的块才拉；失败不留缓存）
        this._blockTxCache = new Map();
        // txHash → 用户 EOA（collector 路由事件订阅回调写入；GMGN 自 emit 事件
        // topics 带 user——映射消费在 _processItem 最前，miss 走块 join 不等待）
        this._routerEventMap = new Map();

        // per-token enq/done watermark（waitTokenIdle 用；超限清一半——清掉活跃票
        // 最坏=多等到 deadline 帽，等待语义无害）
        this._enqSeq = new Map();
        this._doneSeq = new Map();

        this._backlog = [];   // 待处理项 FIFO
        this._timers = new Set(); // { timer, item }（重试退避中的项，不在 backlog）
        this._inflight = 0;
        this._rrIndex = 0;
        this._providers = null;
        this._stopped = false;

        this.stats = {
            submitted: 0,
            eoaFast: 0,          // kind 缓存命中同步直推（零延迟）
            routerMapHits: 0,    // 路由事件映射命中（零 RPC）
            routerMapLateHits: 0,   // CD377 块路径未定值后复查 map 接住（零新增延迟）
            routerMapRetryHits: 0,  // CD377 单行未定值进重试前复查 map 接住（砍 3s 尾巴）
            routerMapMisses: 0,  // 映射 miss（含全部非映射域合约行——粗粒度观测）
            blockPulls: 0,       // eth_getBlockByNumber(full) 发起次数（lazy per-block）
            blockJoinRows: 0,    // 经块 join 定值行数
            blockNotFound: 0,    // CD377 null block（端点 lag）块数——二期 ANKR WSS 块拉取决策依据
            blockShapeDegrades: 0, // CD377 全端点形状退化块数（负缓存）
            blockFallbackRows: 0,// 块路径+映射复查均未定值落单行回查行数（CD377 收窄口径）
            txFromResolved: 0,   // 单行反查 tx.from 成功回推（fallback 主体）
            senderNull: 0,       // 反查耗尽/停机/溢出 → NULL 回推（保数据丢修复）
            retried: 0,
            backlogOverflow: 0,
            backlogHighWater: 0,
            blockLookups: 0,
            txLookups: 0,
            txFromCacheHits: 0,
            callTimeouts: 0,     // callTimeoutMs 竞速超时次数
            rpcErrors: 0,
            pushFailures: 0,
        };
    }

    /** 同步快路：kind 缓存命中 EOA（submit 内直推）；未命中=合约/未知 → 入队解析 */
    kindSync(trader) {
        return this._kindCache.get(trader) || null;
    }

    /**
     * 路由事件订阅开关（collector 侧读）：senderResolve.routerEventMap ?? true。
     * false=collector 不发路由订阅（纯块预取 join，回退路径独立）。
     */
    get routerEventMapEnabled() {
        return this._cfg.routerEventMap !== false;
    }

    /**
     * 路由事件映射写入（collector 路由事件订阅回调）。
     * GMGN 路由每笔 swap 同 tx emit Swap(0x8619026a…)/FeeCollected(0x205442d6…)，
     * topics 带 indexed 用户 EOA（Swap topics[1]/[2]、FeeCollected topics[2]）。
     * 幂等：双 collector 订阅/多事件重复写同值无害。
     */
    setRouterEventUser(txHash, user) {
        if (!txHash || !user) return;
        this._routerEventMap.set(txHash.toLowerCase(), user.toLowerCase());
        if (this._routerEventMap.size > this._routerEventMapLimit) {
            const keys = [...this._routerEventMap.keys()].slice(0, Math.floor(this._routerEventMap.size / 2));
            for (const k of keys) this._routerEventMap.delete(k);
        }
    }

    /**
     * tickRow 分流入口（_emitTick 同步调用）。
     * @param {Object} p
     * @param {Object} p.tickRow - wss_price_ticks 行对象（sender_address 由本方法回填）
     * @param {string} p.trader - 事件 trader（msg.sender，已 lowercase）
     * @param {string} p.txHash - 反查钥匙
     * @param {Function} p.pushRow - 回推回调 (tickRow) => void（collector._pushTickRow）
     */
    submit({ tickRow, trader, txHash, pushRow }) {
        this.stats.submitted++;
        const token = tickRow.token_address || null;
        if (token) this._bumpSeq(this._enqSeq, token);

        const kind = this.kindSync(trader);
        if (kind === KIND_EOA) {
            this.stats.eoaFast++;
            this._pushResolved({ tickRow, pushRow }, trader);
            return;
        }
        if (this._stopped) {
            // 停机后到货（stop 与 collector 停止间竞态）：不延迟，NULL 直推保行
            this.stats.senderNull++;
            this._pushResolved({ tickRow, pushRow }, null);
            return;
        }

        this._enqueue({ tickRow, trader, txHash, pushRow, retries: 0 });
        this.stats.backlogHighWater = Math.max(this.stats.backlogHighWater, this._backlog.length);
        if (this.stats.submitted % this._logEvery === 0) {
            this._logInfo(
                `进度: ${JSON.stringify(this.stats)}`);
        }
        this._pump();
    }

    /** per-token 未定值行数（观测键） */
    pendingFor(token) {
        return (this._enqSeq.get(token) || 0) - (this._doneSeq.get(token) || 0);
    }

    /**
     * 等 per-token 已入队行全部定值（watermark：调用时刻后的新 tick 不打断等待——
     * 活跃票 fire 后持续成交不阻塞 settle）。deadline 到即返回 false（帽语义，
     * 调用方按超时处理不区分）。EOA 快路 submit 同帧定值不进等待。
     * @returns {Promise<boolean>} true=追平 false=deadline 到
     */
    async waitTokenIdle(token, deadlineMs = 4000) {
        const target = this._enqSeq.get(token) || 0;
        const deadline = Date.now() + Math.max(0, deadlineMs);
        while ((this._doneSeq.get(token) || 0) < target) {
            if (Date.now() >= deadline) return false;
            await new Promise((r) => setTimeout(r, 25));
        }
        return true;
    }

    /**
     * 停止：等 in-flight（≤3s）→ 清重试 timer → 剩余 backlog 全部 NULL 回推。
     * ⚠ 必须先于 collector.stop() 调用——回推行要进 tickBuffer 再被 flush 落库（零丢行）。
     */
    async stop() {
        if (this._stopped) return;
        this._stopped = true;

        const deadline = Date.now() + 3000;
        while (this._inflight > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 50));
        }

        for (const { timer, item } of this._timers) {
            clearTimeout(timer);
            this.stats.senderNull++;
            this._pushResolved(item, null);
        }
        this._timers.clear();

        while (this._backlog.length > 0) {
            const item = this._backlog.shift();
            this.stats.senderNull++;
            this._pushResolved(item, null);
        }

        if (this._providers) {
            for (const p of this._providers) {
                try { p.destroy(); } catch { /* 进程退出清理 */ }
            }
            this._providers = null;
        }
        this._logInfo(`已停止: ${JSON.stringify(this.stats)}`);
    }

    getStats() {
        return {
            ...this.stats,
            backlog: this._backlog.length,
            kindCacheSize: this._kindCache.size,
            txFromCacheSize: this._txFromCache.size,
            blockCacheSize: this._blockTxCache.size,
            routerEventMapSize: this._routerEventMap.size,
        };
    }

    // ═══════════════ 内部 ═══════════════

    _bumpSeq(map, token) {
        map.set(token, (map.get(token) || 0) + 1);
        if (map.size > this._seqCacheLimit) {
            const keys = [...map.keys()].slice(0, Math.floor(map.size / 2));
            for (const k of keys) map.delete(k);
        }
    }

    _enqueue(item) {
        if (this._backlog.length >= this._backlogLimit) {
            // 溢出：最老行 NULL 强制落库（保数据丢修复，绝不丢行）
            const oldest = this._backlog.shift();
            this.stats.backlogOverflow++;
            this._logWarn(`暂存队列溢出（上限 ${this._backlogLimit}），最老 1 行 sender=NULL 强制落库（累计 ${this.stats.backlogOverflow}）`);
            this._pushResolved(oldest, null);
        }
        this._backlog.push(item);
    }

    /** 并发泵：in-flight < concurrency 且 backlog 非空则取项处理 */
    _pump() {
        while (this._inflight < this._concurrency && this._backlog.length > 0 && !this._stopped) {
            const item = this._backlog.shift();
            this._inflight++;
            this._processItem(item)
                .catch((err) => {
                    // 防御层（_processItem 内部各步已 catch）：异步隔离防崩引擎，
                    // 异常行留 NULL 不丢（flap collector「内部全 catch 绝不 reject」同款先例）
                    this.stats.senderNull++;
                    this._logError(`处理异常留 NULL: ${err.message}`);
                    this._pushResolved(item, null);
                })
                .finally(() => {
                    this._inflight--;
                    this._pump();
                });
        }
    }

    async _processItem(item) {
        // 1) GMGN 路由事件映射（最前：零 RPC 零延迟；事件晚于 trade 事件几十 ms
        //    到达——miss 不等待，直接走 2/3 互补兜底）
        const routerUser = this._routerEventMap.get(item.txHash);
        if (routerUser !== undefined) {
            this.stats.routerMapHits++;
            this._pushResolved(item, routerUser);
            return;
        }
        this.stats.routerMapMisses++;

        // 2) txFrom 缓存（同 tx 多 log 共享一次回查结果）
        const cachedFrom = this._txFromCache.get(item.txHash);
        if (cachedFrom !== undefined) {
            this.stats.txFromCacheHits++;
            this._pushResolved(item, cachedFrom);
            return;
        }

        // 3) 块预取 join（lazy per-block）：同块全部未定值行共享一次全块拉取。
        //    from 恒 EOA ⇒ sender=from 即答案——getCode 判型不需要（EOA 直连时
        //    from===trader，块 join 结果同样正确且反哺 kind 缓存走未来快路）
        const blockNumber = item.tickRow.block_number ?? null;
        if (blockNumber != null) {
            let from = null;
            try {
                from = await this._joinBlock(item.txHash, blockNumber);
            } catch (err) {
                if (err && err.isBlockLag) {
                    // 端点 lag（ankr 领先 RPC 池）：不 failover（lag 风暴下逐端点重试
                    // null 放大流量），缓存已逐出，行落单行/重试链兜底
                    this.stats.blockNotFound++;
                } else {
                    this.stats.rpcErrors++;
                    this._warnThrottled('blockFetchFail',
                        `块拉取失败走单行 fallback: block=${blockNumber} ${err.message}`);
                }
            }
            if (from != null) {
                this.stats.blockJoinRows++;
                this._pushResolved(item, from);
                return;
            }
            // CD377 复查点①：块路径未定值（lag/空块/负缓存/熔断）——RPC 往返窗内
            // 路由事件（晚到几十 ms）几乎必然已进 map，零新增延迟接住竞态 miss
            const lateUser = this._routerEventMap.get(item.txHash);
            if (lateUser !== undefined) {
                this.stats.routerMapLateHits++;
                this._pushResolved(item, lateUser);
                return;
            }
            // from=null：块内无该 txHash（重组/节点 lag）或拉取失败且映射复查未接住
            this.stats.blockFallbackRows++;
        }

        // 4) 单行 getTransactionByHash fallback（重组边缘/块拉取失败；重试有机会成功）
        const from = await this._lookupTxFrom(item.txHash);
        if (from != null) {
            this.stats.txFromResolved++;
            this._pushResolved(item, from);
            return;
        }
        // CD377 复查点②：单行也未定值（lag/重组边缘）→ 进重试前最后机会，砍 3s
        // 重试尾巴（lookup-null 行此刻 map 命中率极高——事件早于重试退避必到）
        const retryUser = this._routerEventMap.get(item.txHash);
        if (retryUser !== undefined) {
            this.stats.routerMapRetryHits++;
            this._pushResolved(item, retryUser);
            return;
        }

        // 5) 重试（退避后放回队首保序）或耗尽留 NULL
        if (item.retries < this._retryLimit && !this._stopped) {
            item.retries++;
            this.stats.retried++;
            const entry = { timer: null, item };
            entry.timer = setTimeout(() => {
                this._timers.delete(entry);
                if (this._stopped) {
                    this.stats.senderNull++;
                    this._pushResolved(item, null);
                    return;
                }
                this._backlog.unshift(item);
                this._pump();
            }, this._retryDelayMs);
            this._timers.add(entry);
            return;
        }
        this.stats.senderNull++;
        this._logWarn(`tx 反查耗尽留 NULL: tx=${item.txHash} trader=${item.trader}`);
        this._pushResolved(item, null);
    }

    /**
     * 块预取 join：取/建该块的 txHash→from map（in-flight 去重——同块并发未定值行
     * 挂同一 promise，一次拉取全簇共享）；命中行反哺双缓存。
     * CD377 熔断门：形状退化连续触发后停块预取（行直落单行 fallback，回到失效期
     * 行为但有报警）；pause 到期自然恢复（半开）。
     * @returns {Promise<string|null>} from 或 null（块内无该 txHash/熔断期）
     * @throws 块拉取失败（网络错误/lag——失败 promise 不留缓存，重试重新拉）
     */
    _joinBlock(txHash, blockNumber) {
        if (Date.now() < this._prefetchPausedUntil) return Promise.resolve(null);
        let p = this._blockTxCache.get(blockNumber);
        if (!p) {
            this.stats.blockPulls++;
            p = this._pullBlockTxMap(blockNumber);
            this._blockTxCache.set(blockNumber, p);
            if (this._blockTxCache.size > this._blockCacheLimit) {
                const firstKey = this._blockTxCache.keys().next().value;
                this._blockTxCache.delete(firstKey);
            }
            // 失败 promise 不留缓存（挂在它上面的行各自 catch 后走单行 fallback）
            p.catch(() => {
                if (this._blockTxCache.get(blockNumber) === p) this._blockTxCache.delete(blockNumber);
            });
        }
        return p.then((map) => {
            const from = map.get(txHash) || null;
            if (from != null) {
                this._cacheTxFrom(txHash, from);
                // BSC tx.from 恒为 EOA（4337 bundler 同样）——反哺 kind 缓存省未来回查
                this._cacheKind(from, KIND_EOA);
            }
            return from;
        });
    }

    /**
     * 全块拉取 → Map<txHash(lower), from(lower)>（tx.from 恒 EOA——map 即该块全部交易的发起者）。
     * CD377：裸调 eth_getBlockByNumber——ethers getBlock(n,true) 抽象路径实测（dataseed
     * 同端点同块 15/15）恒返回 hash 字符串数组，join 自上线起静默失效（blockJoinRows=0
     * 一周）；裸调同端点恒返回 full 对象数组。形状校验放 _rpcCall fn 内部——退化是
     * 200-OK 成功响应，只有 fn 内 throw 才触发端点 failover。
     * @throws {Error} isBlockLag（端点无该块，暂态）| 网络错误（全端点失败）
     *   全端点形状退化 → resolve 空 Map 负缓存（留缓存防同块重拉风暴）+ 熔断计数
     */
    async _pullBlockTxMap(blockNumber) {
        this.stats.blockLookups++;
        const n = Number(blockNumber);
        if (!Number.isSafeInteger(n) || n < 0) throw new Error(`块号非法: ${blockNumber}`);
        const hexTag = '0x' + n.toString(16);
        let block;
        try {
            block = await this._withTimeout(
                this._rpcCall((p) => p.send('eth_getBlockByNumber', [hexTag, true]).then((b) => {
                    if (b === null) return null; // 端点还没该块（lag）——成功返回不走 failover
                    if (!b || !Array.isArray(b.transactions)) {
                        const e = new Error(`块形状退化(transactions 非数组) host=${this._hostOf(p)}`);
                        e.blockShape = true;
                        throw e;
                    }
                    if (b.transactions.length && typeof b.transactions[0] === 'string') {
                        const e = new Error(`块形状退化(hash 数组,verbose 未生效) host=${this._hostOf(p)}`);
                        e.blockShape = true;
                        throw e;
                    }
                    return b;
                })),
                `getBlock(${n})`,
            );
        } catch (err) {
            if (err && err.blockShape) {
                // 全端点形状退化：负缓存（空 Map 留缓存——同块后续行不再重拉，
                // 防 throw 逐出后同块逐行 ×N 端点 ×全块 payload 的重拉风暴）
                this.stats.blockShapeDegrades++;
                this._shapeDegradeStreak++;
                this._warnThrottled('blockShape',
                    `全端点块形状退化(${this._shapeDegradeStreak} 连续) 负缓存生效: ${err.message}`);
                if (this._shapeDegradeStreak >= this._shapeBreakerThreshold) {
                    this._prefetchPausedUntil = Date.now() + this._shapeBreakerPauseMs;
                    this._logError(`块预取熔断 ${this._shapeBreakerPauseMs / 60000}min（连续 ${this._shapeDegradeStreak} 块全端点退化），期间行直落单行 fallback`);
                }
                return new Map();
            }
            throw err; // 网络错误/超时：reject 逐出缓存（现状语义）
        }
        this._shapeDegradeStreak = 0; // 任何成功拉取归零
        if (block === null) {
            // lag：暂态，throw 逐出缓存（下一行/重试重新拉），行落单行/重试链兜底
            const e = new Error(`端点暂无该块(lag): ${hexTag}`);
            e.isBlockLag = true;
            throw e;
        }
        const map = new Map();
        for (const tx of block.transactions) {
            if (tx && typeof tx.hash === 'string' && typeof tx.from === 'string') {
                map.set(tx.hash.toLowerCase(), tx.from.toLowerCase());
            }
        }
        return map;
    }

    /** provider → host（形状退化 log 定位端点用；取不到给 unknown） */
    _hostOf(p) {
        try {
            return new URL(p.connection?.url || '').host || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    /** 限频 warn（同 key 默认 30s 一条——降级路径 per-row 刷屏防线） */
    _warnThrottled(key, msg, ms = 30000) {
        const now = Date.now();
        const last = this._warnTs.get(key) || 0;
        if (now - last < ms) return;
        this._warnTs.set(key, now);
        this._logWarn(msg);
    }

    /** txHash → from（缓存命中零 RPC；失败/tx 不可见不缓存，重试有机会成功） */
    async _lookupTxFrom(txHash) {
        try {
            this.stats.txLookups++;
            const tx = await this._withTimeout(
                this._rpcCall((p) => p.getTransaction(txHash)),
                `getTransaction(${txHash})`,
            );
            if (tx && tx.from) {
                const from = tx.from.toLowerCase();
                this._cacheTxFrom(txHash, from);
                this._cacheKind(from, KIND_EOA);
                return from;
            }
            return null; // tx 不可见（节点 lag / prune / 重组）
        } catch (err) {
            this.stats.rpcErrors++;
            this._logWarn(`getTransactionByHash 失败: tx=${txHash} ${err.message}`);
            return null;
        }
    }

    /** per-call 超时竞速（callTimeoutMs=0 关=现状不包装）。超时 reject 走调用方降级链 */
    _withTimeout(promise, label) {
        if (!this._callTimeoutMs || this._callTimeoutMs <= 0) return promise;
        let timer = null;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    this.stats.callTimeouts++;
                    reject(new Error(`${label} 超时 ${this._callTimeoutMs}ms`));
                }, this._callTimeoutMs);
            }),
        ]).finally(() => clearTimeout(timer));
    }

    /** 回推（幂等防重复）：sender 写入行对象后交回 collector 进 tickBuffer；per-token done 计数 */
    _pushResolved(entry, sender) {
        if (entry.resolved) return;
        entry.resolved = true;
        entry.tickRow.sender_address = sender;
        const token = entry.tickRow.token_address || null;
        if (token) this._bumpSeq(this._doneSeq, token);
        try {
            entry.pushRow(entry.tickRow);
        } catch (err) {
            this.stats.pushFailures++;
            this._logError(`回推 tickRow 失败（行丢失）: tx=${entry.tickRow.tx_hash} ${err.message}`);
        }
    }

    _cacheKind(addr, kind) {
        this._kindCache.set(addr, kind);
        if (this._kindCache.size > this._kindCacheLimit) {
            // 插入序清一半（_processedTickKeys 同款先例；router 等高频地址有 txFrom 反哺兜底）
            const keys = [...this._kindCache.keys()].slice(0, Math.floor(this._kindCache.size / 2));
            for (const k of keys) this._kindCache.delete(k);
        }
    }

    _cacheTxFrom(txHash, from) {
        this._txFromCache.set(txHash, from);
        if (this._txFromCache.size > this._txFromCacheLimit) {
            const keys = [...this._txFromCache.keys()].slice(0, Math.floor(this._txFromCache.size / 2));
            for (const k of keys) this._txFromCache.delete(k);
        }
    }

    /** RPC 端点解析：rpcMode='urls'（rpcUrls 数组，缺省 dataseed 池）| 'ankrFromEnv'（推导失败 throw，部署错误 fail-loud） */
    _resolveRpcUrls() {
        if (this._rpcMode === 'ankrFromEnv') {
            const u = resolveAnkrHttpUrlFromEnv();
            if (!u) throw new Error('senderResolve.rpcMode=ankrFromEnv 但 ANKR_WS_URL/ANKR_API_KEY 均无法推导出合格 key');
            return [u];
        }
        return (this._rpcUrlsCfg && this._rpcUrlsCfg.length > 0) ? this._rpcUrlsCfg : DEFAULT_RPC_URLS;
    }

    /** round-robin 起点 + per-call failover：逐 provider 试到成功，全失败 throw 最后错误 */
    async _rpcCall(fn) {
        const providers = this._ensureProviders();
        const n = providers.length;
        let idx = (this._rrIndex++) % n;
        let lastErr = null;
        for (let i = 0; i < n; i++, idx = (idx + 1) % n) {
            try {
                return await fn(providers[idx]);
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error('RPC 全端点失败');
    }

    _ensureProviders() {
        if (this._providers) return this._providers;
        const urls = this._resolveRpcUrls();
        this._providers = urls.map((u) => this._makeProvider(u));
        this._logInfo(`RPC 池就绪: ${urls.map((u) => new URL(u).host).join(', ')}`);
        return this._providers;
    }

    /** provider 工厂（单测打桩点）。batchMaxCount=1：单发不打 JSON-RPC batch；staticNetwork 免 detect 往返 */
    _makeProvider(rpcUrl) {
        return new ethers.JsonRpcProvider(rpcUrl, 56, { batchMaxCount: 1, staticNetwork: true });
    }

    // .call 保接收者：Logger 类实例的 info/warn/error 是依赖 this 的普通方法，
    // 解引用裸调用会 TypeError（2026-10-09 a21fa102 崩溃案：首次 RPC 失败 → _logWarn
    // 炸 → reject → _pump catch → _logError 再炸 → unhandledRejection 崩进程）。
    _logInfo(msg) { (this._logger.info || this._logger.log)?.call(this._logger, '', 'SenderResolver', msg); }
    _logWarn(msg) { (this._logger.warn || this._logger.log)?.call(this._logger, '', 'SenderResolver', msg); }
    _logError(msg) { (this._logger.error || this._logger.log)?.call(this._logger, '', 'SenderResolver', msg); }
}

module.exports = { SenderResolver, resolveAnkrHttpUrlFromEnv, DEFAULT_RPC_URLS, KIND_EOA };
