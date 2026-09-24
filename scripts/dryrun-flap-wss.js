#!/usr/bin/env node

/**
 * flap collector 本地 dry-run（不写数据库）
 *
 * FlapAnkrWsCollector + FourMemeFactorAggregator 真流验证：
 *   - 无 setExperimentId → tick 只进 FA 与 TokenPool，不落库
 *   - 每 60s 打印 stats 与样本因子
 *   - 结束打印未知 topic0 分布（确认 TokenQuoteSet / LaunchedToDEX 签名是否实测命中）
 *
 * FA 数值自检由 dryrun-fourmeme-wss.js 覆盖（同一 FourMemeFactorAggregator），此处不重复。
 *
 * 用法：node scripts/dryrun-flap-wss.js [--duration-ms 300000]
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
    const { FlapAnkrWsCollector, TOPIC0_MAP } = require('../src/collectors/flap-ankr-ws-collector.js');
    const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
    const TokenPool = require('../src/core/token-pool');

    // FA 只读 config.fourmemeWs.maxTrackedTokens（与 flapWs 数值相同），沿用全局配置
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
    const collector = new FlapAnkrWsCollector({ ...defaultConfig, flapWs: { ...defaultConfig.flapWs, dryRun: true } }, consoleLogger, pool, fa, {
        onTokenCreate: (info) => { lastCreate = info; },
    });
    // config dryRun=true → _flushTickBuffer 直接丢弃（dry-run 不写库）

    collector.start();
    console.log(`\n🔗 flap 真流 dry-run ${Math.round(durationMs / 1000)}s（不写库）...`);

    const progressTimer = setInterval(() => {
        console.log(`\n── dry-run 进度 @ ${Math.round((Date.now() - collector.stats.startTime) / 1000)}s ──`);
        console.log(JSON.stringify(collector.getStats(), null, 0));
        console.log(`FA: ${JSON.stringify(fa.getStats())} pool=${pool.getStats().total}`);
        if (lastCreate) {
            console.log(`最近发现: ${lastCreate.symbol || lastCreate.name} ${lastCreate.token}` +
                `${lastCreate.taxToken ? ' [税币]' : ''} block=${lastCreate.blockNumber}`);
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

    console.log('\n━━━ flap dry-run 最终结论 ━━━');
    const s = collector.getStats();
    console.log(JSON.stringify(s, null, 2));
    console.log(`FA: ${JSON.stringify(fa.getStats())}`);

    console.log('\n── 事件签名覆盖核对 ──');
    console.log(`TokenQuoteSet 捕获: ${s.quoteSetEvents}（0 = 签名待实测确认，看下方未知 topic0）`);
    console.log(`LaunchedToDEX 捕获: ${s.launchedToDex}（0 = 尚无毕业样本或签名有误）`);
    const unknownEntries = Object.entries(s.unknownTopic0 || {}).sort((a, b) => b[1] - a[1]);
    if (unknownEntries.length > 0) {
        console.log(`未知 topic0（${unknownEntries.length} 种，按频次）:`);
        for (const [topic0, count] of unknownEntries.slice(0, 15)) {
            console.log(`  ${topic0}  ×${count}`);
        }
        console.log('（已知非管道核心：0xb4aa5d6b=TaxV2OnBondingCurvePaid 0x445abee5=QuoteRiskLevelSet 0x651864ac=SaltLocked）');
    } else {
        console.log('未知 topic0: 无');
    }
    console.log(`订阅的已知事件 topic0（核对用）: ${[...TOPIC0_MAP.entries()].map(([k, v]) => `${v}=${k}`).join(' ')}`);

    const ok = s.tokenCreated > 0 && (s.tokenBought + s.tokenSold) > 0 && s.decodeFailed === 0;
    console.log(ok
        ? '✅ flap dry-run 通过：发现与交易事件均解码成功且零解码失败'
        : '❌ flap dry-run 未通过（检查上方统计）');
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
