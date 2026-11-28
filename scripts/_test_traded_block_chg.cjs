#!/usr/bin/env node
/**
 * T249 有交易块窗键族单测（2026-11-28 用户裁定「要看买点之前有交易的 10 个块增长
 * 情况……不能只看时间」+「集中度等指标的计算，也要基于这个新理念」）
 * ——零 DB 零网络。
 *
 * 五键（FourMemeFactorAggregator）：
 *   - tradedBlkChg5Pct/10Pct/20Pct：fire 前最近 5/10/20 个有交易块的区间涨幅 %
 *     （N 块区间需 N+1 个点；块数不足=null fail-closed——0x5287 案「撑不起趋势」）
 *   - tradedBlkConcPct：当前 zigzag 腿对应的块段内「单块涨幅/腿总涨幅」×100
 *     （块版集中度——0x732b 案 9s +42.7% 时间版 conc=80.1 虚高、块口径 25.7%）
 *   - tradedBlkCount：全史有交易块数（观察键）
 *
 * 原料=state._tradedBlockPrices {blockNumber,ts,price}（可靠价写点维护：同块末笔
 * 更新/push 新块；保留最近 40 块，>60 摊销裁剪）。
 *
 * 覆盖：
 *   A. 块链维护：新块 push/同块更新末价/count 单调/裁剪保留 40
 *   B. chg 三键数学：N+1 点恰有值/N 点 null/链空全 null/零价 null
 *   C. 块版集中度：0x732b 形状 9 块段（最大块 13.7/腿 53.3→25.7）/单块段 100/
 *      dir==-1 下跌腿 null/腿起点后无块 null
 *   D. 探针+白名单 ?? null（FactorBuilder 五键落库形状）
 *
 * 用法：node scripts/_test_traded_block_chg.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
let _li = 0;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 0.1, token_amount: 100000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);
function newFA(factorParams) {
    const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
    const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}
// 每块喂一笔可靠价（ts 递增、block 递增）
function feedBlocks(fa, seq) {
    // seq: [[ts, blockNumber, price], ...]
    for (const [ts, blk, price] of seq) fa.processTick(mkTick({ timestamp: ts, block_number: blk, price_bnb: price }));
}
const mapOf = (fa, asOf) => fa.buildFactorMap('0xtoken', asOf);
const keys = (fa, asOf) => {
    const m = mapOf(fa, asOf);
    return {
        c5: m.tradedBlkChg5Pct, c10: m.tradedBlkChg10Pct, c20: m.tradedBlkChg20Pct,
        conc: m.tradedBlkConcPct, cnt: m.tradedBlkCount,
    };
};

console.log('A. 块链维护（写点口径）');
{
    check('A1 新块 push / 同块多笔只更新末价 / count 单调', () => {
        const fa = newFA();
        feedBlocks(fa, [[T0, 100, 1e-6], [T0 + 1000, 100, 2e-6], [T0 + 2000, 101, 3e-6], [T0 + 3000, 102, 4e-6], [T0 + 4000, 102, 5e-6]]);
        const st = fa.getTokenState('0xtoken');
        assert.strictEqual(st._tradedBlockPrices.length, 3, '三个块');
        assert.deepStrictEqual(st._tradedBlockPrices.map(b => [b.blockNumber, b.price]), [[100, 2e-6], [101, 3e-6], [102, 5e-6]], '同块末笔价');
        assert.strictEqual(st._tradedBlockCount, 3);
        const k = keys(fa, T0 + 5000);
        assert.strictEqual(k.cnt, 3);
    });
    check('A2 摊销裁剪：>60 裁到保留 40', () => {
        const fa = newFA();
        const seq = [];
        for (let i = 0; i < 70; i++) seq.push([T0 + i * 1000, 1000 + i, (1 + i) * 1e-6]);
        feedBlocks(fa, seq);
        const st = fa.getTokenState('0xtoken');
        assert.strictEqual(st._tradedBlockPrices.length, 49, '裁剪后 40 + 后续 9 块（摊销：>60 才裁）');
        assert.strictEqual(st._tradedBlockPrices[0].blockNumber, 1021, '第 61 块 push 时裁掉前 21 块（61−40）');
        assert.strictEqual(st._tradedBlockCount, 70, 'count 不随裁剪回退');
    });
    check('A3 乱序到达的同块末价=到达序末笔（与 _relPriceTrend 同款语义）', () => {
        const fa = newFA();
        feedBlocks(fa, [[T0, 100, 2e-6], [T0 + 1000, 100, 1e-6]]);
        const st = fa.getTokenState('0xtoken');
        assert.strictEqual(st._tradedBlockPrices[0].price, 1e-6, '到达序末笔价');
    });
}

console.log('B. chg 三键数学');
{
    // 价格链：每块 +10%（1, 1.1, 1.21, ...）
    const prices = [];
    let p = 1e-6;
    for (let i = 0; i < 22; i++) { prices.push(p); p = p * 1.1; }
    const mk = () => {
        const fa = newFA();
        const seq = prices.map((px, i) => [T0 + i * 1000, 100 + i, px]);
        feedBlocks(fa, seq);
        return fa;
    };
    check('B1 chg5 = (p21/p16−1) = 10%^5；chg10 = 10%^10；chg20 = 10%^20', () => {
        const fa = mk();
        const k = keys(fa, T0 + 22000);
        assert.strictEqual(k.c5, parseFloat(((1.1 ** 5 - 1) * 100).toFixed(2)));
        assert.strictEqual(k.c10, parseFloat(((1.1 ** 10 - 1) * 100).toFixed(2)));
        assert.strictEqual(k.c20, parseFloat(((1.1 ** 20 - 1) * 100).toFixed(2)));
    });
    check('B2 块数不足 null：5 点（4 区间）chg5 无值；6 点（5 区间）chg5 有值 61.05；21 点 chg20 恰有值', () => {
        const fa = newFA();
        feedBlocks(fa, prices.slice(0, 5).map((px, i) => [T0 + i * 1000, 100 + i, px]));
        let k = keys(fa, T0 + 6000);
        assert.strictEqual(k.c5, null, '5 点不足 5 块区间（需 6 点）');
        assert.strictEqual(k.c10, null);
        const fa15 = newFA();
        feedBlocks(fa15, prices.slice(0, 6).map((px, i) => [T0 + i * 1000, 100 + i, px]));
        k = keys(fa15, T0 + 7000);
        assert.strictEqual(k.c5, parseFloat(((1.1 ** 5 - 1) * 100).toFixed(2)), '6 点恰算 5 块区间');
        const fa2 = newFA();
        feedBlocks(fa2, prices.slice(0, 21).map((px, i) => [T0 + i * 1000, 100 + i, px]));
        k = keys(fa2, T0 + 22000);
        assert.ok(k.c20 !== null, '21 块 chg20 有值');
        assert.strictEqual(k.c20, parseFloat(((1.1 ** 20 - 1) * 100).toFixed(2)));
    });
    check('B3 链空全 null；零价块 null', () => {
        const fa = newFA();
        const k0 = keys(fa, T0 + 1000);
        assert.strictEqual(k0.c5, null);
        assert.strictEqual(k0.c10, null);
        assert.strictEqual(k0.c20, null);
        assert.strictEqual(k0.cnt, 0);
        feedBlocks(fa, [[T0, 100, 1e-6], [T0 + 1000, 101, 0]]); // 零价不可靠价不入链？priceBnb>0 才 reliable
        const k = keys(fa, T0 + 2000);
        assert.strictEqual(k.c5, null, '零价 tick 不进可靠价链');
    });
    check('B4 0x5287 形状：fire 前仅 4 个有交易块 → chg5/10/20 全 null（撑不起趋势）', () => {
        const fa = newFA();
        // 14:06:47 卖块 + 14:07:12/19/21 三买块
        feedBlocks(fa, [[T0, 100, 8.69e-9], [T0 + 25000, 101, 9.392e-9], [T0 + 32000, 102, 9.5113e-9], [T0 + 34000, 103, 9.8965e-9]]);
        const k = keys(fa, T0 + 34000);
        assert.strictEqual(k.c5, null);
        assert.strictEqual(k.c10, null);
        assert.strictEqual(k.c20, null);
        assert.strictEqual(k.cnt, 4);
    });
}

console.log('C. 块版集中度 tradedBlkConcPct');
{
    check('C1 0x732b 形状：9 块段、最大单块 +13.7%/腿 +53.3% → conc≈25.7（时间版 80.1 虚高）', () => {
        const fa = newFA();
        // 块末价序列（0x732b 实盘值）：6.0675 / 6.2464 / 6.5184 / 7.0767 / 7.2698 /
        // 7.3277 / 7.9189 / 8.1849 / 9.3027（9 块，首块=腿起点）
        const seq = [6.0675e-9, 6.2464e-9, 6.5184e-9, 7.0767e-9, 7.2698e-9, 7.3277e-9, 7.9189e-9, 8.1849e-9, 9.3027e-9];
        feedBlocks(fa, seq.map((px, i) => [T0 + i * 1000, 100 + i, px]));
        const k = keys(fa, T0 + 9000);
        const maxBlk = parseFloat(((9.3027e-9 / 8.1849e-9 - 1) * 100).toFixed(2));
        const legAmpl = parseFloat(((9.3027e-9 / 6.0675e-9 - 1) * 100).toFixed(2));
        assert.strictEqual(k.conc, parseFloat((maxBlk / legAmpl * 100).toFixed(2)), '最大块/腿涨幅（精确值）');
        assert.strictEqual(k.c5, parseFloat(((9.3027e-9 / 7.0767e-9 - 1) * 100).toFixed(2)), 'chg5=最近 5 块区间（6 点，base=第 4 块末价）');
    });
    check('C2 单块段=100（全部涨幅在一个块=0x71fe 形状）', () => {
        const fa = newFA();
        // 链序：起点块（静默前最后一笔）→ fire 块（5 笔等额同块阶梯）
        feedBlocks(fa, [[T0, 100, 6.9e-9], [T0 + 92000, 101, 7.129e-9], [T0 + 92000, 101, 7.568e-9], [T0 + 92000, 101, 8.020e-9], [T0 + 92000, 101, 8.485e-9], [T0 + 92000, 101, 8.963e-9]]);
        const k = keys(fa, T0 + 92000);
        // 腿=从序列最低点 6.9e-9（dir==0 整体上涨）→ 8.963e-9；块段只有 fire 块
        assert.strictEqual(k.conc, 100, '单块段=100');
    });
    check('C3 dir==-1 下跌腿（riseLegSec=0）→ conc null（无进行中上涨腿）', () => {
        const fa = newFA();
        feedBlocks(fa, [[T0, 100, 1e-6], [T0 + 1000, 101, 1.2e-6], [T0 + 2000, 102, 1.128e-6]]); // −6% 明确回调（−5.0 精确值浮点陷阱）
        const k = keys(fa, T0 + 3000);
        assert.strictEqual(k.conc, null, '下跌腿无块版集中度');
        const m = mapOf(fa, T0 + 3000);
        assert.strictEqual(m.riseLegSec, 0, '前置条件确认：当前在下跌腿');
    });
    check('C4 腿起点晚于链首块时只取腿段（前面涨幅不摊进分母）', () => {
        const fa = newFA();
        // 三个块：100(1e-6) → 101(1.3e-6) → 102(1.2e-6 回调≥5%确认摆高) → 103(1.5e-6)
        feedBlocks(fa, [[T0, 100, 1e-6], [T0 + 1000, 101, 1.3e-6], [T0 + 2000, 102, 1.2e-6], [T0 + 3000, 103, 1.5e-6]]);
        const k = keys(fa, T0 + 4000);
        // 腿=1.2e-6 → 1.5e-6（+25%）；块段=[102,103]，最大块 +25% → conc=100
        const m = mapOf(fa, T0 + 4000);
        assert.strictEqual(m.riseLegAmplPct, 25);
        assert.strictEqual(k.conc, 100, '腿段内单块占全部');
    });
}

console.log('D. 探针+白名单形状');
{
    check('D1 getFactorKeys 含五键（条件三防线自动认得）', () => {
        const fa = newFA();
        const keysAll = fa.getFactorKeys();
        for (const k of ['tradedBlkChg5Pct', 'tradedBlkChg10Pct', 'tradedBlkChg20Pct', 'tradedBlkConcPct', 'tradedBlkCount']) {
            assert.ok(keysAll.has(k), `缺键 ${k}`);
        }
    });
    check('D2 FactorBuilder 白名单 ?? null（缺键 null 在位，不掩盖）', () => {
        const built = FactorBuilder.buildFactorValuesForTimeSeries({});
        for (const k of ['tradedBlkChg5Pct', 'tradedBlkChg10Pct', 'tradedBlkChg20Pct', 'tradedBlkConcPct', 'tradedBlkCount']) {
            assert.strictEqual(built[k], null, `${k} 应为 null`);
        }
        const withVals = FactorBuilder.buildFactorValuesForTimeSeries({
            tradedBlkChg5Pct: 12.3, tradedBlkChg10Pct: 25, tradedBlkChg20Pct: 40, tradedBlkConcPct: 30, tradedBlkCount: 9,
        });
        assert.strictEqual(withVals.tradedBlkChg5Pct, 12.3);
        assert.strictEqual(withVals.tradedBlkCount, 9);
    });
}

console.log(`\n${failed === 0 ? '✅' : '❌'} 有交易块窗键族单测：${passed} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
