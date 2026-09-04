#!/usr/bin/env node

/**
 * Phase 5 live 执行链路本地自检（零 DB 写入、零网络）：
 * mock FourMemeDirectTrader（setWallet/getNativeBalance/buyToken/sellToken）与
 * provider.call（getAmountsOut → BNB/USD=600；balanceOf → 指定代币余额），
 * 真实跑通
 *   live 构造（不抛错）→ _initializeLiveTrader（私钥解密 + 地址一致性校验）
 *   → _loadHoldingsLive（trades 账面重放 + 链上对账 + cash 锚定 + tokenPool/FA 恢复）
 *   → FA tick 卖腿 → _executeSellLive（实收 BNB 换算 USD 记账 + Trade 落库）
 *   → 新币 burst → debounce → _executeBuyLive（fee=0 记账 + 实际成交价锚点）
 *   → 买入失败路径（信号 failed 回写）
 *   → 卖出失败冷却（防 tick 级重试）→ 冷却过期后卖出成功闭环
 *
 * 断言核心：记账口径 USD 名义（fee=0，链上事实优先）、cash=链上可用 BNB 等值、
 * Trade.isVirtualTrade=false + txHash、恢复持仓数量以链上为准。
 *
 * 用法：node scripts/dryrun-fourmeme-engine-live.js
 */

// 必须在 require CryptoUtils 之前固定 ENCRYPTION_KEY（引擎内新实例解密需同 key）
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'live-selftest-key';

require('dotenv').config({ path: './config/.env' });
const assert = require('assert');
const { ethers } = require('ethers');

const consoleLogger = {
    info: (...a) => console.log('[INFO]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    warn: (...a) => console.log('[WARN]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    error: (...a) => console.log('[ERROR]', a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    debug: () => {},
    setExperimentId: () => {},
};

const BNB_USD = 600;
const TOKEN_A = '0x' + 'a'.repeat(40); // 恢复持仓代币
const TOKEN_B = '0x' + 'b'.repeat(40); // live 买入代币
const TOKEN_C = '0x' + 'c'.repeat(40); // 买入失败路径代币

async function main() {
    // ── mock 落库层 ──
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
        savedTrades.push({
            id: this.id,
            direction: this.tradeDirection,
            isVirtual: this.isVirtualTrade,
            txHash: this.txHash,
            inputAmount: this.inputAmount,
            outputAmount: this.outputAmount,
            unitPrice: this.unitPrice,
            metadata: this.metadata,
        });
        return this.id;
    };

    // ── mock dbManager（experiment_tokens 元数据查询分发）──
    const { dbManager } = require('../src/services/dbManager');
    const metaRows = [
        { token_address: TOKEN_A, token_symbol: 'RESTORE', created_at: new Date(Date.now() - 3600_000).toISOString(), raw_api_data: { totalSupply: 1e9 }, creator_address: '0x' + '9'.repeat(40) },
    ];
    dbManager.getClient = () => ({
        from(table) {
            const b = {};
            b.select = () => b;
            b.eq = () => b;
            b.in = (col, values) => {
                if (table === 'experiment_tokens' && col === 'token_address') b._rows = metaRows.filter(r => values.includes(r.token_address));
                return b;
            };
            b.then = (resolve, reject) => Promise.resolve({ data: b._rows || [], error: null }).then(resolve, reject);
            return b;
        },
    });

    // ── mock FourMemeDirectTrader（不连网）──
    const TEST_PRIVATE_KEY = '0x' + '11'.repeat(32); // 公开占位私钥（无资金）
    const fakeProvider = new ethers.JsonRpcProvider('http://127.0.0.1:1');
    const onChainBalances = new Map([[TOKEN_A, 400000]]); // 代币 → 链上数量
    fakeProvider.call = async (tx) => {
        const selector = (tx.data || '').slice(0, 10);
        const coder = ethers.AbiCoder.defaultAbiCoder();
        if (selector === '0xd06ca61f') {
            // getAmountsOut(1e18, [WBNB, USDT]) → [1e18, 600e18]
            return coder.encode(['uint256[]'], [[ethers.parseEther('1'), ethers.parseEther(String(BNB_USD))]]);
        }
        if (selector === '0x70a08231') {
            // balanceOf(wallet) 查询钱包余额；代币身份 = tx.to（ERC20 合约地址）
            const token = (tx.to || '').toLowerCase();
            const qty = onChainBalances.get(token) ?? 0;
            return coder.encode(['uint256'], [ethers.parseUnits(String(qty), 18)]);
        }
        return '0x';
    };

    let buyShouldFail = false;
    let sellShouldFail = false;
    const FourMemeDirectTrader = require('../src/trading-engine/traders/implementations/FourMemeDirectTrader');
    FourMemeDirectTrader.prototype.setWallet = async function (privateKey) {
        this.wallet = new ethers.Wallet(privateKey);
        this.provider = fakeProvider;
        return true;
    };
    FourMemeDirectTrader.prototype.getNativeBalance = async function () {
        return '0.5';
    };
    FourMemeDirectTrader.prototype.buyToken = async function (tokenAddress, amountInWei) {
        if (buyShouldFail) return { success: false, error: '模拟链上买入失败' };
        onChainBalances.set(tokenAddress.toLowerCase(), 80000); // 链上状态随成交推进
        return {
            success: true,
            transactionHash: `0xbuy_${tokenAddress.slice(2, 8)}`,
            gasUsed: '300000',
            actualAmountOut: '80000',
            amountIn: ethers.formatEther(amountInWei),
            method: 'buyTokenAMAP',
        };
    };
    FourMemeDirectTrader.prototype.sellToken = async function (tokenAddress, amountOutWei) {
        if (sellShouldFail) return { success: false, error: '模拟链上卖出失败' };
        onChainBalances.set(tokenAddress.toLowerCase(), 0);
        return {
            success: true,
            transactionHash: `0xsell_${tokenAddress.slice(2, 8)}`,
            gasUsed: '21000',
            amountOut: ethers.formatUnits(amountOutWei, 18),
            actualReceived: '0.12',
        };
    };

    // ── 引擎构造（live 不再抛错）──
    const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
    const engine = new FourMemeWssTradingEngine({ tradingMode: 'live' });
    assert.ok(engine._isLive, '_isLive 应为 true');

    // ── 实验注入（wallet 配置 = 加密测试私钥；live 参数实验级覆盖验证）──
    const { CryptoUtils } = require('../src/utils/CryptoUtils');
    const encryptedKey = new CryptoUtils().encrypt(TEST_PRIVATE_KEY);
    const walletAddress = new ethers.Wallet(TEST_PRIVATE_KEY).address;

    engine._experiment = {
        id: 'local-live-selftest',
        config: {
            strategiesConfig: {
                buyStrategies: [{ priority: 1, condition: 'earlyReturn > 100 AND age < 10' }],
                sellStrategies: [{ priority: 1, condition: 'profitPercent > 15' }],
            },
            tradeAmount: 0.001,
            wallet: { address: walletAddress, privateKey: encryptedKey },
            fourmemeWs: { live: { sellFailureCooldownMs: 1200 } }, // 实验级覆盖（冷却 1.2s 便于测试）
        },
    };
    engine._experimentId = 'local-live-selftest';
    engine.logger = consoleLogger;
    engine._logger = consoleLogger;
    engine.dataService = {
        saveToken: async () => true,
        updateTokenStatus: async () => true,
        // 恢复账面：买 500000@2e-7 + 卖 100000@4e-7 → 净 400000，加权均价 2e-7
        getTrades: async () => ([
            {
                success: true, tradeDirection: 'buy', tokenAddress: TOKEN_A,
                outputAmount: 500000, inputAmount: 0.1, unitPrice: 2e-7,
                createdAt: new Date(Date.now() - 1800_000).toISOString(),
            },
            {
                success: true, tradeDirection: 'sell', tokenAddress: TOKEN_A,
                inputAmount: 100000, outputAmount: 0.04, unitPrice: 4e-7,
                createdAt: new Date(Date.now() - 1200_000).toISOString(),
            },
        ]),
    };

    const signalStatuses = [];
    engine._updateSignalStatus = async (id, status, result) => {
        signalStatuses.push({ id, status, success: result?.success ?? null, reason: result?.reason || result?.message || null });
    };
    engine._updateSignalMetadata = async () => {};

    await engine._initializeComponents();
    await engine._initializeDataSources(); // 含 _initializeLiveTrader + _loadHoldingsLive

    const { EngineStatus } = require('../src/trading-engine/interfaces/ITradingEngine');
    engine._isStopped = false;
    engine._status = EngineStatus.RUNNING;

    // ── 1) live 交易器 + 重启恢复 ──
    assert.strictEqual(engine._walletAddress, walletAddress, '钱包地址应为配置地址');
    assert.strictEqual(engine._lastKnownBnbUsd, BNB_USD, '启动 BNB/USD 直读应为 600（fake getAmountsOut）');
    assert.strictEqual(engine._sellFailureCooldownMs, 1200, '实验级 live 覆盖应生效（冷却 1.2s）');

    const portfolio = engine._portfolioManager.getPortfolio(engine._portfolioId);
    const cashAfterRestore = Number(portfolio.cashBalance);
    // 链上 0.5 BNB - reserve 0.01 = 0.49 × 600 = 294 USD 名义
    assert.ok(Math.abs(cashAfterRestore - 294) < 1e-9, `恢复后 cash 应为 294（实际 ${cashAfterRestore}）`);

    const holdingA = engine._getHolding(TOKEN_A);
    assert.ok(holdingA, '恢复后应有 TOKEN_A 持仓');
    assert.ok(Math.abs(Number(holdingA.amount) - 400000) < 1e-6, `持仓数量应为链上 400000（实际 ${holdingA.amount}）`);
    assert.strictEqual(engine._tokenPool.getToken(TOKEN_A, 'bsc')?.status, 'bought', '恢复后 tokenPool 状态应为 bought');
    assert.ok(engine._factorAggregator.getTokenState(TOKEN_A), '恢复后 FA 应注册代币状态');
    assert.ok(engine._restoreAnchors.has(TOKEN_A), '恢复后应有 FA 锚点待落位');
    console.log(`✅ live 初始化+恢复 OK | cash=${cashAfterRestore} 持仓=400000 状态=bought`);

    // ── 2) FA tick 卖腿 → _executeSellLive ──
    const fa = engine._factorAggregator;
    const tickA = (priceBnb) => fa.processTick({
        token_address: TOKEN_A, trade_type: 'buy', trader_address: '0x' + '5'.repeat(40),
        price_bnb: priceBnb, price_usd: priceBnb * BNB_USD,
        bnb_amount: 0.3, token_amount: 1e6, block_number: 300,
        timestamp: Date.now(), tx_hash: '0xselltick', log_index: 0,
    });
    tickA(5e-7); // 首个可靠价：锚点落位（buyPriceUsd=2e-7）+ factorsUpdated
    tickA(6e-7); // profitPercent=(3.6e-4-2e-7)/2e-7 命中 >15 → 卖腿触发

    await new Promise(r => setTimeout(r, 800));
    const sellTrades = savedTrades.filter(t => t.direction === 'sell');
    assert.strictEqual(sellTrades.length, 1, `应产生 1 笔 live 卖出交易（实际 ${sellTrades.length}）`);
    assert.strictEqual(sellTrades[0].isVirtual, false, 'live 交易 isVirtualTrade 应为 false');
    assert.strictEqual(sellTrades[0].txHash, `0xsell_${TOKEN_A.slice(2, 8)}`, 'Trade 应带链上 txHash');
    assert.strictEqual(sellTrades[0].outputAmount, '0.12', '卖出 outputAmount 应为实收 BNB 0.12');
    // 实际成交价 = 0.12 BNB × 600 / 400000 = 1.8e-4 USD
    assert.ok(Math.abs(Number(sellTrades[0].unitPrice) - 1.8e-4) < 1e-12, `卖出 unitPrice 应为 1.8e-4（实际 ${sellTrades[0].unitPrice}）`);
    // cash：294 + 0.12×600 = 366（fee=0）
    const cashAfterSell = Number(engine._portfolioManager.getPortfolio(engine._portfolioId).cashBalance);
    assert.ok(Math.abs(cashAfterSell - 366) < 1e-9, `卖出后 cash 应为 366（实际 ${cashAfterSell}）`);
    assert.strictEqual(engine._tokenPool.getToken(TOKEN_A, 'bsc')?.status, 'sold', '卖出后应 markAsSold');
    assert.strictEqual(engine._tokenPool.getCurrentRound(TOKEN_A, 'bsc'), 1, '应记录 1 个完整交易对');
    console.log(`✅ live 卖出 OK | tx=${sellTrades[0].txHash} 实收 0.12 BNB cash=${cashAfterSell}`);

    // ── 3) 新币 burst → debounce → _executeBuyLive ──
    const registerToken = (token, symbol) => {
        fa.registerToken(token, { createdAtMs: Date.now() - 60000, totalSupply: 1e9, symbol, creatorAddress: '0x' + '8'.repeat(40) });
        engine._tokenPool.addToken({
            token, chain: 'bsc', platform: 'fourmeme', data_source: 'wss', symbol,
            created_at: Math.floor(Date.now() / 1000) - 60, current_price_usd: null, creator_address: '0x' + '8'.repeat(40),
        });
    };
    registerToken(TOKEN_B, 'LIVEBUY');
    [1e-7, 1.5e-7, 2e-7, 2.5e-7].forEach((p, i) => fa.processTick({
        token_address: TOKEN_B, trade_type: 'buy', trader_address: `0x${String(i + 1).padStart(2, '0').slice(-1).repeat(40)}`,
        price_bnb: p, price_usd: p * BNB_USD, bnb_amount: 0.2, token_amount: 1e6,
        block_number: 400 + i, timestamp: Date.now() - 60000 + i * 16000, tx_hash: `0xbtick${i}`, log_index: 0,
    }));

    await new Promise(r => setTimeout(r, engine._signalDebounceMs + 1500));
    const buyTrades = savedTrades.filter(t => t.direction === 'buy' && t.txHash?.includes('0xbuy'));
    assert.strictEqual(buyTrades.length, 1, `应产生 1 笔 live 买入交易（实际 ${buyTrades.length}）`);
    assert.strictEqual(buyTrades[0].isVirtual, false, 'live 买入 isVirtualTrade 应为 false');
    assert.strictEqual(buyTrades[0].inputAmount, '0.001', '买入 inputAmount 应为真实 BNB 0.001');
    assert.strictEqual(buyTrades[0].outputAmount, '80000', '买入 outputAmount 应为实际成交 80000');
    // 实际成交价 = 0.001 BNB × 600 / 80000 = 7.5e-6 USD
    assert.ok(Math.abs(Number(buyTrades[0].unitPrice) - 7.5e-6) < 1e-15, `买入 unitPrice 应为 7.5e-6（实际 ${buyTrades[0].unitPrice}）`);
    assert.strictEqual(buyTrades[0].metadata.amountInBnb, '0.001', 'metadata 应记录 amountInBnb');
    // cash：366 - 0.001×600 = 365.4（fee=0）
    const cashAfterBuy = Number(engine._portfolioManager.getPortfolio(engine._portfolioId).cashBalance);
    assert.ok(Math.abs(cashAfterBuy - 365.4) < 1e-9, `买入后 cash 应为 365.4（实际 ${cashAfterBuy}）`);
    // 持仓锚点价 = 实际成交价（非信号时刻因子价）
    const tokenB = engine._tokenPool.getToken(TOKEN_B, 'bsc');
    assert.ok(Math.abs(tokenB.buyPrice - 7.5e-6) < 1e-15, `tokenPool buyPrice 应为实际成交价（实际 ${tokenB.buyPrice}）`);
    const posB = fa.getOpenPositions(TOKEN_B);
    assert.ok(posB.length === 1 && Math.abs(posB[0].buyPrice - 7.5e-6) < 1e-15, `FA 锚点价应为实际成交价（实际 ${posB.map(p => p.buyPrice)}）`);
    console.log(`✅ live 买入 OK | tx=${buyTrades[0].txHash} 得 80000 @ 7.5e-6 cash=${cashAfterBuy}`);

    // ── 4) 买入失败路径（信号 failed 回写，无 Trade）──
    buyShouldFail = true;
    registerToken(TOKEN_C, 'LIVEFAIL');
    [1e-7, 1.5e-7, 2e-7, 2.5e-7].forEach((p, i) => fa.processTick({
        token_address: TOKEN_C, trade_type: 'buy', trader_address: `0x${String(i + 1).padStart(2, '0').slice(-1).repeat(40)}`,
        price_bnb: p, price_usd: p * BNB_USD, bnb_amount: 0.2, token_amount: 1e6,
        block_number: 500 + i, timestamp: Date.now() - 60000 + i * 16000, tx_hash: `0xctick${i}`, log_index: 0,
    }));
    await new Promise(r => setTimeout(r, engine._signalDebounceMs + 1500));
    const failedSignals = signalStatuses.filter(s => s.status === 'failed');
    assert.ok(failedSignals.length >= 1, '买入失败信号应回写 failed');
    assert.ok(failedSignals.some(s => (s.reason || '').includes('模拟链上买入失败')), `失败原因应含 trader 错误（实际 ${failedSignals.map(s => s.reason)}）`);
    assert.strictEqual(savedTrades.filter(t => t.txHash?.includes('0xbuy')).length, 1, '失败不应产生新 Trade');
    assert.strictEqual(engine._tokenPool.getToken(TOKEN_C, 'bsc')?.status !== 'bought', true, '失败后不应标记 bought');
    console.log(`✅ 买入失败路径 OK | 信号 failed=${failedSignals.length} 无新 Trade`);
    buyShouldFail = false;

    // ── 5) 卖出失败冷却 → 冷却过期后卖出成功闭环 ──
    sellShouldFail = true;
    fa.processTick({
        token_address: TOKEN_B, trade_type: 'buy', trader_address: '0x' + '7'.repeat(40),
        price_bnb: 1e-6, price_usd: 1e-6 * BNB_USD, bnb_amount: 0.3, token_amount: 1e6,
        block_number: 600, timestamp: Date.now(), tx_hash: '0xretry1', log_index: 0,
    });
    await new Promise(r => setTimeout(r, 800));
    assert.ok(engine._sellCooldownUntil.has(TOKEN_B), '卖出失败应设置冷却');
    const sellCountAfterFail = savedTrades.filter(t => t.direction === 'sell').length;

    // 冷却期内再喂 tick：不重试（无新卖出信号/交易）
    fa.processTick({
        token_address: TOKEN_B, trade_type: 'buy', trader_address: '0x' + '7'.repeat(40),
        price_bnb: 1.1e-6, price_usd: 1.1e-6 * BNB_USD, bnb_amount: 0.3, token_amount: 1e6,
        block_number: 601, timestamp: Date.now(), tx_hash: '0xretry2', log_index: 0,
    });
    await new Promise(r => setTimeout(r, 800));
    assert.strictEqual(savedTrades.filter(t => t.direction === 'sell').length, sellCountAfterFail, '冷却期内不应重试卖出');

    // 冷却过期（1.2s 配置）+ 恢复 trader → 重试成功
    sellShouldFail = false;
    await new Promise(r => setTimeout(r, 1300));
    fa.processTick({
        token_address: TOKEN_B, trade_type: 'buy', trader_address: '0x' + '7'.repeat(40),
        price_bnb: 1.2e-6, price_usd: 1.2e-6 * BNB_USD, bnb_amount: 0.3, token_amount: 1e6,
        block_number: 602, timestamp: Date.now(), tx_hash: '0xretry3', log_index: 0,
    });
    await new Promise(r => setTimeout(r, 800));
    assert.strictEqual(savedTrades.filter(t => t.direction === 'sell').length, sellCountAfterFail + 1, '冷却过期后应重试并成功');
    assert.strictEqual(engine._tokenPool.getToken(TOKEN_B, 'bsc')?.status, 'sold', '卖出成功后应 markAsSold');
    assert.ok(!engine._sellCooldownUntil.has(TOKEN_B), '卖出成功后应清除冷却');
    console.log('✅ 卖出失败冷却 OK | 冷却期不重试，过期后重试成功');

    // ── 6) getStats ──
    const stats = engine.getStats();
    assert.strictEqual(stats.engine.isLive, true, 'getStats 应报告 isLive');
    assert.strictEqual(stats.engine.walletAddress, walletAddress, 'getStats 应报告钱包地址');
    console.log(`✅ getStats OK | wallet=${stats.engine.walletAddress} bnbUsd=${stats.engine.bnbUsd}`);

    console.log('\n✅ Phase 5 live 执行链路自检全部通过（初始化→恢复→卖出→买入→失败路径→冷却闭环）');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ 自检失败:', err.message);
    console.error(err.stack);
    process.exit(1);
});
