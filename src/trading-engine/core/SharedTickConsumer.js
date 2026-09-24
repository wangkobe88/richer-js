/**
 * SharedTickConsumer —— 实验 DB 增量消费者（watcher 架构核心）
 *
 * 实验进程不再持有 WSS 连接，改为从 wss_price_ticks / wss_events 两表按 id
 * watermark 增量消费 watcher（src/watcher/）落库的同一份数据流：
 *   - events: token_create → FA.registerToken + TokenPool.addToken + 引擎._handleNewToken
 *             graduation   → 引擎._handleGraduation
 *             （heartbeat 行只推水位不派发——watcher 活着则 60s 必有新行，
 *              市场安静时也能刷新 lastIngestAt，不误报断供）
 *   - ticks:  TokenPool.updatePrice → minTickBnb 门 → FA.processTick（emitFactors
 *             默认 true，引擎既有 factorsUpdated 订阅零改动）→ priceOutlier 命中行
 *             批量回写 wss_price_ticks.price_outlier=true（列语义不断层）
 *
 * 关键机制（见 plans/pumpfun-http-localhost-3010-experiment-stateless-book.md）：
 *   1. 双水位首拉 select max(id) 对齐——只消费启动后新行，严格等价旧订阅行为
 *   2. 单循环先 events 后 ticks 串行——同周期到达的 create 先应用
 *   3. 水位延迟一个周期提交（committed=上轮观察 max）+ (tx_hash,log_index) 有界
 *      去重集——对抗 bigserial id 分配序≠提交序的双写者竞态（A 批低 id 未提交、
 *      B 批高 id 先提交；每轮固定向后重叠重读一轮，去重集保证幂等——FA.processTick
 *      状态累加不幂等，去重集是必需品不是保险丝）
 *   4. 禁止服务端 platform/kind 过滤——异平台行必须进结果集推水位，否则无限重扫；
 *      本地过滤，水位推进到本地见过的全局 max id
 *   5. 读 0 行=断供不回退水位；单行应用错误 log 跳过、水位照推；_loopBusy 防重叠
 */

'use strict';

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_LOOP = 20;    // 背压：单轮最多 ~2 万行，堆积留给下轮
const DEDUPE_SET_LIMIT = 200000;  // (tx_hash,log_index) 去重集上限（对齐 collector 模式）
const OUTLIER_UPDATE_BATCH = 200; // price_outlier 回写 .in 批量护栏

const TICK_COLUMNS = 'id,token_address,tx_hash,log_index,trade_type,trader_address,price_bnb,price_usd,bnb_amount,token_amount,price_outlier,block_number,block_time,received_at,platform';

class SharedTickConsumer {
    /**
     * @param {Object} deps
     * @param {string} deps.platform            - 'fourmeme' | 'flap'（本实验消费的平台）
     * @param {number} [deps.pollIntervalMs]    - 轮询间隔（缺省 1000）
     * @param {number} deps.minTickBnb          - 尘 tick 门（bnb_amount 低于此值不进 FA，仍推水位）
     * @param {Object|null} deps.factorAggregator - FourMemeFactorAggregator（引擎实例）
     * @param {Object|null} deps.tokenPool      - TokenPool（引擎实例）
     * @param {Function} [deps.onTokenCreate]   - 引擎._handleNewToken(info)
     * @param {Function} [deps.onGraduation]    - 引擎._handleGraduation(info)
     * @param {Object} deps.logger
     * @param {string} [deps.experimentId]      - 日志标识
     */
    constructor(deps) {
        this._platform = deps.platform;
        this._pollIntervalMs = deps.pollIntervalMs ?? 1000;
        this._minTickBnb = deps.minTickBnb ?? 0.001;
        this._fa = deps.factorAggregator || null;
        this._tokenPool = deps.tokenPool || null;
        this._onTokenCreate = deps.onTokenCreate || null;
        this._onGraduation = deps.onGraduation || null;
        this._logger = deps.logger;
        this._experimentId = deps.experimentId || '';

        // 双水位：{ committed, pendingMax }——committed 为读取起点（滞后一轮），pendingMax 为上轮观察 max
        this._eventWatermark = { committed: null, pendingMax: null };
        this._tickWatermark = { committed: null, pendingMax: null };

        this._loopTimer = null;
        this._loopBusy = false;
        this._stopped = false;
        this._lastIngestAt = null;

        this._tickDedupe = new Set(); // `${tx_hash}-${log_index}`

        this.stats = {
            startedAt: null,
            ticksApplied: 0,
            ticksSkippedPlatform: 0,
            ticksSkippedDust: 0,
            ticksSkippedDup: 0,
            eventsApplied: 0,
            eventsSkippedPlatform: 0,
            outlierRowsUpdated: 0,
            pollLoops: 0,
            pollErrors: 0,
        };
    }

    async start() {
        if (this._loopTimer) return;
        const { dbManager } = require('../../services/dbManager');
        this._supabase = dbManager.getClient();

        this.stats.startedAt = Date.now();
        this._loopTimer = setInterval(() => {
            this._pollLoop().catch(e => {
                this.stats.pollErrors++;
                this._logger.warn(this._experimentId, 'SharedTickConsumer', `轮询异常: ${e.message}`);
            });
        }, this._pollIntervalMs);
        this._logger.info(this._experimentId, 'SharedTickConsumer',
            `已启动 | platform=${this._platform} poll=${this._pollIntervalMs}ms minTickBnb=${this._minTickBnb}`);
    }

    async stop() {
        if (this._stopped) return;
        this._stopped = true;
        if (this._loopTimer) clearInterval(this._loopTimer);
        this._loopTimer = null;
        this._logger.info(this._experimentId, 'SharedTickConsumer', '已停止', this.getStats());
    }

    /** 断供判据：最后一次读到新行（任意表）的时刻；null=尚未消费到任何行 */
    getLastIngestAt() {
        return this._lastIngestAt;
    }

    getWatermarks() {
        return {
            ticks: this._tickWatermark.committed,
            events: this._eventWatermark.committed,
        };
    }

    getStats() {
        return {
            ...this.stats,
            tickDedupeSize: this._tickDedupe.size,
            lastIngestAt: this._lastIngestAt,
            watermarks: this.getWatermarks(),
        };
    }

    // ═══════════════ 轮询主循环 ═══════════════

    async _pollLoop() {
        if (this._loopBusy || this._stopped) return; // 防重叠
        this._loopBusy = true;
        try {
            // 首拉水位对齐（各一次轻查询；失败抛给外层记 pollErrors，下轮重试）
            if (this._eventWatermark.committed === null) {
                this._eventWatermark.committed = this._eventWatermark.pendingMax =
                    await this._fetchMaxId('wss_events');
                this._logger.info(this._experimentId, 'SharedTickConsumer',
                    `events 水位对齐 max(id)=${this._eventWatermark.committed}`);
            }
            if (this._tickWatermark.committed === null) {
                this._tickWatermark.committed = this._tickWatermark.pendingMax =
                    await this._fetchMaxId('wss_price_ticks');
                this._logger.info(this._experimentId, 'SharedTickConsumer',
                    `ticks 水位对齐 max(id)=${this._tickWatermark.committed}`);
            }

            // 先 events 后 ticks（串行）：同周期到达的 token_create 先于 tick 应用
            const outlierIds = [];
            await this._drainEvents();
            await this._drainTicks(outlierIds);
            await this._flushOutlierUpdates(outlierIds);

            this.stats.pollLoops++;
        } finally {
            this._loopBusy = false;
        }
    }

    async _fetchMaxId(table) {
        const { data, error } = await this._supabase
            .from(table)
            .select('id')
            .order('id', { ascending: false })
            .limit(1);
        if (error) throw new Error(`${table} max(id) 查询失败: ${error.message}`);
        return data && data.length > 0 ? data[0].id : 0;
    }

    /**
     * 增量排水（水位延迟一轮 + 去重集）。
     * 读 id > committed（committed 滞后一轮 → 固定重叠重读上轮区间，捕捉乱序提交的洞），
     * 行应用后不立即提交水位；本轮结束时 committed=上轮 pendingMax、pendingMax=本轮 max。
     */
    async _drainTable(table, columns, watermark, applyRow) {
        const startId = watermark.committed;
        let from = 0;
        let curMax = startId;
        let sawNew = false;
        for (let page = 0; page < MAX_PAGES_PER_LOOP; page++) {
            const { data, error } = await this._supabase
                .from(table)
                .select(columns)
                .gt('id', startId)
                .order('id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);
            if (error) throw new Error(`${table} 增量读取失败: ${error.message}`);
            if (!data || data.length === 0) break;

            for (const row of data) {
                if (row.id > curMax) { curMax = row.id; sawNew = true; }
                try {
                    applyRow(row);
                } catch (e) {
                    this._logger.warn(this._experimentId, 'SharedTickConsumer',
                        `行应用失败(跳过，水位照推) | ${table} id=${row.id} ${e.message}`);
                }
            }
            from += data.length;
            if (data.length < PAGE_SIZE) break;
        }
        // 水位延迟一轮提交
        watermark.committed = watermark.pendingMax;
        watermark.pendingMax = curMax;
        return sawNew;
    }

    // ═══════════════ events 通道 ═══════════════

    async _drainEvents() {
        const got = await this._drainTable('wss_events', 'id,kind,platform,token_address,payload,block_time,created_at',
            this._eventWatermark, (row) => this._applyEvent(row));
        if (got) this._lastIngestAt = Date.now();
    }

    _applyEvent(row) {
        // heartbeat 只推水位不派发（watcher 存活的证明）；异平台本地过滤（水位已在 _drainTable 推进）
        if (row.kind === 'heartbeat') return;
        if (row.platform !== this._platform) {
            this.stats.eventsSkippedPlatform++;
            return;
        }
        const info = row.payload;
        if (row.kind === 'token_create') {
            // 复刻 collector._handleTokenCreate 的 FA/pool 两路（乱序自愈：registerToken 幂等回填权威锚点）
            if (this._fa && info && info.token) {
                const totalSupply = this._platform === 'flap'
                    ? require('../../collectors/flap-ankr-ws-collector.js').FLAP_TOTAL_SUPPLY
                    : (info.totalSupply ?? 0);
                this._fa.registerToken(info.token, {
                    createdAtMs: info.blockTimeMs,
                    totalSupply,
                    name: info.name,
                    symbol: info.symbol,
                    creatorAddress: info.creator,
                });
            }
            if (this._tokenPool && info && info.token) {
                const existing = this._tokenPool.getToken(info.token, 'bsc');
                if (!existing) {
                    this._tokenPool.addToken({
                        token: info.token,
                        chain: 'bsc',
                        platform: this._platform,
                        data_source: 'wss',
                        name: info.name || '',
                        symbol: info.symbol || '',
                        created_at: Math.floor((info.blockTimeMs || Date.now()) / 1000),
                        current_price_usd: null,
                        creator_address: info.creator,
                    });
                }
            }
            this.stats.eventsApplied++;
            if (this._onTokenCreate) this._onTokenCreate(info);
        } else if (row.kind === 'graduation') {
            this.stats.eventsApplied++;
            if (this._onGraduation) this._onGraduation(info);
        }
    }

    // ═══════════════ ticks 通道 ═══════════════

    async _drainTicks(outlierIds) {
        const got = await this._drainTable('wss_price_ticks', TICK_COLUMNS,
            this._tickWatermark, (row) => this._applyTick(row, outlierIds));
        if (got) this._lastIngestAt = Date.now();
    }

    _applyTick(row, outlierIds) {
        if (row.platform !== this._platform) {
            this.stats.ticksSkippedPlatform++;
            return;
        }
        // 去重集（跨轮重叠重读幂等；FA.processTick 状态累加不幂等）
        const key = `${row.tx_hash}-${row.log_index}`;
        if (this._tickDedupe.has(key)) {
            this.stats.ticksSkippedDup++;
            return;
        }
        this._tickDedupe.add(key);
        if (this._tickDedupe.size > DEDUPE_SET_LIMIT) {
            const entries = [...this._tickDedupe];
            this._tickDedupe = new Set(entries.slice(entries.length / 2));
        }

        // 复刻 collector._emitTick 三路中的两路（第三路 tickBuffer 由 watcher 承担）
        if (this._tokenPool && row.price_usd && row.price_usd > 0) {
            const token = this._tokenPool.getToken(row.token_address, 'bsc');
            if (token) {
                this._tokenPool.updatePrice(row.token_address, 'bsc', row.price_usd,
                    row.received_at ? new Date(row.received_at).getTime() : Date.now(), {});
            }
        }

        // minTickBnb 门 → FA（尘 tick 不进因子计算，水位照推；DB 行无 offers/funds_bnb 列——
        // FA `> 0` 守卫容忍 undefined，tvl 因子恒 0，与回测口径一致）
        if (this._fa && (row.bnb_amount ?? 0) >= this._minTickBnb) {
            const faResult = this._fa.processTick({
                token_address: row.token_address,
                trade_type: row.trade_type,
                trader_address: row.trader_address,
                price_bnb: row.price_bnb,
                price_usd: row.price_usd,
                bnb_amount: row.bnb_amount,
                token_amount: row.token_amount,
                block_number: row.block_number,
                timestamp: row.block_time ? new Date(row.block_time).getTime() : null,
                tx_hash: row.tx_hash,
                log_index: row.log_index,
            });
            // 离群价回写：watcher 无 FA 落库恒 false，此处消费侧补标（tick-kline/预检查
            // 读方依赖该列剔毒价）；行已在库（非竞速首写者），update 无冲突
            if (faResult && faResult.priceOutlier) {
                outlierIds.push(row.id);
            }
        } else if (this._fa) {
            this.stats.ticksSkippedDust++;
        }
        this.stats.ticksApplied++;
    }

    async _flushOutlierUpdates(ids) {
        if (!ids || ids.length === 0) return;
        for (let i = 0; i < ids.length; i += OUTLIER_UPDATE_BATCH) {
            const { error } = await this._supabase
                .from('wss_price_ticks')
                .update({ price_outlier: true })
                .in('id', ids.slice(i, i + OUTLIER_UPDATE_BATCH));
            if (error) {
                this._logger.warn(this._experimentId, 'SharedTickConsumer',
                    `price_outlier 回写失败: ${error.message} count=${ids.length}`);
                return;
            }
            this.stats.outlierRowsUpdated += Math.min(OUTLIER_UPDATE_BATCH, ids.length - i);
        }
    }
}

module.exports = { SharedTickConsumer };
