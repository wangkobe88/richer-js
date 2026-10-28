#!/usr/bin/env node
/**
 * flap collector 盲期暂存白名单——本地零 DB 零网络单测（0xdf7a 案 2026-10-28）
 *
 * 事故：QuoteSet 持久映射 362 万行加载 ~3 分钟（启动后首个 logs 订阅确认即开始），
 * 盲期内全部 trade/graduation 暂存 _pendingDuringBackfill——新创建票（0xdf7a 家族
 * 09:12:14 Created，09:14:37 才重放）整段 tick 延迟，叙事发起/买点全推迟。
 *
 * 修复：白名单票即时处理不暂存——① 实时 QuoteSet 已 apply（正源）；② 本进程 Created
 * （BNB 盘从无 QuoteSet 事件；quote 盘 QuoteSet 按链上 log 序必先于 trade 到达）。
 * 历史票（重启前创建、映射未加载完）维持原暂存语义不变。
 *
 * 覆盖：盲期历史票回归暂存 / session-created BNB 盘即时 / session-created quote 盘
 *       换算即时 / graduation 两态 / flush 零重放+tickKey 去重兜底 / Map 臂独立 /
 *       decode 失败保守暂存 / settled 后零影响 / 0xdf7a 时序现场反证
 *
 * 运行：node scripts/_test_flap_session_created_backfill_bypass.cjs
 */

const path = require('path');
const { ethers } = require('ethers');

const { FlapAnkrWsCollector } = require(path.join(__dirname, '..', 'src', 'collectors', 'flap-ankr-ws-collector.js'));

// ── 脚手架（同 _test_watcher_quote_conversion）──
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
const CREATE_SIG = 'TokenCreated(uint256,address,uint256,address,string,string,string)';
const QUOTE_SET_SIG = 'TokenQuoteSet(address,address)';
const LAUNCHED_SIG = 'LaunchedToDEX(address,address,uint256,uint256)';

function tradeLog({ token, trader, tokenAmt, eth, postPrice, tx, block = 1000, logIndex = 1 }) {
    return {
        topics: [ethers.id(TRADE_SIG)],
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

function createLog({ token, creator, block = 1000, logIndex = 0, tx }) {
    return {
        topics: [ethers.id(CREATE_SIG)],
        data: coder.encode(['uint256', 'address', 'uint256', 'address', 'string', 'string', 'string'],
            [1790000000n, creator, 1n, token, 'Test', 'TST', 'ipfs://x']),
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

function launchedLog({ token, pool, amount, eth, tx, block = 1000, logIndex = 5 }) {
    return {
        topics: [ethers.id(LAUNCHED_SIG)],
        data: coder.encode(['address', 'address', 'uint256', 'uint256'],
            [token, pool, ethers.parseEther(String(amount)), ethers.parseEther(String(eth))]),
        blockNumber: hex(block),
        logIndex: hex(logIndex),
        transactionHash: tx,
    };
}

function makeCollector(callbacks = {}) {
    const cfg = { flapWs: { contracts: { portal: addr('ab') } } };
    return new FlapAnkrWsCollector(cfg, logger, null, null, callbacks);
}

const TOKEN = addr('11');       // session-created 票（0xdf7a 现场形状）
const QUOTE = addr('22');
const TRADER = addr('33');
const HIST = addr('99');        // 历史票（重启前创建、映射未加载）

/** 盲期态：复刻订阅确认后 _scheduleQuoteBackfill 的 settled=false */
function enterBlindZone(c) {
    c._quoteBackfilled = true;
    c._quoteBackfillSettled = false;
    return c;
}

async function main() {
    // ── T1 盲期历史票回归：维持暂存（修复不动原语义）──
    console.log('T1 盲期历史票照旧暂存');
    {
        const c = enterBlindZone(makeCollector());
        await c._processLog(tradeLog({ token: HIST, trader: TRADER, tokenAmt: 10, eth: 0.1, postPrice: 0.01, tx: txHash('a1') }), 1790000000);
        assert(c._pendingDuringBackfill.length === 1, '历史票 trade 进暂存队列');
        assert(c.stats.pendingDuringBackfill === 1, 'pendingDuringBackfill 计数');
        assert(c._tickBuffer.length === 0, '零 tick 输出');
        assert(c.stats.sessionBypassDuringBackfill === 0, '白名单计数零');
    }

    // ── T2 0xdf7a 现场形状：盲期 session-created BNB 盘即时处理 ──
    console.log('T2 盲期 session-created BNB 盘即时（0xdf7a 主修复面）');
    {
        const creates = [];
        const c = enterBlindZone(makeCollector({ onTokenCreate: (i) => creates.push(i) }));
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, tx: txHash('c1') }), 1790000000);
        assert(creates.length === 1 && creates[0].token === TOKEN, 'Created 实时回调（本就不暂存）');
        assert(c._sessionCreatedTokens.has(TOKEN), 'token 入 sessionCreatedTokens');

        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 10, eth: 0.1, postPrice: 0.01, tx: txHash('c2'), logIndex: 1 }), 1790000001);
        assert(c._pendingDuringBackfill.length === 0, '★盲期 trade 不暂存（修复前=暂存整段延迟）');
        assert(c._tickBuffer.length === 1, 'tick 即时落缓冲');
        const row = c._tickBuffer[0];
        assert(near(row.price_bnb, 0.01) && near(row.bnb_amount, 0.1), 'BNB 盘原样不换算');
        assert(row.quote_token === null, 'quote_token null');
        assert(c.stats.sessionBypassDuringBackfill === 1, '白名单放行计数 +1');
    }

    // ── T3 盲期 session-created quote 盘：QuoteSet 实时先到 → trade 换算即时 ──
    console.log('T3 盲期 session-created quote 盘换算即时（0xbe9d15 家族形状）');
    {
        const c = enterBlindZone(makeCollector());
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, tx: txHash('d1') }), 1790000000);
        await c._processLog(quoteSetLog({ token: TOKEN, quote: QUOTE, block: 1000, logIndex: 1, tx: txHash('d1') }), 1790000000);
        assert(c._nonBnbQuoteTokens.get(TOKEN) === QUOTE, 'QuoteSet 实时 apply（Map 臂）');

        c._fetchQuoteRateFromRpc = async () => 0.5;
        await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 100, eth: 2, postPrice: 0.001, tx: txHash('d2'), logIndex: 2 }), 1790000002);
        assert(c._pendingDuringBackfill.length === 0 && c._tickBuffer.length === 1, 'quote 盘 trade 即时');
        const row = c._tickBuffer[0];
        assert(near(row.price_bnb, 0.0005) && near(row.bnb_amount, 1), '换算 0.5 生效');
        assert(row.quote_token === QUOTE, 'quote_token 溯源');
    }

    // ── T4 Map 臂独立成立：非 session 历史票 + 实时 QuoteSet（quote 后改形状）──
    console.log('T4 Map 臂独立（历史票实时 QuoteSet 后改）');
    {
        const c = enterBlindZone(makeCollector());
        c._fetchQuoteRateFromRpc = async () => 0.5;
        await c._processLog(quoteSetLog({ token: HIST, quote: QUOTE, block: 1000, logIndex: 9, tx: txHash('e1') }), 1790000000);
        assert(!c._sessionCreatedTokens.has(HIST), '非 session 票（前置自证）');
        await c._processLog(tradeLog({ token: HIST, trader: TRADER, tokenAmt: 10, eth: 1, postPrice: 0.002, tx: txHash('e2'), logIndex: 1 }), 1790000001);
        assert(c._pendingDuringBackfill.length === 0 && c._tickBuffer.length === 1, 'Map 命中即时放行');
        assert(c.stats.sessionBypassDuringBackfill === 1, '白名单计数');
    }

    // ── T5 graduation 双态：session 即时 / 历史暂存 ──
    console.log('T5 graduation 盲期双态');
    {
        const grads = [];
        const c = enterBlindZone(makeCollector({ onGraduation: (i) => grads.push(i) }));
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, tx: txHash('f1') }), 1790000000);
        await c._processLog(launchedLog({ token: TOKEN, pool: addr('44'), amount: 1e9, eth: 15, tx: txHash('f2') }), 1790000005);
        assert(grads.length === 1 && near(grads[0].fundsBnb, 15), 'session 票 graduation 即时回调（BNB 盘 funds 原值）');
        assert(c._pendingDuringBackfill.length === 0, 'session 票 graduation 不暂存');

        await c._processLog(launchedLog({ token: HIST, pool: addr('44'), amount: 1e9, eth: 15, tx: txHash('f3') }), 1790000006);
        assert(c._pendingDuringBackfill.length === 1, '历史票 graduation 照旧暂存');
        assert(grads.length === 1, '历史票零回调');
    }

    // ── T6 flush 零重放 + tickKey 去重兜底 ──
    console.log('T6 白名单票不进暂存=flush 无从重放；tickKey 去重反证');
    {
        const c = enterBlindZone(makeCollector());
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, tx: txHash('91') }), 1790000000);
        const same = tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 10, eth: 0.1, postPrice: 0.01, tx: txHash('92'), logIndex: 1 });
        await c._processLog(same, 1790000001);
        assert(c._tickBuffer.length === 1, '即时 emit 一次');
        await c._flushPendingDuringBackfill(); // 回放完成
        assert(c._quoteBackfillSettled === true, 'flush 置 settled');
        assert(c._tickBuffer.length === 1, 'flush 零重放（暂存本就为空）');
        assert(c.stats.pendingBackfillFlushed === 0, 'flushed 计数零');

        await c._processLog(same, 1790000001); // 同 logEntry 重放兜底反证
        assert(c._tickBuffer.length === 1 && c.stats.duplicateTicks === 1, 'tickKey 去重挡双发');
    }

    // ── T7 settled 后零影响：白名单只在盲期判定路径消费 ──
    console.log('T7 settled 后白名单零消费');
    {
        const c = makeCollector(); // settled=true 构造默认
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, tx: txHash('81') }), 1790000000);
        await c._processLog(tradeLog({ token: HIST, trader: TRADER, tokenAmt: 10, eth: 0.1, postPrice: 0.01, tx: txHash('82'), logIndex: 1 }), 1790000001);
        assert(c._tickBuffer.length === 1 && c._pendingDuringBackfill.length === 0, 'settled 全票即时');
        assert(c.stats.sessionBypassDuringBackfill === 0, '白名单计数零（不进判定路径）');
    }

    // ── T8 decode 失败保守暂存（盲期未知形状不冒充）──
    console.log('T8 decode 失败保守暂存');
    {
        const c = enterBlindZone(makeCollector());
        const bad = tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1, eth: 1, postPrice: 1, tx: txHash('71'), logIndex: 1 });
        bad.data = '0xdeadbeef'; // 长度非法
        await c._processLog(bad, 1790000000);
        assert(c._pendingDuringBackfill.length === 1, '坏 data 按未命中暂存');
        assert(c._tickBuffer.length === 0, '零 tick');
    }

    // ── T9 0xdf7a 事故现场反证：盲期完整时序零暂存 ──
    console.log('T9 0xdf7a 现场时序反证（Created→QuoteSet→trade 全程盲期）');
    {
        const c = enterBlindZone(makeCollector());
        c._fetchQuoteRateFromRpc = async () => 0.9628; // 实测汇率形状
        await c._processLog(createLog({ token: TOKEN, creator: TRADER, block: 51780900, logIndex: 10, tx: txHash('61') }), 1790000000);
        await c._processLog(quoteSetLog({ token: TOKEN, quote: QUOTE, block: 51780900, logIndex: 11, tx: txHash('61') }), 1790000000);
        for (let i = 0; i < 5; i++) {
            await c._processLog(tradeLog({ token: TOKEN, trader: TRADER, tokenAmt: 1000, eth: 0.5, postPrice: 0.000001, tx: txHash('6' + i), block: 51780901 + i, logIndex: 1 }), 1790000010 + i);
        }
        assert(c._pendingDuringBackfill.length === 0, '★五连 tick 全程零暂存（修复前=353 条延迟 2m53s 重放）');
        assert(c._tickBuffer.length === 5, '五 tick 即时落缓冲');
        assert(c.stats.sessionBypassDuringBackfill === 5, '放行计数=5');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
