/**
 * SenderResolver —— wss_price_ticks.sender_address（真实交易发起者）解析器
 * （2026-09-30 0x1de460 公共路由案）
 *
 * 背景：flap TokenBought/TokenSold 与 four.meme TokenPurchase/TokenSale 事件的
 * trader 参数是 msg.sender（合约直接调用者）。用户经公共路由（0x1de460…，全 flap
 * 27.9% 行）交易时 trader_address 落的是 router 合约地址——top1 买入集中度 /
 * sniper 持仓 / TPA 钱包画像全被污染。WSS logs 推送对象只有 transactionHash 钥匙
 * （182 实证字段全集无 from/to），真实买家 = 交易对象的 tx.from（BSC 上恒为 EOA，
 * 4337 bundler 场景同样）。
 *
 * 方案 X（延迟入 buffer）：_emitTick 构造 tickRow 后分流——
 *   - EOA 缓存命中 → sender=trader 同步直进 buffer（零延迟，大多数行）
 *   - 合约缓存命中 / 未知 → 暂存 resolver，resolve 完成后回推 collector._pushTickRow
 *     （单次 upsert 全字段，省掉回填 UPDATE；代价 = 合约行落库延迟 ~0.3-1s，
 *     vs 90s 因子窗无感）。FA processTick / TokenPool 价格更新不受影响（只有 DB
 *     落库延迟）；price_outlier 回写在 _emitTick 同步段完成，异步回推时已定值
 *
 * RPC 量级：getCode per 新 trader 终身一次（kind 缓存）；getTransactionByHash
 * per 合约行 txHash 一次（txFrom 缓存——聚合交易一条 tx 多 log 共享）。合约行
 * ~30-40% ≈ 日 5-6 万次 ≈ 0.7 req/s，免费 dataseed 单发调用不受限（实测仅
 * eth_getLogs 恒 -32005）。效率不够时 config 切 rpcMode='ankrFromEnv' 零代码。
 *
 * 失败语义（绝不污染）：
 *   - getCode 失败 → 不缓存、不当 EOA 直通（那会把 sender 写成 router）——
 *     fail-safe 走 tx 反查（EOA 直连时 tx.from === trader，反查结果同样正确）
 *   - 反查重试 retryLimit 次耗尽 → sender=NULL 回推（保数据丢修复，绝不丢行）
 *   - 暂存满 backlogLimit → 最老行 NULL 强制落库（同上）
 *
 * 共享实例：watcher 进程构造一个传入两 collector（钱包跨平台交易，kind 缓存
 * 利用率更高）；实验进程不跑 collector（SharedTickConsumer 消费 DB），零影响。
 */

'use strict';

const { ethers } = require('ethers');

const KIND_EOA = 'eoa';
const KIND_CONTRACT = 'contract';

// 默认 RPC 池：binance dataseed 多域名轮询 + per-call failover（免费、单发调用不限）
const DEFAULT_RPC_URLS = [
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed1.nariox.io/',
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
     * @param {Object} cfg - config.senderResolve 段（enabled 由 watcher 侧判定，构造即工作）
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

        // trader 地址 → 'eoa' | 'contract'（终身缓存；getCode 失败不落）
        this._kindCache = new Map();
        // txHash → tx.from（聚合交易一条 tx 多 log 共享一次反查；失败不缓存）
        this._txFromCache = new Map();

        this._backlog = [];   // 待处理项 FIFO
        this._timers = new Set(); // { timer, item }（重试退避中的项，不在 backlog）
        this._inflight = 0;
        this._rrIndex = 0;
        this._providers = null;
        this._stopped = false;

        this.stats = {
            submitted: 0,
            eoaFast: 0,          // kind 缓存命中同步直推（零延迟）
            eoaByCode: 0,        // getCode 判 EOA
            txFromResolved: 0,   // 反查 tx.from 成功回推（合约行主体）
            senderNull: 0,       // 反查耗尽/停机/溢出 → NULL 回推（保数据丢修复）
            retried: 0,
            backlogOverflow: 0,
            backlogHighWater: 0,
            getCodeCalls: 0,
            txLookups: 0,
            txFromCacheHits: 0,
            rpcErrors: 0,
            pushFailures: 0,
        };
    }

    /** 同步快路：kind 缓存命中（'eoa' 直通由 submit 处理；'contract' 供 submit 跳过 getCode） */
    kindSync(trader) {
        return this._kindCache.get(trader) || null;
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

        this._enqueue({ tickRow, trader, txHash, pushRow, kind, retries: 0 });
        this.stats.backlogHighWater = Math.max(this.stats.backlogHighWater, this._backlog.length);
        if (this.stats.submitted % this._logEvery === 0) {
            this._logInfo(
                `进度: ${JSON.stringify(this.stats)}`);
        }
        this._pump();
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
        return { ...this.stats, backlog: this._backlog.length, kindCacheSize: this._kindCache.size, txFromCacheSize: this._txFromCache.size };
    }

    // ═══════════════ 内部 ═══════════════

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
                    // 防御层（_processItem 内部各步已 catch）：异步隔离防崩 watcher，
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
        // 1) kind 判定（kindSync 已知 contract 的项跳过 getCode）
        let kind = item.kind || null;
        if (!kind) {
            try {
                this.stats.getCodeCalls++;
                const code = await this._rpcCall((p) => p.getCode(item.trader));
                kind = code === '0x' ? KIND_EOA : KIND_CONTRACT;
                this._cacheKind(item.trader, kind);
                if (kind === KIND_EOA) this.stats.eoaByCode++;
            } catch (err) {
                this.stats.rpcErrors++;
                this._logWarn(`getCode 失败走 tx 反查（fail-safe，不缓存）: trader=${item.trader} ${err.message}`);
                kind = null; // 绝不当 EOA 直通——那会把 sender 写成 router（污染）
            }
        }
        if (kind === KIND_EOA) {
            this._pushResolved(item, item.trader);
            return;
        }

        // 2) 合约 / 未知 → 反查交易对象 tx.from（txFrom 缓存：聚合交易一条 tx 多 log 共享）
        const from = await this._lookupTxFrom(item.txHash);
        if (from != null) {
            this.stats.txFromResolved++;
            this._pushResolved(item, from);
            return;
        }

        // 3) 重试（退避后放回队首保序）或耗尽留 NULL
        if (item.retries < this._retryLimit && !this._stopped) {
            item.retries++;
            item.kind = kind || undefined;
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

    /** txHash → from（缓存命中零 RPC；失败/tx 不可见不缓存，重试有机会成功） */
    async _lookupTxFrom(txHash) {
        const cached = this._txFromCache.get(txHash);
        if (cached !== undefined) {
            this.stats.txFromCacheHits++;
            return cached;
        }
        try {
            this.stats.txLookups++;
            const tx = await this._rpcCall((p) => p.getTransaction(txHash));
            if (tx && tx.from) {
                const from = tx.from.toLowerCase();
                this._cacheTxFrom(txHash, from);
                // BSC tx.from 恒为 EOA（4337 bundler 同样）——反哺 kind 缓存省未来 getCode
                this._cacheKind(from, KIND_EOA);
                return from;
            }
            return null; // tx 不可见（节点 lag / prune）
        } catch (err) {
            this.stats.rpcErrors++;
            this._logWarn(`getTransactionByHash 失败: tx=${txHash} ${err.message}`);
            return null;
        }
    }

    /** 回推（幂等防重复）：sender 写入行对象后交回 collector 进 tickBuffer */
    _pushResolved(entry, sender) {
        if (entry.resolved) return;
        entry.resolved = true;
        entry.tickRow.sender_address = sender;
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

    _logInfo(msg) { (this._logger.info || this._logger.log)?.('', 'SenderResolver', msg); }
    _logWarn(msg) { (this._logger.warn || this._logger.log)?.('', 'SenderResolver', msg); }
    _logError(msg) { (this._logger.error || this._logger.log)?.('', 'SenderResolver', msg); }
}

module.exports = { SenderResolver, resolveAnkrHttpUrlFromEnv, DEFAULT_RPC_URLS };
