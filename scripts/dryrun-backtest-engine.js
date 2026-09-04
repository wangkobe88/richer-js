#!/usr/bin/env node

/**
 * Phase 4 回放引擎链路本地自检（零 DB 写入）：
 * mock dbManager（supabase 分发：experiment_tokens / wss_price_ticks 喂合成数据，
 * inserts / updates 全收集断言），真实跑通
 *   数据加载 → 逐 tick 回放（FA 增量 + 分腿路由 + 虚拟时钟 debounce）
 *   → 买#1（fire@6s，价 2.5e-7）→ 卖#1（tick4 5e-7，profit 100%）
 *   → 买#2（fire@13s，轮次重买，价 8e-7）→ 不触发卖（+12.5%<15）
 *   → 回放结束强平（9e-7）→ writeBuffer flush → 终态 completed
 *
 * 断言核心：虚拟时间戳贯穿（信号/交易/快照 created 均为回放时刻，非真实时钟）、
 * 轮次语义（getCurrentRound=1）、余额精确核算（0.5% 手续费）、
 * initialBalance 经 _initializeComponents override 生效。
 *
 * 用法：node scripts/dryrun-backtest-engine.js
 */

require('dotenv').config({ path: './config/.env' });
const assert = require('assert');

const consoleLogger = {
    info: (...a) => console.log('[INFO]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    warn: (...a) => console.log('[WARN]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    error: (...a) => console.log('[ERROR]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    debug: () => {},
    setExperimentId: () => {},
};

// ── 合成回放数据 ──
const T0 = Date.now() - 3600_000; // 一小时前的虚拟起点
const S = 1000;
const TOKEN = '0x' + 'e'.repeat(40);
const BNB_USD = 600;

const metaRows = [{
    token_address: TOKEN,
    token_symbol: 'BTTEST',
    created_at: new Date(T0 - 60 * S).toISOString(),
    raw_api_data: { totalSupply: 1e9 },
    creator_address: '0x' + 'c'.repeat(40),
}];

const tickRows = [
    { i: 0, dt: 0, type: 'buy', p: 1e-7 },
    { i: 1, dt: 1, type: 'buy', p: 1.5e-7 },
    { i: 2, dt: 2, type: 'buy', p: 2.0e-7 },
    { i: 3, dt: 3, type: 'buy', p: 2.5e-7 },
    { i: 4, dt: 6, type: 'sell', p: 5e-7 },   // advance(6s) fire 买#1@2.5e-7；本 tick 进 FA 后卖#1@5e-7
    { i: 5, dt: 9, type: 'buy', p: 8e-7 },    // sold → 买腿重新去抖
    { i: 6, dt: 13, type: 'buy', p: 9e-7 },   // advance(13s) fire 买#2@8e-7；+12.5% 不触发卖
].map(({ i, dt, type, p }) => ({
    id: i + 1,
    token_address: TOKEN,
    trade_type: type,
    trader_address: '0x' + String(i + 1).padStart(2, '0').slice(-1).repeat(40),
    price_bnb: String(p),
    price_usd: String(p * BNB_USD),
    bnb_amount: '0.2',
    token_amount: '1e6',
    block_number: 100 + i,
    block_time: new Date(T0 + dt * S).toISOString(),
    tx_hash: '0xtx' + i,
    log_index: 0,
    price_outlier: false,
}));

function makeMockClient() {
    const inserts = []; // { table, rows }
    const updates = []; // { table, patch }
    const selectData = { experiment_tokens: metaRows, wss_price_ticks: tickRows };
    const client = {
        from(table) {
            const b = {};
            b._patch = null;
            b.select = () => b;
            b.eq = () => b;
            b.order = () => b;
            b.insert = (rows) => {
                inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
                return Promise.resolve({ error: null });
            };
            b.update = (patch) => { b._patch = patch; return b; };
            b.range = (from, to) => {
                const rows = selectData[table] || [];
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
            };
            // update 链尾 / 未知 select 的兜底 thenable
            b.then = (resolve, reject) => {
                if (b._patch) updates.push({ table, patch: b._patch });
                return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            };
            return b;
        },
    };
    return { client, inserts, updates };
}

async function main() {
    // ── mock dbManager（require 缓存共享）──
    const { dbManager } = require('../src/services/dbManager');
    const { client, inserts, updates } = makeMockClient();
    dbManager.getClient = () => client;

    // ── mock 预检缓存初始化（避免 wallets 表查询细节）──
    const { TokenHolderService } = require('../src/trading-engine/holders/TokenHolderService');
    const { WalletLabelService } = require('../src/trading-engine/pre-check/WalletLabelService');
    TokenHolderService.prototype.initWalletCache = async () => {};
    WalletLabelService.prototype.initLabelCache = async () => {};

    // ── mock 源实验工厂 ──
    const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
    ExperimentFactory.getInstance = () => ({ load: async () => ({ id: 'src-exp-001', name: 'src', config: {} }) });

    // ── mock 实体落库（writeBuffer 开启时不触达；保险）──
    const entities = require('../src/trading-engine/entities');
    entities.TradeSignal.prototype.save = async function () { return this.id || 'mock-sig'; };
    entities.Trade.prototype.save = async function () { return this.id || 'mock-trade'; };

    const { BacktestEngine } = require('../src/trading-engine/implementations/BacktestEngine');
    const engine = new BacktestEngine();

    engine._experiment = {
        id: 'local-backtest-selftest',
        config: {
            blockchain: 'bsc',
            backtest: { sourceExperimentId: 'src-exp-001', initialBalance: 10 },
            tradeAmount: 0.1,
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'tradeCount >= 3', maxExecutions: 2 }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 15' }],
            },
        },
    };
    engine._experimentId = 'local-backtest-selftest';
    engine.logger = consoleLogger;
    engine._logger = consoleLogger;
    engine.dataService = {
        saveToken: async () => true,
        updateTokenStatus: async () => true,
        getTrades: async () => [],
    };

    const { EngineStatus } = require('../src/trading-engine/interfaces/ITradingEngine');
    await engine._initializeComponents();   // initialBalance override 在此生效
    await engine._initializeDataSources();  // 数据加载（mock 分发）
    engine._isStopped = false;
    engine._status = EngineStatus.RUNNING;

    // ── 0) 数据加载 ──
    assert.strictEqual(engine._ticks.length, 7, '应加载 7 笔 tick');
    assert.strictEqual(engine._tokenMeta.size, 1, '应加载 1 个代币元数据');
    assert.strictEqual(engine._portfolioManager.getPortfolio(engine._portfolioId).cashBalance.toNumber?.() ?? engine._portfolioManager.getPortfolio(engine._portfolioId).cashBalance, 10,
        'portfolio 初始余额应为 config.backtest.initialBalance=10（override 生效）');
    console.log('✅ 数据加载 OK | ticks=7, initialBalance=10');

    // ── 1) 全量回放 ──
    await engine._runMainLoop();

    const tradeInserts = inserts.filter(x => x.table === 'trades').flatMap(x => x.rows);
    const signalInserts = inserts.filter(x => x.table === 'strategy_signals').flatMap(x => x.rows);
    const snapshotInserts = inserts.filter(x => x.table === 'portfolio_snapshots').flatMap(x => x.rows);

    // ── 2) 信号/交易序列 ──
    assert.strictEqual(signalInserts.length, 4, `应产生 4 个信号（买2+卖1+强平1），实际 ${signalInserts.length}`);
    assert.strictEqual(tradeInserts.length, 4, `应产生 4 笔交易，实际 ${tradeInserts.length}`);
    assert.strictEqual(engine.metrics.totalSignals, 4);
    assert.strictEqual(engine.metrics.executedSignals, 4);
    assert.strictEqual(engine.metrics.totalTrades, 4);
    assert.strictEqual(engine.metrics.successfulTrades, 4);
    assert.strictEqual(engine.metrics.debounceFired, 2, 'debounce 应恰好 fire 2 次');
    console.log('✅ 信号/交易序列 OK | signals=4 trades=4 debounceFired=2');

    // ── 3) 虚拟时间戳贯穿（信号/交易 created_at 均为回放历史时刻）──
    const replayEnd = T0 + 13 * S + 1000;
    for (const t of tradeInserts) {
        const ts = new Date(t.created_at).getTime();
        assert.ok(ts >= T0 && ts <= replayEnd, `交易 created_at 应为回放虚拟时间（实际 ${t.created_at}）`);
    }
    for (const s of signalInserts) {
        const ts = new Date(s.created_at).getTime();
        assert.ok(ts >= T0 && ts <= replayEnd, `信号 created_at 应为回放虚拟时间（实际 ${s.created_at}）`);
    }
    assert.strictEqual(snapshotInserts.length, 1, '13s 剧本应产生 1 个 30s 快照桶');
    assert.strictEqual(snapshotInserts[0].snapshot_time, new Date(T0).toISOString(),
        '快照 snapshot_time 应为首个 tick 的虚拟时刻');
    console.log('✅ 虚拟时间戳 OK | 快照/信号/交易均为回放时刻');

    // ── 4) 余额精确核算 ──
    // 买#1 扣 0.1*1.005；卖#1 进 666.6667*3e-4*0.995=0.199；买#2 扣 0.1*1.005；
    // 强平进 208.3333*5.4e-4*0.995=0.1119375（强平卖出同样构成完整交易对）
    for (const t of tradeInserts) {
        console.log(`   trade ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} price=${t.unit_price} at=${t.created_at}`);
    }
    const portfolio = engine._portfolioManager.getPortfolio(engine._portfolioId);
    const finalBalance = typeof portfolio.totalValue === 'number' ? portfolio.totalValue : portfolio.totalValue.toNumber();
    const expected = 10 - 0.1005 + 0.199 - 0.1005 + 0.1119375;
    assert.ok(Math.abs(finalBalance - expected) < 1e-9,
        `终值应为 ${expected}（实际 ${finalBalance}）`);
    assert.strictEqual(engine._tokenPool.getCurrentRound(TOKEN, 'bsc'), 2, '应完成 2 个交易对轮次（含强平对）');
    console.log(`✅ 余额核算 OK | 终值=${finalBalance}（预期 ${expected}）轮次=2`);

    // ── 5) 终态 ──
    assert.ok(engine._finalStatusSet, '终态标志应置位');
    const expUpdates = updates.filter(u => u.table === 'experiments');
    assert.ok(expUpdates.some(u => u.patch.status === 'completed'), '实验状态应更新为 completed');
    console.log(`✅ 终态 OK | completed | signalUpdates=${updates.filter(u => u.table === 'strategy_signals').length}`);

    console.log('\n✅ Phase 4 回放引擎链路自检全部通过（数据加载→回放→轮次重买→强平→虚拟时间戳→终态）');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ 自检失败:', err.message);
    console.error(err.stack);
    process.exit(1);
});
