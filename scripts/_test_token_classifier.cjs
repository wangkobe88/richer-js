#!/usr/bin/env node
/**
 * pumpfun 回迁批 3.1 token 分类器测试（零 DB，合成 tick）
 *
 * 1) 分类阈值场景（classifyToken 单一真相）：
 *    合成闪崩→wash、慢拉横盘→normal、high_mcap_wash 保留/暴力 block 降级/ratio-null、
 *    graduation 断流收割、内盘慢砸 pump_dump、quality、8-9K 早峰→normal、
 *    low_quality、low_activity。
 * 2) computeFirstIdleVisibleAt 双触发（idle 空窗 / bigIdle 见证 / 无见证不外推 / minTicks 门）。
 * 3) FA 仪表对拍：同一序列（含尘 tick + 毒价）喂 FA.processTick 后用 OPB._buildMetrics(state)
 *    构造 metrics，与离线 computeTickMetrics(ticks) 逐项相等——在线/离线单一口径硬门槛。
 * 4) FA _clsTicks 动态保留（peak 后全留、pre-peak 滑出 60s 窗裁剪、1500 上限、尘 tick 记录）
 *    + _lastBigTickAt + _relHighestPriceUsd「BNB 峰 tick 处 USD 快照」语义。
 * 5) OnlineProfileBuilder 触发门：enabled/minTicks/minAge/idle gap/bigTickIdle/profiled 去重/
 *    扫描入口（_classifyAndPersist 打桩，零 DB）。
 *
 * 用法：node scripts/_test_token_classifier.cjs
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const {
  classifyToken, computeTickMetrics, findFlashCrashPeriod, computeFirstIdleVisibleAt,
  CLASSIFIER_VERSION,
} = require('./shared/token-classifier');
const { MIN_TICKS } = require('./shared/classifier-constants');
const { OnlineProfileBuilder } = require(path.join(ROOT, 'src/services/OnlineProfileBuilder'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function approx(a, b, eps, msg) {
    ok(Math.abs(a - b) <= eps, `${msg} (期望 ${b}±${eps})`, a);
}

// ─────────── 合成工具 ───────────
const BNB_USD = 600;
const SUPPLY = 1e9;
const T0 = 1758500000000;
const s = (sec) => T0 + sec * 1000;
/** mc(USD) → priceBnb */
const pb = (mc) => mc / (BNB_USD * SUPPLY);

/** slim tick（分类器统一输入 shape） */
function slim(sec, priceBnb, o = {}) {
    return {
        ts: s(sec),
        isBuy: o.isBuy ?? true,
        bnbAmount: o.bnb ?? 0.01,
        priceBnb,
        priceUsd: o.usd !== undefined ? o.usd : priceBnb * BNB_USD,
        blockNumber: o.block ?? Math.floor(sec / 3),
        priceReliable: o.rel ?? true,
    };
}

/** FA 原生 tick（processTick 输入 shape） */
let txSeq = 0;
function native(sec, priceBnb, o = {}) {
    return {
        token_address: o.token ?? 'TOK_TEST',
        trade_type: (o.isBuy ?? true) ? 'buy' : 'sell',
        trader_address: o.trader ?? '0xtrader01',
        price_bnb: priceBnb,
        price_usd: o.usd !== undefined ? o.usd : (priceBnb > 0 ? priceBnb * BNB_USD : null),
        bnb_amount: o.bnb ?? 0.01,
        token_amount: o.tok ?? 1000,
        block_number: o.block ?? Math.floor(sec / 3),
        timestamp: s(sec),
        tx_hash: '0x' + (++txSeq).toString(16).padStart(8, '0'),
        log_index: 0,
    };
}

// ═══════════ 1) 分类阈值场景 ═══════════
function section1() {
    console.log('── 1) 分类阈值场景 ──');

    // 1.1 合成闪崩 → wash：ramp 5K→10K（20s），8s 窗内 -80% 崩到 2K 后横盘（起不来）
    {
        const ticks = [];
        for (let i = 0; i <= 10; i++) ticks.push(slim(i * 2, pb(5000 + i * 500)));   // 0..20s → 10K 峰
        ticks.push(slim(22, pb(2000)));                                              // 崩盘（-80%，窗内）
        for (let t = 24; t <= 40; t += 4) ticks.push(slim(t, pb(2000)));              // 谷底横盘
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'wash', '合成闪崩 → wash', r.category);
        ok(r.flashCrashPeriod !== null, 'wash 带 flash_crash_period');
        approx(r.maxMarketCap, 10000, 1, 'wash maxMarketCap=10K');
        ok(Array.isArray(r.violentCrashBlocks), 'violentCrashBlocks 数组');
    }

    // 1.2 慢拉横盘 → normal：5K→7K 缓涨（60s），无崩盘
    {
        const ticks = [];
        for (let i = 0; i <= 12; i++) ticks.push(slim(i * 5, pb(5000 + i * 166.7)));  // 0..60s → 7K
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'normal', '慢拉横盘 → normal（6K-8K）', r.category);
        ok(r.flashCrashPeriod === null, 'normal 无闪崩');
    }

    // 1.3 high_mcap_wash 保留：mc 30K ≥15K + 扣前9s ratio=5 + 闪崩跨 3 block（单 block -22% > -40）
    {
        const ticks = [];
        for (let sec = 0; sec <= 8; sec += 2) ticks.push(slim(sec, pb(5000)));        // 前 9s 低位区（不计 ratio）
        ticks.push(slim(10, pb(6000)));                                               // afterFirst9s min 锚
        for (const [sec, mc] of [[14, 12000], [18, 18000], [22, 24000], [26, 27000], [30, 30000]]) {
            ticks.push(slim(sec, pb(mc)));
        }
        // 崩盘 3 block 各 -22%（30K→23.4K→18.25K→14.24K，累计 -52.5%）
        ticks.push(slim(33, pb(23400), { block: 11 }));
        ticks.push(slim(36, pb(18252), { block: 12 }));
        ticks.push(slim(39, pb(14237), { block: 13 }));
        for (let t = 42; t <= 60; t += 6) ticks.push(slim(t, pb(14237)));             // 谷底横盘
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'high_mcap_wash', '高市值闪崩（ratio 5 + 无暴力 block）→ high_mcap_wash', r.category);
        ok(r.flashCrashPeriod !== null, 'high_mcap_wash 带闪崩段');
        ok(r.violentCrashBlocks.length === 0, '单 block -22% 非暴力（>-30）', r.violentCrashBlocks);
    }

    // 1.4 high_mcap_wash 暴力 block 降级 → wash：同 1.3 但崩盘集中在单 block（-55% ≤ -40）
    {
        const ticks = [];
        for (let sec = 0; sec <= 8; sec += 2) ticks.push(slim(sec, pb(5000)));
        ticks.push(slim(10, pb(6000)));
        for (const [sec, mc] of [[14, 12000], [18, 18000], [22, 24000], [26, 27000], [30, 30000]]) {
            ticks.push(slim(sec, pb(mc)));
        }
        ticks.push(slim(30.5, pb(13500), { block: 10 }));                             // 同 block 内 30K→13.5K（-55%）
        for (let t = 33; t <= 60; t += 6) ticks.push(slim(t, pb(13500)));
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'wash', '暴力 block 降级 → wash', r.category);
        ok(r.violentCrashBlocks.length === 1 && r.violentCrashBlocks[0] === 10,
            '暴力 block 记录 block 10', r.violentCrashBlocks);
    }

    // 1.5 ratio null（全部分类数据在前 9s 内）→ 落 wash
    {
        const ticks = [];
        for (const [sec, mc] of [[0, 10000], [1, 16000], [2, 22000], [3, 30000],
            [4, 26000], [5, 20000], [6, 13500], [6.5, 13500], [7, 13500], [7.5, 13500],
            [8, 13500], [8.5, 13500]]) {
            ticks.push(slim(sec, pb(mc)));
        }
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'wash', 'ratio null（9s 后零可靠 tick）→ wash', r.category);
    }

    // 1.6 graduation 断流收割 → pump_dump：<50 tick 急拉到 30K 后断流（末价≈峰、无闪崩）
    {
        const ticks = [];
        for (let i = 0; i < 20; i++) ticks.push(slim(i, pb(20000 + i * 526)));        // 0..19s → 30K，单调急拉
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'pump_dump', 'graduation 断流 → pump_dump', r.category);
        ok(/graduation/.test(r.reason || ''), 'reason 标注 graduation 断流', r.reason);
    }

    // 1.7 内盘慢砸（无闪崩）→ pump_dump：峰在前 15s，慢跌 -80%（每 8s 窗 -15% 不触发闪崩）
    {
        const ticks = [];
        let mc = 20000;
        for (let sec = 5; sec <= 85; sec += 8) { ticks.push(slim(sec, pb(mc))); mc *= 0.85; }
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'pump_dump', '内盘慢砸（峰 5s + dd -80%）→ pump_dump', r.category);
        ok(r.flashCrashPeriod === null, '慢砸无闪崩段');
    }

    // 1.8 quality：mc 10K（≥8K <15K）峰在 30s（>15s），无崩盘
    {
        const ticks = [];
        for (const [sec, mc] of [[0, 5000], [5, 8000], [10, 8500], [20, 9500], [30, 10000],
            [35, 10000], [40, 10000], [45, 10000], [50, 10000], [55, 10000], [60, 10000]]) {
            ticks.push(slim(sec, pb(mc)));
        }
        const r = classifyToken(ticks, { totalSupply: SUPPLY });
        ok(r.category === 'quality', 'mc 10K 晚峰 → quality', r.category);
    }

    // 1.9 8-9K 早峰 → normal（昙花一现不算 quality）
    {
        const ticks = [];
        for (const [sec, mc] of [[0, 5000], [5, 8500], [10, 8450], [15, 8400], [20, 8350],
            [25, 8300], [30, 8250], [35, 8200], [40, 8150], [45, 8100], [50, 8050], [55, 8000]]) {
            ticks.push(slim(sec, pb(mc)));
        }
        const r = classifyToken(ticks, { totalSupply: SUPPLY });
        ok(r.category === 'normal', '8.5K 早峰（≤15s）→ normal', r.category);
    }

    // 1.10 low_quality：mc 5K < 6K 无闪崩
    {
        const ticks = [];
        for (let i = 0; i < 12; i++) ticks.push(slim(i * 3, pb(4000 + i * 90)));      // → ~5K
        const r = classifyToken(ticks, { totalSupply: SUPPLY });
        ok(r.category === 'low_quality', 'mc 5K → low_quality', r.category);
    }

    // 1.11 low_activity：tick < MIN_TICKS
    {
        const ticks = [];
        for (let i = 0; i < MIN_TICKS - 1; i++) ticks.push(slim(i, pb(30000)));
        const r = classifyToken(ticks, { totalSupply: SUPPLY }, { diagnostic: true });
        ok(r.category === 'low_activity', `tick ${MIN_TICKS - 1} < MIN_TICKS → low_activity`, r.category);
    }

    // 1.12 totalSupply 缺失 → maxMarketCap 0 → low_quality（保守方向，不用尘价编市值）
    {
        const ticks = [];
        for (let i = 0; i <= 10; i++) ticks.push(slim(i * 2, pb(5000 + i * 500)));
        ticks.push(slim(22, pb(2000)));
        for (let t = 24; t <= 40; t += 4) ticks.push(slim(t, pb(2000)));
        const r = classifyToken(ticks, { totalSupply: 0 }, { diagnostic: true });
        ok(r.category === 'low_quality', 'totalSupply 缺失 → low_quality', r.category);
        ok(r.maxMarketCap === 0, 'maxMarketCap=0', r.maxMarketCap);
    }

    ok(CLASSIFIER_VERSION === 'bsc-v2', 'CLASSIFIER_VERSION=bsc-v2', CLASSIFIER_VERSION);
}

// ═══════════ 2) computeFirstIdleVisibleAt 双触发 ═══════════
function section2() {
    console.log('── 2) computeFirstIdleVisibleAt ──');

    // 2.1 idle 空窗触发：攒够 minTicks 后出现 ≥60s 空窗 → vis = 空窗前最后 tick + 60s
    {
        const ticks = [];
        for (let i = 0; i < 10; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });       // 0..9s（i=10 起过门）
        ticks.push({ ts: s(100), bnbAmount: 0.01 });                                   // 91s 空窗（i=10 ≥ minTicks）
        ticks.push({ ts: s(105), bnbAmount: 0.01 });
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === s(9) + 60000, 'idle 触发 vis=空窗前最后 tick(s9)+60s', vis);
    }

    // 2.2 bigIdle 见证触发（隔离 idle 路径）：大额 tick 后 30s 涓流压制空窗，600s 后有见证 tick
    //    → vis = 大额 tick + 600s（idle 路径无 ≥60s 空窗不参与）
    {
        const ticks = [];
        for (let i = 0; i < 9; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });        // 0..8s 小额
        ticks.push({ ts: s(100), bnbAmount: 0.06 });                                   // 大额（≥0.05）
        for (let sec = 130; sec <= 730; sec += 30) ticks.push({ ts: s(sec), bnbAmount: 0.01 }); // 涓流（无空窗）
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === s(700), 'bigIdle 触发 vis=大额 tick+600s（涓流压制 idle）', vis);
    }

    // 2.3 bigIdle 无见证 → 不外推（数据末端不虚构可见性；涓流压制 idle 同 2.2）
    {
        const ticks = [];
        for (let i = 0; i < 9; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });
        ticks.push({ ts: s(100), bnbAmount: 0.06 });
        for (let sec = 130; sec <= 400; sec += 30) ticks.push({ ts: s(sec), bnbAmount: 0.01 }); // 无 ≥s(700) 见证
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === null, 'bigIdle 无见证 → null（不外推）', vis);
    }

    // 2.4 bigIdle 被下一大额打破：第一段 400s < 600s 不算断流；第二段 fireAt 超数据末端无见证 → null
    {
        const ticks = [];
        for (let i = 0; i < 9; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });
        ticks.push({ ts: s(100), bnbAmount: 0.06 });
        for (let sec = 130; sec <= 470; sec += 30) ticks.push({ ts: s(sec), bnbAmount: 0.01 });
        ticks.push({ ts: s(500), bnbAmount: 0.06 });                                   // 400s < 600s 打破第一段断流
        for (let sec = 530; sec <= 980; sec += 30) ticks.push({ ts: s(sec), bnbAmount: 0.01 });
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === null, 'bigIdle 被下一大额打破 → null', vis);
    }

    // 2.5 tick 数 < minTicks → null
    {
        const ticks = [];
        for (let i = 0; i < 8; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });
        ticks.push({ ts: s(500), bnbAmount: 0.01 });                                   // 共 9 tick < 10
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === null, 'tick < minTicks → null', vis);
    }

    // 2.6 idle 空窗在 minTicks 之前出现 → 不计，等后续空窗
    {
        const ticks = [];
        for (let i = 0; i < 5; i++) ticks.push({ ts: s(i), bnbAmount: 0.01 });
        ticks.push({ ts: s(100), bnbAmount: 0.01 });                                   // 空窗 95s 但 i=5 < minTicks
        for (let i = 0; i < 6; i++) ticks.push({ ts: s(100 + i), bnbAmount: 0.01 });   // 攒够 12 tick 无空窗
        const vis = computeFirstIdleVisibleAt(ticks);
        ok(vis === null, 'minTicks 前的空窗不计', vis);
    }
}

// ═══════════ 3) FA 仪表对拍（在线标量 vs 离线单遍历）═══════════
function section3() {
    console.log('── 3) FA 仪表对拍 ──');

    const fa = new FourMemeFactorAggregator({}, null);
    fa.registerToken('TOK_PARITY', { createdAtMs: s(0), totalSupply: SUPPLY });

    // 序列：尘 tick + 毒价 + 9s 后拉 4× + 8s 窗内崩 -67% + 谷底横盘（含尾随尘 tick）
    const plan = [
        [0, 1.0e-8, 0.0005],   // 尘（<0.002 不可靠）
        [1, 1.0e-8, 0.01],
        [2, 1.05e-8, 0.01],
        [3, 1.1e-8, 0.01],
        [4, 5.0e-5, 0.01],     // 毒价（>1000× 中位 → 离群剔除）
        [5, 1.2e-8, 0.01],
        [7, 1.35e-8, 0.01],
        [9, 1.5e-8, 0.01],     // afterFirst9s min 锚
        [11, 2.5e-8, 0.01],
        [13, 3.5e-8, 0.01],
        [16, 4.5e-8, 0.01],
        [20, 6.0e-8, 0.01],    // BNB 峰（ratio 分子）
        [21, 2.0e-8, 0.01],    // 崩盘（-67%）
        [22, 2.0e-8, 0.0005],  // 尾随尘 tick（两侧都须排除在价格外）
        [23, 2.0e-8, 0.01],
    ];
    const slimSeq = [];
    for (const [sec, price, bnb] of plan) {
        const ret = fa.processTick(native(sec, price, { token: 'TOK_PARITY' }), { emitFactors: false });
        slimSeq.push({
            ts: s(sec), isBuy: true, bnbAmount: bnb, priceBnb: price,
            priceUsd: price * BNB_USD, blockNumber: Math.floor(sec / 3),
            priceReliable: !!ret && !!ret.priceAccepted && bnb >= 0.002,
        });
    }
    ok(slimSeq[0].priceReliable === false, '尘 tick 不可靠（对拍前提）');
    ok(slimSeq[4].priceReliable === false, '毒价 tick 不可靠（对拍前提）');

    const state = fa.getTokenState('TOK_PARITY');
    ok(state !== null, 'FA state 存在');

    // 离线单一真相
    const off = computeTickMetrics(slimSeq, SUPPLY);
    const offFlash = findFlashCrashPeriod(slimSeq, { peakTimeMs: slimSeq[off.peakIdx].ts });
    // 在线 OPB metrics（FA 标量构造）
    const opb = new OnlineProfileBuilder({}, null);
    const peakTimeSeconds = state._relHighestAt > 0 && state.firstTickAt !== null
        ? (state._relHighestAt - state.firstTickAt) / 1000 : Infinity;
    const onFlash = findFlashCrashPeriod(state._clsTicks, { peakTimeMs: state._relHighestAt || 0 });
    const onMetrics = opb._buildMetrics(state, onFlash !== null, peakTimeSeconds, onFlash);

    approx(onMetrics.maxMarketCap, off.maxMarketCap, 1e-9, '对拍 maxMarketCap');
    approx(onMetrics.drawdownFromHighestPct, off.drawdownFromHighestPct, 1e-9, '对拍 drawdownFromHighestPct');
    approx(onMetrics.beforePeakMaxMinRatio, off.beforePeakMaxMinRatio, 1e-9, '对拍 beforePeakMaxMinRatio');
    ok(Math.abs(peakTimeSeconds - off.peakTimeSeconds) < 1e-9, '对拍 peakTimeSeconds',
        `${peakTimeSeconds} vs ${off.peakTimeSeconds}`);
    ok(onMetrics.tickCount === off.tickCount, '对拍 tickCount', `${onMetrics.tickCount} vs ${off.tickCount}`);
    ok((onFlash !== null) === (offFlash !== null), '对拍 hasFlashCrash');
    if (onFlash && offFlash) {
        ok(onFlash.floorTime === offFlash.floorTime && onFlash.peakTime === offFlash.peakTime,
            '对拍闪崩段时段');
    }
    approx(off.beforePeakMaxMinRatio, 4.0, 1e-9, '离线 ratio=4.0（6e-8/1.5e-8）');
    approx(off.maxMarketCap, 36000, 1e-6, '离线 maxMarketCap=36K');

    // ═══ 4) FA 轨迹仪表 ═══
    console.log('── 4) FA _clsTicks/_lastBigTickAt/USD 快照 ──');
    {
        const fa2 = new FourMemeFactorAggregator({}, null);
        fa2.registerToken('TOK_RET', { createdAtMs: s(0), totalSupply: SUPPLY });
        fa2.processTick(native(5, 1e-8, { token: 'TOK_RET', bnb: 0.0005 }), { emitFactors: false }); // 尘
        for (let sec = 6; sec <= 9; sec++) {
            fa2.processTick(native(sec, 1e-8 + (sec - 6) * 2e-9, { token: 'TOK_RET' }), { emitFactors: false });
        }
        fa2.processTick(native(10, 5e-8, { token: 'TOK_RET', bnb: 0.06 }), { emitFactors: false });   // 峰 + 大额
        for (let sec = 11; sec <= 120; sec += 3) {
            fa2.processTick(native(sec, 3e-8, { token: 'TOK_RET', bnb: 0.01 }), { emitFactors: false });
        }
        const st = fa2.getTokenState('TOK_RET');
        ok(st._clsTicks.length > 0 && st._clsTicks[0].ts >= s(10),
            '动态保留：peak 前 tick（含 5s 尘）被裁剪，peak 起全留', st._clsTicks[0]?.ts - T0);
        ok(st._clsTicks.every(t => t.ts >= s(10)), '全部保留 tick ≥ peak 时刻');
        ok(st._lastBigTickAt === s(10), '_lastBigTickAt=大额 tick 时刻', st._lastBigTickAt - T0);
        fa2.processTick(native(121, 3e-8, { token: 'TOK_RET', bnb: 0.01 }), { emitFactors: false });
        ok(fa2.getTokenState('TOK_RET')._lastBigTickAt === s(10), '小额 tick 不改 _lastBigTickAt');

        // 1500 上限
        const fa3 = new FourMemeFactorAggregator({}, null);
        fa3.registerToken('TOK_CAP', { createdAtMs: s(0), totalSupply: SUPPLY });
        fa3.processTick(native(0, 1e-8, { token: 'TOK_CAP' }), { emitFactors: false }); // 峰（cutoff 锚）
        for (let i = 1; i <= 1700; i++) {
            fa3.processTick(native(i, 0.5e-8, { token: 'TOK_CAP' }), { emitFactors: false });
        }
        ok(fa3.getTokenState('TOK_CAP')._clsTicks.length <= 1500,
            '_clsTicks ≤1500 上限', fa3.getTokenState('TOK_CAP')._clsTicks.length);

        // 尘 tick 也进轨迹（活跃度判定需全量）
        const fa4 = new FourMemeFactorAggregator({}, null);
        fa4.registerToken('TOK_DUST', { createdAtMs: s(0), totalSupply: SUPPLY });
        fa4.processTick(native(1, 1e-8, { token: 'TOK_DUST', bnb: 0.0005 }), { emitFactors: false });
        ok(fa4.getTokenState('TOK_DUST')._clsTicks.length === 1, '尘 tick 记入 _clsTicks');
    }

    // USD 快照：仅在新 BNB 峰覆写（离线 computeTickMetrics 同口径）
    {
        const fa5 = new FourMemeFactorAggregator({}, null);
        fa5.registerToken('TOK_USD', { createdAtMs: s(0), totalSupply: SUPPLY });
        const st = () => fa5.getTokenState('TOK_USD');
        fa5.processTick(native(1, 1.0e-8, { token: 'TOK_USD', usd: 6e-6 }), { emitFactors: false });
        approx(st()._relHighestPriceUsd, 6e-6, 1e-12, 'USD 快照：首峰取 tick USD');
        fa5.processTick(native(2, 2.0e-8, { token: 'TOK_USD', usd: 0 }), { emitFactors: false });
        ok(st()._relHighestPriceUsd === 0, '新 BNB 峰缺 USD → 快照覆写为 0（保守）');
        fa5.processTick(native(3, 1.5e-8, { token: 'TOK_USD', usd: 9.9e-3 }), { emitFactors: false });
        ok(st()._relHighestPriceUsd === 0, '非峰 tick 不回填 USD（即使 USD 更高）');
        fa5.processTick(native(4, 3.0e-8, { token: 'TOK_USD', usd: 1.8e-5 }), { emitFactors: false });
        approx(st()._relHighestPriceUsd, 1.8e-5, 1e-12, '更高峰带 USD → 覆写快照');
    }
}

// ═══════════ 5) OnlineProfileBuilder 触发门（_classifyAndPersist 打桩，零 DB）═══════════
function section5() {
    console.log('── 5) OnlineProfileBuilder 触发门 ──');

    function makeOpb(config = {}) {
        const opb = new OnlineProfileBuilder({ enabled: true, ...config }, null);
        const calls = [];
        opb._classifyAndPersist = async (...a) => { calls.push(a); };
        return { opb, calls };
    }
    const mkState = (o = {}) => ({
        createdAtMs: s(0),
        tradeCount: 20,
        _clsTicks: [
            { ts: s(0), bnbAmount: 0.01 }, { ts: s(1), bnbAmount: 0.01 },
        ],
        _lastBigTickAt: null,
        _relHighestAt: 0, firstTickAt: s(0),
        _relHighestPriceBnb: 0, _relPriceBnb: 0, _relHighestPriceUsd: 0, totalSupply: 0,
        _afterFirst9sReliableCount: 0, _beforeFirst9sPeakMinBnb: Infinity,
        _afterFirst9sPeakPriceBnb: 0, _runningMinAfterFirst9sBnb: Infinity,
        uniqueTraders: new Set(), totalBuyBnb: 0, totalSellBnb: 0,
        firstPriceBnb: 0, buyCount: 0, sellCount: 0, lastTickAt: s(1),
        ...o,
    });

    // 5.1 enabled=false → 零触发
    {
        const opb = new OnlineProfileBuilder({ enabled: false }, null);
        let called = 0;
        opb._classifyAndPersist = async () => { called++; };
        opb.checkAndEnqueue('A', mkState(), s(1000));
        ok(called === 0, 'enabled=false 不触发');
    }

    // 5.2 minTicks 门
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('B', mkState({ tradeCount: 9 }), s(1000));
        ok(calls.length === 0, 'tradeCount < minTicks 不触发');
    }

    // 5.3 minAge 门（createdAtMs 锚）
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('C', mkState({ createdAtMs: s(995) }), s(1000)); // age=5s <10s
        ok(calls.length === 0, 'age < minAgeSeconds 不触发');
    }

    // 5.4 idle gap 触发（末两条 _clsTicks 间隔 >60s = 母版 timeSinceLastTrade 语义）
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('D', mkState({
            _clsTicks: [{ ts: s(0), bnbAmount: 0.01 }, { ts: s(62), bnbAmount: 0.01 }],
        }), s(62));
        ok(calls.length === 1, 'inter-tick gap 62s > 60s 触发');
    }

    // 5.5 gap 不足不触发
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('E', mkState({
            _clsTicks: [{ ts: s(0), bnbAmount: 0.01 }, { ts: s(59), bnbAmount: 0.01 }],
        }), s(59));
        ok(calls.length === 0, 'gap 59s ≤ 60s 不触发');
    }

    // 5.6 bigTickIdle 触发（gap 小但距最近大额 >600s）
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('F', mkState({
            _clsTicks: [{ ts: s(700), bnbAmount: 0.01 }, { ts: s(701), bnbAmount: 0.01 }],
            _lastBigTickAt: s(100),
        }), s(701));
        ok(calls.length === 1, '大额断流 601s > 600s 触发');
    }

    // 5.7 大额断流不足不触发
    {
        const { opb, calls } = makeOpb();
        opb.checkAndEnqueue('G', mkState({
            _clsTicks: [{ ts: s(650), bnbAmount: 0.01 }, { ts: s(651), bnbAmount: 0.01 }],
            _lastBigTickAt: s(100),
        }), s(651));
        ok(calls.length === 0, '大额断流 551s ≤ 600s 不触发');
    }

    // 5.8 profiled 去重（同 token 二连击只触发一次）
    {
        const { opb, calls } = makeOpb();
        const st = mkState({ _clsTicks: [{ ts: s(0), bnbAmount: 0.01 }, { ts: s(62), bnbAmount: 0.01 }] });
        opb.checkAndEnqueue('H', st, s(62));
        opb.checkAndEnqueue('H', st, s(200));
        ok(calls.length === 1, '_profiled 去重');
    }

    // 5.9 扫描入口：now-lastTickAt 判真实 idle（死后零 tick 补救）
    {
        const { opb, calls } = makeOpb();
        const st = mkState({ tradeCount: 15, lastTickAt: s(0) });
        const stubFa = {
            getTrackedTokens: () => ['SCAN1', 'SCAN2'],
            getTokenState: (a) => (a === 'SCAN1' ? st : mkState({ lastTickAt: Date.now() / 1 })),
        };
        opb._factorAggregator = stubFa;
        opb._scanIdleTokens();
        ok(calls.length === 1, '扫描补分类真实 idle token');
        opb.destroy();
        ok(opb._scanInterval === null && opb._profiled.size === 0, 'destroy 清理');
    }

    // 5.10 分类核心纯函数： fabricated state → category
    {
        const { opb } = makeOpb();
        // 慢拉横盘 state：峰 7K、末价 7K、无闪崩、ratio null（count<2）
        const st = mkState({
            _relHighestPriceBnb: pb(7000), _relPriceBnb: pb(7000),
            _relFirstPriceBnb: pb(5000), // 涨幅基准：base=5K → max/final = +40%
            _relHighestPriceUsd: pb(7000) * BNB_USD, totalSupply: SUPPLY,
            _relHighestAt: s(60), firstTickAt: s(0), tradeCount: 13,
            _afterFirst9sReliableCount: 5, _beforeFirst9sPeakMinBnb: pb(5000),
            _afterFirst9sPeakPriceBnb: pb(7000),
        });
        st._clsTicks = [];
        const flash = findFlashCrashPeriod(st._clsTicks, { peakTimeMs: st._relHighestAt });
        const { category, profile } = opb._classify(st, 'test', flash !== null, 60, flash);
        ok(category === 'normal', 'OPB._classify 慢拉横盘 → normal', category);
        ok(profile.source === 'online' && profile.classifier_version === 'bsc-v2',
            'profile source/classifier_version', `${profile.source}/${profile.classifier_version}`);
        ok(profile.category_visible_at === profile.classified_at, '在线 visible_at=写入时刻');
        approx(profile.max_market_cap_usd, 7000, 0.5, 'profile max_market_cap_usd=7K');
        approx(profile.max_change_percent, 40, 1e-6, 'profile max_change_percent=+40%（base 5K→峰 7K）');
        approx(profile.final_change_percent, 40, 1e-6, 'profile final_change_percent=+40%（base 5K→末 7K）');
    }

    // 5.11 OPB 涨幅 null：无 _relFirstPriceBnb（全尘 token）→ 两字段 null（不进分类门也安全）
    {
        const { opb } = makeOpb();
        const st = mkState({ _relHighestPriceBnb: pb(7000), _relPriceBnb: pb(7000) });
        st._clsTicks = [];
        const { profile } = opb._classify(st, 'test', false, 60, null);
        ok(profile.max_change_percent === null && profile.final_change_percent === null,
            'OPB 无基准价 → 涨幅 null', `${profile.max_change_percent}/${profile.final_change_percent}`);
    }
}

// ═══════════ 运行 ═══════════
section1();
section2();
section3();
section5();

console.log(`\n结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 全部通过 ✅' : ' ❌'}`);
process.exit(failed === 0 ? 0 : 1);
