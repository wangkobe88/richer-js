#!/usr/bin/env node
/**
 * 净买窗两键单测（T77 2026-10-27 MUSK2028 案立 10s 时间窗；T87 2026-10-28
 * 0xdf7a 案用户裁定换轨「最近 N 笔」尾窗——慢热票 10s 内常无行情，时间窗
 * null fail-closed 恰好掐掉目标形状）——本地零 DB 零网络。
 *
 * 两键：tradesNetBuyRatioWin（(Σ买−Σ卖)÷Σ买×100，尾 netBuyWinTrades（默认 20）
 *      笔；环空=null fail-closed；尾窗全卖=-100 有证据零值——T87 后与全史键
 *      null 语义统一）/ tradesNetBuyWinBnb（尾窗买量观察键）。
 * 原料复用 _activityEvents 事件环（act* 先例；尾 N 笔按到达序——defer 乱序
 * 回推行落环尾，竞速缝隙与 famous/act* 同款已知形状）。
 *
 * 覆盖：
 *   A. 精确公式（尾 20 笔买卖混排，toFixed(2) 对齐全史键口径）
 *   B. 尾窗边界（25 笔：前 5 笔出局、后 20 笔计入——与时间无关）
 *   C. 乱序到达容忍（事件集相同即求和同——defer 回推行落环尾计入尾窗）
 *   D. null/-100 语义（环空=null fail-closed `>=40` 恒 false；尾窗全卖=-100
 *      与全史键统一——T77 时间窗「10s 零买=null」语义随换轨退役）
 *   E. 与时间无关（asOf 推进读数不变——读点零周期判定天然免 Date.now）
 *   F. 裁剪交互（稀疏票跨 21 分钟尾 20 笔不被 act 时间界裁穿=环尾 floor 笔
 *      永不裁；活跃票 act* 10s 窗照常）
 *   G. 参数覆盖（netBuyWinTrades=5 生效）+ 默认 20
 *   H. getFactorKeys 探针含两键（未知因子三防线自动认得）
 *   I. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   J. 源码口径断言（读点段禁 Date.now / 裁剪环尾 floor 保底 / OR 臂真值表）
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

// ═══════════════ A. 精确公式 ═══════════════
console.log('A. 精确公式（尾 20 笔）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.8, timestamp: AS_OF - 30000 }));
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.3, timestamp: AS_OF - 10000 }));
    fa.processTick(mkTick({ bnb_amount: 0.4, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('尾窗净比 = 75.00（(1.2−0.3)/1.2×100）', () => assert.strictEqual(f.tradesNetBuyRatioWin, 75.00));
    check('尾窗买量观察键 = 1.2（toFixed(4)）', () => assert.strictEqual(f.tradesNetBuyWinBnb, 1.2));
    check('对照全史键同值（事件集相同）', () => assert.strictEqual(f.tradesNetBuyRatio, 75.00));
}

// ═══════════════ B. 尾窗边界（笔数出局与时间无关） ═══════════════
console.log('B. 尾窗边界');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    for (let i = 0; i < 5; i++) fa.processTick(mkTick({ bnb_amount: 0.2, timestamp: AS_OF - 50000 + i * 1000 })); // 前 5 笔出局
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 10000 })); // 第 6 笔起入窗
    for (let i = 0; i < 19; i++) fa.processTick(mkTick({ bnb_amount: 0.05, timestamp: AS_OF - 9000 + i * 100 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    // 尾 20 笔 = 0.5 + 19×0.05 = 1.45 全买
    check('25 笔 → 前 5 笔出局，尾 20 笔买量 = 1.45', () =>
        assert.strictEqual(f.tradesNetBuyWinBnb, 1.45));
    check('尾窗全买 → 净比 100', () => assert.strictEqual(f.tradesNetBuyRatioWin, 100.00));
    check('全史键含全部 25 笔 = 0.2×5+1.45=2.45（尾窗≠全史反证）', () =>
        assert.strictEqual(f.tradesNetBuyRatio, 100.00));
    check('全史买量 = 2.45（对照键含前 5 笔；浮点累加近似）', () =>
        assert.ok(Math.abs(f.buyVolumeBnb - 2.45) < 1e-9));
}

// ═══════════════ C. 乱序到达容忍 ═══════════════
console.log('C. 乱序到达容忍（事件集相同即求和同）');
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
    check('乱序到达 == 正序（事件集相同 → 求和交换律 bit 一致）', () =>
        assert.deepStrictEqual(b.tradesNetBuyRatioWin, a.tradesNetBuyRatioWin));
    check('值 = (1.2−0.3)/1.2 = 75', () => assert.strictEqual(a.tradesNetBuyRatioWin, 75.00));
}

// ═══════════════ D. null / -100 语义 ═══════════════
console.log('D. null / -100 语义');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    // 尾窗全卖：21 笔买（0.1×21=2.1）+ 20 笔卖（0.05×20=1.0）——尾 20 笔=纯卖
    for (let i = 0; i < 21; i++) fa.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 100000 + i * 1000 }));
    for (let i = 0; i < 20; i++) fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.05, timestamp: AS_OF - 20000 + i * 1000 }));
    const f1 = fa.buildFactorMap('0xtoken', AS_OF);
    check('尾窗全卖 → -100（有证据零值，T87 与全史键统一）', () =>
        assert.strictEqual(f1.tradesNetBuyRatioWin, -100));
    check('对照全史键 = (2.1−1)/2.1 = 52.38（全史含挤出的 1 笔买）', () =>
        assert.strictEqual(f1.tradesNetBuyRatio, 52.38));
    check('`tradesNetBuyRatioWin >= 40` 对 -100 恒 false', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioWin >= 40', f1), false);
    });
    check('空环（无 tick）→ null（fail-closed）+ 买量 0', () => {
        const fa3 = newFA();
        const f3 = fa3.buildFactorMap('0xtoken', AS_OF);
        assert.strictEqual(f3.tradesNetBuyRatioWin, null);
        assert.strictEqual(f3.tradesNetBuyWinBnb, 0);
    });
    check('`tradesNetBuyRatioWin >= 40` 对 null 恒 false', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioWin >= 40',
            { tradesNetBuyRatioWin: null }), false);
    });
}

// ═══════════════ E. 与时间无关（读点零周期判定） ═══════════════
console.log('E. 与时间无关');
{
    const fa = newFA();
    const T1 = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.6, timestamp: T1 - 600000 })); // 10 分钟前（T77 时间窗早已出局）
    const f = fa.buildFactorMap('0xtoken', T1);
    check('10 分钟前的单笔买仍计入尾窗 = 100（T87 时间窗退役反证）', () =>
        assert.strictEqual(f.tradesNetBuyRatioWin, 100.00));
    const fLater = fa.buildFactorMap('0xtoken', T1 + 600000);
    check('asOf 推进 10 分钟读数不变（读点不消费时间）', () =>
        assert.strictEqual(fLater.tradesNetBuyRatioWin, 100.00));
}

// ═══════════════ F. 裁剪交互（稀疏票不被 act 时间界裁穿） ═══════════════
console.log('F. 裁剪交互');
{
    const fa = newFA();
    let now = T0;
    // 稀疏票：每分钟 1 笔 × 60 笔——每次 processTick 都触发 prune 考察（长度 53 后）
    for (let i = 0; i < 60; i++) {
        now += 60000;
        fa.processTick(mkTick({ bnb_amount: 0.05, timestamp: now }));
    }
    const f = fa.buildFactorMap('0xtoken', now);
    check('60 分钟稀疏流：尾 20 笔保住 = 买量 1.0（时间界裁穿反证）', () =>
        assert.strictEqual(f.tradesNetBuyWinBnb, 1.0));
    check('actBuyBnb 同刻 = 0.05（10s 窗只含最新 1 笔，act* 语义不变）', () =>
        assert.strictEqual(f.actBuyBnb, 0.05));
    // 卖压注入后尾窗即时反映
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.05, timestamp: now + 61000 }));
    const f2 = fa.buildFactorMap('0xtoken', now + 61000);
    check('新卖入尾窗（尾 20=19 买+1 卖）→ (0.95−0.05)/0.95 = 94.74', () =>
        assert.strictEqual(f2.tradesNetBuyRatioWin, 94.74));
}

// ═══════════════ G. 参数覆盖 + 默认 ═══════════════
console.log('G. 参数覆盖');
{
    const AS_OF = T0 + 60000;
    const faN5 = newFA({ netBuyWinTrades: 5 });
    for (let i = 0; i < 10; i++) faN5.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 10000 + i * 100 }));
    check('netBuyWinTrades=5：尾 5 笔买量 = 0.5（前 5 笔出局）', () =>
        assert.strictEqual(faN5.buildFactorMap('0xtoken', AS_OF).tradesNetBuyWinBnb, 0.5));
    const faDef = newFA();
    for (let i = 0; i < 10; i++) faDef.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 10000 + i * 100 }));
    check('默认 20：10 笔全计入 = 1.0', () =>
        assert.strictEqual(faDef.buildFactorMap('0xtoken', AS_OF).tradesNetBuyWinBnb, 1.0));
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
    const seg = src.slice(src.indexOf('_netBuyWinFactors(state)'), src.indexOf('// _earlyWindowAdvance'));
    check('读点段禁 Date.now', () => assert.ok(!seg.includes('Date.now'), '读点段出现 Date.now'));
    check('读点段无 cutoff/时间窗残留', () => assert.ok(!seg.includes('cutoff'), '读点段出现 cutoff'));
    check('裁剪环尾 floor 保底（maxCut 上限防裁穿尾 N 笔）', () => {
        assert.ok(src.includes('const maxCut = evts.length - floor;'), '缺 maxCut 保底');
        assert.ok(src.includes('while (i < maxCut'), 'while 未受 maxCut 约束');
    });
    check('netBuyWinMs 参数已随时间窗退役', () =>
        assert.ok(!src.includes('netBuyWinMs'), '源码残留 netBuyWinMs'));
    const se = new StrategyEngine({});
    const OR = '(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)';
    check('OR 臂：全史过线（45）窗口 null → 放行', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 45, tradesNetBuyRatioWin: null }), true));
    check('OR 臂：全史 18 窗口 46.4 过线 → 放行', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 18, tradesNetBuyRatioWin: 46.4 }), true));
    check('OR 臂：全史 18 窗口 null → 拒（MUSK2028 砸盘段形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 18, tradesNetBuyRatioWin: null }), false));
    check('OR 臂：全史 18 窗口 -100 → 拒（尾窗全卖有证据零值）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: 18, tradesNetBuyRatioWin: -100 }), false));
    check('OR 臂：双 null → 拒', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatio: null, tradesNetBuyRatioWin: null }), false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
