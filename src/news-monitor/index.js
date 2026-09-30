#!/usr/bin/env node
/**
 * news-monitor 采集守护进程（常驻，182 screen: news-daemon 部署）。
 *
 * 用法：node src/news-monitor/index.js
 *
 * - pid 单实例锁（pids/news-daemon.pid，watcher 同款模式）
 * - 启动时序：config → 启动即 sync（建 tier Map）→ WSS 启动 →
 *   报告落后补偿（≥80min 并窗）→ 北京时间整点调度（:00 sync / :05 summarize /
 *   每小时 purge 分钟滚动清理 30 天）
 * - SIGINT/SIGTERM 优雅退出。崩溃不自动拉起（screen 现场可见；systemd 场景 Restart 拉起）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadNewsConfig } = require('./config');
const { logger, cleanupOldLogs } = require('./logs');
const store = require('./store');
const { createWssClient } = require('./wss');
const { ingestEvent } = require('./ingest');
const { runSync } = require('./sync');
const { runSummary, LlmClient } = require('./report');

const PID_FILE = path.resolve(__dirname, '../../pids/news-daemon.pid');
const COMPENSATE_MS = 80 * 60 * 1000;
const SCHEDULER_TICK_MS = 30_000;

// ---- pid 防重（watcher 同款） ----
function acquirePidLock() {
    if (fs.existsSync(PID_FILE)) {
        const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (Number.isInteger(oldPid)) {
            try {
                process.kill(oldPid, 0);
                logger.error(`已有 news-daemon 在跑（pid ${oldPid}），拒绝启动。退出。`);
                process.exit(1);
            } catch (e) {
                if (e.code === 'EPERM') {
                    logger.error(`news-daemon pid=${oldPid} 存在但无权限探活，拒绝启动`);
                    process.exit(1);
                }
                logger.warn('残留 pid 文件（进程已不存在），覆盖', { oldPid });
            }
        }
    }
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
}

function releasePidLock() {
    try {
        if (fs.existsSync(PID_FILE) && parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10) === process.pid) {
            fs.unlinkSync(PID_FILE);
        }
    } catch { /* best effort */ }
}

// ---- 整点对齐调度（Asia/Shanghai，与服务器时区无关） ----
// setInterval 30s tick + Intl 取北京时间的 时:分；lastRunKey 防同分钟重复触发，
// busy 闸门防任务重入；run 抛错 ERROR 不影响后续 tick。错过的整点不回溯
// （sync 幂等下个整点自愈；summarize 有 daemon 启动补偿）。

function bjHourMinute(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const h = parts.find(p => p.type === 'hour').value;
    const m = parts.find(p => p.type === 'minute').value;
    const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
    return { hour: Number(h), minute: Number(m), day };
}

function startScheduler({ jobs }) {
    const lastRunKey = new Map(jobs.map(j => [j.key, '']));
    const busy = new Map(jobs.map(j => [j.key, false]));

    const timer = setInterval(async () => {
        const { hour, minute, day } = bjHourMinute();
        for (const job of jobs) {
            if (minute !== job.minute) continue;
            const key = `${day}${String(hour).padStart(2, '0')}-${job.key}`;
            if (lastRunKey.get(job.key) === key) continue;
            if (busy.get(job.key)) {
                logger.warn('调度跳过：上一次任务仍在跑', { job: job.key });
                continue;
            }
            lastRunKey.set(job.key, key);
            busy.set(job.key, true);
            const t0 = Date.now();
            try {
                await job.run();
                logger.info('调度任务完成', { job: job.key, ms: Date.now() - t0 });
            } catch (err) {
                logger.error('调度任务失败', { job: job.key, err: err.message, ms: Date.now() - t0 });
            } finally {
                busy.set(job.key, false);
            }
        }
    }, SCHEDULER_TICK_MS);

    logger.info('调度器已启动', {
        jobs: jobs.map(j => `${j.key}@每小时:${String(j.minute).padStart(2, '0')}分`),
        tz: 'Asia/Shanghai',
    });
    return { stop: () => clearInterval(timer) };
}

async function main() {
    const config = loadNewsConfig('daemon');
    if (!config.enabled) {
        logger.error('newsMonitor.enabled=false，daemon 不启动（检查 config/default.json）');
        process.exit(1);
    }
    logger.info('news-daemon 启动', { pid: process.pid, node: process.version });
    cleanupOldLogs();
    acquirePidLock();

    // handle → ecosystem（web 展示分组与 sync 名单同源）
    const ecoOf = new Map();
    for (const [eco, entries] of Object.entries(config.watchlist)) {
        for (const entry of entries) {
            ecoOf.set(String(typeof entry === 'object' ? entry.handle : entry).toLowerCase(), eco);
        }
    }

    // tier 内存 Map：handle → tier；未知账号按 normal（ingest 内 WARN）
    const tierMap = new Map();
    const nameMap = new Map();
    const tierOf = handle => tierMap.get(handle) ?? null;
    const displayNameOf = handle => nameMap.get(handle) || null;
    const refreshTierMap = accounts => {
        tierMap.clear();
        nameMap.clear();
        for (const a of accounts) {
            tierMap.set(a.handle, a.tier);
            if (a.displayName) nameMap.set(a.handle, a.displayName);
        }
    };

    // 启动即同步（失败不退出：WSS 先收着，下个整点再试）
    try {
        const result = await runSync(config);
        refreshTierMap(result.accounts);
        logger.info('启动同步完成', {
            sheet: result.sheetCount, core: result.coreCount, quotaHit: result.quotaHit,
        });
        if (result.quotaHit) {
            logger.error('⚠️ watch_add 触发配额上限——部分账号未加入监控，请人工决策（升套餐或裁名单）');
        }
    } catch (err) {
        logger.error('启动同步失败（继续启动，下个整点重试）', { err: err.message });
        // 从 watch_accounts 表兜回 tier（上轮同步结果）
        try {
            const rows = await store.fetchAllAccounts();
            for (const r of rows) {
                tierMap.set(r.handle, r.tier);
                if (r.display_name) nameMap.set(r.handle, r.display_name);
            }
            logger.info('已从 watch_accounts 恢复 tier Map', { count: rows.length });
        } catch (e2) {
            logger.error('watch_accounts 恢复也失败（tier 全部按 normal）', { err: e2.message });
        }
    }

    // WSS 采集
    const wss = createWssClient({
        url: config.wssUrl,
        token: config.wssToken,
        heartbeatMs: config.heartbeatMs,
        onEvent: params => { ingestEvent(params, tierOf); },
        onState: s => logger.debug('WSS 状态', { state: s }),
    });
    wss.start();

    // 整点调度
    const llm = new LlmClient({
        baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
    });
    const scheduler = startScheduler({
        jobs: [
            {
                minute: config.syncMinute,
                key: 'sync',
                run: async () => {
                    const result = await runSync(config);
                    refreshTierMap(result.accounts);
                    if (result.quotaHit) {
                        logger.error('⚠️ 整点同步触发配额上限，未尝试账号见上条汇总');
                    }
                },
            },
            {
                minute: config.summaryMinute,
                key: 'summarize',
                run: () => runSummary({ llm, digestCap: config.digestCap, displayNameOf }, 'cron'),
            },
            {
                // 30 天滚动清理（原独立项目 pg_cron 的 daemon 化；每小时跑，幂等无老行即 0 删）
                minute: config.purgeMinute,
                key: 'purge',
                run: async () => {
                    const deleted = await store.purgeOldEvents(config.retainDays);
                    if (deleted > 0) logger.info('twitter_events 滚动清理完成', { deleted, retainDays: config.retainDays });
                },
            },
        ],
    });

    // 报告落后补偿：daemon 重启总是错过整点的话，这里并窗补报
    try {
        const last = await store.getLatestReport();
        if (!last || Date.now() - new Date(last.window_end).getTime() >= COMPENSATE_MS) {
            logger.info('报告落后 ≥80min，启动即并窗补报', { lastWindowEnd: last?.window_end ?? null });
            await runSummary({ llm, digestCap: config.digestCap, displayNameOf }, 'startup');
        }
    } catch (err) {
        logger.error('启动补偿总结失败（不影响运行，下个整点自然补上）', { err: err.message });
    }

    // 优雅退出
    const shutdown = sig => {
        logger.info(`收到 ${sig}，优雅退出`, { wssEvents: wss.stats.eventsReceived });
        scheduler.stop();
        wss.stop();
        releasePidLock();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // 周期性心跳摘要日志（每 10 分钟）
    setInterval(() => {
        logger.info('daemon 心跳', {
            wssState: wss.stats.state,
            events: wss.stats.eventsReceived,
            reconnects: wss.stats.reconnects,
            accounts: tierMap.size,
        });
    }, 10 * 60 * 1000).unref();

    logger.info('news-daemon 启动完成，进入常驻');
}

main().catch(err => {
    logger.error('daemon 启动失败', { err: err.stack || err.message });
    releasePidLock();
    process.exit(1);
});
