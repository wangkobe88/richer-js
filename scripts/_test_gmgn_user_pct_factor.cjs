#!/usr/bin/env node
/**
 * FA 实时因子 gmgnUserPct 测试（零 DB 零网络，合成 tick）
 *
 * 2026-10-14 小王子案（0x71b58f07…7777）：TPAPre_gmgnUserPct 是 TPA 触发时刻（age=5s）
 * 的 write-once 快照——好票前期 GMGN 用户少（25.3<40 被拦）、后面涨上来快照也不翻案。
 * 用户裁定：门改用 FA 实时因子 gmgnUserPct（每 tick 重算，口径与 TPA _gmgnShareStats
 * 逐字一致：Σ(GMGN 用户 net>0)/Σ(net>0)×100 量加权）。
 *
 * 1) 量加权正确性：直连+GMGN 混合持仓占比精确值
 * 2) 实时翻新（本案核心反证）：追加 GMGN 大单后因子值上升——与 TPAPre 快照不动的语义对照
 * 3) GMGN 用户清仓 → 剔除分子（net<=0 跳过）；全员清仓 posTotal=0 → 0
 * 4) 零 GMGN（纯直连盘）→ 0（有证据零占比）
 * 5) maintainTpaTracks=false（实验无 TPA 段，_walletRoutedBuyBnb 零写入）→ null fail-closed
 * 6) 与 TPA _gmgnShareStats 同 state 真对拍（防两端口径漂移）
 * 7) getFactorKeys 含 gmgnUserPct（三层未知因子防线校验能过）+ 因子字面量无条件出键
 * 8) slim/signal 快照白名单含键（FactorBuilder 两函数）
 *
 * 用法：node scripts/_test_gmgn_user_pct_factor.cjs
 */

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
const ROUTER = [...AGGREGATOR_ROUTER_ADDRS][0]; // GMGN BSC 聚合路由（trader=msg.sender 层）

let passed = 0, failed = 0;
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

let txSeq = 0;
function mkTick(token, ts, isBuy, trader, sender, bnbAmount, tokenAmount, block) {
    return {
        token_address: token,
        trade_type: isBuy ? 'buy' : 'sell',
        trader_address: trader,
        sender_address: sender ?? null,
        price_bnb: 2e-7,
        price_usd: 2e-7 * 600,
        bnb_amount: bnbAmount,
        token_amount: tokenAmount,
        block_number: block,
        timestamp: ts,
        tx_hash: '0x' + (++txSeq).toString(16).padStart(8, '0'),
        log_index: 0,
    };
}

function mkFA(configOverride) {
    const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
    const fa = new FourMemeFactorAggregator(configOverride || {});
    fa.registerToken('TOK_GMGN', { totalSupply: 1e9, platform: 'fourmeme' });
    return fa;
}

function feed(fa, ticks) {
    for (const t of ticks) fa.processTick(t);
}

const T = 'TOK_GMGN';
const EOA_A = '0xaaa1111111111111111111111111111111111111'; // 直连散户
const EOA_B = '0xbbb2222222222222222222222222222222222222'; // GMGN 用户（经路由买入）
const EOA_C = '0xccc3333333333333333333333333333333333333'; // GMGN 用户 2

function build(fa) {
    const state = fa._states.get(T);
    const now = state.lastTickAt || 1758500000000;
    return { factors: fa.buildFactorMap(T, now), state };
}

// ─────────── 1) 量加权正确性 + 4) 纯直连 0 ───────────

{
    const fa = mkFA();
    let ts = 1758500000000, blk = 50000000;
    // A 直连买 100 token（非路由 trader → 不入 _walletRoutedBuyBnb）
    feed(fa, [mkTick(T, ts += 500, true, EOA_A, null, 0.02, 100, ++blk)]);
    {
        const { factors } = build(fa);
        approx(factors.gmgnUserPct, 0, 1e-9, '纯直连盘 gmgnUserPct=0');
    }
    // B 经 GMGN 路由买 50（sender=B 真实 EOA、trader=路由合约）
    feed(fa, [mkTick(T, ts += 500, true, ROUTER, EOA_B, 0.01, 50, ++blk)]);
    {
        const { factors } = build(fa);
        // GMGN 占比 = 50/(100+50)×100 = 33.33（量加权：token 净持仓口径）
        approx(factors.gmgnUserPct, 33.33, 0.01, '混合盘量加权占比 50/150');
    }
}

// ─────────── 2) 实时翻新（本案核心：TPAPre 快照不动的反证） ───────────

{
    const fa = mkFA();
    let ts = 1758500000000, blk = 50000000;
    // 前期：A 直连 300 + B 路由 100 → 25%（=小王子案 25.3 形状，<40 被 u40 门拦）
    feed(fa, [
        mkTick(T, ts += 500, true, EOA_A, null, 0.06, 300, ++blk),
        mkTick(T, ts += 500, true, ROUTER, EOA_B, 0.02, 100, ++blk),
    ]);
    const before = build(fa).factors.gmgnUserPct;
    approx(before, 25, 0.01, '前期 GMGN 占比 25%（门拦形状）');
    // 后期：C 经路由大单 250 → (100+250)/(400+250)=53.85 —— 好票 GMGN 用户涌入，实时因子翻正过门
    feed(fa, [mkTick(T, ts += 500, true, ROUTER, EOA_C, 0.05, 250, ++blk)]);
    const after = build(fa).factors.gmgnUserPct;
    approx(after, 53.85, 0.01, '后期 GMGN 涌入实时翻新 53.85（>=40 过门）');
    ok(after > before, '实时因子随 GMGN 流入上升（TPAPre 快照不动反证）', `${before}→${after}`);
}

// ─────────── 3) 清仓语义 ───────────

{
    const fa = mkFA();
    let ts = 1758500000000, blk = 50000000;
    feed(fa, [
        mkTick(T, ts += 500, true, EOA_A, null, 0.02, 100, ++blk),
        mkTick(T, ts += 500, true, ROUTER, EOA_B, 0.01, 50, ++blk),
    ]);
    // B 全部卖出（GMGN 用户清仓 → net<=0 剔除分子分母）
    feed(fa, [mkTick(T, ts += 500, false, ROUTER, EOA_B, 0.01, 50, ++blk)]);
    {
        const { factors } = build(fa);
        approx(factors.gmgnUserPct, 0, 1e-9, 'GMGN 用户清仓后剔除（回 0）');
    }
    // A 也清仓 → posTotal=0 → 0（非 null）
    feed(fa, [mkTick(T, ts += 500, false, EOA_A, null, 0.02, 100, ++blk)]);
    {
        const { factors } = build(fa);
        ok(factors.gmgnUserPct === 0, '全员清仓 posTotal=0 → 0（有证据零占比）', factors.gmgnUserPct);
    }
}

// ─────────── 5) maintainTpaTracks=false → null ───────────

{
    const fa = mkFA({ maintainTpaTracks: false });
    let ts = 1758500000000, blk = 50000000;
    feed(fa, [mkTick(T, ts += 500, true, ROUTER, EOA_B, 0.01, 50, ++blk)]);
    const { factors, state } = build(fa);
    ok(factors.gmgnUserPct === null, 'maintainTpa=false → null（无证据 fail-closed，区别于 0）', factors.gmgnUserPct);
    ok(state._walletRoutedBuyBnb.size === 0, 'maintainTpa=false 时 routed map 零写入（P2b 语义不变）');
}

// ─────────── 6) 与 TPA _gmgnShareStats 同 state 真对拍 ───────────

{
    const fa = mkFA();
    let ts = 1758500000000, blk = 50000000;
    feed(fa, [
        mkTick(T, ts += 500, true, EOA_A, null, 0.06, 300, ++blk),
        mkTick(T, ts += 500, true, ROUTER, EOA_B, 0.02, 100, ++blk),
        mkTick(T, ts += 500, true, ROUTER, EOA_C, 0.05, 250, ++blk),
        mkTick(T, ts += 500, false, EOA_A, null, 0.01, 50, ++blk), // A 部分卖出
        mkTick(T, ts += 500, true, EOA_C, null, 0.005, 25, ++blk), // C 直连补仓（已判 GMGN 仍 GMGN——本盘内经路由买入>0 即是）
    ]);
    const { factors, state } = build(fa);
    const { TokenPositionAnalyzer } = require('../src/services/TokenPositionAnalyzer');
    const tpa = new TokenPositionAnalyzer(
        { enabled: true, enforce: false, trigger: { blocks: 1, buyBnb: 1, minHolders: 4, tradeCount: 10 } }, {});
    const stats = tpa._gmgnShareStats(state);
    ok(stats != null, 'TPA _gmgnShareStats 双 map 在 → 非 null');
    approx(factors.gmgnUserPct, stats.gmgnUserPct, 1e-9,
        `FA 实时因子 ≡ TPA _gmgnShareStats 同口径（${factors.gmgnUserPct} vs ${stats && stats.gmgnUserPct}）`);
}

// ─────────── 7) getFactorKeys 含键（未知因子防线） ───────────

{
    const fa = mkFA();
    ok(fa.getFactorKeys().has('gmgnUserPct'), 'getFactorKeys 含 gmgnUserPct（condition 校验可引用）');
    // 空 state（无 tick）也出键：字面量无条件出现 → 探针自动收（getFactorKeys 同款 _buildFactorMap 直调）
    const emptyState = fa._createEmptyState('__PROBE__', Date.now());
    const emptyFactors = fa._buildFactorMap(emptyState, Date.now());
    ok('gmgnUserPct' in emptyFactors, '因子字面量无条件出键（空 state 亦有键，值 0）');
}

// ─────────── 8) FactorBuilder signal 快照白名单含键（源码口径） ───────────

{
    const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/core/FactorBuilder.js'), 'utf8');
    ok(/buildFactorValuesForTimeSeries[\s\S]{0,4000}gmgnUserPct:\s*factorResults\.gmgnUserPct/.test(src),
        'signal 快照（buildFactorValuesForTimeSeries）含 gmgnUserPct 键');
    // experiment_time_series_data 时序表 2026-10-15 停写：buildSlimFactorValues 已删，零残留由
    // _test_timeseries_removal.cjs 锁定
    ok(!src.includes('buildSlimFactorValues'),
        'slim 时序快照构建器零残留（时序机制停写）');
}

// ─────────── 汇总 ───────────

console.log(`\n${failed === 0 ? '✅' : '❌'} gmgnUserPct 实时因子: ${passed} passed, ${failed} failed`);
if (failed > 0) { failures.forEach(f => console.error(f)); process.exit(1); }
