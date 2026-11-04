#!/usr/bin/env node
/**
 * T113 自入场累计净买三键单测（2026-11-04 pump 卖出臂）——本地零 DB 零网络。
 *
 * 三键：sinceEntryNetBuyRatio（主键进条件串）= 本仓成交锚（setBuyState）以来的
 *      (Σ买−Σ卖)÷(Σ买+Σ卖)×100 / sinceEntryBuyBnb / sinceEntrySellBnb（两原料
 *      观察键）。锚=登记时刻全史累计（totalBuyBnb/totalSellBnb）快照，差值派生
 *      ——补买轮各自重锚=每仓独立「入场以来」。
 *
 * 动机（v70 13 票探针 2026-11-04）：入场后 30s 仍 ≥90 单边买的 6 票中 4 票
 * -7%~-37%（比特币银行/蝴蝶喊单/蝴蝶池/共建共赢全亏）；滚动窗载体
 * tradesNetBuyRatioShortWin 被入场前买潮污染接不住（同锚对拍 S12@+30s 只中
 * 3/6 票）→ 必须自入场语义。卖腿形状：realHoldDuration >= 30 AND
 * sinceEntryNetBuyRatio >= 90（成交后 30s 仍单边买=无真实对手盘的机器推盘）。
 *
 * 覆盖：
 *   A. 精确公式（入场前不计入；入场后买 0.8/卖 0.2 → 60.00）
 *   B. null fail-closed（入场后零交易 → ratio null，`>= 90` 恒 false；
 *      两原料键=0 有证据零值）
 *   C. 未持仓/全清 → 三键 null（默认对象；clearBuyState 复位）
 *   D. 补买重锚（第二轮 setBuyState 从新锚起算，第一轮流量不再计入）
 *   E. 与时间无关（差值不消费 now——asOf 推进读数不变，回测虚拟时钟天然兼容）
 *   F. 条件串可评估（真实卖腿条件 AND 形状真值表 + null 侧 fail-closed）
 *   G. getFactorKeys 探针含三键（未知因子三防线自动认得）
 *   H. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   I. 源码口径断言（派生段禁 Date.now / 锚快照在 setBuyState / Math.max(0)
 *      防乱序负差值 / 累计器在 processTick 价格段每行恰一次）
 *
 * 用法：node scripts/_test_since_entry_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
const FactorBuilder = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
    token_address: '0xtoken', trade_type: 'buy', trader_address: '0xa', sender_address: null,
    price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA() {
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. 精确公式 ═══════════════
console.log('A. 精确公式（入场前不计入）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    // 入场前流量：买 0.5（必须不计入自入场）
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 30000 }));
    // 成交锚
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyPriceUsd: 5, buyTime: AS_OF - 20000 });
    // 入场后：买 0.8 卖 0.2
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 10000 }));
    fa.processTick(mkTick({ bnb_amount: 0.3, timestamp: AS_OF - 5000 }));
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.2, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('sinceEntryBuyBnb = 0.8（入场前 0.5 不计入）', () =>
        assert.ok(Math.abs(f.sinceEntryBuyBnb - 0.8) < 1e-9));
    check('sinceEntrySellBnb = 0.2', () =>
        assert.ok(Math.abs(f.sinceEntrySellBnb - 0.2) < 1e-9));
    check('sinceEntryNetBuyRatio = 60.00（(0.8−0.2)/1.0×100）', () =>
        assert.ok(Math.abs(f.sinceEntryNetBuyRatio - 60.00) < 1e-9));
}

// ═══════════════ B. null fail-closed ═══════════════
console.log('B. null 语义（入场后零交易）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 30000 }));
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 20000 });
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('ratio = null（b+s<=0 无新证据 fail-closed）', () =>
        assert.strictEqual(f.sinceEntryNetBuyRatio, null));
    check('原料键 = 0（有证据零值非 null）', () => {
        assert.strictEqual(f.sinceEntryBuyBnb, 0);
        assert.strictEqual(f.sinceEntrySellBnb, 0);
    });
    check('`>= 90` 对 null 恒 false（死盘不靠本键触发，归断流扫描/止损）', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('sinceEntryNetBuyRatio >= 90', f), false);
    });
}

// ═══════════════ C. 未持仓 / 全清 ═══════════════
console.log('C. 未持仓/全清 → null');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 30000 }));
    const f0 = fa.buildFactorMap('0xtoken', AS_OF);
    check('未持仓三键 null（默认对象）', () => {
        assert.strictEqual(f0.sinceEntryNetBuyRatio, null);
        assert.strictEqual(f0.sinceEntryBuyBnb, null);
        assert.strictEqual(f0.sinceEntrySellBnb, null);
    });
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 20000 });
    fa.processTick(mkTick({ bnb_amount: 0.4, timestamp: AS_OF - 10000 }));
    const f1 = fa.buildFactorMap('0xtoken', AS_OF);
    check('持仓后 = 100（单买）', () =>
        assert.ok(Math.abs(f1.sinceEntryNetBuyRatio - 100) < 1e-9));
    fa.clearBuyState('0xtoken');
    const f2 = fa.buildFactorMap('0xtoken', AS_OF);
    check('全清后三键回 null（clearBuyState 复位）', () => {
        assert.strictEqual(f2.sinceEntryNetBuyRatio, null);
        assert.strictEqual(f2.sinceEntryBuyBnb, null);
    });
}

// ═══════════════ D. 补买重锚 ═══════════════
console.log('D. 补买重锚（每仓独立入场以来）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 30000 });
    fa.processTick(mkTick({ bnb_amount: 1.0, timestamp: AS_OF - 20000 })); // 第一轮大买潮
    // 第二轮补买（卡牌加仓）：新锚
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: AS_OF - 10000 });
    fa.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 5000 }));
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.1, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('重锚后 = 0（(0.1−0.1)/0.2；第一轮 1.0 买潮不再计入）', () =>
        assert.ok(Math.abs(f.sinceEntryNetBuyRatio) < 1e-9));
    check('原料键 = 0.1/0.1（新锚口径）', () => {
        assert.ok(Math.abs(f.sinceEntryBuyBnb - 0.1) < 1e-9);
        assert.ok(Math.abs(f.sinceEntrySellBnb - 0.1) < 1e-9);
    });
}

// ═══════════════ E. 与时间无关 ═══════════════
console.log('E. 与时间无关（回测虚拟时钟兼容）');
{
    const fa = newFA();
    const T1 = T0 + 60000;
    fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T1 - 10000 });
    fa.processTick(mkTick({ bnb_amount: 0.6, timestamp: T1 - 5000 }));
    const f1 = fa.buildFactorMap('0xtoken', T1);
    const f2 = fa.buildFactorMap('0xtoken', T1 + 600000);
    check('asOf 推进 10 分钟读数不变（差值不消费时间）', () =>
        assert.strictEqual(f2.sinceEntryNetBuyRatio, f1.sinceEntryNetBuyRatio));
}

// ═══════════════ F. 真实卖腿条件真值表 ═══════════════
console.log('F. 卖腿条件真值表');
{
    const se = new StrategyEngine({});
    const COND = 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90';
    check('成交 35s + 单边买 95 → 触发', () =>
        assert.strictEqual(se.evaluateCondition(COND,
            { realHoldDuration: 35, sinceEntryNetBuyRatio: 95 }), true));
    check('成交 35s + 60（失衡不严重）→ 不触发', () =>
        assert.strictEqual(se.evaluateCondition(COND,
            { realHoldDuration: 35, sinceEntryNetBuyRatio: 60 }), false));
    check('成交 25s（未满持有门）+ 100 → 不触发', () =>
        assert.strictEqual(se.evaluateCondition(COND,
            { realHoldDuration: 25, sinceEntryNetBuyRatio: 100 }), false));
    check('成交 35s + ratio null（入场后零交易）→ 不触发 fail-closed', () =>
        assert.strictEqual(se.evaluateCondition(COND,
            { realHoldDuration: 35, sinceEntryNetBuyRatio: null }), false));
}

// ═══════════════ G. 探针收键 ═══════════════
console.log('G. getFactorKeys 探针');
{
    const fa = newFA();
    const keys = fa.getFactorKeys();
    check('三键全在探针键集（未知因子三防线自动认得）', () => {
        assert.ok(keys.has('sinceEntryNetBuyRatio'));
        assert.ok(keys.has('sinceEntryBuyBnb'));
        assert.ok(keys.has('sinceEntrySellBnb'));
    });
}

// ═══════════════ H. FactorBuilder 快照透传 ═══════════════
console.log('H. FactorBuilder 快照透传');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({
        sinceEntryNetBuyRatio: 95.5, sinceEntryBuyBnb: 0.42, sinceEntrySellBnb: 0.01,
    });
    check('三键透传（不落库即丢防线）', () => {
        assert.strictEqual(snap.sinceEntryNetBuyRatio, 95.5);
        assert.strictEqual(snap.sinceEntryBuyBnb, 0.42);
        assert.strictEqual(snap.sinceEntrySellBnb, 0.01);
    });
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('缺键 → null 不掩盖（旧 FA/历史信号兼容）', () => {
        assert.strictEqual(snapOld.sinceEntryNetBuyRatio, null);
        assert.strictEqual(snapOld.sinceEntryBuyBnb, null);
        assert.strictEqual(snapOld.sinceEntrySellBnb, null);
    });
}

// ═══════════════ I. 源码口径断言 ═══════════════
console.log('I. 源码口径断言');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    const derivStart = src.indexOf('T113 自入场累计净买三键');
    const derivEnd = src.indexOf('return {', derivStart);
    const derivSeg = src.slice(derivStart, derivEnd);
    check('派生段禁 Date.now（差值口径天然无前视）', () =>
        assert.ok(!/Date\.now/.test(derivSeg)));
    check('差值经 Math.max(0,·) 防 defer 乱序瞬时负', () =>
        assert.ok(derivSeg.includes('Math.max(0,')));
    const setBuySeg = src.slice(src.indexOf('setBuyState(tokenAddress'), src.indexOf('clearBuyState(tokenAddress'));
    check('锚快照字段在 setBuyState（entryTotalBuyBnb/entryTotalSellBnb）', () => {
        assert.ok(setBuySeg.includes('entryTotalBuyBnb: state.totalBuyBnb'));
        assert.ok(setBuySeg.includes('entryTotalSellBnb: state.totalSellBnb'));
    });
    const cumSeg = src.slice(src.indexOf('state.totalBuyBnb += isBuy'), src.indexOf('state.totalBuyBnb += isBuy') + 200);
    check('全史累计器在 processTick 价格段（每行恰一次，defer 路径即时喂）', () => {
        assert.ok(cumSeg.includes('state.totalSellBnb += isBuy ? 0 : bnbAmount'));
    });
    const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
    check('FactorBuilder 两处透传齐（快照对象+注释锚）', () =>
        assert.ok(fbSrc.includes('sinceEntryNetBuyRatio: factorResults.sinceEntryNetBuyRatio ?? null')));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
