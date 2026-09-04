#!/usr/bin/env node

/**
 * Phase 2 验证脚本：FourMemeAnkrWsCollector + FourMemeFactorAggregator 本地 dry-run
 *
 * 两部分（均不写数据库）：
 *   A. FA 合成 tick 序列自检：首价/earlyReturn/per-position 数值断言、离群价剔除、持有者计数
 *   B. collector 真流 dry-run：ankr WSS 连 5 分钟（无 experimentId → tick 只进 FA 与 TokenPool，不落库）
 *
 * 用法：node scripts/dryrun-fourmeme-wss.js [--duration-ms 300000] [--skip-live]
 */

require('dotenv').config({ path: './config/.env' });
const assert = require('assert');

const defaultConfig = require('../config/default.json');
const consoleLogger = {
    info: (expId, comp, msg, meta) => console.log(`[INFO][${comp}] ${msg}`, meta || ''),
    warn: (expId, comp, msg, meta) => console.log(`[WARN][${comp}] ${msg}`, meta || ''),
    error: (expId, comp, msg, meta) => console.log(`[ERROR][${comp}] ${msg}`, meta || ''),
    debug: () => {},
};

// ═══════════════ A. FA 合成 tick 自检 ═══════════════

function syntheticTickSeq(tokenAddress, ts0, specs) {
    // specs: [{type, trader, bnb, tokens, priceBnb}] → tick 流
    return specs.map((s, i) => ({
        token_address: tokenAddress,
        trade_type: s.type,
        trader_address: s.trader,
        price_bnb: s.priceBnb,
        price_usd: s.priceBnb * 600, // 假设 BNB=600 USD
        bnb_amount: s.bnb,
        token_amount: s.tokens,
        offers: 1e9, funds_bnb: 10,
        block_number: 100 + i,
        timestamp: ts0 + i * 15000, // 每 15s 一笔（跨 10s 桶）
        tx_hash: `0xsyn${i}`, log_index: 0,
    }));
}

async function runFaSelfTest() {
    const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
    const fa = new FourMemeFactorAggregator(defaultConfig, consoleLogger);
    const TOKEN = '0x' + 'a'.repeat(40);
    const ts0 = Date.now() - 10 * 60 * 1000;

    // 1) 注册 + 首笔
    fa.registerToken(TOKEN, {
        createdAtMs: ts0,
        totalSupply: 1e9,
        name: 'Synth', symbol: 'SYN',
        creatorAddress: '0x' + 'c'.repeat(40),
    });

    const tickSeq = syntheticTickSeq(TOKEN, ts0 + 60000, [
        { type: 'buy', trader: '0x' + '1'.repeat(40), bnb: 0.1, tokens: 1000000, priceBnb: 1e-7 },
        { type: 'buy', trader: '0x' + '2'.repeat(40), bnb: 0.2, tokens: 1000000, priceBnb: 2e-7 },  // +100%
        { type: 'sell', trader: '0x' + '1'.repeat(40), bnb: 0.05, tokens: 500000, priceBnb: 2.5e-7 },
        { type: 'buy', trader: '0x' + '3'.repeat(40), bnb: 0.3, tokens: 1000000, priceBnb: 3e-7 },   // 首价→300%（out of 80-120 门）
        { type: 'buy', trader: '0x' + '4'.repeat(40), bnb: 0.1, tokens: 300000, priceBnb: 1e-3 },    // 毒价：偏中位 >1000×
        { type: 'sell', trader: '0x' + '2'.repeat(40), bnb: 0.1, tokens: 700000, priceBnb: 3.2e-7 },
    ]);

    const emits = [];
    fa.on('factorsUpdated', (evt) => emits.push(evt));

    const results = tickSeq.map(t => fa.processTick(t));
    const st = fa.getTokenState(TOKEN);

    // ── 断言组 1：基础价格链 ──
    assert.strictEqual(st.firstPriceBnb, 1e-7, 'firstPriceBnb 应为首笔 1e-7');
    assert.strictEqual(st.currentPriceBnb, 3.2e-7, 'currentPriceBnb 应为末笔 3.2e-7（毒价 1e-3 被拒）');
    assert.strictEqual(results[4].priceOutlier, true, '第 5 笔 1e-3 应判离群');
    assert.strictEqual(results[5].priceOutlier, false, '末笔正常价应接受');
    assert.strictEqual(st.highestPriceBnb, 3.2e-7, 'highestPriceBnb 应为 3.2e-7');

    // ── 断言组 2：因子契约数值 ──
    const f = fa.buildFactorMap(TOKEN, tickSeq[5].timestamp);
    const expectEarlyReturn = ((3.2e-7 - 1e-7) / 1e-7) * 100;
    assert.ok(Math.abs(f.earlyReturn - expectEarlyReturn) < 1e-9,
        `earlyReturn 应为 ${expectEarlyReturn}，实际 ${f.earlyReturn}`);
    assert.ok(Math.abs(f.age - 2.25) < 0.01, `age 应为 2.25 分钟（注册后 60s+5×15s），实际 ${f.age}`);
    assert.ok(Math.abs(f.riseSpeed - expectEarlyReturn / 2.25) < 1e-9, 'riseSpeed = earlyReturn/age');
    assert.ok(Math.abs(f.marketCap - 3.2e-7 * 600 * 1e9) < 1, 'marketCap = currentPrice(USD) × totalSupply');
    assert.strictEqual(f.holders, 4, 'holders：trader1 净 50 万 + trader2 净 30 万 + trader3 100 万 + trader4 30 万（毒价拒价不拒成交）→ 4');
    assert.strictEqual(f.tradeCount, 6);
    assert.strictEqual(f.buyCount, 4);
    assert.strictEqual(f.sellCount, 2);
    assert.strictEqual(f.uniqueTraderCount, 4);
    assert.ok(f.txVolumeU24h > 0, 'txVolumeU24h 应为累计 BNB×600');
    assert.ok(f.tvl === 10 * 600, 'tvl = funds_bnb × bnbUsd');
    assert.strictEqual(f.trendDataPoints >= 5, true, '10s 桶序列应 ≥5 点');

    // ── 断言组 3：per-position 持仓因子 ──
    const BUY_PRICE = 3.0e-7, BUY_TS = tickSeq[5].timestamp + 1000;
    fa.setBuyState(TOKEN, { buyPriceBnb: BUY_PRICE, buyPriceUsd: BUY_PRICE * 600, buyTime: BUY_TS }, 'p1');
    // 后续上涨 tick
    fa.processTick({ ...tickSeq[5], price_bnb: 4.5e-7, price_usd: 4.5e-7 * 600, timestamp: BUY_TS + 60000, tx_hash: '0xsynX' });
    const hf = fa.getHolderFactors(TOKEN, 'p1', BUY_TS + 60000);
    assert.ok(Math.abs(hf.profitPercent - 50) < 1e-9, `profitPercent 应为 +50%，实际 ${hf.profitPercent}`);
    assert.ok(Math.abs(hf.holdDuration - 60) < 1e-9, 'holdDuration 应为 60s');
    assert.ok(Math.abs(hf.drawdownFromHighestSinceLastBuy) < 1e-9, '创新高后回撤应为 0');
    const topF = fa.buildFactorMap(TOKEN, BUY_TS + 60000);
    assert.ok(Math.abs(topF.profitPercent - 50) < 1e-9, '顶层 profitPercent = 最新仓');

    fa.clearBuyState(TOKEN, 'p1');
    assert.strictEqual(fa.getHolderFactors(TOKEN, 'p1'), null, '清仓后 getHolderFactors 应为 null');

    // ── 断言组 4：prune ──
    fa.processTick({ ...tickSeq[5], token_address: '0x' + 'b'.repeat(40), timestamp: Date.now() - 40 * 60 * 1000, tx_hash: '0xold' });
    const pruned = fa.pruneStaleTokens(30 * 60 * 1000, new Set([TOKEN]));
    assert.ok(pruned >= 1, '陈旧 token 应被清理');
    assert.ok(fa.getTokenState(TOKEN), '持仓保护集合内的 token 不应被清理');

    // ── 断言组 5：emit 计数 ──
    assert.ok(emits.length >= 7, `factorsUpdated 事件应 ≥7 次，实际 ${emits.length}`);

    // 因子键集合打印（Phase 3 策略审计基准）
    const keys = [...fa.getFactorKeys()].sort();
    console.log(`\n✅ FA 自检全部通过（emit ${emits.length} 次）`);
    console.log(`FA 因子键全集（${keys.length} 个）:`);
    console.log('  ' + keys.join(', '));
}

// ═══════════════ B. collector 真流 dry-run ═══════════════

async function runLiveDryRun(durationMs) {
    const { FourMemeAnkrWsCollector } = require('../src/collectors/fourmeme-ankr-ws-collector.js');
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
    const collector = new FourMemeAnkrWsCollector(defaultConfig, consoleLogger, pool, fa, {
        onTokenCreate: (info) => { lastCreate = info; },
    });
    // 无 setExperimentId → _flushTickBuffer 直接丢弃（dry-run 不写库）

    collector.start();
    console.log(`\n🔗 真流 dry-run ${Math.round(durationMs / 1000)}s（不写库）...`);

    const progressTimer = setInterval(() => {
        console.log(`\n── dry-run 进度 @ ${Math.round((Date.now() - collector.stats.startTime) / 1000)}s ──`);
        console.log(JSON.stringify(collector.getStats(), null, 0));
        console.log(`FA: ${JSON.stringify(fa.getStats())} pool=${pool.getStats().total}`);
        if (lastCreate) {
            console.log(`最近发现: ${lastCreate.symbol || lastCreate.name} ${lastCreate.token} block=${lastCreate.blockNumber}`);
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

    console.log('\n━━━ dry-run 最终结论 ━━━');
    const s = collector.getStats();
    console.log(JSON.stringify(s, null, 2));
    console.log(`FA: ${JSON.stringify(fa.getStats())}`);
    const ok = s.createDecoded > 0 && (s.purchaseDecoded + s.saleDecoded) > 0 && s.decodeFailed === 0;
    console.log(ok
        ? '✅ Phase 2 dry-run 通过：发现与交易事件均解码成功且零解码失败'
        : '❌ Phase 2 dry-run 未通过（检查上方统计）');
    process.exit(ok ? 0 : 2);
}

// ═══════════════ 入口 ═══════════════

(async () => {
    const args = process.argv.slice(2);
    const durationMs = args.includes('--duration-ms')
        ? Number(args[args.indexOf('--duration-ms') + 1])
        : 5 * 60 * 1000;

    try {
        await runFaSelfTest();
    } catch (err) {
        console.error('❌ FA 自检失败:', err.message);
        process.exit(1);
    }

    if (args.includes('--skip-live')) return;
    await runLiveDryRun(durationMs);
})();
