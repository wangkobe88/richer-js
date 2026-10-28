#!/usr/bin/env node
/**
 * 净买窗三键单测（T77 2026-10-27 立短窗；T87 2026-10-28 0xdf7a 案换轨「最近
 * N 笔」；T88 2026-10-28 全史键 tradesNetBuyRatio 断代换长窗 M 笔——用户裁定
 * 「全量买卖比没必要，检测一个趋势」）——本地零 DB 零网络。
 *
 * 三键：tradesNetBuyRatioShortWin（尾 netBuyWinTrades（默认 20）笔即时流）/
 *      tradesNetBuyRatioLongWin（尾 netBuyWinLongTrades（默认 100）笔主趋势——
 *      T88 换轨载体，M>n 时=全史值=中小票 bit 一致最小干预）/
 *      tradesNetBuyShortWinBnb（短窗买量观察键，刻意不进条件串）。
 *      公式同款 (Σ买−Σ卖)÷Σ买×100；环空=null fail-closed；尾窗全卖=-100
 *      有证据零值——三键 null 语义 T87/T88 统一。
 * 原料复用 _activityEvents 事件环（act* 先例；尾 N 笔按到达序——defer 乱序
 * 回推行落环尾，竞速缝隙与 famous/act* 同款已知形状）。
 *
 * 覆盖：
 *   A. 精确公式（尾 20 笔买卖混排；M>n 时长窗=全史值）
 *   B. 尾窗边界（25 笔：前 5 笔出短窗、长窗 25<100 全计入）
 *   C. 乱序到达容忍（事件集相同即求和同——defer 回推行落环尾计入尾窗）
 *   D. null/-100 语义（环空=null fail-closed `>=40` 恒 false；尾窗全卖=-100）
 *   E. 与时间无关（asOf 推进读数不变——读点零周期判定天然免 Date.now）
 *   F. 裁剪交互（稀疏票尾 20 笔不被 act 时间界裁穿=环尾 floor 笔永不裁）
 *   G. 参数覆盖（netBuyWinTrades=5 / netBuyWinLongTrades=7 独立生效）+ 默认
 *   H. getFactorKeys 探针含三键（未知因子三防线自动认得）
 *   I. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   J. 源码口径断言（读点段禁 Date.now / 裁剪环尾 floor 保底 / 全史键发射
 *      防复活 / netBuyWinMs 退役）+ OR 臂真值表（新键名）
 *   K. 长窗边界（T88 核心）：150 笔密集流长窗自截（前 50 笔出局——早期砸盘
 *      记忆截断=换轨动机）；prune 协同（稀疏流 floor=100 不裁穿）
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
console.log('A. 精确公式（尾 20 笔；M>n 时长窗=全史值）');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    fa.processTick(mkTick({ bnb_amount: 0.8, timestamp: AS_OF - 30000 }));
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.3, timestamp: AS_OF - 10000 }));
    fa.processTick(mkTick({ bnb_amount: 0.4, timestamp: AS_OF - 1000 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    check('短窗净比 = 75.00（(1.2−0.3)/1.2×100）', () => assert.strictEqual(f.tradesNetBuyRatioShortWin, 75.00));
    check('短窗买量观察键 = 1.2（toFixed(4)）', () => assert.strictEqual(f.tradesNetBuyShortWinBnb, 1.2));
    check('长窗 3 笔 <100 全计入 = 75.00（T88 换轨后中小票 bit 一致）', () =>
        assert.strictEqual(f.tradesNetBuyRatioLongWin, 75.00));
}

// ═══════════════ B. 尾窗边界（笔数出局与时间无关） ═══════════════
console.log('B. 尾窗边界');
{
    const fa = newFA();
    const AS_OF = T0 + 60000;
    for (let i = 0; i < 5; i++) fa.processTick(mkTick({ bnb_amount: 0.2, timestamp: AS_OF - 50000 + i * 1000 })); // 前 5 笔出短窗
    fa.processTick(mkTick({ bnb_amount: 0.5, timestamp: AS_OF - 10000 })); // 第 6 笔起入短窗
    for (let i = 0; i < 19; i++) fa.processTick(mkTick({ bnb_amount: 0.05, timestamp: AS_OF - 9000 + i * 100 }));
    const f = fa.buildFactorMap('0xtoken', AS_OF);
    // 尾 20 笔 = 0.5 + 19×0.05 = 1.45 全买
    check('25 笔 → 前 5 笔出短窗，尾 20 笔买量 = 1.45', () =>
        assert.strictEqual(f.tradesNetBuyShortWinBnb, 1.45));
    check('短窗全买 → 净比 100', () => assert.strictEqual(f.tradesNetBuyRatioShortWin, 100.00));
    check('长窗 25 笔 <100 全计入 → 100（短窗≠长窗边界形状反证）', () =>
        assert.strictEqual(f.tradesNetBuyRatioLongWin, 100.00));
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
    check('乱序到达 == 正序（事件集相同 → 求和交换律 bit 一致，短/长窗同）', () => {
        assert.deepStrictEqual(b.tradesNetBuyRatioShortWin, a.tradesNetBuyRatioShortWin);
        assert.deepStrictEqual(b.tradesNetBuyRatioLongWin, a.tradesNetBuyRatioLongWin);
    });
    check('值 = (1.2−0.3)/1.2 = 75', () => assert.strictEqual(a.tradesNetBuyRatioShortWin, 75.00));
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
    check('短窗全卖 → -100（有证据零值）', () =>
        assert.strictEqual(f1.tradesNetBuyRatioShortWin, -100));
    check('长窗 41 笔全计入 = (2.1−1)/2.1 = 52.38（含挤出的 1 笔买）', () =>
        assert.strictEqual(f1.tradesNetBuyRatioLongWin, 52.38));
    check('`tradesNetBuyRatioShortWin >= 40` 对 -100 恒 false', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioShortWin >= 40', f1), false);
    });
    check('空环（无 tick）→ 三键 null/0（fail-closed）', () => {
        const fa3 = newFA();
        const f3 = fa3.buildFactorMap('0xtoken', AS_OF);
        assert.strictEqual(f3.tradesNetBuyRatioShortWin, null);
        assert.strictEqual(f3.tradesNetBuyShortWinBnb, 0);
        assert.strictEqual(f3.tradesNetBuyRatioLongWin, null);
    });
    check('`>= 40` 对 null 恒 false（短/长窗同）', () => {
        const se = new StrategyEngine({});
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioShortWin >= 40',
            { tradesNetBuyRatioShortWin: null }), false);
        assert.strictEqual(se.evaluateCondition('tradesNetBuyRatioLongWin >= 40',
            { tradesNetBuyRatioLongWin: null }), false);
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
        assert.strictEqual(f.tradesNetBuyRatioShortWin, 100.00));
    const fLater = fa.buildFactorMap('0xtoken', T1 + 600000);
    check('asOf 推进 10 分钟读数不变（读点不消费时间）', () =>
        assert.strictEqual(fLater.tradesNetBuyRatioShortWin, 100.00));
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
        assert.strictEqual(f.tradesNetBuyShortWinBnb, 1.0));
    check('长窗 60 笔 <100 全计入 = 3.0 买量', () =>
        assert.strictEqual(f.tradesNetBuyRatioLongWin, 100.00));
    check('actBuyBnb 同刻 = 0.05（10s 窗只含最新 1 笔，act* 语义不变）', () =>
        assert.strictEqual(f.actBuyBnb, 0.05));
    // 卖压注入后尾窗即时反映
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.05, timestamp: now + 61000 }));
    const f2 = fa.buildFactorMap('0xtoken', now + 61000);
    check('新卖入尾窗（尾 20=19 买+1 卖）→ (0.95−0.05)/0.95 = 94.74', () =>
        assert.strictEqual(f2.tradesNetBuyRatioShortWin, 94.74));
}

// ═══════════════ G. 参数覆盖 + 默认 ═══════════════
console.log('G. 参数覆盖');
{
    const AS_OF = T0 + 60000;
    const faN5 = newFA({ netBuyWinTrades: 5, netBuyWinLongTrades: 7 });
    for (let i = 0; i < 10; i++) faN5.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 10000 + i * 100 }));
    const fN5 = faN5.buildFactorMap('0xtoken', AS_OF);
    check('netBuyWinTrades=5：尾 5 笔买量 = 0.5（前 5 笔出局）', () =>
        assert.strictEqual(fN5.tradesNetBuyShortWinBnb, 0.5));
    check('netBuyWinLongTrades=7：尾 7 笔净比 = 100（前 3 笔出局，10 笔全买）', () =>
        assert.strictEqual(fN5.tradesNetBuyRatioLongWin, 100.00));
    // 长窗参数独立生效反证：10 笔中前 3 笔卖、后 7 笔买 → 短窗 5 笔全买=100、长窗 7 笔=100；
    // 再构造长窗 ≠ 短窗形状：前 4 笔卖 0.1、后 6 笔买 0.1 → 长 7 笔=(0.6-0.1)/0.6=83.33
    const faL = newFA({ netBuyWinLongTrades: 7 });
    for (let i = 0; i < 4; i++) faL.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.1, timestamp: AS_OF - 10000 + i * 100 }));
    for (let i = 0; i < 6; i++) faL.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 9500 + i * 100 }));
    check('netBuyWinLongTrades=7 独立生效：尾 7 笔=(0.6−0.1)/0.6 = 83.33', () =>
        assert.strictEqual(faL.buildFactorMap('0xtoken', AS_OF).tradesNetBuyRatioLongWin, 83.33));
    const faDef = newFA();
    for (let i = 0; i < 10; i++) faDef.processTick(mkTick({ bnb_amount: 0.1, timestamp: AS_OF - 10000 + i * 100 }));
    check('默认 20/100：10 笔全计入 = 1.0（长短窗同值）', () => {
        const fDef = faDef.buildFactorMap('0xtoken', AS_OF);
        assert.strictEqual(fDef.tradesNetBuyShortWinBnb, 1.0);
        assert.strictEqual(fDef.tradesNetBuyRatioLongWin, 100.00);
    });
}

// ═══════════════ H. getFactorKeys 探针 ═══════════════
console.log('H. getFactorKeys 探针');
{
    const keys = newFA().getFactorKeys();
    check('探针含三新键且旧键已删（未知因子三防线口径）', () => {
        assert.ok(keys.has('tradesNetBuyRatioShortWin'), '缺 tradesNetBuyRatioShortWin');
        assert.ok(keys.has('tradesNetBuyShortWinBnb'), '缺 tradesNetBuyShortWinBnb');
        assert.ok(keys.has('tradesNetBuyRatioLongWin'), '缺 tradesNetBuyRatioLongWin');
        assert.ok(!keys.has('tradesNetBuyRatioWin'), '旧键 tradesNetBuyRatioWin 仍在');
        assert.ok(!keys.has('tradesNetBuyWinBnb'), '旧键 tradesNetBuyWinBnb 仍在');
        assert.ok(!keys.has('tradesNetBuyRatio'), '旧全史键 tradesNetBuyRatio 仍在（T88 断代）');
    });
}

// ═══════════════ I. FactorBuilder 快照透传 ═══════════════
console.log('I. FactorBuilder 快照透传');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({
        tradesNetBuyRatioShortWin: 55.5, tradesNetBuyShortWinBnb: 1.25, tradesNetBuyRatioLongWin: 48.3,
    });
    check('三键透传（55.5 / 1.25 / 48.3）', () => {
        assert.strictEqual(snap.tradesNetBuyRatioShortWin, 55.5);
        assert.strictEqual(snap.tradesNetBuyShortWinBnb, 1.25);
        assert.strictEqual(snap.tradesNetBuyRatioLongWin, 48.3);
    });
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('旧 FA 缺键 → null 不掩盖（历史快照旧键保留展示）', () => {
        assert.strictEqual(snapOld.tradesNetBuyRatioShortWin, null);
        assert.strictEqual(snapOld.tradesNetBuyShortWinBnb, null);
        assert.strictEqual(snapOld.tradesNetBuyRatioLongWin, null);
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
    check('floor 含长窗（max(short, long, 32)）', () =>
        assert.ok(src.includes('Math.max(this._fp.netBuyWinTrades, this._fp.netBuyWinLongTrades, 32)'), 'floor 缺 netBuyWinLongTrades'));
    check('netBuyWinMs 参数已随时间窗退役', () =>
        assert.ok(!src.includes('netBuyWinMs'), '源码残留 netBuyWinMs'));
    check('全史键发射防复活（源码无 tradesNetBuyRatio: 对象键形状）', () =>
        assert.ok(!/\btradesNetBuyRatio\s*:/.test(src), '源码出现 tradesNetBuyRatio: 发射形状（T88 断代防复活）'));
    const se = new StrategyEngine({});
    const OR = '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)';
    check('OR 臂：长窗过线（45）短窗 null → 放行（慢热票长记忆承接形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatioLongWin: 45, tradesNetBuyRatioShortWin: null }), true));
    check('OR 臂：长窗 18 短窗 46.4 过线 → 放行（砸盘后恢复形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatioLongWin: 18, tradesNetBuyRatioShortWin: 46.4 }), true));
    check('OR 臂：长窗 18 短窗 null → 拒（MUSK2028 砸盘段形状）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatioLongWin: 18, tradesNetBuyRatioShortWin: null }), false));
    check('OR 臂：长窗 18 短窗 -100 → 拒（尾窗全卖有证据零值）', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatioLongWin: 18, tradesNetBuyRatioShortWin: -100 }), false));
    check('OR 臂：双 null → 拒', () =>
        assert.strictEqual(se.evaluateCondition(OR, { tradesNetBuyRatioLongWin: null, tradesNetBuyRatioShortWin: null }), false));
}

// ═══════════════ K. 长窗边界（T88 核心：记忆截断） ═══════════════
console.log('K. 长窗边界（150 笔密集流：早期砸盘滚出长窗）');
{
    const fa = newFA();
    // 密集流（50ms 间隔 ×150 笔=7.5s）：prune 时间界（20s）不出局——长窗按笔数自截
    let now = T0;
    for (let i = 0; i < 50; i++) fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.1, timestamp: (now += 50) })); // 前 50 笔砸盘 5.0
    for (let i = 0; i < 100; i++) fa.processTick(mkTick({ bnb_amount: 0.02, timestamp: (now += 50) })); // 后 100 笔买 2.0
    const f = fa.buildFactorMap('0xtoken', now);
    check('长窗尾 100=纯买段 → 100（早期 50 笔砸盘滚出长窗=换轨动机形状）', () =>
        assert.strictEqual(f.tradesNetBuyRatioLongWin, 100.00));
    check('对照全史量：买 2.0 卖 5.0（旧全史口径=(2−5)/2=−150 恒拦——被截断救回）', () => {
        assert.ok(Math.abs(f.buyVolumeBnb - 2.0) < 1e-9);
        assert.ok(Math.abs(f.sellVolumeBnb - 5.0) < 1e-9);
    });
    // 追加 1 笔卖：151 笔，长窗尾 100=第 52..151 笔（首笔买出局，含 1 卖）
    fa.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.05, timestamp: (now += 50) }));
    const f2 = fa.buildFactorMap('0xtoken', now);
    check('151 笔新卖入长窗 → (1.98−0.05)/1.98 = 97.47', () =>
        assert.strictEqual(f2.tradesNetBuyRatioLongWin, 97.47));
}
console.log('K2. prune 协同（稀疏长流 floor=100 不裁穿）');
{
    const fa = newFA();
    let now = T0;
    // 每分钟 1 笔 × 400 笔：len>floor+32=132 起 prune 每次裁时间界外旧行，
    // maxCut=len−floor 保证尾 100 笔永不裁——长窗证据完整
    for (let i = 0; i < 400; i++) {
        now += 60000;
        fa.processTick(mkTick({ bnb_amount: 0.01, timestamp: now }));
    }
    const st = fa._states?.get('0xtoken') || fa.states?.get('0xtoken');
    const ringLen = st && st._activityEvents ? st._activityEvents.length : null;
    const f = fa.buildFactorMap('0xtoken', now);
    check('400 分钟稀疏流：环保底 ≥100 笔（floor=max(20,100,32)）', () =>
        assert.ok(ringLen >= 100, `环长=${ringLen}`));
    check('长窗尾 100 全买 → 100（prune 后证据不裁穿）', () =>
        assert.strictEqual(f.tradesNetBuyRatioLongWin, 100.00));
    check('短窗同刻不受影响 = 100', () =>
        assert.strictEqual(f.tradesNetBuyRatioShortWin, 100.00));
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
