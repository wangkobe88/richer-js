#!/usr/bin/env node

/**
 * gang collector 本地 dry-run（不写数据库）
 *
 * GangAnkrWsCollector + FourMemeFactorAggregator 真流验证：
 *   - 无 setExperimentId → tick 只进 FA 与 TokenPool，不落库
 *   - dryRun=true 同时跳过 DB quote map 重建（零 DB）
 *   - 每 60s 打印 stats 与样本因子
 *   - 结束打印未知 topic0 分布（确认五事件签名是否实测命中）
 *
 * M0 验证点（docs/gang-events.md 产出）：事件解码命中率、WBNB 盘净额口径 tick
 * （自算累计 realQuote 对拍事件 dw4 可在远程对 182 DB 行做，本脚本只验解码链）。
 *
 * 用法：node scripts/dryrun-gang-wss.js [--duration-ms 300000]
 */

require('dotenv').config({ path: './config/.env' });

const defaultConfig = require('../config/default.json');
const consoleLogger = {
    info: (expId, comp, msg, meta) => console.log(`[INFO][${comp}] ${msg}`, meta || ''),
    warn: (expId, comp, msg, meta) => console.log(`[WARN][${comp}] ${msg}`, meta || ''),
    error: (expId, comp, msg, meta) => console.log(`[ERROR][${comp}] ${msg}`, meta || ''),
    debug: () => {},
};

async function runLiveDryRun(durationMs) {
    const { GangAnkrWsCollector, TOPIC0_MAP } = require('../src/collectors/gang-ankr-ws-collector.js');
    const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
    const TokenPool = require('../src/core/token-pool');

    const fa = new FourMemeFactorAggregator(defaultConfig, consoleLogger);
    const pool = new TokenPool(consoleLogger);

    let sampleFactorMap = null;
    let sampleToken = null;
    fa.on('factorsUpdated', (evt) => {
        if (!sampleFactorMap && evt.factors.earlyReturn > 50) {
            sampleFactorMap = evt.factors;
            sampleToken = evt.tokenAddress;
        }
    });

    let lastCreate = null;
    let lastGraduation = null;
    const collector = new GangAnkrWsCollector({ ...defaultConfig, gangWs: { ...defaultConfig.gangWs, dryRun: true } }, consoleLogger, pool, fa, {
        onTokenCreate: (info) => { lastCreate = info; },
        onGraduation: (info) => { lastGraduation = info; },
    });
    // config dryRun=true → _flushTickBuffer 直接丢弃 + 跳过 DB quote map 重建（零 DB）

    collector.start();
    console.log(`\n🔗 gang 真流 dry-run ${Math.round(durationMs / 1000)}s（不写库）...`);

    const progressTimer = setInterval(() => {
        console.log(`\n── dry-run 进度 @ ${Math.round((Date.now() - collector.stats.startTime) / 1000)}s ──`);
        console.log(JSON.stringify(collector.getStats(), null, 0));
        console.log(`FA: ${JSON.stringify(fa.getStats())} pool=${pool.getStats().total}`);
        if (lastCreate) {
            console.log(`最近发现: ${lastCreate.symbol || lastCreate.name} ${lastCreate.token}` +
                `${lastCreate.taxed ? ' [taxed]' : ''} quote=${lastCreate.quoteIsBnb ? 'WBNB' : lastCreate.quote}` +
                ` gradAmtBnb=${lastCreate.gradAmtBnb} block=${lastCreate.blockNumber}`);
        }
        if (lastGraduation) {
            console.log(`最近毕业: ${lastGraduation.token} funds=${lastGraduation.fundsBnb} BNB pair=${lastGraduation.dexPool}`);
        }
        if (sampleFactorMap) {
            const f = sampleFactorMap;
            console.log(`样本因子(${sampleToken}): age=${f.age?.toFixed(2)}min earlyReturn=${f.earlyReturn?.toFixed(1)}% ` +
                `holders=${f.holders} tradeCount=${f.tradeCount} trendPts=${f.trendDataPoints} mcap=${f.marketCap?.toExponential(3)}`);
            sampleFactorMap = null; // 打印下一个样本
        }
    }, 60000);

    await new Promise(resolve => setTimeout(resolve, durationMs));
    clearInterval(progressTimer);
    await collector.stop();

    console.log('\n━━━ gang dry-run 最终结论 ━━━');
    const s = collector.getStats();
    console.log(JSON.stringify(s, null, 2));
    console.log(`FA: ${JSON.stringify(fa.getStats())}`);

    console.log('\n── 事件签名覆盖核对 ──');
    console.log(`Graduated 捕获: ${s.graduated}（0 = 尚无毕业样本，正常——~4h/次量级）`);
    console.log(`VirtualQuoteLocked 捕获: ${s.virtualQuoteLocked}（0 = 尚无样本或签名有误）`);
    const unknownEntries = Object.entries(s.unknownTopic0 || {}).sort((a, b) => b[1] - a[1]);
    if (unknownEntries.length > 0) {
        console.log(`未知 topic0（${unknownEntries.length} 种，按频次）:`);
        for (const [topic0, count] of unknownEntries.slice(0, 15)) {
            console.log(`  ${topic0}  ×${count}`);
        }
        console.log('（白名单订阅下不应出现——出现即订阅过滤失效，须排查）');
    } else {
        console.log('未知 topic0: 无');
    }
    console.log(`订阅的已知事件 topic0（核对用）: ${[...TOPIC0_MAP.entries()].map(([k, v]) => `${v}=${k}`).join(' ')}`);

    const ok = s.tokenCreated > 0 && (s.tokenBought + s.tokenSold) > 0 && s.decodeFailed === 0;
    console.log(ok
        ? '✅ gang dry-run 通过：发现与交易事件均解码成功且零解码失败'
        : '❌ gang dry-run 未通过（检查上方统计；gang 盘速 408 token/21h，5min 窗口可能恰好无 Created——延长 --duration-ms）');
    process.exit(ok ? 0 : 2);
}

// ═══════════════ 入口 ═══════════════

(async () => {
    const args = process.argv.slice(2);
    const durationMs = args.includes('--duration-ms')
        ? Number(args[args.indexOf('--duration-ms') + 1])
        : 5 * 60 * 1000;

    await runLiveDryRun(durationMs);
})();
