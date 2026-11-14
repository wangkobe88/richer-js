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

// ═══════════════ J. T133 famous near_launch 入场计数 + sinceEntryFamousNearLaunchBuys ═══════════════
console.log('J. T133 famous near_launch 计数（2026-11-10 用户立法「买入后有 famous 钱包在 near_launch 区间内入场，立即全部卖出」——卖臂 famous-entry-exit 主键）');
{
    const FAM = '0xfamous1111111111111111111111111111111111111';
    const NOTFAM = '0xother22222222222222222222222222222222222222';
    const P0 = 0.00001; // 首可靠价=launch 兜底锚（无平台常量 → ?? _relFirstPriceBnb）
    /** famous 买入 @curVs%（相对 P0） */
    const famBuy = (pct, ts) => mkTick({
        sender_address: FAM, bnb_amount: 0.3, price_bnb: P0 * (1 + pct / 100), timestamp: ts,
    });
    let liJ = 0;
    const tickJ = (t) => Object.assign({}, t, { tx_hash: '0xj' + (++liJ), log_index: liJ });

    FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set([FAM]));
    try {
        // J1 区间口径：curVs ∈ (+10,+40] 才计（BP43 near_launch 界；含 40 不含 10）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 })); // launch 锚定值 P0
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            fa.processTick(tickJ(famBuy(5, T0 + 3000)));    // almost_launch 区 → 不计
            fa.processTick(tickJ(famBuy(10, T0 + 4000)));   // 恰 10（区间开边界）→ 不计
            fa.processTick(tickJ(famBuy(15, T0 + 5000)));   // 计 1
            fa.processTick(tickJ(famBuy(40, T0 + 6000)));   // 恰 40（区间闭边界）→ 计 2
            fa.processTick(tickJ(famBuy(45, T0 + 7000)));   // low 区 → 不计
            const f = fa.buildFactorMap('0xtoken', T0 + 8000);
            check('J1 区间口径：(10,40] 含 40 不含 10——5%/10%/45% 三笔不计、15%/40% 两笔计 → 计数 2', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 2, `got ${f.sinceEntryFamousNearLaunchBuys}`));
        }
        // J2 名单外钱包 near_launch 买不计 / famous 卖腿不计（isBuy 门）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            fa.processTick(tickJ(mkTick({ sender_address: NOTFAM, bnb_amount: 0.3, price_bnb: P0 * 1.2, timestamp: T0 + 3000 })));
            fa.processTick(tickJ(mkTick({ sender_address: FAM, trade_type: 'sell', bnb_amount: 0.3, price_bnb: P0 * 1.2, timestamp: T0 + 4000 })));
            const f = fa.buildFactorMap('0xtoken', T0 + 5000);
            check('J2 名单外不计 + famous 卖腿不计（isBuy 门）→ 计数 0（有证据零值）', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 0));
        }
        // J3 差值 latch：入场锚前的 famous near_launch 买不进差值；补买轮重锚
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tickJ(famBuy(20, T0 + 1500)));  // 入场前 famous near_launch 买
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            let f = fa.buildFactorMap('0xtoken', T0 + 2500);
            check('J3a 入场前计数不进差值 → 0', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 0));
            fa.processTick(tickJ(famBuy(25, T0 + 3000)));
            f = fa.buildFactorMap('0xtoken', T0 + 3500);
            check('J3b 入场后新 famous near_launch 买 → 1（卖臂 >=1 即全清）', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 1));
            // 补买轮重锚：全清后再买（第二轮 setBuyState 从新锚起算）
            fa.clearBuyState('0xtoken');
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 5000 });
            f = fa.buildFactorMap('0xtoken', T0 + 5500);
            check('J3c 补买轮重锚 → 第一轮计数不再计入 → 0', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 0));
        }
        // J4 未持仓 null 域（fail-closed：`>= 1` 恒 false 不触发）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tickJ(famBuy(20, T0 + 2000)));
            const f = fa.buildFactorMap('0xtoken', T0 + 3000);
            check('J4 未持仓 → sinceEntryFamousNearLaunchBuys null（差值因子 T113 同域；`>= 1` 恒 false）', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, null));
        }
        // J5 defer 双段恰一次：价格段(!deferWallet) 直计 + wallet 段(smartBotEligible) 补跑；
        //    直推路径写点②不跑（flag 缺省）防双计
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            // 直推（回放/回测）：sender 在行上 → 写点①计一次
            fa.processTick(tickJ(famBuy(20, T0 + 3000)));
            let f = fa.buildFactorMap('0xtoken', T0 + 3500);
            check('J5a 直推路径恰计一次 → 1', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 1));

            // defer 路径：价格段 sender 未知跳过 → applyWalletTick 真名补跑一次
            const fa2 = newFA();
            fa2.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa2.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            const raw = tickJ({ ...famBuy(20, T0 + 3000), sender_address: null });
            fa2.processTick(raw, { deferWallet: true, emitFactors: false });
            let f2 = fa2.buildFactorMap('0xtoken', T0 + 3200);
            check('J5b defer 价格段（sender 未知）不计 → 0', () =>
                assert.strictEqual(f2.sinceEntryFamousNearLaunchBuys, 0));
            fa2.applyWalletTick({ ...raw, sender_address: FAM, price_accepted: true }, { emitFactors: false });
            f2 = fa2.buildFactorMap('0xtoken', T0 + 3500);
            check('J5c wallet 段真 sender 补跑恰一次 → 1（与直推 J5a bit 一致）', () =>
                assert.strictEqual(f2.sinceEntryFamousNearLaunchBuys, 1));
        }
        // J6 名单缺失（null=未加载）不计数（写点① `size>0` 门）
        {
            FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
            fa.processTick(tickJ(mkTick({ sender_address: FAM, bnb_amount: 0.3, price_bnb: P0 * 1.2, timestamp: T0 + 3000 })));
            const f = fa.buildFactorMap('0xtoken', T0 + 4000);
            check('J6 名单缺失不计数 → 0（宁漏不冒充）', () =>
                assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 0));
        }
        // J7 源码口径断言
        {
            const src = read('src/services/FourMemeFactorAggregator.js');
            const cntStart = src.indexOf('_countFamousNearLaunchBuy(state, priceBnb, bnbAmount = 0) {');
            const cntSeg = src.slice(cntStart, src.indexOf('state._famousNearLaunchBuys++;', cntStart));
            check('J7a 计数器段禁 Date.now（单笔价+write-once 锚，回放任意序收敛）', () =>
                assert.ok(!/Date\.now/.test(cntSeg), '计数器函数体出现 Date.now'));
            check('J7b 区间判据源码锁：curVs > 10 && curVs <= 40（near_launch 界）', () =>
                assert.ok(cntSeg.includes('curVs > 10 && curVs <= 40')));
            check('J7c 锚链与 currentVsLaunchPct 同源（_floorLaunchPriceBnb(_resolveLaunchPriceBnb…, _firstBuyPriceBnb)）', () => {
                assert.ok(cntSeg.includes('_floorLaunchPriceBnb('));
                assert.ok(cntSeg.includes('_resolveLaunchPriceBnb(state.platform, state.quoteToken)'));
                assert.ok(cntSeg.includes('state._firstBuyPriceBnb'));
                assert.ok(cntSeg.includes('?? state._relFirstPriceBnb'));
            });
            const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
            check('J7d FactorBuilder 快照透传（不落库即丢防线）', () =>
                assert.ok(fbSrc.includes('sinceEntryFamousNearLaunchBuys: factorResults.sinceEntryFamousNearLaunchBuys ?? null')));
            check('J7e 未持仓 null 域字面量（三处：positionFactors 前置对象+主表发射）', () => {
                assert.ok(src.includes('sinceEntryFamousNearLaunchBuys: null,'));
                assert.ok(src.includes('sinceEntryFamousNearLaunchBuys: positionFactors.sinceEntryFamousNearLaunchBuys ?? null,'));
            });
        }
        // J8 T136 金额累计键 sinceEntryFamousNearLaunchBuyBnb（2026-11-12 bt-v106
        //    来财 0xc84a0ff2 案：roster v2 扩面后新增址 0.276 BNB 一笔 near_launch
        //    买入触发 v1 计数门 → 持仓 43s 全清 +0.51 仓位在第二波拉盘前 0 秒——
        //    用户裁定金额门 0.5「像样的 famous 进场才撤离」，库条目 v2 换键）
        //    注：J6 已把名单置 null 且靠外层 finally 复位 → 本段开头重挂名单
        FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set([FAM]));
        {
            // J8a 来财案形状反证：单笔 0.276（<0.5）计数 1 但金额不足 → v2 不触发
            {
                const fa = newFA();
                fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
                fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
                fa.processTick(tickJ(mkTick({ sender_address: FAM, bnb_amount: 0.276, price_bnb: P0 * 1.2, timestamp: T0 + 3000 })));
                const f = fa.buildFactorMap('0xtoken', T0 + 4000);
                check('J8a 来财案形状：计数 1 ∧ 金额 0.276 < 0.5（v1 误触发 / v2 金额门不触发）', () => {
                    assert.strictEqual(f.sinceEntryFamousNearLaunchBuys, 1);
                    assert.ok(Math.abs(f.sinceEntryFamousNearLaunchBuyBnb - 0.276) < 1e-9,
                        `got ${f.sinceEntryFamousNearLaunchBuyBnb}`);
                });
            }
            // J8b 两笔 0.3 累计 0.6 ≥ 0.5 → v2 触发（FIGHT 案 0.252+0.343=0.595 同族）
            {
                const fa = newFA();
                fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
                fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
                fa.processTick(tickJ(mkTick({ sender_address: FAM, bnb_amount: 0.3, price_bnb: P0 * 1.2, timestamp: T0 + 3000 })));
                fa.processTick(tickJ(mkTick({ sender_address: FAM, bnb_amount: 0.3, price_bnb: P0 * 1.25, timestamp: T0 + 4000 })));
                const f = fa.buildFactorMap('0xtoken', T0 + 5000);
                check('J8b 两笔 0.3 累计 0.6 ≥ 0.5 → v2 金额门触发（FIGHT 0.595 同族）', () =>
                    assert.ok(Math.abs(f.sinceEntryFamousNearLaunchBuyBnb - 0.6) < 1e-9,
                        `got ${f.sinceEntryFamousNearLaunchBuyBnb}`));
            }
            // J8c 区间外/卖腿不计金额；差值 latch 与计数同构；未持仓 null fail-closed
            {
                const fa = newFA();
                fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
                let f = fa.buildFactorMap('0xtoken', T0 + 1500);
                check('J8c 未持仓 → 金额键 null（fail-closed，`>= 0.5` 恒 false）', () =>
                    assert.strictEqual(f.sinceEntryFamousNearLaunchBuyBnb, null));
                fa.processTick(tickJ(famBuy(20, T0 + 1600)));  // 入场前 famous near_launch 买（0.3）
                fa.setBuyState('0xtoken', { buyPriceBnb: P0, buyPriceUsd: 5, buyTime: T0 + 2000 });
                f = fa.buildFactorMap('0xtoken', T0 + 2500);
                check('J8d 入场前 famous near_launch 买不进金额差值 → 0（latch 同构）', () =>
                    assert.strictEqual(f.sinceEntryFamousNearLaunchBuyBnb, 0));
                fa.processTick(tickJ(mkTick({ sender_address: FAM, trade_type: 'sell', bnb_amount: 0.9, price_bnb: P0 * 1.2, timestamp: T0 + 3000 })));
                f = fa.buildFactorMap('0xtoken', T0 + 3500);
                check('J8e 卖腿不计金额（isBuy 门同构）→ 仍 0', () =>
                    assert.strictEqual(f.sinceEntryFamousNearLaunchBuyBnb, 0));
            }
            // J8f 源码锁：库条目 v2 金额门 + v1 计数门已替换 + 新键三防线透传
            {
                const src = read('src/services/FourMemeFactorAggregator.js');
                check('J8f FA 金额累计字面量（_famousNearLaunchBuyBnb 累计+锚快照+差值）', () => {
                    assert.ok(src.includes('state._famousNearLaunchBuyBnb = (state._famousNearLaunchBuyBnb || 0) + (bnbAmount || 0);'));
                    assert.ok(src.includes('entryFamousNearLaunchBuyBnb: state._famousNearLaunchBuyBnb || 0,'));
                    assert.ok(src.includes('(state._famousNearLaunchBuyBnb || 0) - (pos.entryFamousNearLaunchBuyBnb || 0)'));
                });
                const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
                check('J8g FactorBuilder 快照透传新键（不落库即丢防线）', () =>
                    assert.ok(fbSrc.includes('sinceEntryFamousNearLaunchBuyBnb: factorResults.sinceEntryFamousNearLaunchBuyBnb ?? null')));
                check('J8h 未持仓 null 域字面量+主表发射', () => {
                    assert.ok(src.includes('sinceEntryFamousNearLaunchBuyBnb: null,'));
                    assert.ok(src.includes('sinceEntryFamousNearLaunchBuyBnb: positionFactors.sinceEntryFamousNearLaunchBuyBnb ?? null,'));
                });
                const dep = read('scripts/deploy-signal-source-strategies.cjs');
                const i = dep.indexOf("name: 'famous-entry-exit'");
                check('J8i 库条目 v2 金额门源码锁：>= 0.5（计数门 v1 已替换）', () => {
                    assert.ok(i > 0, '条目缺失');
                    const seg = dep.slice(i, i + 900);
                    assert.ok(seg.includes('sinceEntryFamousNearLaunchBuyBnb >= 0.5'), 'v2 金额门缺失');
                    assert.ok(!seg.includes("'sinceEntryFamousNearLaunchBuys >= 1'"), 'v1 计数门残留');
                });
            }
        }
    } finally {
        FourMemeFactorAggregator.setFamousCopyWalletsForTest(null); // 复位未加载态（防污染其它段/测试）
    }
}

// ═══════════════ K. T137 KOL HOLD 两键（2026-11-13 KOL 研究）═══════════════
// sinceLastFamousBigBuySec（HOLD 触发载体：卡 fire 时 pp≥100 ∧ ≤120 → 延缓该卡
// 卖出到释放点——V2 反事实 +2.32）+ recentFamousSellBnb（释放臂载体：60s 窗 famous
// 卖出合计 ≥0.2）。token 级键（未持仓也发射）；null/0 语义=无 famous 在场 →
// HOLD 臂恒 false fail-open（无 famous 的票零影响）。
console.log('K. T137 KOL HOLD 两键（sinceLastFamousBigBuySec / recentFamousSellBnb）');
{
    const FAMK = '0xfamousk111111111111111111111111111111111111';
    const P0K = 0.00001;
    let liK = 0;
    const tK = (o) => mkTick(Object.assign({
        sender_address: FAMK, price_bnb: P0K, bnb_amount: 0.3, timestamp: T0 + 3000,
    }, o, { tx_hash: '0xk' + (++liK), log_index: liK }));
    FourMemeFactorAggregator.setFamousCopyWalletsForTest(new Set([FAMK]));
    try {
        // K1 大买记时刻：0.3B famous 买 → (now−lastAt)/1000 toFixed(1)
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ timestamp: T0 + 3000 }));
            const f = fa.buildFactorMap('0xtoken', T0 + 3000 + 123500);
            check('K1 sinceLastFamousBigBuySec = 123.5（精确 (now−lastAt)/1000）', () =>
                assert.strictEqual(f.sinceLastFamousBigBuySec, 123.5));
        }
        // K2 阈值门：0.1 贴线过（≥）= 研究口径大买线
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ bnb_amount: 0.1, timestamp: T0 + 2000 })); // 恰 0.1（闭界）
            const f = fa.buildFactorMap('0xtoken', T0 + 3000);
            check('K2a 0.1 贴线（≥famousBigBuyBnb）记时刻 → 1.0', () =>
                assert.strictEqual(f.sinceLastFamousBigBuySec, 1));
            const fa2 = newFA();
            fa2.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa2.processTick(tK({ bnb_amount: 0.05, timestamp: T0 + 2000 }));       // 低于线不记
            fa2.processTick(tK({ sender_address: '0xzz', bnb_amount: 0.5, timestamp: T0 + 2500 })); // 非 famous 不记
            const f2 = fa2.buildFactorMap('0xtoken', T0 + 3000);
            check('K2b 0.05 低于线 + 非 famous 0.5B → null（从未有大买）', () =>
                assert.strictEqual(f2.sinceLastFamousBigBuySec, null));
        }
        // K3 Math.max 防回拨（defer 乱序回推晚到行不回退 lastAt）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ timestamp: T0 + 5000 }));
            fa.processTick(tK({ timestamp: T0 + 3000 })); // 乱序晚到行 ts 更小
            const f = fa.buildFactorMap('0xtoken', T0 + 6000);
            check('K3 晚到行不回退 lastAt → since=1.0（按 T0+5000 非按 T0+3000）', () =>
                assert.strictEqual(f.sinceLastFamousBigBuySec, 1));
        }
        // K4 卖行不推进 lastAt + recentFamousSellBnb 窗内合计
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ timestamp: T0 + 2000 }));                                       // famous 大买
            fa.processTick(tK({ trade_type: 'sell', bnb_amount: 0.15, timestamp: T0 + 3000 })); // famous 卖①
            fa.processTick(tK({ trade_type: 'sell', bnb_amount: 0.1, timestamp: T0 + 3500 }));  // famous 卖②
            const f = fa.buildFactorMap('0xtoken', T0 + 3600);
            check('K4a 卖行不推进 lastAt → since 按 T0+2000 算 = 1.6', () =>
                assert.strictEqual(f.sinceLastFamousBigBuySec, 1.6));
            check('K4b recentFamousSellBnb = 0.25（窗内两笔合计，小额也收——释放臂看合计）', () =>
                assert.ok(Math.abs(f.recentFamousSellBnb - 0.25) < 1e-9, `got ${f.recentFamousSellBnb}`));
        }
        // K5 60s 窗边界 + 无事件零值
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ trade_type: 'sell', bnb_amount: 0.3, timestamp: T0 + 1000 }));   // 早于窗
            fa.processTick(tK({ trade_type: 'sell', bnb_amount: 0.25, timestamp: T0 + 61000 })); // 窗内
            const f = fa.buildFactorMap('0xtoken', T0 + 66000); // 窗 = (T0+6000, T0+66000]
            check('K5a 窗外剔除（T0+1000 出窗）→ 0.25', () =>
                assert.ok(Math.abs(f.recentFamousSellBnb - 0.25) < 1e-9, `got ${f.recentFamousSellBnb}`));
            const fa2 = newFA();
            fa2.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            const f2 = fa2.buildFactorMap('0xtoken', T0 + 5000);
            check('K5b 无任何 famous 事件 → since null + sell 0（有证据零值非 null）', () => {
                assert.strictEqual(f2.sinceLastFamousBigBuySec, null);
                assert.strictEqual(f2.recentFamousSellBnb, 0);
            });
        }
        // K6 defer 双段恰一次（T133 同构：价格段假 wallet 跳过 + wallet 段补跑）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ timestamp: T0 + 3000 }));
            const f = fa.buildFactorMap('0xtoken', T0 + 3100);
            check('K6a 直推路径恰计一次 → since=0.1', () =>
                assert.strictEqual(f.sinceLastFamousBigBuySec, 0.1));

            const fa2 = newFA();
            fa2.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            const rawBuy = tK({ timestamp: T0 + 3000, sender_address: null });
            const rawSell = tK({ trade_type: 'sell', bnb_amount: 0.2, timestamp: T0 + 3100, sender_address: null });
            fa2.processTick(rawBuy, { deferWallet: true, emitFactors: false });
            fa2.processTick(rawSell, { deferWallet: true, emitFactors: false });
            const f2mid = fa2.buildFactorMap('0xtoken', T0 + 3200);
            check('K6b defer 价格段（sender 未知假值）两键都不计 → null/0', () => {
                assert.strictEqual(f2mid.sinceLastFamousBigBuySec, null);
                assert.strictEqual(f2mid.recentFamousSellBnb, 0);
            });
            fa2.applyWalletTick({ ...rawBuy, sender_address: FAMK, price_accepted: true }, { emitFactors: false });
            fa2.applyWalletTick({ ...rawSell, sender_address: FAMK, price_accepted: true }, { emitFactors: false });
            const f2 = fa2.buildFactorMap('0xtoken', T0 + 3200);
            check('K6c wallet 段补跑恰一次 → since=0.2 + sell=0.2（与直推 bit 一致）', () => {
                assert.strictEqual(f2.sinceLastFamousBigBuySec, 0.2);
                assert.ok(Math.abs(f2.recentFamousSellBnb - 0.2) < 1e-9, `got ${f2.recentFamousSellBnb}`);
            });
        }
        // K7 摊销裁剪（>64 条触发；5×窗余量=窗内证据不丢）
        {
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            for (let i = 0; i < 65; i++) { // 间隔 10s 跨 640s：触发裁剪（头部 <尾部−300s 被裁）
                fa.processTick(tK({ trade_type: 'sell', bnb_amount: 0.01, timestamp: T0 + 2000 + i * 10000 }));
            }
            const f = fa.buildFactorMap('0xtoken', T0 + 645000); // 窗 = (T0+585000, …] → i≥59 共 6 笔
            check('K7 裁剪只裁 5×窗外头部 → 窗内 6 笔保留合计 0.06', () =>
                assert.ok(Math.abs(f.recentFamousSellBnb - 0.06) < 1e-9, `got ${f.recentFamousSellBnb}`));
        }
        // K8 HOLD 臂条件串真值表（释放四臂 OR 形状——null 侧放行 fail-open）
        {
            const se = new StrategyEngine({});
            const HOLD = 'profitPercent < 100 OR sinceLastFamousBigBuySec IS NULL'
                + ' OR sinceLastFamousBigBuySec > 120 OR recentFamousSellBnb >= 0.2';
            check('K8a pp=150 ∧ famous 在场（since=45）→ false（HOLD 该卡）', () =>
                assert.strictEqual(se.evaluateCondition(HOLD,
                    { profitPercent: 150, sinceLastFamousBigBuySec: 45, recentFamousSellBnb: 0 }), false));
            check('K8b pp=150 ∧ since=null（无 famous）→ true（放行——裸比较恒 false 由 IS NULL 臂兜住）', () =>
                assert.strictEqual(se.evaluateCondition(HOLD,
                    { profitPercent: 150, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0 }), true));
            check('K8c pp=150 ∧ since=200（120s 无大买=停止）→ true（放行）', () =>
                assert.strictEqual(se.evaluateCondition(HOLD,
                    { profitPercent: 150, sinceLastFamousBigBuySec: 200, recentFamousSellBnb: 0 }), true));
            check('K8d pp=150 ∧ sell=0.3（首大卖释放）→ true（放行）', () =>
                assert.strictEqual(se.evaluateCondition(HOLD,
                    { profitPercent: 150, sinceLastFamousBigBuySec: 30, recentFamousSellBnb: 0.3 }), true));
            check('K8e pp=80（未达安全垫）→ true（不 HOLD——pp<100 卡照常卖）', () =>
                assert.strictEqual(se.evaluateCondition(HOLD,
                    { profitPercent: 80, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }), true));
        }
        // K9 源码口径断言
        {
            const src = read('src/services/FourMemeFactorAggregator.js');
            check('K9a 写点①双段字面量（价格段 deferWallet 门+_noteFamousFlow）', () => {
                assert.ok(src.includes('this._noteFamousFlow(state, isBuy, bnbAmount, ts);'));
            });
            check('K9b 写点②补跑字面量（smartBotEligible 门+tick.timestamp）', () => {
                assert.ok(src.includes('this._noteFamousFlow(state, isBuy, bnbAmount, tick.timestamp);'));
            });
            const fnStart = src.indexOf('_noteFamousFlow(state, isBuy, bnbAmount, ts) {');
            const fnSeg = src.slice(fnStart, src.indexOf('\n    /**', fnStart));
            check('K9c 函数体禁 Date.now + Math.max 防回拨字面量', () => {
                assert.ok(!/Date\.now/.test(fnSeg), '_noteFamousFlow 出现 Date.now');
                assert.ok(fnSeg.includes('ts > state._famousBigBuyLastAt'));
            });
            check('K9d 发射段 null 语义（lastAt==null → null）+ toFixed(1)', () => {
                assert.ok(src.includes('sinceLastFamousBigBuySec: state._famousBigBuyLastAt === null ? null'));
                assert.ok(src.includes("/ 1000).toFixed(1)"));
            });
            const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
            check('K9e FactorBuilder 快照透传两键（不落库即丢防线）', () => {
                assert.ok(fbSrc.includes('sinceLastFamousBigBuySec: factorResults.sinceLastFamousBigBuySec ?? null'));
                assert.ok(fbSrc.includes('recentFamousSellBnb: factorResults.recentFamousSellBnb ?? null'));
            });
            check('K9f getFactorKeys 探针含两键（未知因子三防线自动认得）', () => {
                const keys = newFA().getFactorKeys();
                assert.ok(keys.has('sinceLastFamousBigBuySec'), '探针缺 sinceLastFamousBigBuySec');
                assert.ok(keys.has('recentFamousSellBnb'), '探针缺 recentFamousSellBnb');
            });
        }
        // K10 roster 未加载 fail-open（K 段内置复位前置段）
        {
            FourMemeFactorAggregator.setFamousCopyWalletsForTest(null);
            const fa = newFA();
            fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
            fa.processTick(tK({ bnb_amount: 0.5, timestamp: T0 + 3000 })); // roster 空 → 不记
            const f = fa.buildFactorMap('0xtoken', T0 + 4000);
            check('K10 roster 未加载恒 null/0（fail-open：HOLD 不触发，无 famous 票零影响）', () => {
                assert.strictEqual(f.sinceLastFamousBigBuySec, null);
                assert.strictEqual(f.recentFamousSellBnb, 0);
            });
        }
    } finally {
        FourMemeFactorAggregator.setFamousCopyWalletsForTest(null); // 复位未加载态
    }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
