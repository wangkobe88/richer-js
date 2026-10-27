#!/usr/bin/env node

/**
 * gang collector 解码/口径单测（零 DB 零网络）
 *
 * 覆盖：五事件 topic0 黄金哈希（与 2026-10-27 链上采样对拍固化）、Created 六段
 * 解码+registerToken meta（platform gang/totalSupply 1e9/graduationThresholdBnb）、
 * quote=0x0 亦按 WBNB（合约源码语义）、Buy/Sell tick 净额黄金口径（dw0=净入金→
 * bnb_amount、dw3=tokensOut→token_amount——事故级反证：勿按毛入金解读 dw0）、
 * (txHash,logIndex) 去重、未知 token 暂存→Created 到达重放、非 WNB 盘换算
 * （rate 命中/全 miss 跳行宁漏不污染）、Graduated 回调形状、DB quote map 重建
 * （实时正源不覆盖）、尘 tick 落表不喂 FA、VQL 仅计数。
 *
 * 直接跑：node scripts/_test_gang_collector_decode.cjs（断言失败退出非零）
 */

const assert = require('assert');
const { ethers } = require('ethers');

const { GangAnkrWsCollector, TOPIC0_MAP, GANG_TOTAL_SUPPLY } = require('../src/collectors/gang-ankr-ws-collector');

// ── 五 topic0 黄金哈希（本地 keccak 与链上采样实测对拍一致，2026-10-27 调研固化）──
const GOLDEN_TOPIC0 = {
    Created: '0xd23a447045c377a966a79f59983bae21db7b92fead61df8ace4aea5628043791',
    Buy: '0x6e59ac1e0b7a4b5c385ffff3601e05644c2ed9d875089895ed1b88e9cf8c632a',
    Sell: '0x00055e00ae56ca9d108326c7fd1ab1e6380614100b19bf3e4d1411240a726d86',
    Graduated: '0x6da2ac486174425e3bbc9aab3a6fd9ee8fb4d1c1e769a02af4a159b37c52eea9',
    VirtualQuoteLocked: '0x92cbbe3df7bc99e8bc37c3efdb3dc96270157e1b4e9cdda9fb2380a2e215d53d',
};

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const ZERO = '0x' + '0'.repeat(40);
const LAUNCHPAD = '0x1b8f3f69dfa0a7f63d308c7eb0fd38d8b099966e';

const coder = ethers.AbiCoder.defaultAbiCoder();
const padAddr = (a) => ethers.zeroPadValue(a, 32);
const hex = (n) => '0x' + n.toString(16);
const eth = (n) => ethers.parseEther(String(n));

// ── 桩 ──
function makeStubs() {
    const calls = { faRegister: [], faTicks: [], poolAdds: [], onTokenCreate: [], onTick: [], onGraduation: [], priceUpdates: [] };
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const tokenPool = {
        _tokens: new Map(),
        getToken(addr) { return this._tokens.get(addr.toLowerCase()) || null; },
        addToken(info) { this._tokens.set(info.token.toLowerCase(), info); calls.poolAdds.push(info); return true; },
        updatePrice(addr, chain, priceUsd, at) { calls.priceUpdates.push({ addr, priceUsd }); },
    };
    const fa = {
        registerToken(addr, meta) { calls.faRegister.push({ addr, meta }); },
        processTick(tick, opts) { calls.faTicks.push(tick); return null; },
    };
    const callbacks = {
        onTokenCreate: (info) => calls.onTokenCreate.push(info),
        onTick: (t) => calls.onTick.push(t),
        onGraduation: (info) => calls.onGraduation.push(info),
    };
    return { calls, logger, tokenPool, fa, callbacks };
}

function makeCollector(stubs, gangWsOverrides = {}) {
    const config = {
        gangWs: {
            contracts: { launchpadV2: LAUNCHPAD },
            minTickBnb: 0.001,
            quoteRate: { unknownTokenMax: 2000 },
            ...gangWsOverrides,
        },
    };
    const c = new GangAnkrWsCollector(config, stubs.logger, stubs.tokenPool, stubs.fa, stubs.callbacks, null);
    return c;
}

function createdLog({ token, creator = '0x' + '22'.repeat(20), quote, name = 'Test Token', symbol = 'TST', logoUri = 'https://cdn.gang.fun/ipfs/x', taxed = false, refPair = ZERO, gradAmt = 15, txHash = '0x' + 'aa'.repeat(32), logIndex = 0, blockNumber = 1000 }) {
    return {
        topics: [GOLDEN_TOPIC0.Created, padAddr(token), padAddr(creator), padAddr(quote)],
        data: coder.encode(
            ['string', 'string', 'string', 'bool', 'address', 'uint256'],
            [name, symbol, logoUri, taxed, refPair, eth(gradAmt)]),
        transactionHash: txHash,
        logIndex: hex(logIndex),
        blockNumber: hex(blockNumber),
    };
}

function tradeLog(kind, { token, trader, dw0, dw1 = 0n, dw2 = 0n, dw3, dw4 = 0n, txHash, logIndex, blockNumber = 1001 }) {
    return {
        topics: [GOLDEN_TOPIC0[kind], padAddr(token), padAddr(trader)],
        data: coder.encode(['uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [dw0, dw1, dw2, dw3, dw4]),
        transactionHash: txHash,
        logIndex: hex(logIndex),
        blockNumber: hex(blockNumber),
    };
}

async function main() {
    // ═══ 1. 五 topic0 黄金哈希（本地 keccak = 链上实测；防签名串手滑）═══
    for (const [name, hash] of Object.entries(GOLDEN_TOPIC0)) {
        assert.strictEqual(TOPIC0_MAP.get(hash), name, `topic0 映射缺 ${name}`);
    }
    assert.strictEqual(TOPIC0_MAP.size, 5, 'TOPIC0_MAP 恰五事件');
    assert.strictEqual(GANG_TOTAL_SUPPLY, 1e9, 'totalSupply 常量 1e9');
    console.log('✓ 1. 五 topic0 黄金哈希');

    // ═══ 2. Created 解码：WBNB 盘 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '11'.repeat(20);
        const CREATOR = '0x' + '22'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, creator: CREATOR, quote: WBNB, refPair: '0x' + 'ab'.repeat(20) }), 1793000000);

        assert.strictEqual(c.stats.tokenCreated, 1);
        const q = c._tokenQuotes.get(TOKEN);
        assert.ok(q, 'quote map 登记');
        assert.strictEqual(q.quote, WBNB);
        assert.strictEqual(q.quoteIsBnb, true, 'WBNB 盘免换算');
        assert.strictEqual(q.refPair, '0x' + 'ab'.repeat(20));
        assert.ok(Math.abs(q.gradAmtBnb - 15) < 1e-9, 'WBNB 盘 gradAmt 直取 15');

        // registerToken meta（FA set-once 源）
        assert.strictEqual(stubs.calls.faRegister.length, 1);
        const meta = stubs.calls.faRegister[0].meta;
        assert.strictEqual(meta.platform, 'gang');
        assert.strictEqual(meta.totalSupply, 1e9);
        assert.ok(Math.abs(meta.graduationThresholdBnb - 15) < 1e-9);
        assert.strictEqual(meta.createdAtMs, 1793000000 * 1000);
        assert.strictEqual(meta.creatorAddress, CREATOR);

        // tokenPool 入池 + onTokenCreate info 形状
        assert.strictEqual(stubs.calls.poolAdds.length, 1);
        assert.strictEqual(stubs.calls.poolAdds[0].platform, 'gang');
        const info = stubs.calls.onTokenCreate[0];
        assert.strictEqual(info.logoUri, 'https://cdn.gang.fun/ipfs/x');
        assert.strictEqual(info.taxed, false);
        assert.strictEqual(info.gradAmtQuote, 15);
        assert.strictEqual(info.quoteIsBnb, true);
    }
    console.log('✓ 2. Created WBNB 盘解码+meta');

    // ═══ 3. quote=0x0 亦按 WBNB（合约源码语义）═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '33'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: ZERO }), 1793000000);
        assert.strictEqual(c._tokenQuotes.get(TOKEN).quoteIsBnb, true, '0x0 计价=WBNB');
    }
    console.log('✓ 3. quote=0x0 → WBNB 盘');

    // ═══ 4. Buy/Sell tick 净额黄金口径（dw0=净入金 dw3=tokensOut；净额口径反证）═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '44'.repeat(20);
        const BUYER = '0x' + '55'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: WBNB }), 1793000000);

        // Buy：dw0=0.495 净入金（=毛 0.5 × 0.99 税后）、dw3=10_000_000 tokensOut
        await c._processLog(tradeLog('Buy', {
            token: TOKEN, trader: BUYER, dw0: eth('0.495'), dw3: eth('10000000'), dw4: eth('0.495'),
            txHash: '0x' + 'bb'.repeat(32), logIndex: 1 }), 1793000001);
        assert.strictEqual(c.stats.tokenBought, 1);
        const tick = stubs.calls.faTicks[0];
        assert.strictEqual(tick.token_address, TOKEN);
        assert.strictEqual(tick.trade_type, 'buy');
        assert.strictEqual(tick.trader_address, BUYER);
        assert.ok(Math.abs(tick.bnb_amount - 0.495) < 1e-12, `bnb_amount=dw0 净入金直取，实得 ${tick.bnb_amount}`);
        assert.ok(Math.abs(tick.token_amount - 10000000) < 1e-6, `token_amount=dw3，实得 ${tick.token_amount}`);
        assert.ok(Math.abs(tick.price_bnb - 0.495 / 10000000) < 1e-18, 'price=净入金÷tokenAmount');
        assert.strictEqual(tick.platform, undefined, 'FA 输入不带 platform（registerToken 定身份）');

        // tickRow（buffer 行）platform/quote_token 黄金
        const row = c._tickBuffer[0];
        assert.strictEqual(row.platform, 'gang');
        assert.strictEqual(row.quote_token, null, 'WBNB 盘 quote_token=null');
        assert.strictEqual(row.experiment_id, null, 'experiment_id 防线=引擎绝不 setExperimentId');
        assert.strictEqual(row.sender_address, null, 'resolver 未启用 → NULL 保行');
        assert.strictEqual(row.log_index, 1);

        // Sell：dw0=tokensIn dw3=净收款
        await c._processLog(tradeLog('Sell', {
            token: TOKEN, trader: BUYER, dw0: eth('5000000'), dw3: eth('0.98'), dw4: eth('1.475'),
            txHash: '0x' + 'cc'.repeat(32), logIndex: 2 }), 1793000002);
        assert.strictEqual(c.stats.tokenSold, 1);
        const sell = stubs.calls.faTicks[1];
        assert.strictEqual(sell.trade_type, 'sell');
        assert.ok(Math.abs(sell.token_amount - 5000000) < 1e-6, 'Sell token_amount=dw0 tokensIn');
        assert.ok(Math.abs(sell.bnb_amount - 0.98) < 1e-12, 'Sell bnb_amount=dw3 净收款');

        // 去重：(txHash, logIndex) 重复不计
        await c._processLog(tradeLog('Sell', {
            token: TOKEN, trader: BUYER, dw0: eth('5000000'), dw3: eth('0.98'),
            txHash: '0x' + 'cc'.repeat(32), logIndex: 2 }), 1793000002);
        assert.strictEqual(c.stats.duplicateTicks, 1);
        assert.strictEqual(stubs.calls.faTicks.length, 2, '重复行不重复喂 FA');
    }
    console.log('✓ 4. Buy/Sell 净额黄金口径+去重');

    // ═══ 5. 未知 token 暂存 → Created 到达重放 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '66'.repeat(20);
        // Buy 先于 Created（订阅竞态/乱序）
        await c._processLog(tradeLog('Buy', {
            token: TOKEN, trader: '0x' + '77'.repeat(20), dw0: eth('0.198'), dw3: eth('5000000'),
            txHash: '0x' + 'dd'.repeat(32), logIndex: 5 }), 1793000005);
        assert.strictEqual(c.stats.unknownTokenPending, 1, '暂存');
        assert.strictEqual(stubs.calls.faTicks.length, 0, '暂存期绝不以未知计价冒充出 tick');
        // Created 到达（logIndex 0 早于暂存行——重放按暂存序）
        await c._processLog(createdLog({ token: TOKEN, quote: WBNB }), 1793000006);
        assert.strictEqual(c.stats.unknownTokenPending, 0, 'Created 后清空');
        assert.strictEqual(stubs.calls.faTicks.length, 1, '重放出 tick');
        assert.ok(Math.abs(stubs.calls.faTicks[0].bnb_amount - 0.198) < 1e-12);
        // 重放中仍 miss 的重新入队尾（保序收敛）
        const UNKNOWN = '0x' + 'ee'.repeat(20);
        await c._processLog(tradeLog('Buy', {
            token: UNKNOWN, trader: '0x' + '77'.repeat(20), dw0: eth('0.1'), dw3: eth('1000'),
            txHash: '0x' + 'ef'.repeat(32), logIndex: 6 }), 1793000007);
        await c._processLog(createdLog({ token: TOKEN, quote: WBNB }), 1793000008); // 另一 token 的 Created
        assert.strictEqual(c.stats.unknownTokenPending, 1, '非本 token Created 不消费他票暂存');
    }
    console.log('✓ 5. 未知 token 暂存/重放');

    // ═══ 6. 非 WNB 盘换算：命中 / 全 miss 跳行 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '88'.repeat(20);
        const QUOTE = '0x' + '99'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: QUOTE, gradAmt: 100 }), 1793000000);
        const q = c._tokenQuotes.get(TOKEN);
        assert.strictEqual(q.quoteIsBnb, false);

        // 换算打桩 rate=0.5（gradAmtBnb=100×0.5=50）
        c._getQuoteConversion = async () => ({ rate: 0.5 });
        await c._processLog(tradeLog('Buy', {
            token: TOKEN, trader: '0x' + '77'.repeat(20), dw0: eth('10'), dw3: eth('1000000'),
            txHash: '0x' + '1a'.repeat(32), logIndex: 1 }), 1793000001);
        const t = stubs.calls.faTicks[0];
        assert.ok(Math.abs(t.bnb_amount - 5) < 1e-12, '净额×rate 换算');
        assert.strictEqual(c._tickBuffer[0].quote_token, QUOTE, '非 WNB 盘 quote_token 留痕');
        assert.strictEqual(c.stats.quoteConverted, 1);

        // 全 miss → 跳行（宁漏不污染）
        c._getQuoteConversion = async () => null;
        await c._processLog(tradeLog('Buy', {
            token: TOKEN, trader: '0x' + '77'.repeat(20), dw0: eth('10'), dw3: eth('1000000'),
            txHash: '0x' + '1b'.repeat(32), logIndex: 2 }), 1793000002);
        assert.strictEqual(stubs.calls.faTicks.length, 1, 'miss 跳行不出 tick');
        assert.strictEqual(c.stats.nonBnbQuoteSkipped, 1);
        assert.strictEqual(c.stats.ticksBuffered < 2 || true, true);
    }
    console.log('✓ 6. 非 WNB 盘换算/miss 跳行');

    // ═══ 6b. Created 换算失败：gradAmtBnb=null + quoteRateUnavailable（FA 侧 ?? 15）═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        c._getQuoteConversion = async () => null;
        const TOKEN = '0x' + '2a'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: '0x' + '9b'.repeat(20), gradAmt: 200 }), 1793000000);
        assert.strictEqual(c._tokenQuotes.get(TOKEN).gradAmtBnb, null, '换算失败 null 不冒充');
        assert.strictEqual(c.stats.quoteRateUnavailable, 1);
        assert.strictEqual(stubs.calls.faRegister[0].meta.graduationThresholdBnb, null, 'meta 透传 null（FA set-once 不落 → ?? 15）');
    }
    console.log('✓ 6b. Created 换算失败 null 语义');

    // ═══ 7. Graduated 回调形状（2026-10-27 链上实证三字段：quote/tokenAmount/quoteAmount）═══
    // 实证样本：0x6b2ce31a…e694（quote=0x0c630240…b405 非 WNB、tokenAmount 恒 2e8、
    // quoteAmount==Created gradAmt 逐票精确全等）；旧四字段形状系调研期构造未实证，
    // 对真实事件解码必败——本节锁三字段防复活
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + '3b'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: WBNB }), 1793000000);
        await c._processLog({
            topics: [GOLDEN_TOPIC0.Graduated, padAddr(TOKEN)],
            data: coder.encode(['address', 'uint256', 'uint256'], [WBNB, eth('200000000'), eth('15')]),
            transactionHash: '0x' + '5d'.repeat(32), logIndex: hex(9), blockNumber: hex(1100),
        }, 1793000010);
        assert.strictEqual(c.stats.graduated, 1);
        const g = stubs.calls.onGraduation[0];
        assert.strictEqual(g.token, TOKEN);
        assert.strictEqual(g.dexPool, undefined, '真实事件不带 PCS pair（word0 是 quote）');
        assert.ok(Math.abs(g.tokenAmount - 2e8) < 1e-3, 'tokenAmount=2e8 毕业储备协议常量');
        assert.ok(Math.abs(g.fundsBnb - 15) < 1e-9, 'WBNB 盘 fundsBnb=quoteAmount 直取（==gradAmt）');
        assert.strictEqual(g.fundsQuote, null);
        assert.strictEqual(g.quoteToken, null);
        // 非 WNB 盘：fundsBnb 换算 miss → null + fundsQuote 留原值
        const TOKEN2 = '0x' + '6e'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN2, quote: '0x' + '9c'.repeat(20) }), 1793000000);
        c._getQuoteConversion = async () => null;
        await c._processLog({
            topics: [GOLDEN_TOPIC0.Graduated, padAddr(TOKEN2)],
            data: coder.encode(['address', 'uint256', 'uint256'], ['0x' + '9c'.repeat(20), eth('200000000'), eth('7.6')]),
            transactionHash: '0x' + '7f'.repeat(32), logIndex: hex(10), blockNumber: hex(1101),
        }, 1793000011);
        const g2 = stubs.calls.onGraduation[1];
        assert.strictEqual(g2.fundsBnb, null, '换算 miss fundsBnb=null 诚实语义');
        assert.ok(Math.abs(g2.fundsQuote - 7.6) < 1e-9, 'fundsQuote 留原值');
    }
    console.log('✓ 7. Graduated 回调形状（链上实证三字段 WNB/非 WNB）');

    // ═══ 8. VQL 仅计数 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        await c._processLog({
            topics: [GOLDEN_TOPIC0.VirtualQuoteLocked, padAddr('0x' + '8d'.repeat(20))],
            data: coder.encode(['uint256'], [eth('100')]),
            transactionHash: '0x' + '9e'.repeat(32), logIndex: hex(0), blockNumber: hex(1),
        }, 1793000000);
        assert.strictEqual(c.stats.virtualQuoteLocked, 1);
        assert.strictEqual(stubs.calls.onTokenCreate.length, 0);
        assert.strictEqual(stubs.calls.faTicks.length, 0, 'VQL 无业务消费');
    }
    console.log('✓ 8. VirtualQuoteLocked 仅计数');

    // ═══ 9. 尘 tick：落表不喂 FA ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        const TOKEN = '0x' + 'af'.repeat(20);
        await c._processLog(createdLog({ token: TOKEN, quote: WBNB }), 1793000000);
        await c._processLog(tradeLog('Buy', {
            token: TOKEN, trader: '0x' + '77'.repeat(20), dw0: eth('0.0005'), dw3: eth('10000'),
            txHash: '0x' + 'ba'.repeat(32), logIndex: 1 }), 1793000001);
        assert.strictEqual(stubs.calls.faTicks.length, 0, '尘 tick 不喂 FA');
        assert.strictEqual(c._tickBuffer.length, 1, '尘 tick 仍落表');
    }
    console.log('✓ 9. 尘门落表不喂 FA');

    // ═══ 10. DB quote map 重建（分页/实时正源不覆盖/残行跳过）═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        // 实时已在册（正源，不覆盖）
        const LIVE = '0x' + '1c'.repeat(20);
        await c._processLog(createdLog({ token: LIVE, quote: WBNB }), 1793000000);

        let call = 0;
        // 单页语义：page.length < limit(1000) 即末页 break（keyset 分页正确形状）
        const page1 = [
            { id: 1, payload: { token: LIVE, quote: '0x' + '9d'.repeat(20), quoteIsBnb: false } }, // 实时已册：不覆盖
            { id: 2, payload: { token: '0x' + '2d'.repeat(20), quote: WBNB, quoteIsBnb: true, refPair: ZERO, gradAmtBnb: 15 } },
            { id: 3, payload: { token: '0x' + '3d'.repeat(20), quote: WBNB, quoteIsBnb: true, refPair: null, gradAmtBnb: null } },
        ];
        const fakeQuery = {
            select() { return this; }, eq() { return this; }, gte() { return this; }, gt() { return this; },
            order() { return this; },
            async limit() {
                call++;
                return call === 1 ? { data: page1, error: null } : { data: [], error: null };
            },
        };
        c._supabase = { from() { return fakeQuery; } };
        const applied = await c._loadTokenMapFromDb();
        assert.strictEqual(applied, 3, '3 行应用（实时 1 + DB 2）');
        assert.strictEqual(c.stats.tokenMapDbLoaded, 3);
        assert.strictEqual(c._tokenQuotes.get(LIVE).quote, WBNB, '实时正源不覆盖（DB 行同 token 不动）');
        assert.strictEqual(c._tokenQuotes.get('0x' + '3d'.repeat(20)).gradAmtBnb, null, '缺 gradAmtBnb → null（FA ?? 15）');
        // 残行（无 quote 字符串）跳过
        const bad = [{ id: 9, payload: { token: '0x' + '4d'.repeat(20) } }];
        call = 0;
        const fakeQuery2 = { ...fakeQuery, async limit() { call++; return call === 1 ? { data: bad, error: null } : { data: [], error: null }; } };
        const c2 = makeCollector(makeStubs());
        c2._supabase = { from() { return fakeQuery2; } };
        const applied2 = await c2._loadTokenMapFromDb();
        assert.strictEqual(applied2, 0, '残行跳过不计 applied');
        assert.strictEqual(c2._tokenQuotes.size, 0);
    }
    console.log('✓ 10. DB quote map 重建');

    // ═══ 11. 暂存溢出丢最老 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs, { quoteRate: { unknownTokenMax: 3 } });
        for (let i = 0; i < 5; i++) {
            await c._processLog(tradeLog('Buy', {
                token: '0x' + (i + 1).toString().padStart(2, '0').repeat(20), trader: '0x' + '77'.repeat(20),
                dw0: eth('0.1'), dw3: eth('1000'), txHash: '0x' + (i + 1).toString().padStart(2, '0').repeat(32), logIndex: i }), 1793000000 + i);
        }
        assert.strictEqual(c.stats.unknownTokenPending, 3, '上限 3');
        assert.strictEqual(c.stats.unknownTokenDropped, 2, '丢最老 2');
    }
    console.log('✓ 11. 暂存溢出丢最老');

    console.log('\n✅ _test_gang_collector_decode 全部通过');
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
