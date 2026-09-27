#!/usr/bin/env node
/**
 * flap collector 非 BNB 计价 quote→BNB 换算——本地零 DB 单测（打桩 _fetchQuoteRateFromRpc）
 *
 * 覆盖：换算正确性 / quote_token 落行 / TTL 缓存 / SWR / 超期阻塞刷新 / 负缓存跳过 /
 *       RPC 异常不崩（负缓存）/ inflight 去重 + 同 quote tick 保序 / TokenQuoteSet
 *       单调去重（旧事件晚到不回退）/ graduation 换算成功+失败 / 回放应用 / getLogs 分块
 *
 * 不覆盖（182 部署时自然验证）：_fetchQuoteRateFromRpc 真实链上数学（token0 排序/
 * decimals 归一——已由 /tmp/verify-quote-conv2.mjs 实证 0.9628 汇率 + 量级自洽）、
 * _backfillQuoteSets 的 provider 胶水（3 行 RPC 调用）。
 *
 * 运行：node scripts/_test_watcher_quote_conversion.cjs
 */

const path = require('path');
const { ethers } = require('ethers');

const { FlapAnkrWsCollector } = require(path.join(__dirname, '..', 'src', 'collectors', 'flap-ankr-ws-collector.js'));

// ── 脚手架 ──
let passed = 0, failed = 0;
function assert(cond, label) {
    if (cond) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.error(`  ✗ ${label}`); }
}
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const coder = ethers.AbiCoder.defaultAbiCoder();
const addr = (hex) => '0x' + hex.padStart(40, '0');
const txHash = (hex) => '0x' + hex.padEnd(64, '0');
const hex = (n) => '0x' + n.toString(16);

const TRADE_SIG = 'TokenBought(uint256,address,address,uint256,uint256,uint256,uint256)';
const SOLD_SIG = 'TokenSold(uint256,address,address,uint256,uint256,uint256,uint256)';
const QUOTE_SET_SIG = 'TokenQuoteSet(address,address)';
const LAUNCHED_SIG = 'LaunchedToDEX(address,address,uint256,uint256)';

function tradeLog({ sig = TRADE_SIG, token, trader, tokenAmt, eth, postPrice, tx, block = 1000, logIndex = 1 }) {
    return {
        topics: [ethers.id(sig)],
        data: coder.encode(
            ['uint256', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256'],
            [1790000000n, token, trader,
                ethers.parseEther(String(tokenAmt)), ethers.parseEther(String(eth)), 0n,
                ethers.parseEther(String(postPrice))]
        ),
        blockNumber: hex(block),
        logIndex: hex(logIndex),
        transactionHash: tx,
    };
}

function quoteSetLog({ token, quote, block, logIndex, tx }) {
    return {
        topics: [ethers.id(QUOTE_SET_SIG)],
        data: coder.encode(['address', 'address'], [token, quote]),
        blockNumber: hex(block),
        logIndex: hex(logIndex),
        transactionHash: tx,
    };
}

function launchedLog({ token, pool, amount, eth, tx, block = 1000 }) {
    return {
        topics: [ethers.id(LAUNCHED_SIG)],
        data: coder.encode(['address', 'address', 'uint256', 'uint256'],
            [token, pool, ethers.parseEther(String(amount)), ethers.parseEther(String(eth))]),
        blockNumber: hex(block),
        logIndex: hex(5),
        transactionHash: tx,
    };
}

function makeCollector(callbacks = {}, quoteRate = null) {
    const cfg = { flapWs: { contracts: { portal: addr('ab') } } };
    if (quoteRate) cfg.flapWs.quoteRate = quoteRate;
    return new FlapAnkrWsCollector(cfg, logger, null, null, callbacks);
}

const TOKEN = addr('11');
const QUOTE = addr('22');
const TRADER = addr('33');

async function main() {
    // ── T1 基础换算 + quote_token 溯源 + TTL 缓存 ──
    console.log('T1 基础换算 / quote_token 落行 / TTL 缓存');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = async () => { fetchCalls++; return 0.5; };
        c._nonBnbQuoteTokens.set(TOKEN, QUOTE);

        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 100, eth: 2, postPrice: 0.001, tx: txHash('a1'), logIndex: 1 }), 1790000000);
        assert(c._tickBuffer.length === 1, '换算成功 tick 落缓冲');
        const row = c._tickBuffer[0];
        assert(near(row.price_bnb, 0.0005), `price_bnb = postPrice×rate (0.001×0.5，got ${row.price_bnb})`);
        assert(near(row.bnb_amount, 1), `bnb_amount = eth×rate (2×0.5，got ${row.bnb_amount})`);
        assert(row.quote_token === QUOTE, 'quote_token 溯源落行');
        assert(near(row.token_amount, 100), 'token_amount 不换算');
        assert(c.stats.quoteConverted === 1 && fetchCalls === 1, 'quoteConverted 计数 + 首次 fetch');

        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 50, eth: 1, postPrice: 0.002, tx: txHash('a2'), logIndex: 1, block: 1001 }), 1790000001);
        assert(c._tickBuffer.length === 2 && fetchCalls === 1, '第二笔命中 TTL 缓存零 fetch');
        assert(near(c._tickBuffer[1].price_bnb, 0.001), '第二笔换算正确（0.002×0.5）');
    }

    // ── T2 BNB 计价盘零影响 ──
    console.log('T2 BNB 计价盘零影响');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = async () => { fetchCalls++; return 0.5; };
        await c._processLog(tradeLog({ token: addr('99'), trader: TRADER, tokenAmt: 10, eth: 0.1, postPrice: 0.01, tx: txHash('b1'), logIndex: 1 }), 1790000000);
        const row = c._tickBuffer[0];
        assert(near(row.price_bnb, 0.01) && near(row.bnb_amount, 0.1), '价格金额原样不换算');
        assert(row.quote_token === null, 'quote_token 为 null');
        assert(fetchCalls === 0, '零汇率调用（全同步路径）');
        assert(c.stats.quoteConverted === 0, 'quoteConverted 零计数');
    }

    // ── T3 负缓存：无池 → 跳过，negTtl 内不重打 ──
    console.log('T3 负缓存（无池/无储备）');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = async () => { fetchCalls++; return null; };
        c._nonBnbQuoteTokens.set(TOKEN, QUOTE);
        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 0.01, tx: txHash('c1'), logIndex: 1 }), 1790000000);
        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 0.01, tx: txHash('c2'), logIndex: 1, block: 1001 }), 1790000001);
        assert(c._tickBuffer.length === 0, '两笔 tick 均跳过（宁漏不污染）');
        assert(fetchCalls === 1, '负缓存期内第二次零 fetch');
        assert(c.stats.nonBnbQuoteSkipped === 2, 'nonBnbQuoteSkipped 计数 2');
    }

    // ── T4 RPC 异常：不崩 + 落负缓存 ──
    console.log('T4 RPC 异常路径');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = async () => { fetchCalls++; throw new Error('rpc down'); };
        c._nonBnbQuoteTokens.set(TOKEN, QUOTE);
        let threw = false;
        try {
            await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 0.01, tx: txHash('d1'), logIndex: 1 }), 1790000000);
        } catch { threw = true; }
        assert(!threw, '_processLog 不向调用方抛错（无 unhandled rejection）');
        assert(c._tickBuffer.length === 0 && fetchCalls === 1, '异常→跳过 + 单次调用');
        assert(c._quoteRates.get(QUOTE)?.negative === true, '异常落负缓存');
        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 0.01, tx: txHash('d2'), logIndex: 1, block: 1001 }), 1790000001);
        assert(fetchCalls === 1, '负缓存生效（第二次零 fetch）');
    }

    // ── T5 SWR：TTL 过期未超 staleMax → 旧值先用 + 后台刷新 ──
    console.log('T5 stale-while-revalidate');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = async () => { fetchCalls++; return 0.6; };
        c._quoteRates.set(QUOTE, { rate: 0.4, fetchedAtMs: Date.now() - 31000, negative: false }); // 刚过 TTL 30s
        const t0 = Date.now();
        const conv = await c._getQuoteConversion(QUOTE);
        assert(conv && near(conv.rate, 0.4), '立即返回旧值 0.4（不阻塞）');
        assert(Date.now() - t0 < 50, '同步级返回（未等刷新）');
        await new Promise(r => setTimeout(r, 50));
        assert(fetchCalls === 1, '后台刷新已发出');
        assert(near(c._quoteRates.get(QUOTE).rate, 0.6), '缓存已更新为新值');
        const conv2 = await c._getQuoteConversion(QUOTE);
        assert(conv2 && near(conv2.rate, 0.6), '后续取新值');
    }

    // ── T6 超 staleMax → 阻塞刷新 ──
    console.log('T6 超 staleMaxMs 阻塞刷新');
    {
        const c = makeCollector();
        c._fetchQuoteRateFromRpc = async () => 0.7;
        c._quoteRates.set(QUOTE, { rate: 0.4, fetchedAtMs: Date.now() - 310000, negative: false }); // 超 5min
        const conv = await c._getQuoteConversion(QUOTE);
        assert(conv && near(conv.rate, 0.7), '阻塞等待新值 0.7（5min 旧值不用）');
    }

    // ── T7 inflight 去重 + 同 quote tick 保序 ──
    console.log('T7 inflight 去重 + tick 保序');
    {
        const c = makeCollector();
        let fetchCalls = 0;
        c._fetchQuoteRateFromRpc = () => new Promise((resolve) => setTimeout(() => { fetchCalls++; resolve(1.0); }, 30));
        c._nonBnbQuoteTokens.set(TOKEN, QUOTE);
        const p1 = c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 0.01, tx: txHash('e1'), logIndex: 1 }), 1790000000);
        const p2 = c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 2, eth: 2, postPrice: 0.02, tx: txHash('e2'), logIndex: 2, block: 1001 }), 1790000001);
        await Promise.all([p1, p2]);
        assert(fetchCalls === 1, '并发去重（一次 fetch）');
        assert(c._tickBuffer.length === 2, '两笔均落');
        assert(c._tickBuffer[0].tx_hash === txHash('e1') && c._tickBuffer[1].tx_hash === txHash('e2'),
            '同 token tick 保序（先到先落）');
    }

    // ── T8 TokenQuoteSet 实时应用 + 单调去重 ──
    console.log('T8 TokenQuoteSet 单调去重');
    {
        const c = makeCollector();
        const quoteB = addr('44');
        await c._processLog(quoteSetLog({ token: TOKEN, quote: QUOTE, block: 100, logIndex: 3, tx: txHash('f1') }), 1790000000);
        assert(c._nonBnbQuoteTokens.get(TOKEN) === QUOTE, '实时 QuoteSet 应用');
        await c._processLog(quoteSetLog({ token: TOKEN, quote: quoteB, block: 99, logIndex: 9, tx: txHash('f2') }), 1790000000);
        assert(c._nonBnbQuoteTokens.get(TOKEN) === QUOTE, '旧块事件晚到不回退');
        await c._processLog(quoteSetLog({ token: TOKEN, quote: quoteB, block: 101, logIndex: 0, tx: txHash('f3') }), 1790000000);
        assert(c._nonBnbQuoteTokens.get(TOKEN) === quoteB, '更新块事件正常应用');
        await c._processLog(quoteSetLog({ token: TOKEN, quote: '0x' + '0'.repeat(40), block: 102, logIndex: 0, tx: txHash('f4') }), 1790000000);
        assert(!c._nonBnbQuoteTokens.has(TOKEN), '零地址（BNB 计价）删除条目');
        assert(c.stats.quoteSetEvents === 4, 'quoteSetEvents 计数');
    }

    // ── T9 graduation 换算 ──
    console.log('T9 graduation 换算（成功 + 失败 + BNB 盘）');
    {
        let captured = null;
        const c = makeCollector({ onGraduation: (info) => { captured = info; } });
        c._fetchQuoteRateFromRpc = async () => 2.0;
        c._nonBnbQuoteTokens.set(TOKEN, QUOTE);
        await c._processLog(launchedLog({ token: TOKEN, pool: addr('55'), amount: 1e8, eth: 10, tx: txHash('aa') }), 1790000000);
        assert(captured !== null, 'onGraduation 回调触发');
        assert(near(captured.fundsBnb, 20), `fundsBnb 换算 10×2.0（got ${captured.fundsBnb}）`);
        assert(near(captured.fundsQuote, 10), 'fundsQuote 留原值');
        assert(captured.quoteToken === QUOTE, 'quoteToken 透传');

        let captured2 = null;
        const c2 = makeCollector({ onGraduation: (info) => { captured2 = info; } });
        c2._fetchQuoteRateFromRpc = async () => null;
        c2._nonBnbQuoteTokens.set(TOKEN, QUOTE);
        await c2._processLog(launchedLog({ token: TOKEN, pool: addr('55'), amount: 1e8, eth: 10, tx: txHash('ab') }), 1790000000);
        assert(captured2.fundsBnb === null, '换算失败 fundsBnb=null（不冒充 BNB）');
        assert(near(captured2.fundsQuote, 10) && captured2.quoteToken === QUOTE, '失败留 fundsQuote + quoteToken');
        assert(c2.stats.quoteRateUnavailable === 1, 'quoteRateUnavailable 计数');

        let captured3 = null;
        const c3 = makeCollector({ onGraduation: (info) => { captured3 = info; } });
        c3._fetchQuoteRateFromRpc = async () => 2.0;
        await c3._processLog(launchedLog({ token: addr('77'), pool: addr('55'), amount: 1e8, eth: 10, tx: txHash('ac') }), 1790000000);
        assert(near(captured3.fundsBnb, 10) && captured3.fundsQuote === null && captured3.quoteToken === null,
            'BNB 盘 graduation 原样（不换算不溯源）');
    }

    // ── T10 回放应用 _applyQuoteSetLogs ──
    console.log('T10 启动回放日志应用');
    {
        const c = makeCollector();
        const t2 = addr('66');
        c._applyQuoteSetLogs([
            quoteSetLog({ token: TOKEN, quote: QUOTE, block: 100, logIndex: 1, tx: txHash('ba') }),
            quoteSetLog({ token: t2, quote: addr('44'), block: 101, logIndex: 1, tx: txHash('bb') }),
            quoteSetLog({ token: TOKEN, quote: addr('55'), block: 99, logIndex: 1, tx: txHash('bc') }),   // 乱序旧事件
            quoteSetLog({ token: t2, quote: '0x' + '0'.repeat(40), block: 102, logIndex: 1, tx: txHash('bd') }), // 改 BNB
        ]);
        assert(c._nonBnbQuoteTokens.get(TOKEN) === QUOTE, '乱序旧事件被单调去重忽略');
        assert(!c._nonBnbQuoteTokens.has(t2), '回放内 BNB 转换生效');
        assert(c.stats.quoteSetBackfilled === 3, `applied 计数只算实际应用（got ${c.stats.quoteSetBackfilled}）`);
    }

    // ── T11 getLogs 分块 ──
    console.log('T11 _fetchQuoteSetLogs 分块');
    {
        const c = makeCollector();
        const ranges = [];
        const fakeProvider = { getLogs: async (f) => { ranges.push([f.fromBlock, f.toBlock]); return []; } };
        await c._fetchQuoteSetLogs(fakeProvider, 0, 4500);
        assert(JSON.stringify(ranges) === JSON.stringify([[0, 1999], [2000, 3999], [4000, 4500]]),
            `2000 块分块且尾块截断（got ${JSON.stringify(ranges)}）`);
    }

    // ── T12 回放失败退避重试调度 ──
    console.log('T12 回放失败退避重试');
    {
        const warns = [];
        const logger2 = { info: () => {}, warn: (...a) => warns.push(a[2]), error: () => {}, debug: () => {} };
        const c = new FlapAnkrWsCollector(
            { flapWs: { contracts: { portal: addr('ab') } } }, logger2, null, null, {});
        let attempts = 0;
        c._backfillQuoteSets = () => {
            attempts++;
            return attempts < 2 ? Promise.reject(new Error('rate limit -32005')) : Promise.resolve();
        };
        c._scheduleQuoteBackfill();
        await new Promise(r => setTimeout(r, 20));
        assert(attempts === 1, '首轮立即执行');
        assert(c._quoteBackfillRetryTimer !== null, '失败已挂重试定时器');
        assert(warns.some(m => /30s 后重试.*rate limit/.test(m)), `warn 带重试间隔与原因（got ${warns[0]}）`);
        await c.stop();
        assert(c._quoteBackfillRetryTimer === null, 'stop 清理重试定时器');
    }

    // ── T13 回放 RPC 端点解析 ──
    console.log('T13 _resolveBackfillRpcUrl 五分支');
    {
        const bakWs = process.env.ANKR_WS_URL, bakKey = process.env.ANKR_API_KEY;
        const K1 = 'a'.repeat(64), K2 = 'b'.repeat(64);
        try {
            process.env.ANKR_API_KEY = K1; delete process.env.ANKR_WS_URL;
            assert(makeCollector({}, { backfillRpcUrl: 'ankrFromEnv' })._resolveBackfillRpcUrl()
                === `https://rpc.ankr.com/bsc/${K1}`, 'ankrFromEnv + ANKR_API_KEY');

            process.env.ANKR_WS_URL = `wss://rpc.ankr.com/bsc/ws/${K2}`;
            assert(makeCollector({}, { backfillRpcUrl: 'ankrFromEnv' })._resolveBackfillRpcUrl()
                === `https://rpc.ankr.com/bsc/${K2}`, 'ankrFromEnv + ANKR_WS_URL 提取 key 优先');

            process.env.ANKR_WS_URL = 'wss://rpc.ankr.com/bsc/ws'; // 无 key 形状（尾段 'ws'）
            assert(makeCollector({}, { backfillRpcUrl: 'ankrFromEnv' })._resolveBackfillRpcUrl()
                === `https://rpc.ankr.com/bsc/${K1}`, '无 key WS_URL 回退 ANKR_API_KEY');
            delete process.env.ANKR_API_KEY;
            assert(makeCollector({}, { backfillRpcUrl: 'ankrFromEnv' })._resolveBackfillRpcUrl()
                === null, 'ankrFromEnv 但无任何 key → null（回退主 rpcUrl）');

            assert(makeCollector({}, { backfillRpcUrl: 'https://x.example/rpc' })._resolveBackfillRpcUrl()
                === 'https://x.example/rpc', '显式 url 直用');
            assert(makeCollector()._resolveBackfillRpcUrl() === null, '缺省 → null（主 rpcUrl）');
        } finally {
            if (bakWs !== undefined) process.env.ANKR_WS_URL = bakWs; else delete process.env.ANKR_WS_URL;
            if (bakKey !== undefined) process.env.ANKR_API_KEY = bakKey; else delete process.env.ANKR_API_KEY;
        }
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
    console.error('测试执行异常:', err);
    process.exitCode = 1;
});
