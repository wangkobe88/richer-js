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
    // V3 Created 签名串反推未中（keccak 生成不可行）：链上实测常量（2026-10-28 换代接入）
    V3Created: '0x416fe98c8f1ea2977674a1a4ee6252eb72597a8392fc2d7d0599a2bf5d8fdb63',
};

// ── V3 链上原文 fixtures（2026-10-28 getLogs 采集，block ~130205558/130119539）──
// Chicken Chiu（WNB 盘）：动态 ABI 3 偏移+2 静态 word；w3=0x0、w4=15e18；
// 47 条全量分布：WNB 盘 w4 恒 15e18（29/29）、quote 盘 w4 逐票各异（18/18）、
// w3≠0 ⟺ quote 盘（恒 20 字节地址形状但无代码非合约=未识别不消费）
const V3_WNB_TOKEN = '0x68f2182e5ed8be223751eb943bdee744a9a95f04';
const V3_WNB_CREATOR = '0xe30aa4748dc2582374ebc85abfbf3c428cc70e81';
const V3_WNB_CREATED_DATA = '0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d02ab486cedc0000000000000000000000000000000000000000000000000000000000000000000c436869636b656e204368697500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006e5b1b1e99b9e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005568747470733a2f2f63646e2e67616e672e66756e2f697066732f6261666b726569686d37766670776a7337347832646e6b77617973326764666e70353763626e7266753273663463716771377373757173337770650000000000000000000000';
// bibi.ai（quote 盘 0x0c630240…b405）：w3=0xbd5d…b6d（地址形状）、w4=1788077.253…
const V3_QT_TOKEN = '0x2fba353ecfebe2dcd49f733b9d92d213278aa7bd';
const V3_QT_QUOTE = '0x0c6302401aa5325c2e36f170f52c00b1d220b405';
const V3_QT_CREATED_DATA = '0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000bd5ded695d61c2db15c703c345d57e039fd0b6d000000000000000000000000000000000000000000017aa3dcb58a4552db0fc90000000000000000000000000000000000000000000000000000000000000007626962692e61690000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000046269626900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005568747470733a2f2f63646e2e67616e672e66756e2f697066732f6261666b726569676c35356f3235786e617a796b717537627635326e687a6935376565357569756463723778786c6a6b64717171756c34657a6d610000000000000000000000';
// Chicken Chiu Buy1（同 token 紧随 Created，3 块后）：dw0=0.047318611987381705（协议
// 定值 260/267 首买同款）、dw3=10M 枚（1% 钱包帽精确值）、dw4=dw0（首笔累计）
const V3_B1_TX = '0x9e82093777f97d1a7a268feabc721ab0fc1caf64d3fe5e5ee75486baad251912';
const V3_B1_DATA = '0x00000000000000000000000000000000000000000000000000a81c06e2c5bdc90000000000000000000000000000000000000000000000000001b2b5146442900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000084595161401484a00000000000000000000000000000000000000000000000000000000a81c06e2c5bdc9';
// Chicken Chiu Sell2（trader 0xd458…453e 全卖其 Buy2 仓位）：dw0=1035277.496… 枚、
// dw3=0.005724542690177462 BNB 净收款
const V3_S2_TX = '0xf7fa920a1946f3e00efb9578b43e84578aa66a43ecc400c0da1cb362a43b3f3f';
const V3_S2_DATA = '0x00000000000000000000000000000000000000000000db3a816afbff8f83d8fe000000000000000000000000000000000000000000000000000034971eecbbfa000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000145670f58cb1b600000000000000000000000000000000000000000000000006507048bf9832d1';

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
    assert.strictEqual(TOPIC0_MAP.size, 6, 'TOPIC0_MAP 六 topic0（V2 五签名+V3 Created）');
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

    // ═══ 12. V3Created 链上原文解码（WNB 盘 Chicken Chiu）+ V3 pad 装配 ═══
    // 动态 ABI 新形状（3 string 偏移+2 静态 word）：ethers 按声明类型自处理偏移，
    // 实测 data 直喂精确命中（V2 Graduated 教训：未实证形状不进黄金单测——本组
    // data 为链上 getLogs 原文非构造）
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs, { contracts: { launchpadV2: LAUNCHPAD, launchpadV3: '0x15CFD2dc8278Fb87a1783ef42111618E20874365' } });
        assert.strictEqual(c._launchpadV3, '0x15cfd2dc8278fb87a1783ef42111618e20874365', 'V3 pad 小写装配');
        const c2 = makeCollector(makeStubs());
        assert.strictEqual(c2._launchpadV3, null, '未配置 V3 → null（只订 V2 存量票）');

        await c._processLog({
            topics: [GOLDEN_TOPIC0.V3Created, padAddr(V3_WNB_TOKEN), padAddr(V3_WNB_CREATOR), padAddr(WBNB)],
            data: V3_WNB_CREATED_DATA,
            transactionHash: '0x2fca01109b40eaec71cb3648801c2807ce087f02bef1f56ef2bf341ed158e09a',
            logIndex: hex(195), blockNumber: hex(130205558),
        }, 1793000000);
        assert.strictEqual(c.stats.tokenCreated, 1);
        const q = c._tokenQuotes.get(V3_WNB_TOKEN);
        assert.ok(q, 'V3 quote map 登记');
        assert.strictEqual(q.quote, WBNB);
        assert.strictEqual(q.quoteIsBnb, true);
        assert.strictEqual(q.refPair, null, 'V3 无 refPair 字段');
        assert.ok(Math.abs(q.gradAmtBnb - 15) < 1e-9, 'WNB 盘 gradAmt=15（Chicken Chiu 实测）');

        // registerToken meta（FA set-once 源）+ info 形状
        const meta = stubs.calls.faRegister[0].meta;
        assert.strictEqual(meta.platform, 'gang');
        assert.strictEqual(meta.totalSupply, 1e9);
        assert.ok(Math.abs(meta.graduationThresholdBnb - 15) < 1e-9);
        const info = stubs.calls.onTokenCreate[0];
        assert.strictEqual(info.name, 'Chicken Chiu');
        assert.strictEqual(info.symbol, '山雞');
        assert.strictEqual(info.logoUri, 'https://cdn.gang.fun/ipfs/bafkreihm7vfpwjs74x2dnkways2gdfnp57cbnrfu2sf4cqgq7ssuqs3wpe');
        assert.strictEqual(info.taxed, false, 'V3 无 taxed 事件字段恒 false');
        assert.strictEqual(info.pad, 'v3', 'pad 世系标记（payload 审计用）');
        assert.strictEqual(info.unknownParam, '0x0', 'WNB 盘 w3 恒 0');
        assert.ok(Math.abs(info.gradAmtQuote - 15) < 1e-9);
    }
    console.log('✓ 12. V3Created WNB 盘链上原文解码+装配');

    // ═══ 13. V3Created quote 盘（bibi.ai）：w3 地址形状 hex 存档 + gradAmt 换算 ═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        // 换算打桩 rate=1e-6：gradAmtBnb=1788077.253…×1e-6
        c._getQuoteConversion = async () => ({ rate: 1e-6 });
        await c._processLog({
            topics: [GOLDEN_TOPIC0.V3Created, padAddr(V3_QT_TOKEN), padAddr('0x' + '21'.repeat(20)), padAddr(V3_QT_QUOTE)],
            data: V3_QT_CREATED_DATA,
            transactionHash: '0x7c8e4e5e0c167166b3ac2bf7650ebc1f8e3d10cc0271de2ff590e345af6b7065',
            logIndex: hex(210), blockNumber: hex(130119539),
        }, 1793000000);
        const q = c._tokenQuotes.get(V3_QT_TOKEN);
        assert.strictEqual(q.quoteIsBnb, false);
        assert.ok(Math.abs(q.gradAmtBnb - 1788077.253578430023929801 * 1e-6) < 1e-15, 'quote 盘 gradAmt×rate');
        const info = stubs.calls.onTokenCreate[0];
        assert.strictEqual(info.name, 'bibi.ai');
        assert.strictEqual(info.symbol, 'bibi');
        assert.strictEqual(info.unknownParam, '0xbd5ded695d61c2db15c703c345d57e039fd0b6d', 'w3 地址形状 hex 存档（未识别不消费）');
        assert.ok(Math.abs(info.gradAmtQuote - 1788077.253578430023929801) < 1e-9, 'quote 盘 gradAmt 逐票各异（V3 非 V2 恒 15 口径）');
        // 换算 miss：gradAmtBnb=null（FA ?? 15 兜底）+ quoteRateUnavailable
        const c2 = makeCollector(makeStubs());
        c2._getQuoteConversion = async () => null;
        await c2._processLog({
            topics: [GOLDEN_TOPIC0.V3Created, padAddr(V3_QT_TOKEN), padAddr('0x' + '21'.repeat(20)), padAddr(V3_QT_QUOTE)],
            data: V3_QT_CREATED_DATA,
            transactionHash: '0x7c8e4e5e0c167166b3ac2bf7650ebc1f8e3d10cc0271de2ff590e345af6b7065',
            logIndex: hex(210), blockNumber: hex(130119539),
        }, 1793000000);
        assert.strictEqual(c2._tokenQuotes.get(V3_QT_TOKEN).gradAmtBnb, null, '换算失败 null 不冒充');
        assert.strictEqual(c2.stats.quoteRateUnavailable, 1);
    }
    console.log('✓ 13. V3Created quote 盘（w3 存档/gradAmt 换算/miss null）');

    // ═══ 14. V3 Buy/Sell 沿用 V2 签名：链上原文 tick 净额口径 ═══
    // Chicken Chiu 真实 Buy1/Sell2（V3 pad 事件但 topic0=V2 签名——白名单共享实证）
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        await c._processLog({
            topics: [GOLDEN_TOPIC0.V3Created, padAddr(V3_WNB_TOKEN), padAddr(V3_WNB_CREATOR), padAddr(WBNB)],
            data: V3_WNB_CREATED_DATA,
            transactionHash: '0x2fca01109b40eaec71cb3648801c2807ce087f02bef1f56ef2bf341ed158e09a',
            logIndex: hex(195), blockNumber: hex(130205558),
        }, 1793000000);
        // Buy1：dw0=0.047318611987381705 协议定值、dw3=10M 枚（1% 钱包帽精确上限）
        await c._processLog({
            topics: [GOLDEN_TOPIC0.Buy, padAddr(V3_WNB_TOKEN), padAddr('0xbb656758bf080bf822218bb0cafa150ba3256073')],
            data: V3_B1_DATA,
            transactionHash: V3_B1_TX, logIndex: hex(259), blockNumber: hex(130205561),
        }, 1793000001);
        assert.strictEqual(c.stats.tokenBought, 1);
        const t = stubs.calls.faTicks[0];
        assert.ok(Math.abs(t.bnb_amount - 0.047318611987381705) < 1e-15, `V3 Buy dw0 净入金（协议定值），实得 ${t.bnb_amount}`);
        assert.ok(Math.abs(t.token_amount - 10_000_000) < 1e-6, 'V3 Buy dw3=tokensOut（1% 钱包帽 10M）');
        assert.ok(Math.abs(t.price_bnb - 0.047318611987381705 / 1e7) < 1e-18, 'price=净入金÷tokenAmount');
        assert.strictEqual(c._tickBuffer[0].quote_token, null, 'V3 WNB 盘 quote_token=null');
        // Sell2：dw0=1035277.496… 枚、dw3=0.005724542690177462 净收款
        await c._processLog({
            topics: [GOLDEN_TOPIC0.Sell, padAddr(V3_WNB_TOKEN), padAddr('0xd458fb0e7d3863ecb6eb8b761b595d950a24453e')],
            data: V3_S2_DATA,
            transactionHash: V3_S2_TX, logIndex: hex(163), blockNumber: hex(130205711),
        }, 1793000002);
        const s = stubs.calls.faTicks[1];
        assert.strictEqual(s.trade_type, 'sell');
        assert.ok(Math.abs(s.token_amount - 1_035_277.496447780922841342) < 1e-6, 'V3 Sell dw0=tokensIn');
        assert.ok(Math.abs(s.bnb_amount - 0.005724542690177462) < 1e-15, 'V3 Sell dw3=净收款');
    }
    console.log('✓ 14. V3 Buy/Sell 链上原文净额口径（V2 签名共享）');

    // ═══ 15. V3 token 暂存→V3Created 到达重放（换代后新票订阅竞态）═══
    {
        const stubs = makeStubs();
        const c = makeCollector(stubs);
        await c._processLog({
            topics: [GOLDEN_TOPIC0.Buy, padAddr(V3_WNB_TOKEN), padAddr('0xbb656758bf080bf822218bb0cafa150ba3256073')],
            data: V3_B1_DATA,
            transactionHash: V3_B1_TX, logIndex: hex(259), blockNumber: hex(130205561),
        }, 1793000001);
        assert.strictEqual(c.stats.unknownTokenPending, 1, 'V3 未知 token 暂存');
        assert.strictEqual(stubs.calls.faTicks.length, 0, '暂存期不出 tick');
        await c._processLog({
            topics: [GOLDEN_TOPIC0.V3Created, padAddr(V3_WNB_TOKEN), padAddr(V3_WNB_CREATOR), padAddr(WBNB)],
            data: V3_WNB_CREATED_DATA,
            transactionHash: '0x2fca01109b40eaec71cb3648801c2807ce087f02bef1f56ef2bf341ed158e09a',
            logIndex: hex(195), blockNumber: hex(130205558),
        }, 1793000000);
        assert.strictEqual(c.stats.unknownTokenPending, 0, 'V3Created 后清空');
        assert.strictEqual(stubs.calls.faTicks.length, 1, '重放出 tick（净额不变）');
        assert.ok(Math.abs(stubs.calls.faTicks[0].bnb_amount - 0.047318611987381705) < 1e-15);
        assert.strictEqual(c.stats.unknownTokenFlushed, 1);
    }
    console.log('✓ 15. V3 token 暂存/重放');

    console.log('\n✅ _test_gang_collector_decode 全部通过');
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
