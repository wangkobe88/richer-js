/**
 * WssEventWriter —— wss_events 事件写入器（带重试队列）
 *
 * 自 WssWatcherService（watcher 架构，2026-10-09 废除）抽取的事件落库链：collector 回调
 * （token_create / graduation / token_quote_set）→ 立即 insert wss_events，失败进内存
 * 重试队列，绝不 fire-and-forget——create 行丢失 = token 对所有实验/回测/叙事年龄锚
 * 永久不可见。
 *
 * 重试语义（批次 4b，2026-10-15）：per-row 独立重试——一条坏行不再堵全队列（旧实现
 * 队头失败整轮中断，队头恒坏行=后面好行永远写不出）；失败行保留相对序（读方幂等：
 * 最早 token_create / quote map 按 (blockNumber,logIndex) 排序应用，保序非正确性要求），
 * 绝不丢行。重试队列高水位告警（alertThresholdRows，默认 1000）超阈 error 节流重告 +
 * 回落一次性恢复——同 tickBuffer 水位监控（批次 3a）风格。
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
const EVENT_ALERT_THRESHOLD_ROWS_DEFAULT = 1000;
const EVENT_ALERT_RE_ALERT_MS_DEFAULT = 10 * 60 * 1000;

class WssEventWriter {
    /**
     * @param {Object} logger - { info, warn, error }
     * @param {Object} [config] - { eventRetryMs, eventAlertThresholdRows, eventAlertReAlertMs } 均可缺省
     */
    constructor(logger, config = {}) {
        this.logger = logger;
        this._retryMs = config.eventRetryMs || EVENT_RETRY_MS_DEFAULT;
        this._alertThresholdRows = config.eventAlertThresholdRows ?? EVENT_ALERT_THRESHOLD_ROWS_DEFAULT;
        this._alertReAlertMs = config.eventAlertReAlertMs ?? EVENT_ALERT_RE_ALERT_MS_DEFAULT;

        this._supabase = null;
        this._queue = [];        // 写失败待重试（per-row 重试，失败行保相对序）
        this._writing = false;
        this._retryTimer = null;
        this._stopped = false;
        this._queueAlerted = false;
        this._lastQueueAlertAt = 0;

        this.stats = {
            eventsWritten: 0,
            eventsFailed: 0,
            queuePeak: 0,
            queueAlerts: 0,
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
            this._checkQueueWatermark();
            this.logger.warn('', 'WssEventWriter',
                `event 落库失败进重试队列 | kind=${kind} platform=${platform} token=${info.token} queue=${this._queue.length}`);
        });
    }

    async _write(row) {
        const { error } = await this._supabase.from('wss_events').insert([row]);
        if (error) throw new Error(error.message);
        this.stats.eventsWritten++;
    }

    /**
     * per-row 独立重试（批次 4b）：逐条 shift 尝试，失败行进 survivors 保留相对序，
     * 一条坏行不再堵全队列（旧实现队头失败整轮中断=队头恒坏行时好行永远写不出——
     * 事故现场反证在 _test_wss_event_writer_retry.cjs A 组）。flush 进行中 enqueue
     * 失败 push 的行会被本 while 继续消费（while 退出时 _queue 必空，survivors
     * 覆盖安全），绝不丢行。
     */
    async _flush() {
        if (this._writing || this._queue.length === 0) return;
        this._writing = true;
        try {
            const survivors = [];
            let failed = 0;
            let firstErr = null;
            while (this._queue.length > 0) {
                const row = this._queue.shift();
                try {
                    await this._write(row);
                } catch (e) {
                    this.stats.eventsFailed++;
                    failed++;
                    if (!firstErr) firstErr = e;
                    survivors.push(row); // 失败保留（相对序），下轮重试——绝不丢
                }
            }
            this._queue = survivors;
            if (failed > 0) {
                this.logger.warn('', 'WssEventWriter',
                    `events 重试 ${failed} 条失败保留（下轮再试） | queue=${this._queue.length} 首错: ${firstErr?.message}`);
            }
        } finally {
            this._writing = false;
        }
        this._checkQueueWatermark();
    }

    /** 重试队列高水位告警（O(1)；超阈节流 error 重告 + 回落一次性恢复 info；绝不丢行） */
    _checkQueueWatermark() {
        const len = this._queue.length;
        if (len > this.stats.queuePeak) this.stats.queuePeak = len;
        if (len > this._alertThresholdRows) {
            if (!this._queueAlerted || Date.now() - this._lastQueueAlertAt >= this._alertReAlertMs) {
                this._queueAlerted = true;
                this._lastQueueAlertAt = Date.now();
                this.stats.queueAlerts++;
                this.logger.error('', 'WssEventWriter',
                    `重试队列高水位 | queue=${len} > ${this._alertThresholdRows}（per-row 重试继续，绝不丢事件）`);
            }
        } else if (this._queueAlerted && len <= this._alertThresholdRows) {
            this._queueAlerted = false;
            this.logger.info('', 'WssEventWriter', `重试队列回落 | queue=${len}`);
        }
    }

    /** 停机冲刷（create 行丢失 = token 永久不可见；残余条数与 kind 在 error 日志留痕） */
    async stop() {
        if (this._stopped) return;
        this._stopped = true;
        if (this._retryTimer) clearInterval(this._retryTimer);
        this._retryTimer = null;
        try {
            await this._flush();
        } catch (e) {
            this.logger.error('', 'WssEventWriter',
                `停机 events 冲刷异常: ${e.message}`);
        }
        if (this._queue.length > 0) {
            const kinds = [...new Set(this._queue.map(r => r.kind))].join(',');
            this.logger.error('', 'WssEventWriter',
                `停机残余 ${this._queue.length} 条 event 未落库（kind=${kinds}）——token_create 残余=对应 token 永久不可见`);
        }
    }

    getStats() {
        return { ...this.stats, queueLength: this._queue.length };
    }
}

module.exports = { WssEventWriter };
