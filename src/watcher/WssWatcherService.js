/**
 * WSS Watcher 常驻采集服务（watcher 架构核心）
 *
 * 职责：单进程长期稳定运行，同时订阅 four.meme TokenManager + flap Portal 两条
 * ankr WSS，解析事件落库——不随实验起停：
 *   - tick → collector 内置 tickBuffer → upsert wss_price_ticks（experiment_id=NULL）
 *   - token_create / graduation 回调 → events 重试队列 → insert wss_events
 *   - 60s 心跳行（kind='heartbeat'）→ 人工 SQL 查活 + 实验侧断供判据
 *   - 60s 断流自愈守护（自引擎 wss-down-guard 迁入：消息心跳静默 → forceReconnect）
 *   - 心跳行 7 天清理（每日一次）
 *
 * 消费侧见 src/trading-engine/core/SharedTickConsumer.js（实验进程 DB 增量消费）。
 * collector 以 FA/tokenPool=null 无状态复用（调用点均带 null 守卫）。
 */

'use strict';

const HEARTBEAT_MS_DEFAULT = 60 * 1000;
const DOWN_GUARD_MS_DEFAULT = 5 * 60 * 1000; // watcher 自愈比实验侧告警（15min）更敏感
const HEARTBEAT_TTL_DAYS = 7;
const EVENT_RETRY_MS_DEFAULT = 30 * 1000;
const WATCHER_TICK_FLUSH_MS = 500; // 覆盖 collector 默认 2s，压低端到端延迟

class WssWatcherService {
    /**
     * @param {Object} config - 全局配置（读 config.watcher 段，均可缺省）
     * @param {Object} logger - { info, warn, error, debug }
     */
    constructor(config, logger) {
        this.config = config || {};
        this._cfg = this.config.watcher || {};
        this.logger = logger;

        this._heartbeatMs = this._cfg.heartbeatMs || HEARTBEAT_MS_DEFAULT;
        this._downGuardMs = this._cfg.downGuardMs || DOWN_GUARD_MS_DEFAULT;
        this._eventRetryMs = this._cfg.eventRetryMs || EVENT_RETRY_MS_DEFAULT;

        this._supabase = null;
        this._collectors = new Map(); // platform → collector
        this._eventQueue = [];        // 写失败的 events 待重试（unshift 模式，镜像 tickBuffer）
        this._eventWriting = false;

        this._heartbeatTimer = null;
        this._downGuardTimer = null;
        this._eventRetryTimer = null;
        this._heartbeatCleanupTimer = null;
        this._stopped = false;

        this.stats = {
            startedAt: null,
            eventsWritten: 0,
            eventsFailed: 0,
            heartbeatsWritten: 0,
            heartbeatsFailed: 0,
            forcedReconnects: 0,
            heartbeatRowsCleaned: 0,
        };
    }

    async start() {
        if (this._collectors.size > 0) return;
        const { dbManager } = require('../services/dbManager');
        this._supabase = dbManager.getClient();

        const { FourMemeAnkrWsCollector } = require('../collectors/fourmeme-ankr-ws-collector.js');
        const { FlapAnkrWsCollector } = require('../collectors/flap-ankr-ws-collector.js');

        // tick flush 压到 500ms（浅覆盖各自 config 段）；FA/tokenPool=null 无状态复用
        const watcherCfg = (section) => ({
            ...this.config,
            [section]: { ...this.config[section], tickBuffer: { flushIntervalMs: WATCHER_TICK_FLUSH_MS } },
        });

        const platforms = [
            {
                name: 'fourmeme', section: 'fourmemeWs', Ctor: FourMemeAnkrWsCollector,
            },
            {
                name: 'flap', section: 'flapWs', Ctor: FlapAnkrWsCollector,
            },
        ];

        for (const p of platforms) {
            const collector = new p.Ctor(watcherCfg(p.section), this.logger, null, null, {
                onTokenCreate: (info) => this._enqueueEvent('token_create', p.name, info),
                onGraduation: (info) => this._enqueueEvent('graduation', p.name, info),
            });
            this._collectors.set(p.name, collector);
            collector.start();
        }

        this.stats.startedAt = Date.now();
        this._heartbeatTimer = setInterval(() => this._writeHeartbeat().catch(e =>
            this.logger.error('', 'WssWatcher', `心跳写入失败: ${e.message}`)), this._heartbeatMs);
        this._downGuardTimer = setInterval(() => this._checkDownGuard(), this._heartbeatMs);
        this._eventRetryTimer = setInterval(() => this._flushEventQueue().catch(e =>
            this.logger.error('', 'WssWatcher', `events 重试刷新失败: ${e.message}`)), this._eventRetryMs);
        // 心跳行清理：每 24h 一次（延迟 10 分钟错峰首次执行）
        this._heartbeatCleanupTimer = setInterval(() => this._cleanupHeartbeats().catch(e =>
            this.logger.warn('', 'WssWatcher', `心跳清理失败: ${e.message}`)), 24 * 3600 * 1000);
        setTimeout(() => this._cleanupHeartbeats().catch(() => {}), 10 * 60 * 1000);

        this.logger.info('', 'WssWatcher',
            `watcher 启动 | platforms=${[...this._collectors.keys()].join(',')} ` +
            `heartbeat=${this._heartbeatMs}ms downGuard=${this._downGuardMs}ms tickFlush=${WATCHER_TICK_FLUSH_MS}ms`);
    }

    async stop() {
        if (this._stopped) return;
        this._stopped = true;
        for (const t of [this._heartbeatTimer, this._downGuardTimer, this._eventRetryTimer, this._heartbeatCleanupTimer]) {
            if (t) clearInterval(t);
        }
        // 先冲刷 events 队列（create 行丢失 = token 对所有实验永久不可见），再停 collector（flush tickBuffer）
        try {
            await this._flushEventQueue();
        } catch (e) {
            this.logger.error('', 'WssWatcher', `停机 events 冲刷失败（丢失 ${this._eventQueue.length} 条）: ${e.message}`);
        }
        for (const collector of this._collectors.values()) {
            try {
                await collector.stop();
            } catch (e) {
                this.logger.error('', 'WssWatcher', `collector 停止失败: ${e.message}`);
            }
        }
        this._collectors.clear();
        this.logger.info('', 'WssWatcher', `watcher 已停止 | ${JSON.stringify(this.stats)}`);
    }

    /** 事件入队：立即尝试落库，失败进重试队列（绝不 fire-and-forget） */
    _enqueueEvent(kind, platform, info) {
        const row = {
            kind,
            platform,
            token_address: info.token || null,
            payload: info,
            block_time: info.blockTimeMs ? new Date(info.blockTimeMs).toISOString() : null,
        };
        this._writeEvent(row).catch(() => {
            this._eventQueue.push(row);
            this.logger.warn('', 'WssWatcher',
                `event 落库失败进重试队列 | kind=${kind} platform=${platform} token=${info.token} queue=${this._eventQueue.length}`);
        });
    }

    async _writeEvent(row) {
        const { error } = await this._supabase.from('wss_events').insert([row]);
        if (error) throw new Error(error.message);
        this.stats.eventsWritten++;
    }

    async _flushEventQueue() {
        if (this._eventWriting || this._eventQueue.length === 0) return;
        this._eventWriting = true;
        try {
            while (this._eventQueue.length > 0) {
                const row = this._eventQueue[0];
                try {
                    await this._writeEvent(row);
                    this._eventQueue.shift();
                } catch (e) {
                    this.stats.eventsFailed++;
                    throw e; // 留在队列头，下轮重试
                }
            }
        } finally {
            this._eventWriting = false;
        }
    }

    /** 60s 心跳行：人工查活 + 实验侧断供判据（payload 带两 collector 心跳与统计） */
    async _writeHeartbeat() {
        const collectorState = {};
        for (const [name, collector] of this._collectors) {
            collectorState[name] = {
                lastMessageAt: collector.getLastMessageAt(),
                stats: collector.getStats(),
            };
        }
        const row = {
            kind: 'heartbeat',
            platform: 'watcher',
            token_address: null,
            payload: {
                at: Date.now(),
                collectors: collectorState,
                eventQueue: this._eventQueue.length,
                watcherStats: { ...this.stats },
            },
            block_time: null,
        };
        const { error } = await this._supabase.from('wss_events').insert([row]);
        if (error) {
            this.stats.heartbeatsFailed++;
            throw new Error(error.message);
        }
        this.stats.heartbeatsWritten++;
    }

    /** 60s 断流自愈（自引擎 wss-down-guard 迁入）：消息心跳静默 → forceReconnect（幂等可反复踢） */
    _checkDownGuard() {
        for (const [name, collector] of this._collectors) {
            const since = collector.getLastMessageAt() || collector.stats?.startTime || null;
            if (!since) continue;
            const silentMs = Date.now() - since;
            if (silentMs >= this._downGuardMs) {
                this.stats.forcedReconnects++;
                this.logger.error('', 'WssWatcher',
                    `WSS 断流守护触发强制重连 | platform=${name} silentMs=${silentMs}`);
                try {
                    collector.forceReconnect();
                } catch (e) {
                    this.logger.error('', 'WssWatcher', `forceReconnect 失败 | platform=${name} ${e.message}`);
                }
            }
        }
    }

    /** 心跳行 7 天清理 */
    async _cleanupHeartbeats() {
        const cutoff = new Date(Date.now() - HEARTBEAT_TTL_DAYS * 24 * 3600 * 1000).toISOString();
        const { data, error } = await this._supabase
            .from('wss_events')
            .delete()
            .eq('kind', 'heartbeat')
            .lt('created_at', cutoff)
            .select('id');
        if (error) throw new Error(error.message);
        if (data && data.length > 0) {
            this.stats.heartbeatRowsCleaned += data.length;
            this.logger.info('', 'WssWatcher', `心跳行清理 | 删除 ${data.length} 行（>7天）`);
        }
    }

    getStats() {
        const collectors = {};
        for (const [name, collector] of this._collectors) {
            collectors[name] = {
                lastMessageAt: collector.getLastMessageAt(),
                stats: collector.getStats(),
            };
        }
        return { ...this.stats, eventQueue: this._eventQueue.length, collectors };
    }
}

module.exports = { WssWatcherService };
