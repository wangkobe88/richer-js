#!/usr/bin/env node
/**
 * 滚动净买窗两键单测（T77 2026-10-27 MUSK2028 0x8f53…7777 案，用户裁定 W=10s
 * 先跑观察）——本地零 DB 零网络。
 *
 * 两键：tradesNetBuyRatioWin（(Σ买−Σ卖)÷Σ买×100，10s 窗，null=窗内零买缺近期
 *      证据 fail-closed）/ tradesNetBuyWinBnb（窗买量观察键）。
 * 原料复用 _activityEvents 事件环（act* 先例；求和交换律 → defer 乱序回推无害），
 * 窗宽 factorParams.netBuyWinMs 默认 10000。
 *
 * 覆盖：
 *   A. 正序精确公式（买卖混排，toFixed(2) 对齐全史键口径）
 *   B. 窗口边界（asOf-11s 出局 / asOf-10s 边界留）
 *   C. 乱序回推容忍（乱序补喂 == 正序重放对拍）
 *   D. null 语义（窗内零买但有卖 → null；`>= 40` 恒 false fail-closed；
 *      对照全史键同输入 = -100 有证据零值——两键语义刻意分叉）
 *   E. 防前视（读数只随 asOf 变，禁 Date.now）
 *   F. 裁剪交互（netBuyWinMs > activityWinMs：25s 前事件 act 窗外但净买窗内，
 *      >64 事件触发 prune 后窗内值不变）
 *   G. 参数覆盖（netBuyWinMs=30000 生效）+ 默认 10000
 *   H. getFactorKeys 探针含两键（未知因子三防线自动认得）
 *   I. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   J. 源码口径断言（读点段禁 Date.now / 裁剪 cutoff 两窗 max / OR 臂真值表三态）
 *
 * 用法：node scripts/_test_netbuy_window_factors.cjs
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

/** 标准构造：FA + 已注册 token（factorParams 覆盖经参传） */
function newFA(factorParams) {
    const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
    const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. 正序精确公式 ═══════════════
console.log('A. 正序精确公式（10s 窗）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    // 窗内（AS_OF-9s~AS_OF-1s）：买 0.8+0.4=1.2，卖 0.3 → (1.2-0.3)/1.2 = 75
    fa.processTick(mkTick({ bnb_amount: 0.8, timestamp: AS_OF - 9000 }));
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.3, timestamp: AS_OF - 7000 }));
    fa.processTick(mkTick({ bnb_amount: 0.4, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('窗净比 = 75.00（(1.2−0.3)/1.2×100）', () => assert.strictEqual(f.tradesNetBuyRatioWin, 75.00));
    check('窗买量观察键 = 1.2（toFixed(4)）', () => assert.strictEqual(f.tradesNetBuyWinBnb, 1.2));
}

// ═══════════════ B. 窗口边界 ═══════════════
console.log('B. 窗口边界');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 11000 })); // 出局（>10s 前）
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 10000 })); // 边界留（==cutoff）
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.1, timestamp: AS_OF - 9500 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('AS_OF-11s 出局 / AS_OF-10s 边界留 → (0.5−0.1)/0.5 = 80', () =>
        assert.strictEqual(f.tradesNetBuyRatioWin, 80.00));
    check('窗买量只计边界内 0.5', () => assert.strictEqual(f.tradesNetBuyWinBnb, 0.5));
}

// ═══════════════ C. 乱序回推容忍 ═══════════════
console.log('C. 乱序回推容忍（求和交换律）');
{
    const mk = (ts, type, bnb) => mkTick({ timestamp: ts, trade_type: type, bnb_amount: bnb });
    const AS_OF = T0 + 60000;
    const ticks = [
        mk(AS_OF - 9000, 'buy', 0.7), mk(AS_OF - 8000, 'sell', 0.2),
        mk(AS_OF - 5000, 'buy', 0.5), mk(AS_OF - 2000, 'sell', 0.1),
    ];
    const straight = newFA();
    for (const t of ticks) straight.processTick(t);
    const shuffled = newFA();
    for (const t of [ticks[2], ticks[0], ticks[3], ticks[1]]) shuffled.processTick(t);
    const a = straight.buildFactorMap('0xtoken', AS_OF);
    const b = shuffled.buildFactorMap('0xtoken', AS_OF);
    check('乱序补喂 == 正序重放（bit 一致）', () =>
        assert.deepStrictEqual(b.tradesNetBuyRatioWin, a.tradesNetBuyRatioWin));
    check('值 = (1.2−0.3)/1.2 = 75', () => assert.strictEqual(a.tradesNetBuyRatioWin, 75.00));
}

// ═══════════════ D. null 语义 ═══════════════
console.log('D. null 语义（fail-closed）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 2, timestamp: AS_OF - 9000 }));       // 窗内买（早段）
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 1, timestamp: AS_OF - 30000 })); // 窗外卖
    const f1 = fa.buildFactorMap('0xtoken', AS_OF);
    check('窗内有买 → 有值', () => assert.ok(f1.tradesNetBuyRatioWin === 100.00));
    // 全推到窗外：只剩窗内卖
    const fa2 = newFA();
    fa2.processTick(mkTick({ trade_type: 'sell', bnb_amount: 1, timestamp: AS_OF - 5000 }));
    const f2 = fa2.buildFactorMap('0xtoken', AS_OF);
    check('窗内零买但有卖 → null（缺近期证据）', () => assert.strictEqual(f2.tradesNetBuyRatioWin, null));
    check('对照全史键同输入 = -100（有证据零值，两键语义刻意分叉）', () =>
        assert.strictEqual(f2.tradesNetBuyRatio, -100));
    check('`tradesNetBuyRatioWin >= 40` 对 null 恒 false（fail-closed）', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioWin >= 40', f2), false);
    });
    check('空窗（无 tick）→ null', () => {
        const fa3 = newFA();
        const f3 = fa3.buildFactorMap('0xtoken', AS_OF);
        assert.strictEqual(f3.tradesNetBuyRatioWin, null);
        assert.strictEqual(f3.tradesNetBuyWinBnb, 0);
    });
}

// ═══════════════ E. 防前视（读数只随 asOf 变） ═══════════════
console.log('E. 防前视');
{
    const fa = newFA();
    const T1 = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.6, timestamp: T1 - 5000 }));
    // 真实墙钟远晚于 T1（距今数月）——若读点用 Date.now，T1-5s 早已出局必得 null
    const f = fa.buildFactorMap('0xtoken', T1);
    check('asOf 决定窗口（禁 Date.now）——5s 前事件仍计入 = 100', () =>
        assert.strictEqual(f.tradesNetBuyRatioWin, 100.00));
    const fLate = fa.buildFactorMap('0xtoken', T1 + 6000);
    check('同一事件流，asOf 推进 6s → 事件滑出窗 = null', () =>
        assert.strictEqual(fLate.tradesNetBuyRatioWin, null));
}

// ═══════════════ F. 裁剪交互（netBuyWinMs > activityWinMs） ═══════════════
console.log('F. 裁剪交互');
{
    const fa = newFA({ netBuyWinMs: 30000 });
    const AS_OF = T0 + 60000;
    // 头部 70 笔 25s 前事件：act(10s) 窗外、净买窗(30s) 内；触发 >64 摊销裁剪后仍须计入
    for (let i = 0; i < 70; i++) fa.processTick(mkTick({ bnb_amount: 0.01, timestamp: AS_OF - 25000 }));
    fa.processTick(mkTick({ bnb_amount: 0.3, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('prune 后 25s 前事件仍在 30s 净买窗内（0.7+0.3 买）', () =>
        assert.strictEqual(f.tradesNetBuyWinBnb, 1));
    check('actBuyBnb 同刻只计 0.3（10s 窗不含 25s 前事件）', () =>
        assert.strictEqual(f.actBuyBnb, 0.3));
    // 逐笔推进裁剪头（cutoff=now−2×30s=60s 前）：25s 前事件永不误删
    fa.processTick(mkTick({ bnb_amount: 0.01, timestamp: AS_OF + 34000 }));
    const f2 = fa.buildFactorMap('0xtoken', AS_OF + 34000);
    check('now 推进 34s：25s 前事件滑出 30s 窗（但不被 splice 误删先于窗口）→ 只剩近端', () =>
        assert.strictEqual(f2.tradesNetBuyRatioWin, 100.00));
}

// ═══════════════ G. 参数覆盖 + 默认 ═══════════════
console.log('G. 参数覆盖');
{
    const AS_OF = T0 + 60000;
    const faWide = newFA({ netBuyWinMs: 30000 });
    faWide.processTick(mkTick({ bnb_amount: 1, timestamp: AS_OF - 20000 }));
    check('netBuyWinMs=30000：20s 前事件计入', () =>
        assert.strictEqual(faWide.buildFactorMap('0xtoken', AS_OF).tradesNetBuyRatioWin, 100.00));
    const faDef = newFA();
    faDef.processTick(mkTick({ bnb_amount: 1, timestamp: AS_OF - 20000 }));
    check('默认 10000：20s 前事件出局 → null', () =>
        assert.strictEqual(faDef.buildFactorMap('0xtoken', AS_OF).tradesNetBuyRatioWin, null));
}

// ═══════════════ H. getFactorKeys 探针 ═══════════════
console.log('H. getFactorKeys 探针');
{
    const keys = newFA().getFactorKeys();
    check('探针含 tradesNetBuyRatioWin / tradesNetBuyWinBnb', () => {
        assert.ok(keys.has('tradesNetBuyRatioWin'), '缺 tradesNetBuyRatioWin');
        assert.ok(keys.has('tradesNetBuyWinBnb'), '缺 tradesNetBuyWinBnb');
    });
}

// ═══════════════ I. FactorBuilder 快照透传 ═══════════════
console.log('I. FactorBuilder 快照透传');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({ tradesNetBuyRatioWin: 55.5, tradesNetBuyWinBnb: 1.25 });
    check('两键透传（55.5 / 1.25）', () => {
        assert.strictEqual(snap.tradesNetBuyRatioWin, 55.5);
        assert.strictEqual(snap.tradesNetBuyWinBnb, 1.25);
    });
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('旧 FA 缺键 → null 不掩盖', () => {
        assert.strictEqual(snapOld.tradesNetBuyRatioWin, null);
        assert.strictEqual(snapOld.tradesNetBuyWinBnb, null);
    });
}

// ═══════════════ J. 源码口径断言 + OR 臂真值表 ═══════════════
console.log('J. 源码口径断言 + OR 臂真值表');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    const seg = src.slice(src.indexOf('_netBuyWinFactors(state, now)'), src.indexOf('// _earlyWindowAdvance'));
    check('读点段禁 Date.now', () => assert.ok(!seg.includes('Date.now'), '读点段出现 Date.now'));
    check('裁剪 cutoff 两窗取 max', () =>
        assert.ok(src.includes('2 * Math.max(this._fp.activityWinMs, this._fp.netBuyWinMs)'), 'cutoff 未取 max'));
    const se = new StrategyEngine({});
    const OR = '(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)';
    check('OR 臂：全史过线（45）窗口 null → 放行', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 45, tradesNetBuyRatioWin: null }), true));
    check('OR 臂：全史 18 窗口 46.4 过线 → 放行（国库币 W10 形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 18, tradesNetBuyRatioWin: 46.4 }), true));
    check('OR 臂：全史 18 窗口 null → 拒（MUSK2028 砸盘段形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 18, tradesNetBuyRatioWin: null }), false));
    check('OR 臂：双 null → 拒', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: null, tradesNetBuyRatioWin: null }), false));
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
