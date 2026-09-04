#!/usr/bin/env node

/**
 * Phase 3 引擎链路本地自检（零 DB 写入）：
 * mock Trade/TradeSignal 落库与信号状态回写，真实跑通
 *   TokenCreate 入池 → FA tick → _onFactorsUpdated → debounce 买评估 → 买入记账
 *   → FA.setBuyState → 上涨 tick → 卖腿评估 → 全额卖出 → markAsSold/clearBuyState
 *
 * 不连 WSS（合成 tick 直喂 FA）、不连 Supabase（collector 无 experimentId 不 flush；
 * 时序/统计 intervals 不启动——不调 _runMainLoop）。
 *
 * 用法：node scripts/dryrun-fourmeme-engine.js
 */

require('dotenv').config({ path: './config/.env' });
const assert = require('assert');

const consoleLogger = {
    // 宽容签名：兼容 (expId, comp, msg) 与 (msg, meta) 两种调用形态
    info: (...a) => console.log('[INFO]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    warn: (...a) => console.log('[WARN]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    error: (...a) => console.log('[ERROR]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    debug: () => {},
    setExperimentId: () => {},
};

async function main() {
    // ── mock 落库层（require 缓存共享，引擎内部拿到同一实体类）──
    const entities = require('../src/trading-engine/entities');
    const savedTrades = [];
    const savedSignals = [];
    entities.TradeSignal.prototype.save = async function () {
        this.id = `mock-signal-${savedSignals.length + 1}`;
        savedSignals.push({ id: this.id, action: this.action, metadata: this.metadata });
        return this.id;
    };
    entities.Trade.prototype.save = async function () {
        this.id = `mock-trade-${savedTrades.length + 1}`;
        savedTrades.push({ id: this.id, direction: this.direction });
        return this.id;
    };

    const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'virtual', initialBalance: 1 });

    // ── 手动注入最小实验状态（绕过 initialize() 的 Supabase 读取）──
    engine._experiment = {
        id: 'local-selftest',
        config: {
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 40' }],
            },
            tradeAmount: 0.1,
        },
    };
    engine._experimentId = 'local-selftest';
    engine.logger = consoleLogger;
    engine._logger = consoleLogger;
    engine.dataService = {
        saveToken: async () => true,
        updateTokenStatus: async () => true,
        getTrades: async () => [],
    };

    // 信号状态回写 mock（base 实现直连 Supabase）
    const signalStatuses = [];
    engine._updateSignalStatus = async (id, status, result) => {
        signalStatuses.push({ id, status, success: result?.success ?? null, reason: result?.reason || result?.message || null });
    };
    engine._updateSignalMetadata = async () => {};

    // 核心组件（TokenPool/PortfolioManager/RoundSummary——全部内存操作）
    await engine._initializeComponents();
    // 数据源（PreBuyCheckService/TokenPool/FA/collector/StrategyEngine；测试策略无 preBuyCheckCondition → 不触 AVE）
    await engine._initializeDataSources();

    // 模拟 start() 的引擎状态副作用（base 构造器 _isStopped=true，start() 才置 false），
    // 但不真正调 start()——那会启动真实 WSS collector 与守护 intervals
    const { EngineStatus } = require('../src/trading-engine/interfaces/ITradingEngine');
    engine._isStopped = false;
    engine._status = EngineStatus.RUNNING;

    // collector 不 start()；直接驱动 FA。TokenCreate 链路 =
    // collector._handleTokenCreate（FA.registerToken + pool.addToken）→ onTokenCreate 回调（落库）
    const TOKEN = '0x' + 'e'.repeat(40);
    const createInfo = {
        token: TOKEN, symbol: 'SELFTEST', name: 'SelfTest',
        creator: '0x' + 'c'.repeat(40), requestId: '1', totalSupply: 1e9,
        blockNumber: 100, blockTimeMs: Date.now() - 60000, txHash: '0xcreate',
    };
    engine._factorAggregator.registerToken(TOKEN, {
        createdAtMs: createInfo.blockTimeMs,
        totalSupply: createInfo.totalSupply,
        name: createInfo.name, symbol: createInfo.symbol,
        creatorAddress: createInfo.creator,
    });
    engine._tokenPool.addToken({
        token: TOKEN, chain: 'bsc', platform: 'fourmeme', data_source: 'wss',
        name: createInfo.name, symbol: createInfo.symbol,
        created_at: Math.floor(createInfo.blockTimeMs / 1000),
        current_price_usd: null, creator_address: createInfo.creator,
    });
    await engine._handleNewToken(createInfo);
    assert.ok(engine._seenTokens.has(`${TOKEN}-bsc`), '新代币应入 _seenTokens');
    assert.ok(engine._tokenPool.getToken(TOKEN, 'bsc'), '新代币应入池');

    const fa = engine._factorAggregator;
    const BNB_USD = 600;
    const tick = (i, priceBnb, trader, type = 'buy') => fa.processTick({        token_address: TOKEN, trade_type: type, trader_address: trader,
        price_bnb: priceBnb, price_usd: priceBnb * BNB_USD,
        bnb_amount: 0.2, token_amount: 1e6, offers: 1e9, funds_bnb: 10,
        block_number: 200 + i, timestamp: Date.now() - 60000 + i * 16000,
        tx_hash: `0xtick${i}`, log_index: 0,
    });

    // ── 1) 连续 tick burst（1e-7 → 2.5e-7，earlyReturn=150% 命中买入门）──
    tick(0, 1e-7, '0x' + '1'.repeat(40));
    tick(1, 1.5e-7, '0x' + '2'.repeat(40));
    tick(2, 2.0e-7, '0x' + '3'.repeat(40));
    tick(3, 2.5e-7, '0x' + '4'.repeat(40)); // burst 内 debounce 持续重置

    // 等 debounce fire + 买路径执行完成
    await new Promise(r => setTimeout(r, engine._signalDebounceMs + 1500));
    assert.strictEqual(savedSignals.filter(s => s.action === 'buy').length, 1, '应恰好产生 1 个买入信号（burst 去抖）');
    if (signalStatuses.filter(s => s.success === true).length !== 1) {
        console.log('诊断 signalStatuses =', JSON.stringify(signalStatuses, null, 2));
        console.log('诊断 savedTrades =', JSON.stringify(savedTrades, null, 2));
    }
    assert.strictEqual(signalStatuses.filter(s => s.success === true).length, 1, '买入信号应 executed');
    const token = engine._tokenPool.getToken(TOKEN, 'bsc');
    assert.strictEqual(token.status, 'bought', '买入后 token.status=bought');
    assert.ok(engine._getHolding(TOKEN), '应有持仓');
    assert.strictEqual(fa.getOpenPositions(TOKEN).length, 1, 'FA 应有 1 个持仓锚点');
    const balAfterBuy = engine.currentBalance;
    // PortfolioManager.executeTrade 默认 tradingFee=0.005：0.1 本金 + 0.0005 手续费（与旧 Virtual 引擎同源）
    assert.ok(Math.abs(balAfterBuy - (1 - 0.1 * 1.005)) < 1e-9, `买入应扣 0.1 本金 + 0.5% 手续费（实际 ${balAfterBuy}）`);
    console.log(`✅ 买入链路 OK | 信号=${savedSignals.find(s => s.action === 'buy').id} 余额=${balAfterBuy}`);

    // ── 2) 下跌再上涨 tick：+100% 触发卖出（profitPercent=(5e-7-2.5e-7)/2.5e-7=100% > 40）──
    const baseTs = Date.now();
    fa.processTick({
        token_address: TOKEN, trade_type: 'buy', trader_address: '0x' + '5'.repeat(40),
        price_bnb: 5e-7, price_usd: 5e-7 * BNB_USD,
        bnb_amount: 0.3, token_amount: 1e6, offers: 1e9, funds_bnb: 12,
        block_number: 300, timestamp: baseTs, tx_hash: '0xsell1', log_index: 0,
    });

    await new Promise(r => setTimeout(r, 800));
    assert.strictEqual(savedSignals.filter(s => s.action === 'buy').length, 1, '持有期间不应产生第 2 个买入信号（单仓封锁）');
    assert.strictEqual(savedSignals.filter(s => s.action === 'sell').length, 1, '应产生 1 个卖出信号');
    assert.strictEqual(signalStatuses.filter(s => s.status === 'executed').length, 2, '买卖信号均 executed');
    assert.strictEqual(token.status, 'sold', '卖出后 token.status=sold');
    assert.strictEqual(fa.getOpenPositions(TOKEN).length, 0, 'FA 持仓锚点应清除');
    assert.strictEqual(engine._getHolding(TOKEN), null, '组合持仓应清空');
    assert.ok(engine.currentBalance > balAfterBuy, '卖出后余额应回升');
    console.log(`✅ 卖出链路 OK | 卖出后余额=${engine.currentBalance.toFixed(6)}`);

    // ── 3) sold 后轮次重买（getCurrentRound=1，第 2 轮买入）──
    fa.processTick({
        token_address: TOKEN, trade_type: 'buy', trader_address: '0x' + '6'.repeat(40),
        price_bnb: 8e-7, price_usd: 8e-7 * BNB_USD,
        bnb_amount: 0.2, token_amount: 5e5, offers: 1e9, funds_bnb: 15,
        block_number: 400, timestamp: baseTs + 30000, tx_hash: '0xafter', log_index: 0,
    });
    await new Promise(r => setTimeout(r, engine._signalDebounceMs + 1500));
    assert.strictEqual(savedSignals.filter(s => s.action === 'buy').length, 2, 'sold 后应触发第 2 轮买入');
    assert.strictEqual(engine._tokenPool.getCurrentRound(TOKEN, 'bsc'), 1, '交易对轮次应为 1');
    assert.strictEqual(signalStatuses.filter(s => s.status === 'executed').length, 3, '第 2 轮买入也应 executed');
    assert.strictEqual(token.status, 'bought', '第 2 轮买入后 token.status=bought');
    assert.strictEqual(fa.getOpenPositions(TOKEN).length, 1, 'FA 应重建 1 个持仓锚点');

    // ── 4) getStats 汇总 ──
    const stats = engine.getStats();
    assert.ok(stats.metrics.factorsUpdatedCount >= 6, 'factorsUpdated 心跳应累计');
    assert.ok(stats.collector === null || typeof stats.collector === 'object', 'stats 结构完整');
    console.log(`✅ 轮次重买 OK | signals=${savedSignals.length} trades=${savedTrades.length} ` +
        `debounceFired=${stats.metrics.debounceFired} suppressed=${stats.metrics.debounceSuppressed}`);

    console.log('\n✅ Phase 3 引擎链路自检全部通过（买入→持仓→卖出→单仓封锁→轮次重买）');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ 自检失败:', err.message);
    console.error(err.stack);
    process.exit(1);
});
