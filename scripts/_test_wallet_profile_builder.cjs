#!/usr/bin/env node
/**
 * wallet-profile-builder 单测（pumpfun 回迁批 4；零 DB 纯函数）
 *
 * 覆盖（plan 条目 16）：
 *   1) amountBucket 五档四边界两侧（0.0004/0.02/0.2/0.8，闭开区间方向）
 *   2) 基础统计 + 金额桶 per-token maxBnb 归档口径（多笔取 max 分桶，非逐笔）
 *   3) bad_buy 分子分母：age∈[0,3s) 下界排负 / ≥1.0 BNB / 恶意类分子 / good 类只进分母
 *   4) bad_action 中性类 high_mcap_wash：分子分母都不计
 *   5) badAction24h：asOfMs 窗口 / asOfMs=null 恒 false
 *   6) bad_sell 闪崩段 [peak,floor] 闭区间 + ≥2.0 BNB
 *   7) Tier2 暴力 block：wash + block∈violentCrashBlocks + bnb∈[0.6,2.0)（嵌在 flashCrashPeriod 存在时才判）
 *   8) FIFO hold 配对：≥0.4 BNB 参与 / 先卖后买跳过 / 未平仓不配 / median=floor(len/2) / 空仓 null
 *      （hold 段不依赖 tokenProfiles——无 profile token 的持仓时间照算）
 *   9) AVG_AGG_GAP 同向 <5s 聚合 / 恰 5000ms 不合并 / 方向切换新意图 / 跨 token 不合并
 *  10) mergeOfflineProfile：aggregatedTradeCount 哨兵 throw / tier2 缺失降级 0 / 标量累加 +
 *      buckets/tokenCount 用 offline / firstSeenMs=minIgnoreNull / badAction 布尔或 / 比率重算
 *  11) tokenProfiles=null → bad_action 全 0（无 profile 不计，不 crash）
 *
 * 用法：node scripts/_test_wallet_profile_builder.cjs
 */

const {
    buildProfileFromTicks, mergeOfflineProfile, amountBucket,
    BAD_BUY_BNB, BAD_SELL_BNB, TIER2_SELL_LO_BNB, BAD_BUY_EARLY_MS,
    BAD_BUY_CATEGORIES, BAD_SELL_CATEGORIES, BAD_ACTION_NEUTRAL_CATEGORIES,
    AVG_AGG_GAP_MS,
} = require('../src/services/wallet-profile-builder');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg, got) {
    if (cond) { passed++; return; }
    failed++;
    const line = `  ✗ ${msg}${got !== undefined ? ` | got=${typeof got === 'number' ? got : JSON.stringify(got)}` : ''}`;
    failures.push(line);
    console.error(line);
}
function eq(actual, expected, msg) { ok(actual === expected, `${msg}（期望 ${expected}）`, actual); }
function approx(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, `${msg}（期望 ${b}±${eps}）`, a); }

// ─────────── 合成工具 ───────────
// tick 形状 = wss_price_ticks 行子集（builder 只读 token_address/bnb_amount/price_usd/trade_type/block_time/block_number）
let txSeq = 0;
function tk(token, btMs, isBuy, bnb, block, priceUsd) {
    return {
        token_address: token,
        trade_type: isBuy ? 'buy' : 'sell',
        bnb_amount: bnb,
        price_usd: priceUsd == null ? 0 : priceUsd,
        block_time: btMs,              // ms 数字（new Date(number) 直解）
        block_number: block,
        tx_hash: '0x' + (++txSeq).toString(16).padStart(8, '0'),
        log_index: 0,
    };
}
// token profile 形状 = TPA._normalizeTokenProfile 产出（camelCase，flashCrashPeriod/firstTickTime 均 ms 数字）
function tp(category, { firstTickTime = null, peak = null, floor = null, vBlocks = null } = {}) {
    return {
        category,
        firstTickTime,
        flashCrashPeriod: (peak != null && floor != null) ? { peakTime: peak, floorTime: floor } : null,
        violentCrashBlocks: vBlocks || [],
    };
}

const T0 = 1758500000000; // 固定时间基准（不用 Date.now，断言确定性）

// ═══════════════ 1. amountBucket 边界 ═══════════════
{
    eq(amountBucket(0), 'dust', 'amountBucket(0)→dust');
    eq(amountBucket(0.0003), 'dust', 'amountBucket(0.0003)→dust');
    eq(amountBucket(0.0004), 'tiny', 'amountBucket(0.0004) 边界→tiny（dust 开区间上界）');
    eq(amountBucket(0.019), 'tiny', 'amountBucket(0.019)→tiny');
    eq(amountBucket(0.02), 'small', 'amountBucket(0.02) 边界→small');
    eq(amountBucket(0.199), 'small', 'amountBucket(0.199)→small');
    eq(amountBucket(0.2), 'medium', 'amountBucket(0.2) 边界→medium');
    eq(amountBucket(0.799), 'medium', 'amountBucket(0.799)→medium');
    eq(amountBucket(0.8), 'big', 'amountBucket(0.8) 边界→big');
    eq(amountBucket(5), 'big', 'amountBucket(5)→big');
    // 常量锚点（阈值字面量防漂移）
    eq(BAD_BUY_BNB, 1.0, 'BAD_BUY_BNB=1.0');
    eq(BAD_SELL_BNB, 2.0, 'BAD_SELL_BNB=2.0');
    eq(TIER2_SELL_LO_BNB, 0.6, 'TIER2_SELL_LO_BNB=0.6');
    eq(BAD_BUY_EARLY_MS, 3000, 'BAD_BUY_EARLY_MS=3000（BSC 3s 对齐 firstBlockWindowMs）');
    eq(AVG_AGG_GAP_MS, 5000, 'AVG_AGG_GAP_MS=5000');
    eq(JSON.stringify(BAD_BUY_CATEGORIES), JSON.stringify(['wash', 'pump_dump', 'low_quality', 'low_activity']), 'BAD_BUY_CATEGORIES');
    eq(JSON.stringify(BAD_SELL_CATEGORIES), JSON.stringify(['wash']), 'BAD_SELL_CATEGORIES');
    eq(JSON.stringify(BAD_ACTION_NEUTRAL_CATEGORIES), JSON.stringify(['high_mcap_wash']), 'BAD_ACTION_NEUTRAL_CATEGORIES');
}

// ═══════════════ 2. 基础统计 + 桶 per-token maxBnb 归档 ═══════════════
{
    const ticks = [
        tk('TOK_A', T0, true, 0.0001, 100),   // dust 级一笔
        tk('TOK_A', T0 + 1000, true, 0.5, 101),
        tk('TOK_A', T0 + 9000, false, 1.5, 104), // 同 token maxBnb=1.5 → big 桶 1 个（非逐笔分桶）
        tk('TOK_B', T0 + 2000, true, 0.05, 102), // maxBnb=0.05 → small
    ];
    const p = buildProfileFromTicks(ticks, new Map());
    eq(p.rawTotal, 2, 'rawTotal=distinct token 数');
    eq(p.tokenCount, 2, 'tokenCount=rawTotal');
    eq(p.tickCount, 4, 'tickCount');
    approx(p.totalBnb, 2.0501, 1e-9, 'totalBnb 逐笔累加');
    eq(p.buyCount, 3, 'buyCount');
    eq(p.sellCount, 1, 'sellCount');
    eq(p.largeTradeCount, 1, 'largeTradeCount（≥1.0BNB 仅 1.5 一笔）');
    eq(p.effectiveTradeCount, 2, 'effectiveTradeCount（≥0.4BNB：0.5/1.5 两笔）');
    eq(p.effectiveTokenCount, 1, 'effectiveTokenCount（仅 TOK_A maxBnb≥0.4）');
    eq(p.buckets.total, 2, 'buckets.total');
    eq(p.buckets.big, 1, 'buckets.big（TOK_A maxBnb=1.5）');
    eq(p.buckets.small, 1, 'buckets.small（TOK_B maxBnb=0.05）');
    eq(p.buckets.dust, 0, 'buckets.dust（TOK_A maxBnb 非 dust，逐笔 dust 笔不单独归桶）');
    approx(p.dustRatio, 0, 1e-12, 'dustRatio');
    approx(p.lowRatio, 0.5, 1e-12, 'lowRatio=(dust+tiny+small)/total=1/2');
    approx(p.lowTinyRatio, 0, 1e-12, 'lowTinyRatio');
    eq(p.firstSeenMs, T0, 'firstSeenMs');
}

// ═══════════════ 3/4. bad_buy 分子分母 + age 排负 + 中性类 ═══════════════
{
    // TOK_W（wash）：4 笔 buy 分别命中/错过各门
    //   early 命中（age=1s,1.2BNB）/ 金额不够（0.9）/ 年龄超窗（age=4s）/ 负 age（bt 早于 firstTickTime 20s）
    const ticks = [
        tk('TOK_W', T0 + 1000, true, 1.2, 10),    // age=1s <3s，≥1.0 → 分母+分子
        tk('TOK_W', T0 + 1500, true, 0.9, 11),    // age ok 但 0.9<1.0 → 不进分母
        tk('TOK_W', T0 + 4000, true, 2.0, 12),    // age=4s≥3s → 不进
        tk('TOK_W', T0 - 20000, true, 2.0, 9),    // age=-20s<0 → 排负，不进
        tk('TOK_G', T0 + 1000, true, 1.5, 10),    // good 类：进分母不进分子
        tk('TOK_N', T0 + 1000, true, 1.5, 10),    // 中性类 high_mcap_wash：分子分母都不计
        tk('TOK_W', T0 + 5000, true, 0.5, 13),    // 常规笔（不进任何门，凑 effectiveTradeCount）
    ];
    const tps = new Map([
        ['TOK_W', tp('wash', { firstTickTime: T0 })],
        ['TOK_G', tp('quality', { firstTickTime: T0 })],
        ['TOK_N', tp('high_mcap_wash', { firstTickTime: T0 })],
    ]);
    const p = buildProfileFromTicks(ticks, tps);
    eq(p.earlyLargeBuyCount, 2, 'earlyLargeBuyCount=TOK_W 1 笔 + TOK_G 1 笔（TOK_N 中性类整 token 跳过）');
    eq(p.badBuyCount, 1, 'badBuyCount 仅 wash 类');
    eq(p.badCount14d, 1, 'badCount14d=badBuy+badSell');
    approx(p.badBuyRatio, 0.5, 1e-12, 'badBuyRatio=1/2');
    eq(p.badSellCount, 0, 'badSellCount 无闪崩段');
    eq(p.crashLargeSellCount, 0, 'crashLargeSellCount 无闪崩段');
}

// ═══════════════ 5. badAction24h 窗口 ═══════════════
{
    const asOf = T0 + 10 * 3600 * 1000; // 10h 后评估
    const mk = (bt) => [
        tk('TOK_W', bt, true, 1.2, 10),
    ];
    const tps = new Map([['TOK_W', tp('wash', { firstTickTime: T0 })]]);

    // 命中 24h 窗（bt 距 asOf 10h）
    eq(buildProfileFromTicks(mk(T0 + 1000), tps, { asOfMs: asOf }).badAction, true,
        'badAction：bad buy 在 asOf 前 24h 内 → true');
    // 窗外（bt 距 asOf 30h）
    eq(buildProfileFromTicks(mk(asOf - 30 * 3600 * 1000 + 1000), tps, { asOfMs: asOf }).badAction, false,
        'badAction：bad buy 在 24h 窗外 → false（badCount 仍计）');
    // asOfMs=null → 恒 false（离线全历史口径）
    const pn = buildProfileFromTicks(mk(T0 + 1000), tps, { asOfMs: null });
    eq(pn.badAction, false, 'badAction：asOfMs=null 恒 false');
    eq(pn.badBuyCount, 1, 'asOfMs=null 时 badBuyCount 仍计');
}

// ═══════════════ 6. bad_sell 闪崩段闭区间 ═══════════════
{
    const peak = T0 + 100000, floor = T0 + 200000;
    const ticks = [
        tk('TOK_S', peak, false, 2.5, 300),          // bt=peak 闭区间下界 → 分母
        tk('TOK_S', floor, false, 2.5, 301),         // bt=floor 闭区间上界 → 分母
        tk('TOK_S', peak - 1, false, 2.5, 299),      // 段前 1ms → 不进
        tk('TOK_S', floor + 1, false, 2.5, 302),     // 段后 1ms → 不进
        tk('TOK_S', peak + 500, false, 1.9, 303),    // 段内但 1.9<2.0 → 不进分母（但进 Tier2 若 wash+block）
        tk('TOK_G2', peak + 500, false, 2.5, 300),   // good 类段内 → 只进分母
    ];
    const tps = new Map([
        ['TOK_S', tp('wash', { peak, floor })],
        ['TOK_G2', tp('quality', { peak, floor })],
    ]);
    const p = buildProfileFromTicks(ticks, tps);
    eq(p.crashLargeSellCount, 3, 'crashLargeSellCount=2(TOK_S peak/floor 边界)+1(TOK_G2)（1.9<2.0 不进）');
    eq(p.badSellCount, 2, 'badSellCount 仅 wash 2 笔');
    approx(p.badSellRatio, 2 / 3, 1e-12, 'badSellRatio=2/3');
}

// ═══════════════ 7. Tier2 暴力 block 分片抛售 ═══════════════
{
    const peak = T0 + 100000, floor = T0 + 200000;
    const ticks = [
        tk('TOK_T', peak + 100, false, 0.6, 555),    // 下界 0.6 → 计
        tk('TOK_T', peak + 200, false, 1.9, 555),    // 上界内 1.9 → 计
        tk('TOK_T', peak + 300, false, 2.0, 555),    // 2.0 ≥BAD_SELL 上界（开区间）→ 不计 Tier2（进 Tier1 分母）
        tk('TOK_T', peak + 400, false, 0.5, 555),    // <0.6 → 不计
        tk('TOK_T', peak + 500, false, 1.0, 556),    // block 不在 violentCrashBlocks → 不计
        tk('TOK_T', peak + 600, true, 0.7, 555),     // buy 非 sells → 不计（凑 effectiveTradeCount）
        tk('TOK_T', peak + 700, false, 1.0, null),   // block=null 防御 → 不计
    ];
    const tps = new Map([['TOK_T', tp('wash', { peak, floor, vBlocks: [555] })]]);
    const p = buildProfileFromTicks(ticks, tps);
    eq(p.tier2CrashBlockSellCount, 2, 'tier2CrashBlockSellCount=0.6+1.9 两笔');
    eq(p.effectiveTradeCount, 7, 'effectiveTradeCount（≥0.4：7 笔全计，含 0.5 与 block=null 的 1.0）');
    approx(p.tier2Ratio, 2 / 7, 1e-12, 'tier2Ratio=2/7');
    // Tier2 不进 Tier1 体系
    eq(p.crashLargeSellCount, 1, 'crashLargeSellCount 仅 2.0 一笔（Tier2 0.6/1.9 不混入）');
    eq(p.badSellCount, 1, 'badSellCount 仅 2.0 一笔');

    // flashCrashPeriod 缺失 → Tier2 整段不判（嵌在 if(flashCrashPeriod) 内）
    const p2 = buildProfileFromTicks(ticks, new Map([['TOK_T', tp('wash', { vBlocks: [555] })]]));
    eq(p2.tier2CrashBlockSellCount, 0, '无 flashCrashPeriod → tier2 不判');

    // 非 wash 类不判 Tier2（isSellCat=wash 才进）
    const p3 = buildProfileFromTicks(ticks, new Map([['TOK_T', tp('pump_dump', { peak, floor, vBlocks: [555] })]]));
    eq(p3.tier2CrashBlockSellCount, 0, '非 wash 类 → tier2 不判');
}

// ═══════════════ 8. FIFO hold 配对 ═══════════════
{
    // 意图构造（token 不给 profile——hold 段不依赖 tokenProfiles）：
    //   TOK_H1: buy0.5@t0 → sell0.5@t0+65s           → hold=65
    //   TOK_H2: buy0.3/sell0.3（<0.4 不参与）          → 无配对
    //   TOK_H3: sell0.5@t0（先卖，无 buy 可配跳过）→ buy0.5@t0+10s（未平仓不配）→ 无配对
    //   TOK_H4: buy0.5@t0 → sell0.5@t0+10s → buy0.5@t0+20s → sell0.5@t0+30s → hold=[10,10]
    const t0 = T0;
    const ticks = [
        tk('TOK_H1', t0, true, 0.5, 10),
        tk('TOK_H1', t0 + 65000, false, 0.5, 32),
        tk('TOK_H2', t0, true, 0.3, 10),
        tk('TOK_H2', t0 + 5000, false, 0.3, 12),
        tk('TOK_H3', t0, false, 0.5, 10),
        tk('TOK_H3', t0 + 10000, true, 0.5, 13),
        tk('TOK_H4', t0, true, 0.5, 10),
        tk('TOK_H4', t0 + 10000, false, 0.5, 13),
        tk('TOK_H4', t0 + 20000, true, 0.5, 17),
        tk('TOK_H4', t0 + 30000, false, 0.5, 20),
    ];
    const p = buildProfileFromTicks(ticks, null); // tokenProfiles=null（hold 不依赖）
    // holdSecs 排序后 = [10,10,65]
    eq(p.avgHoldSeconds, 28, 'avgHoldSeconds=round(85/3)=28');
    eq(p.medianHoldSeconds, 10, 'medianHoldSeconds=holdSecs[floor(3/2)]=10');
    eq(p.badAction, false, '无 profile → badAction false');

    // 空 hold（无已平仓大额）→ median null / avg 0
    const pEmpty = buildProfileFromTicks([tk('TOK_X', t0, true, 0.1, 10)], null);
    eq(pEmpty.medianHoldSeconds, null, '无配对 → medianHoldSeconds=null');
    eq(pEmpty.avgHoldSeconds, 0, '无配对 → avgHoldSeconds=0');

    // 同刻买卖（hold=0 合法重罚值，max(0) 不截断为负）
    const pZero = buildProfileFromTicks([
        tk('TOK_Z', t0, true, 0.5, 10),
        tk('TOK_Z', t0, false, 0.5, 10),
    ], null);
    eq(pZero.medianHoldSeconds, 0, '同刻平仓 hold=0（含 0 非-null）');
}

// ═══════════════ 9. AVG_AGG_GAP 同向聚合 ═══════════════
{
    const t0 = T0;
    // TOK_M：buy@0/1000/2000 连续 <5s 同向 → 1 意图；buy@2000+6000 → 与前间隔 6000≥5000 新意图；
    //         sell@+7000（方向切换新意图）；buy@+7500（切换又一意图）
    const ticks = [
        tk('TOK_M', t0, true, 0.1, 10),
        tk('TOK_M', t0 + 1000, true, 0.1, 10),
        tk('TOK_M', t0 + 2000, true, 0.1, 11),
        tk('TOK_M', t0 + 8000, true, 0.1, 13),      // 距前 buy 6000ms ≥5000 → 新意图
        tk('TOK_M', t0 + 9000, false, 0.1, 13),     // 方向切换 → 新意图
        tk('TOK_M', t0 + 9500, true, 0.1, 14),      // 再切换 → 新意图
        tk('TOK_N2', t0 + 1500, true, 0.1, 10),     // 跨 token：与 TOK_M 的 buy 间隔 <5s 但不合并
    ];
    const p = buildProfileFromTicks(ticks, null);
    eq(p.aggregatedTradeCount, 5, 'aggregatedTradeCount=3buy链1+1buy+1sell+1buy +跨token1=5');
    approx(p.avgBnb, 0.7 / 5, 1e-12, 'avgBnb=totalBnb/aggregatedTradeCount');

    // 恰 5000ms 间隔不合并（严格 <）
    const pEdge = buildProfileFromTicks([
        tk('TOK_E', t0, true, 0.1, 10),
        tk('TOK_E', t0 + 5000, true, 0.1, 11),
    ], null);
    eq(pEdge.aggregatedTradeCount, 2, '间隔恰 5000ms → 不合并（严格 <）');
    // 4999ms 合并
    const pEdge2 = buildProfileFromTicks([
        tk('TOK_E', t0, true, 0.1, 10),
        tk('TOK_E', t0 + 4999, true, 0.1, 11),
    ], null);
    eq(pEdge2.aggregatedTradeCount, 1, '间隔 4999ms → 合并 1 意图');

    // 空 ticks
    const pNone = buildProfileFromTicks([], null);
    eq(pNone.aggregatedTradeCount, 0, '空 ticks → 0');
    eq(pNone.avgBnb, 0, '空 ticks → avgBnb=0');
    eq(pNone.firstSeenMs, null, '空 ticks → firstSeenMs=null');
    eq(pNone.tier2Ratio, null, '空 ticks → tier2Ratio=null（无分母）');
}

// ═══════════════ 10. mergeOfflineProfile ═══════════════
{
    // 哨兵 throw：旧 offline 有 tickCount 无 aggregatedTradeCount
    let threw = null;
    try { mergeOfflineProfile({ tickCount: 5, totalBnb: 10 }, { tickCount: 1 }); }
    catch (e) { threw = e.message; }
    ok(threw === 'stale offline profile: missing aggregatedTradeCount (rerun build-wallet-profiles)',
        'merge 哨兵：缺 aggregatedTradeCount → throw 精确文案', threw);

    // 空 offline（tickCount=0）不 throw
    let noThrow = true;
    try { mergeOfflineProfile({ tickCount: 0 }, { tickCount: 1, aggregatedTradeCount: 1 }); }
    catch (_) { noThrow = false; }
    ok(noThrow, 'merge：offline tickCount=0 不触发哨兵');

    const offline = {
        tokenCount: 100, effectiveTokenCount: 40,
        tickCount: 1000, totalBnb: 500, aggregatedTradeCount: 600,
        buyCount: 700, sellCount: 300, largeTradeCount: 50, effectiveTradeCount: 200,
        badCount14d: 10, earlyLargeBuyCount: 20, crashLargeSellCount: 15,
        badBuyCount: 8, badSellCount: 2, tier2CrashBlockSellCount: 3,
        buckets: { total: 100, dust: 10, tiny: 20, small: 30, medium: 25, big: 15 },
        dustRatio: 0.1, lowRatio: 0.6, lowTinyRatio: 0.3,
        avgHoldSeconds: 120, medianHoldSeconds: 90,
        firstSeenMs: T0 - 5000000, badAction: false,
    };
    const inc = buildProfileFromTicks([
        tk('TOK_NEW', T0, true, 1.2, 10),
        tk('TOK_NEW', T0 + 60000, false, 0.5, 30),
    ], new Map([['TOK_NEW', tp('wash', { firstTickTime: T0 })]]), { asOfMs: T0 + 120000 });
    const m = mergeOfflineProfile(JSON.parse(JSON.stringify(offline)), inc);

    eq(m.tokenCount, 100, 'merge tokenCount 用 offline（不去重累加 inc 新 token）');
    eq(m.rawTotal, 100, 'merge rawTotal=offline.tokenCount');
    eq(m.effectiveTokenCount, 40, 'merge effectiveTokenCount 用 offline');
    eq(m.tickCount, 1002, 'merge tickCount 标量累加');
    approx(m.totalBnb, 501.7, 1e-9, 'merge totalBnb 标量累加');
    eq(m.buyCount, 701, 'merge buyCount 累加');
    eq(m.sellCount, 301, 'merge sellCount 累加');
    eq(m.largeTradeCount, 51, 'merge largeTradeCount 累加');
    eq(m.effectiveTradeCount, 202, 'merge effectiveTradeCount 累加');
    eq(m.earlyLargeBuyCount, 21, 'merge earlyLargeBuyCount 累加（inc 1 笔 age0 ≥1.0）');
    eq(m.badBuyCount, 9, 'merge badBuyCount 累加（inc wash 1 笔）');
    eq(m.badCount14d, 11, 'merge badCount14d 累加');
    eq(m.tier2CrashBlockSellCount, 3, 'merge tier2 累加（inc 无 tier2）');
    approx(m.avgBnb, 501.7 / 602, 1e-12, 'merge avgBnb=合并 totalBnb/合并 aggregatedTradeCount');
    eq(m.aggregatedTradeCount, 602, 'merge aggregatedTradeCount 累加（inc 两笔不同向远距=2 意图）');
    ok(m.buckets === offline.buckets || JSON.stringify(m.buckets) === JSON.stringify(offline.buckets),
        'merge buckets 用 offline 值');
    eq(m.dustRatio, 0.1, 'merge dustRatio 用 offline');
    eq(m.medianHoldSeconds, 90, 'merge medianHoldSeconds 用 offline');
    eq(m.firstSeenMs, offline.firstSeenMs, 'merge firstSeenMs=min（offline 更早）');
    eq(m.badAction, true, 'merge badAction=!!(o||i)（inc 24h 内 bad）');

    // tier2 缺失降级 0（不 throw）
    const o2 = { ...offline, tier2CrashBlockSellCount: undefined };
    delete o2.tier2CrashBlockSellCount;
    const m2 = mergeOfflineProfile(o2, { tickCount: 0, aggregatedTradeCount: 0, tier2CrashBlockSellCount: 2 });
    eq(m2.tier2CrashBlockSellCount, 2, 'merge tier2 缺失降级 0 + inc 累加');

    // firstSeenMs：offline null → inc 值
    const m3 = mergeOfflineProfile(
        { ...offline, firstSeenMs: null },
        { tickCount: 0, aggregatedTradeCount: 0, firstSeenMs: T0 },
    );
    eq(m3.firstSeenMs, T0, 'merge firstSeenMs：offline null 取 inc');
}

// ═══════════════ 11. tokenProfiles=null → bad_action 全 0 ═══════════════
{
    const ticks = [
        tk('TOK_ANY', T0 + 1000, true, 5.0, 10), // 即便满足 early+大额也无 profile → 不计
        tk('TOK_ANY', T0 + 2000, false, 5.0, 11),
    ];
    const p = buildProfileFromTicks(ticks, null);
    eq(p.earlyLargeBuyCount, 0, 'tokenProfiles=null → earlyLargeBuyCount=0');
    eq(p.badBuyCount, 0, 'tokenProfiles=null → badBuyCount=0');
    eq(p.crashLargeSellCount, 0, 'tokenProfiles=null → crashLargeSellCount=0');
    eq(p.badAction, false, 'tokenProfiles=null → badAction=false');
    ok(p instanceof Object && p.totalBnb === 10, 'tokenProfiles=null 不 crash，基础统计照算');
}

// ═══════════════ 汇总 ═══════════════
console.log(`\n_wallet_profile_builder: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(failures.join('\n')); process.exit(1); }
