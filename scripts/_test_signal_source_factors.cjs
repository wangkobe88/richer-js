#!/usr/bin/env node
/**
 * T117 信号源五因子单测（2026-11-05 买入策略整体调整）——本地零 DB 零网络。
 *
 * 五键：
 *   - recentBlockDropPct（t5 连续区块砸盘）：最近 ≤5 时点价格（≤4 已闭合块收盘环
 *     + 当前块实时收盘）内窗宽 1/2/3 块最深跌幅 %；<2 时点 null fail-closed；
 *     0=有价格对无下跌。原料环结算挂块号单调 guard——迟到/回退块不污染。
 *   - mcapFromPeakPct（t6/t7 市值回撤）：100×(1−现价/峰价)，与 T107 mcapPeakBnb
 *     同峰同价轨；峰/现价/supply 任一缺失 null（与 marketCap 缺 supply=0 口径
 *     刻意不同：本键是证据键不冒充）。
 *   - quietSpanMs/quietSurgeBuyBnb/quietSurgeSec（t7 跌底沉寂后放量）：静默段
 *     状态机挂 processTick lastTickAt 更新**前**（更新后判 ts−max 恒 ≤0 永不
 *     触发——前次会话顺序 bug 现场反证）；gap ≥ quietThresholdMs 定格 spanMs +
 *     重开 surge 波；surge 累计带 ts≥startTs guard（defer 乱序晚到旧行不污染
 *     新波）；quietSurgeSec=波已持续秒数（now=buildFactorMap 入参，禁 Date.now
 *     ——回测虚拟时钟同源）；从未开波 null。
 *
 * 覆盖：
 *   A. recentBlockDropPct 手算精确值（两块窗/三块窗宽 2/环滑出/上涨 0/不足 null）
 *   B. 迟到块忽略（块号回退不结算不入环；同块晚笔覆盖收盘=真序语义）
 *   C. mcapFromPeakPct（精确值/恰峰 0/无峰 null/supply 缺 null/toFixed 舍入）
 *   D. quiet 状态机（边界恰阈值/59999 不触发/苏醒笔即计入/卖出不计/迟到 guard
 *      /二次静默重开波清零/quietSurgeSec asOf 推进/从未开波 null）
 *   E. 乱序喂入语义（块号单调 guard——迟到块丢弃不污染，读数由按时到达块确定）
 *   F. getFactorKeys 探针含五键（未知因子三防线自动认得）
 *   G. FactorBuilder 快照透传（缺键 → null 不掩盖）
 *   H. 源码口径断言（静默判定在 lastTickAt 更新前/环上限 4/quietSurgeSec 用
 *      now 入参/读点段无 Date.now）
 *
 * 用法：node scripts/_test_signal_source_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
    price_bnb: 0.000001, price_usd: 0.0006, bnb_amount: 1, token_amount: 1000000,
    block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: _li++,
}, o);

/** 标准构造：FA + 已注册 token（factorParams 覆盖经参传；supply 可关） */
function newFA(factorParams, totalSupply = 1e9) {
    const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
    const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
    fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply, symbol: 'T', creatorAddress: null });
    return fa;
}

// ═══════════════ A. recentBlockDropPct 手算 ═══════════════
console.log('A. recentBlockDropPct（块收盘环+当前块实时收盘，窗宽 1/2/3 最深跌幅）');
{
    const fa = newFA();
    fa.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    fa.processTick(mkTick({ block_number: 101, price_bnb: 0.9 * 1e-9, timestamp: T0 + 2000 }));
    const f1 = fa.buildFactorMap('0xtoken', T0 + 2000);
    check('两时点 1.0→0.9 → 10（窗宽 1）', () => assert.strictEqual(f1.recentBlockDropPct, 10));

    const fa2 = newFA();
    fa2.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    fa2.processTick(mkTick({ block_number: 101, price_bnb: 0.9 * 1e-9, timestamp: T0 + 2000 }));
    fa2.processTick(mkTick({ block_number: 102, price_bnb: 0.72 * 1e-9, timestamp: T0 + 3000 }));
    const f2 = fa2.buildFactorMap('0xtoken', T0 + 3000);
    check('三时点 1.0/0.9/0.72 → 28（窗宽 2 深于窗宽 1 的 11.11）', () => assert.strictEqual(f2.recentBlockDropPct, 28));

    const faUp = newFA();
    faUp.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faUp.processTick(mkTick({ block_number: 101, price_bnb: 1.2 * 1e-9, timestamp: T0 + 2000 }));
    check('上涨序列 → 0（有价格对无下跌=有证据零值）', () => assert.strictEqual(faUp.buildFactorMap('0xtoken', T0 + 2000).recentBlockDropPct, 0));

    const faOne = newFA();
    faOne.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    check('单时点 → null（<2 fail-closed）', () => assert.strictEqual(faOne.buildFactorMap('0xtoken', T0 + 1000).recentBlockDropPct, null));

    // 同块多笔：收盘=该块最后一笔价（链上真序 log_index 序）
    const faSame = newFA();
    faSame.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faSame.processTick(mkTick({ block_number: 101, price_bnb: 1.5 * 1e-9, timestamp: T0 + 2000, log_index: 0 }));
    faSame.processTick(mkTick({ block_number: 101, price_bnb: 0.75 * 1e-9, timestamp: T0 + 2100, log_index: 1 }));
    check('同块末笔为收盘（101 块收 0.75 → 25 跌幅）', () => assert.strictEqual(faSame.buildFactorMap('0xtoken', T0 + 2100).recentBlockDropPct, 25));

    // 环滑出：5 个已闭合块后最老收盘滑出，最深跌幅只剩窗内部分
    const faRing = newFA();
    const prices = [1.0, 0.99, 0.98, 0.97, 0.96]; // 块 100-104；1.0 滑出后 closes=[0.99..0.96]
    prices.forEach((p, i) => faRing.processTick(mkTick({ block_number: 100 + i, price_bnb: p * 1e-9, timestamp: T0 + 1000 + i * 1000 })));
    const fr = faRing.buildFactorMap('0xtoken', T0 + 5000);
    check('环满滑出：最老 1.0 出环 → 最深=0.99→0.96 窗 3 ≈ 3.03', () => assert.strictEqual(fr.recentBlockDropPct, 3.03));
}

// ═══════════════ B. 迟到块忽略 ═══════════════
console.log('B. 迟到块忽略（块号单调 guard——回退块不结算不入环不污染收盘）');
{
    // 块 100(1.0) → 102(0.9)：迟到 101(0.5 天价) 到达后不进环不改 102 收盘
    const faLate = newFA();
    faLate.processTick(mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faLate.processTick(mkTick({ block_number: 102, price_bnb: 0.9 * 1e-9, timestamp: T0 + 3000 }));
    const before = faLate.buildFactorMap('0xtoken', T0 + 3000).recentBlockDropPct;
    faLate.processTick(mkTick({ block_number: 101, price_bnb: 0.5 * 1e-9, timestamp: T0 + 2000 }));
    const after = faLate.buildFactorMap('0xtoken', T0 + 3000).recentBlockDropPct;
    check('迟到块 101(0.5) 不污染（前=后=10）', () => {
        assert.strictEqual(before, 10);
        assert.strictEqual(after, 10);
    });
}

// ═══════════════ C. mcapFromPeakPct ═══════════════
console.log('C. mcapFromPeakPct（现价/峰价回撤，supply 缺失 null 不冒充）');
{
    const fa = newFA();
    fa.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000, block_number: 100 }));
    fa.processTick(mkTick({ price_bnb: 2.0 * 1e-9, timestamp: T0 + 2000, block_number: 101 }));
    fa.processTick(mkTick({ price_bnb: 1.6 * 1e-9, timestamp: T0 + 3000, block_number: 102 }));
    check('1.6/2.0 → 20', () => assert.strictEqual(fa.buildFactorMap('0xtoken', T0 + 3000).mcapFromPeakPct, 20));

    const faTop = newFA();
    faTop.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faTop.processTick(mkTick({ price_bnb: 1.5 * 1e-9, timestamp: T0 + 2000 }));
    check('恰在峰顶 → 0（有证据零值）', () => assert.strictEqual(faTop.buildFactorMap('0xtoken', T0 + 2000).mcapFromPeakPct, 0));

    const faNoTick = newFA();
    check('零 tick 无峰 → null fail-closed', () => assert.strictEqual(faNoTick.buildFactorMap('0xtoken', T0 + 1000).mcapFromPeakPct, null));

    const faNoSupply = newFA(null, 0);
    faNoSupply.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faNoSupply.processTick(mkTick({ price_bnb: 0.5 * 1e-9, timestamp: T0 + 2000 }));
    check('supply 缺失 → null（与 marketCap=0 口径刻意不同向）', () => assert.strictEqual(faNoSupply.buildFactorMap('0xtoken', T0 + 2000).mcapFromPeakPct, null));

    const faR = newFA();
    faR.processTick(mkTick({ price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }));
    faR.processTick(mkTick({ price_bnb: 0.8765 * 1e-9, timestamp: T0 + 2000 }));
    check('toFixed(2) 舍入 12.35', () => assert.strictEqual(faR.buildFactorMap('0xtoken', T0 + 2000).mcapFromPeakPct, 12.35));
}

// ═══════════════ D. quiet 状态机 ═══════════════
console.log('D. quiet 三键（静默段定格 + surge 波累计/重置/迟到 guard）');
{
    // 基本形状：正常流（无静默）→ quietSpanMs=0 / surge 键 null（从未开波）
    const fa0 = newFA();
    fa0.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    fa0.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 2000 }));
    const f0 = fa0.buildFactorMap('0xtoken', T0 + 2000);
    check('无静默：quietSpanMs=0 / quietSurgeSec=null', () => {
        assert.strictEqual(f0.quietSpanMs, 0);
        assert.strictEqual(f0.quietSurgeSec, null);
    });
    check('无静默：quietSurgeBuyBnb=0（从未开波=零）', () => assert.strictEqual(f0.quietSurgeBuyBnb, 0));

    // 恰阈值 60000 触发；59999 不触发
    const faEdge = newFA();
    faEdge.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faEdge.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 + 59999 }));
    check('gap=59999 不触发（strict <）', () => assert.strictEqual(faEdge.buildFactorMap('0xtoken', T0 + 1000 + 59999).quietSpanMs, 0));

    const faHit = newFA();
    faHit.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faHit.processTick(mkTick({ bnb_amount: 0.3, timestamp: T0 + 1000 + 60000 }));
    const fHit = faHit.buildFactorMap('0xtoken', T0 + 1000 + 60000);
    check('gap=60000 恰阈值触发（quietSpanMs=60000）', () => assert.strictEqual(fHit.quietSpanMs, 60000));
    check('苏醒笔是买入即计入 surge（0.3）', () => assert.strictEqual(fHit.quietSurgeBuyBnb, 0.3));
    check('quietSurgeSec=0（now=苏醒笔 ts）', () => assert.strictEqual(fHit.quietSurgeSec, 0));

    // 卖出苏醒笔：段定格但买入不累计
    const faSell = newFA();
    faSell.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faSell.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.2, timestamp: T0 + 1000 + 70000 }));
    const fSell = faSell.buildFactorMap('0xtoken', T0 + 1000 + 70000);
    check('卖出苏醒笔：段定格 70000 / surge 买入 0 / 波已开（sec=0 非 null）', () => {
        assert.strictEqual(fSell.quietSpanMs, 70000);
        assert.strictEqual(fSell.quietSurgeBuyBnb, 0);
        assert.strictEqual(fSell.quietSurgeSec, 0);
    });

    // 波内累计 + asOf 推进 quietSurgeSec
    const faWave = newFA();
    faWave.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faWave.processTick(mkTick({ bnb_amount: 0.4, timestamp: T0 + 1000 + 60000 })); // 苏醒开波买 0.4
    faWave.processTick(mkTick({ bnb_amount: 0.25, timestamp: T0 + 1000 + 62000 })); // 波内买
    faWave.processTick(mkTick({ trade_type: 'sell', bnb_amount: 0.1, timestamp: T0 + 1000 + 64000 })); // 波内卖不计
    const fWave = faWave.buildFactorMap('0xtoken', T0 + 1000 + 64000 + 6000);
    check('波内累计买入 0.65（卖不计）', () => assert.strictEqual(fWave.quietSurgeBuyBnb, 0.65));
    check('quietSurgeSec=(asOf−波起点)/1000=10', () => assert.strictEqual(fWave.quietSurgeSec, 10));

    // 迟到 guard：波开后晚到旧行（ts < 波起点）不污染累计
    const faGuard = newFA();
    faGuard.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faGuard.processTick(mkTick({ bnb_amount: 0.4, timestamp: T0 + 1000 + 60000 })); // 开波
    faGuard.processTick(mkTick({ bnb_amount: 5.0, timestamp: T0 + 1000 + 30000 })); // 乱序旧行（静默段内）
    const fGuard = faGuard.buildFactorMap('0xtoken', T0 + 1000 + 60000);
    check('乱序旧行（ts<波起点）不污染 surge（仍 0.4）', () => assert.strictEqual(fGuard.quietSurgeBuyBnb, 0.4));

    // 二次静默：开新段重置 spanMs + 清零 surge 重开
    const fa2nd = newFA();
    fa2nd.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    fa2nd.processTick(mkTick({ bnb_amount: 0.4, timestamp: T0 + 1000 + 60000 })); // 波 1 开
    fa2nd.processTick(mkTick({ bnb_amount: 0.3, timestamp: T0 + 1000 + 62000 })); // 波 1 累计 0.7
    fa2nd.processTick(mkTick({ bnb_amount: 0.2, timestamp: T0 + 1000 + 62000 + 80000 })); // 二次静默 80s 后苏醒
    const f2nd = fa2nd.buildFactorMap('0xtoken', T0 + 1000 + 62000 + 80000);
    check('二次静默：spanMs=80000 覆盖 / surge 清零重开（0.2）', () => {
        assert.strictEqual(f2nd.quietSpanMs, 80000);
        assert.strictEqual(f2nd.quietSurgeBuyBnb, 0.2);
    });

    // 不达标 gap 不覆盖旧段证据（沉寂过→小活动→再评仍见最近一次长静默）
    const faKeep = newFA();
    faKeep.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faKeep.processTick(mkTick({ bnb_amount: 0.3, timestamp: T0 + 1000 + 60000 })); // 段 60000 定格
    faKeep.processTick(mkTick({ bnb_amount: 0.1, timestamp: T0 + 1000 + 61000 })); // 小 gap 1000 不达标
    check('小 gap 不覆盖旧段（quietSpanMs 仍 60000）', () => assert.strictEqual(faKeep.buildFactorMap('0xtoken', T0 + 1000 + 61000).quietSpanMs, 60000));

    // factorParams 覆盖 quietThresholdMs
    const faP = newFA({ quietThresholdMs: 10000 });
    faP.processTick(mkTick({ bnb_amount: 0.5, timestamp: T0 + 1000 }));
    faP.processTick(mkTick({ bnb_amount: 0.3, timestamp: T0 + 1000 + 10000 }));
    check('quietThresholdMs=10000 覆盖生效（恰阈值触发）', () => assert.strictEqual(faP.buildFactorMap('0xtoken', T0 + 1000 + 10000).quietSpanMs, 10000));
}

// ═══════════════ E. 乱序喂入语义（块号单调 guard——迟到块丢弃不污染） ═══════════════
console.log('E. 乱序喂入语义（迟到块不入环=读数由按时到达块确定，非乱序同值）');
{
    const mkTicks = () => [
        mkTick({ block_number: 100, price_bnb: 1.0 * 1e-9, timestamp: T0 + 1000 }),
        mkTick({ block_number: 101, price_bnb: 0.9 * 1e-9, timestamp: T0 + 2000 }),
        mkTick({ block_number: 102, price_bnb: 0.72 * 1e-9, timestamp: T0 + 3000 }),
        mkTick({ block_number: 103, price_bnb: 0.6 * 1e-9, timestamp: T0 + 4000 }),
    ];
    const faStraight = newFA();
    for (const t of mkTicks()) faStraight.processTick(t);
    const faShuffled = newFA();
    for (const t of [mkTicks()[2], mkTicks()[0], mkTicks()[3], mkTicks()[1]]) faShuffled.processTick(t);
    const a = faStraight.buildFactorMap('0xtoken', T0 + 4000);
    const b = faShuffled.buildFactorMap('0xtoken', T0 + 4000);
    check('真序 1.0/0.9/0.72/0.6 → 40（窗 3 深于窗 2 的 28）', () => assert.strictEqual(a.recentBlockDropPct, 40));
    check('乱序（102,100,103,101）：迟到 100/101 丢弃 → 环=[0.72,0.6] → 16.67', () => assert.strictEqual(b.recentBlockDropPct, 16.67));
    check('乱序后读数幂等（确定性非 NaN）', () => assert.ok(Number.isFinite(faShuffled.buildFactorMap('0xtoken', T0 + 4000).recentBlockDropPct)));
}

// ═══════════════ F. getFactorKeys 探针 ═══════════════
console.log('F. getFactorKeys 探针含五键（未知因子三防线自动认得）');
{
    const keys = new Set(newFA().getFactorKeys());
    for (const k of ['recentBlockDropPct', 'mcapFromPeakPct', 'quietSpanMs', 'quietSurgeBuyBnb', 'quietSurgeSec']) {
        check(`探针含 ${k}`, () => assert.ok(keys.has(k), `getFactorKeys 缺 ${k}`));
    }
}

// ═══════════════ G. FactorBuilder 快照透传 ═══════════════
console.log('G. FactorBuilder 快照透传（缺键 → null 不掩盖）');
{
    const snap = FactorBuilder.buildFactorValuesForTimeSeries({
        recentBlockDropPct: 12.5, mcapFromPeakPct: 62.4, quietSpanMs: 61000, quietSurgeBuyBnb: 0.55, quietSurgeSec: 8,
    });
    check('五键透传', () => {
        assert.strictEqual(snap.recentBlockDropPct, 12.5);
        assert.strictEqual(snap.mcapFromPeakPct, 62.4);
        assert.strictEqual(snap.quietSpanMs, 61000);
        assert.strictEqual(snap.quietSurgeBuyBnb, 0.55);
        assert.strictEqual(snap.quietSurgeSec, 8);
    });
    const snapOld = FactorBuilder.buildFactorValuesForTimeSeries({});
    check('旧 FA 缺键 → null 不掩盖', () => {
        assert.strictEqual(snapOld.recentBlockDropPct, null);
        assert.strictEqual(snapOld.mcapFromPeakPct, null);
        assert.strictEqual(snapOld.quietSpanMs, null);
        assert.strictEqual(snapOld.quietSurgeBuyBnb, null);
        assert.strictEqual(snapOld.quietSurgeSec, null);
    });
}

// ═══════════════ H. 源码口径断言 ═══════════════
console.log('H. 源码口径断言（顺序/上限/时钟红线）');
{
    const src = read('src/services/FourMemeFactorAggregator.js');
    const quietIdx = src.indexOf('T117 t7 静默段状态机');
    const maxIdx = src.indexOf('state.lastTickAt = state.lastTickAt === null ? ts : Math.max(state.lastTickAt, ts);');
    check('静默段判定在 lastTickAt 更新前（顺序 bug 现场反证）', () => {
        assert.ok(quietIdx > 0 && maxIdx > 0, '定位失败');
        assert.ok(quietIdx < maxIdx, '静默判定段在 lastTickAt 更新后=永不触发形状');
    });
    const quietSeg = src.slice(quietIdx, maxIdx);
    check('静默段无 Date.now', () => assert.ok(!quietSeg.includes('Date.now'), '静默段出现 Date.now'));
    check('块收盘环上限 4（shift 保最近 4 块）', () => {
        assert.ok(src.includes('if (state._blockCloseRing.length > 4) state._blockCloseRing.shift();'), '环上限 4 缺失');
    });
    check('quietSurgeSec 用 buildFactorMap 入参 now（回测虚拟时钟同源）', () => {
        assert.ok(/quietSurgeSec: state\._quietSurgeStartTs !== null\s*\?\s*Math\.max\(0, \(now - state\._quietSurgeStartTs\) \/ 1000\) : null/.test(src), 'quietSurgeSec 读 now 入参形状变化');
    });
    check('surge 累计带 ts guard（乱序晚到不污染新波）', () => {
        assert.ok(src.includes('ts >= state._quietSurgeStartTs && isBuy'), 'ts guard 缺失');
    });
    check('mcapFromPeakPct 三条件门（supply/现价/峰）', () => {
        assert.ok(src.includes('state.totalSupply > 0 && currentPriceBnb > 0 && state.highestPriceBnb > 0'), '三条件门形状变化');
    });
    const rbSeg = src.slice(src.indexOf('recentBlockDropPct: (() => {'), src.indexOf('// t7 静默段三键'));
    check('recentBlockDropPct 读点段无 Date.now', () => assert.ok(!rbSeg.includes('Date.now'), '读点段出现 Date.now'));
    check('环结算挂块号单调分支内（> 严格比较）', () => {
        assert.ok(src.includes('blockNumber > state._curBlock'), '块号单调 guard 形状变化');
    });
}

console.log(failed === 0 ? `\n✅ signal_source_factors 全部通过（${passed} 断言）` : `\n❌ signal_source_factors：${failed} 失败 / ${passed} 通过`);
process.exit(failed === 0 ? 0 : 1);
