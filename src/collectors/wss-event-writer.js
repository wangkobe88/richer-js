/**
 * WssEventWriter —— wss_events 事件写入器（带重试队列）
 *
 * 自 WssWatcherService（watcher 架构，2026-10-09 废除）抽取的事件落库链：collector 回调
 * （token_create / graduation / token_quote_set）→ 立即 insert wss_events，失败进内存
 * 重试队列保序（队头重试，写成功才 shift），绝不 fire-and-forget——create 行丢失 =
 * token 对所有实验/回测/叙事年龄锚永久不可见。
 *
 * watcher 退役后由实验进程内嵌（引擎 _createCollectors 接线），行形状与 watcher 时代
 * 逐字一致（消费方 PrecheckFailRetryService / token-info-service / BacktestEngine
 * totalSupply / flap quote map 水位零变化）：
 *   { kind, platform, token_address: info.token || null, payload: info,
 *     block_time: info.blockTimeMs ? ISO : null }
 *
 * 刻意不写 heartbeat 行（watcher 专属人工查活 + consumer 断供判据；直连架构判据回到
 * collector.getLastMessageAt()，无读者）。
 *
 * 多实验并发各自写一份：wss_events 无唯一约束，重复行可容忍（读方取最早 token_create /
 * quote map 按 (blockNumber,logIndex) 排序应用同 payload 幂等）。
 *
 * ⚠️ DB 访问必须经 dbManager.getClient()（service key）——anon key 对 wss_events/wss_price_ticks
 *   被 RLS 静默过滤（[[supabase-key-anon-rls]]）。
 */

'use strict';

const EVENT_RETRY_MS_DEFAULT = 30 * 1000;

class WssEventWriter {
    /**
     * @param {Object} logger - { info, warn, error }
     * @param {Object} [config] - { eventRetryMs } 均可缺省
     */
    constructor(logger, config = {}) {
        this.logger = logger;
        this._retryMs = config.eventRetryMs || EVENT_RETRY_MS_DEFAULT;

        this._supabase = null;
        this._queue = [];        // 写失败待重试（队头重试保序，镜像 tickBuffer unshift 语义）
        this._writing = false;
        this._retryTimer = null;
        this._stopped = false;

        this.stats = {
            eventsWritten: 0,
            eventsFailed: 0,
        };
    }

    /** 启动 30s 重试定时器（supabase client 惰性取——enqueue 先到也走 _ensureClient） */
    start() {
        if (this._retryTimer) return;
        const { dbManager } = require('../services/dbManager');
        this._supabase = dbManager.getClient();
        this._retryTimer = setInterval(() => {
            this._flush().catch(e =>
                this.logger.error('', 'WssEventWriter', `events 重试刷新失败: ${e.message}`));
        }, this._retryMs);
    }

    /** 事件入队：立即尝试落库，失败进重试队列（绝不 fire-and-forget） */
    enqueue(kind, platform, info) {
        const row = {
            kind,
            platform,
            token_address: info.token || null,
            payload: info,
            block_time: info.blockTimeMs ? new Date(info.blockTimeMs).toISOString() : null,
        };
        this._write(row).catch(() => {
            this._queue.push(row);
            this.logger.warn('', 'WssEventWriter',
                `event 落库失败进重试队列 | kind=${kind} platform=${platform} token=${info.token} queue=${this._queue.length}`);
        });
    }

    async _write(row) {
        const { error } = await this._supabase.from('wss_events').insert([row]);
        if (error) throw new Error(error.message);
        this.stats.eventsWritten++;
    }

    async _flush() {
        if (this._writing || this._queue.length === 0) return;
        this._writing = true;
        try {
            while (this._queue.length > 0) {
                const row = this._queue[0];
                try {
                    await this._write(row);
                    this._queue.shift();
                } catch (e) {
                    this.stats.eventsFailed++;
                    throw e; // 留在队列头，下轮重试
                }
            }
        } finally {
            this._writing = false;
        }
    }

    /** 停机冲刷（create 行丢失 = token 永久不可见；残余条数在 error 日志留痕） */
    async stop() {
        if (this._stopped) return;
        this._stopped = true;
        if (this._retryTimer) clearInterval(this._retryTimer);
        this._retryTimer = null;
        try {
            await this._flush();
        } catch (e) {
            this.logger.error('', 'WssEventWriter',
                `停机 events 冲刷失败（丢失 ${this._queue.length} 条）: ${e.message}`);
        }
    }

    getStats() {
        return { ...this.stats, queueLength: this._queue.length };
    }
}

module.exports = { WssEventWriter };
