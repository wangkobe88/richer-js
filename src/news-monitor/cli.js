#!/usr/bin/env node
/**
 * news-monitor 手动单步工具（验证与运维）：
 *   node src/news-monitor/cli.js sheet                     拉取解析 Sheet + watchlist 选中清单对数
 *   node src/news-monitor/cli.js listen [--minutes 15]     连 WSS 打印原始事件（连通性+结构观察）
 *   node src/news-monitor/cli.js sync                      执行一轮三方同步（含 watch_add/delete）
 *   node src/news-monitor/cli.js summarize                 手动执行一次小时总结
 */
'use strict';

const { loadNewsConfig } = require('./config');
const { logger } = require('./logs');
const { fetchSheetAccounts, filterByWatchlist, runSync } = require('./sync');
const { runSummary, LlmClient } = require('./report');
const { createWssClient } = require('./wss');
const store = require('./store');

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
    if (!['sheet', 'listen', 'sync', 'summarize'].includes(cmd)) {
        console.log('用法: node src/news-monitor/cli.js sheet | listen [--minutes N] | sync | summarize');
        process.exit(1);
    }
    const config = loadNewsConfig(cmd);

    if (cmd === 'sheet') {
        const all = await fetchSheetAccounts(config.sheetCsvUrls);
        const accounts = filterByWatchlist(all, config.watchlist);
        const core = accounts.filter(a => a.tier === 'core');
        console.log(`Sheet 共 ${all.length} 个账号，watchlist 选中 ${accounts.length} 个（core ${core.length}）：`);
        for (const eco of Object.keys(config.watchlist)) {
            console.log(`-- ${eco} --`);
            for (const a of accounts.filter(x => x.ecosystem === eco)) {
                console.log(`  ${a.tier === 'core' ? '★' : ' '} ${a.handle.padEnd(22)} ${a.displayName || '-'}`);
            }
        }
        process.exit(0);
    }

    if (cmd === 'listen') {
        const minutesIdx = rest.indexOf('--minutes');
        const minutes = minutesIdx >= 0 ? Number(rest[minutesIdx + 1]) : 15;
        console.log(`连接 WSS 监听 ${minutes} 分钟（打印原始事件）...`);
        let count = 0;
        const client = createWssClient({
            url: config.wssUrl,
            token: config.wssToken,
            heartbeatMs: config.heartbeatMs,
            onEvent: params => {
                count += 1;
                console.log(`\n===== event #${count} =====`);
                console.log(JSON.stringify(params, null, 2));
            },
            onState: s => console.log(`[state] ${s}`),
        });
        client.start();
        setTimeout(() => {
            console.log(`\n时间到，共收到 ${count} 个事件，退出。`);
            client.stop();
            process.exit(0);
        }, minutes * 60 * 1000);
        return;
    }

    if (cmd === 'sync') {
        const result = await runSync(config);
        console.log('sync 完成', {
            sheet: result.sheetCount, added: result.added.length,
            deleted: result.deleted.length, quotaHit: result.quotaHit,
        });
        process.exit(result.quotaHit ? 1 : 0);
    }

    // summarize
    const llm = new LlmClient({
        baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
    });
    const accounts = await store.fetchAllAccounts();
    const nameMap = new Map(accounts.map(a => [a.handle, a.display_name]));
    const result = await runSummary({
        llm, digestCap: config.digestCap,
        displayNameOf: h => nameMap.get(h) || null,
    }, rest.includes('--trigger') ? rest[rest.indexOf('--trigger') + 1] : 'manual');
    console.log('summarize 结果:', JSON.stringify(result));
    process.exit(result.failed ? 1 : 0);
}

main().catch(err => {
    logger.error('cli 执行失败', { err: err.stack || err.message });
    process.exit(1);
});
