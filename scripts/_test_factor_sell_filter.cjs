#!/usr/bin/env node
/**
 * T157 因子卖出过滤门单测（零 DB 零网络）
 *
 * T157c 管辖门简化（2026-11-17 用户裁定；T211 2026-11-22 管辖线 100→50）：
 * **所有卖出臂统一过门，管辖判定=`profitPercent >= minProfitPct(50 缺省)`
 * 本身**——当前收益 ≥50% 的卖信号即被 famous/smart 卖出门管住，与触发腿条件串
 * 里有没有 profitPercent 因子无关；arms 条件文本清单整链
 * 退役（配置漂移失配风险消灭），famousHold 三键收进模块配置。
 *
 * 覆盖：
 *  A. normalizeFactorSellFilterConfig 配置全形状（enabled/famousHold 三键/arms 退役防线）
 *  B. 全臂管辖（T157c 核心语义）：任何腿（止损/bypass/条件串不含 pp 的腿）
 *     pp≥50 即进 famous/smart 管辖（T211）；pp<50 恒放行
 *  C. judgeFactorSellFilter 判定树全分支（放行三形状+拦截+info 快照+阈值覆盖）
 *  D. 事故现场反证（0x29921a53…7777 bt-v140 四笔卖出帧回放——D 修靶心：
 *     卖出① recentSell=0.287 ∈ [0.2,0.4) 差异带：原条件串 0.2 线放行、新门 0.4 线拦截）
 *  E. 与原条件串释放臂的等价性对拍（唯一刻意差异=D 线 0.2→0.4）
 *  F. 校验链（loadStrategies 腿字段退役防线 / validateLegs 同口径）
 *  G. 引擎包装 _factorSellFilterEvaluate（配置关=恒放行；拦截落行+日志去重；
 *     落行桩替换 _persistFactorSellFilterSignal——零 DB 红线）
 *  H. _initFactorSellFilter（缺段=关；非法 throw；arms 携带 throw）
 *  O. T211 管辖线 100→50（2026-11-22 bt-v179 0x4509…7777 金狗案源四帧：
 *     pp=92.8 smart 1s 前大买 0.33B 照卖=被 100 线放走的靶心）
 */

'use strict';

const assert = require('assert');
const {
    FACTOR_SELL_FILTER_DEFAULTS,
    normalizeFactorSellFilterConfig,
    judgeFactorSellFilter,
} = require('../src/trading-engine/core/factor-sell-filter');

let passed = 0;
function ok(cond, msg) {
    if (!cond) {
        console.error(`❌ ${msg}`);
        process.exit(1);
    }
    passed++;
}

const CFG = normalizeFactorSellFilterConfig({ enabled: true }).normalized;

// ── A. 配置归一化 ─────────────────────────────────────────
{
    ok(CFG && CFG.enabled === true, 'A1 enabled=true 归一化');
    ok(CFG.famousHold.minProfitPct === 50 && CFG.famousHold.maxSinceBuySec === 180 && CFG.famousHold.sellReleaseBnb === 0.4, 'A2 默认阈值（famousHold 整体省略=全默认；minProfitPct=50 T211）');
    ok(normalizeFactorSellFilterConfig(null).normalized === null, 'A3 缺段=关');
    ok(normalizeFactorSellFilterConfig({ enabled: false }).normalized === null, 'A4 enabled=false=关');
    ok(normalizeFactorSellFilterConfig({ famousHold: {} }).error, 'A5 配段忘 enabled → error');
    ok(normalizeFactorSellFilterConfig({ enabled: 'yes' }).error, 'A6 enabled 非 bool → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, nope: 1 }).error, 'A7 顶层未知键 → error');
    // arms 退役防线（T157c：携带即报错防旧配置静默失效）
    ok(/arms 已退役/.test(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ['profitPercent > 100'] } }).error || ''), 'A8 arms 携带 → 退役 error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { nope: 1 } }).error, 'A9 famousHold 未知键 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { sellReleaseBnb: -1 } }).error, 'A10 负值 → error');
    const c = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { maxSinceBuySec: 300, sellReleaseBnb: 0.6 } }).normalized;
    ok(c.famousHold.maxSinceBuySec === 300 && c.famousHold.sellReleaseBnb === 0.6 && c.famousHold.minProfitPct === 50, 'A11 阈值覆盖+回落（minProfitPct 未覆盖回落 50）');
    normalizeFactorSellFilterConfig({ enabled: true, famousHold: { sellReleaseBnb: 99 } });
    ok(FACTOR_SELL_FILTER_DEFAULTS.sellReleaseBnb === 0.4, 'A12 默认常量不被污染');
}

// ── B. 全臂管辖（T157c 核心语义；T211 管辖线 50）────────────────
// 管辖判定=pp≥50 本身（T211 2026-11-22 100→50），与腿条件形状无关——任何卖臂
// fire 时 pp≥50 都过 famous/smart HOLD 门
{
    const F = { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 };
    // 各类腿（条件串含/不含 pp 因子、止损/bypass 形状）pp≥50 全部被拦
    ok(judgeFactorSellFilter(CFG, F).blocked === true, 'B1 pp 止盈腿被拦');
    // 同因子表下「腿」概念不再参与判定——条件串不含 pp 的回撤臂同样被拦
    ok(judgeFactorSellFilter(CFG, F).blocked === true, 'B2 判定与腿条件形状无关（judge 两参）');
    // pp<50 的卖信号恒放行（止损腿 pp 负值/低盈亏减仓）
    for (const pp of [-40, 0, 49.9]) {
        ok(judgeFactorSellFilter(CFG, { ...F, profitPercent: pp }).blocked === false, `B3 pp=${pp} 恒放行（<管辖门 50）`);
    }
    // pp=50 恰达管辖门（T211 边界 >=）
    ok(judgeFactorSellFilter(CFG, { ...F, profitPercent: 50 }).blocked === true, 'B5 pp=50 恰达管辖门拦截（>=，T211）');
    // 旧线差带反证：pp∈[50,100) 旧形状放行、T211 起入管辖（0x4509 案源 pp=92.8 域）
    ok(judgeFactorSellFilter(CFG, { ...F, profitPercent: 92.8 }).blocked === true, 'B6 pp=92.8 案源域拦截（旧 100 线放走=T211 靶心）');
    // pp 缺失 fail-open 放行
    ok(judgeFactorSellFilter(CFG, { sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0 }).blocked === false, 'B4 pp 缺失放行');
}

// ── C. 判定树全分支 ───────────────────────────────────────
{
    // config null/关 → 恒放行
    ok(judgeFactorSellFilter(null, { profitPercent: 500, sinceLastFamousBigBuySec: 1, recentFamousSellBnb: 0 }).blocked === false, 'C1 配置关恒放行');
    ok(judgeFactorSellFilter({}, { profitPercent: 500 }).blocked === false, 'C2 无 famousHold 放行');
    // ① sinceLast null / 超窗
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0 }).blocked === false, 'C3 sinceLast null 放行（原 IS NULL 释放臂）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 180.1, recentFamousSellBnb: 0 }).blocked === false, 'C4 sinceLast>180 放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 180, recentFamousSellBnb: 0 }).blocked === true, 'C5 sinceLast=180 恰窗内拦截（<=）');
    // ② famous 撤退达线（D 线 0.4；恰达线=放行）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.4 }).blocked === false, 'C6 recentSell=0.4 恰达线放行（>=）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.3999 }).blocked === true, 'C7 recentSell=0.3999 拦截');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: null }).blocked === true, 'C8 recentSell null 保持拦截（否定形状 bit 对齐）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: NaN }).blocked === true, 'C9 recentSell NaN 保持拦截');
    // pp=50 恰达管辖门（T211）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 50, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === true, 'C10 pp=50 恰达管辖门拦截（>=）');
    // pp=49.9 门外放行（T211 边界）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 49.9, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'C16 pp=49.9 门外放行');
    // 拦截产物形状
    const r = judgeFactorSellFilter(CFG, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(r.blocked === true && r.rule === 'famous_hold', 'C11 rule=famous_hold');
    ok(r.info.profitPercent === 105.6 && r.info.sinceLastFamousBigBuySec === 42 && r.info.recentFamousSellBnb === 0.287, 'C12 info 判据三因子值');
    ok(r.info.sellReleaseBnb === 0.4 && r.info.maxSinceBuySec === 180 && r.info.minProfitPct === 50, 'C13 info 阈值快照（minProfitPct=50 T211）');
    // 阈值覆盖生效
    const c2 = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { maxSinceBuySec: 300, sellReleaseBnb: 0.2 } }).normalized;
    ok(judgeFactorSellFilter(c2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.1 }).blocked === true, 'C14 覆盖窗 300s 内拦截');
    ok(judgeFactorSellFilter(c2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.2 }).blocked === false, 'C15 覆盖线 0.2 达线放行');
}

// ── S. T227d famousHold 状态窗臂（用户裁定「止盈也很常见……只要有新入场的即可」；
//    案源 개구리씨 0xa38b…7777：famous 03:45:18 卖 0.48 止盈后 03:48:03 买 0.132 回归——
//    侦察：180s 无新入场释放 +116.5 vs 挂起形状 +34.7；卖点时 180s 无买的票零干预）──
//    形状：circPct>0（仍持仓）∧ sinceLastFamousAnyBuySec ≤ releaseNoBuySec(180)（近期
//    任意金额新入场）→ 同拦不限 180s 且压制 0.4 撤退线；释放唯一判据=anyBuy 出窗。
//    旧帧不传新键=状态臂静默关（C 组全兼容）。
{
    // S1 状态臂命中：时间窗臂出窗（sinceLast null）但 famous 持仓+近期任意买 → 拦
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 120 }).blocked === true, 'S1 状态臂命中（持仓 ∧ 120s 前有任意买 → HOLD）');
    // S2 小买也算新入场（0.025 < 0.09 大买线——개구리씨 03:45:04 案）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 14 }).blocked === true, 'S2 任意金额买=新入场（anyBuySec=14s）');
    // S3 撤退线被新入场压制（개구리씨 03:45:18 帧：卖 0.48 达线但 14s 前有买）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0.64, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 14 }).blocked === true, 'S3 撤退线 0.64 被新入场压制（止盈不释放——T227d 靶心）');
    // S4 anyBuy 出窗 → 释放（唯一释放判据）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 180.1 }).blocked === false, 'S4 anyBuy=180.1 出窗释放（卖点即放——金鲨号/0x1a44 形状）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 180 }).blocked === true, 'S5 anyBuy=180 恰窗内拦截（<=）');
    // S6 anyBuySec null（无 famous 买/旧 FA）→ 状态臂不拦
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: null }).blocked === false, 'S6 anyBuy null fail-open');
    // S7 circPct=0/null（清仓/旧 FA）→ 不拦
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 0, sinceLastFamousAnyBuySec: 10 }).blocked === false, 'S7 circPct=0（清仓）放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: null, sinceLastFamousAnyBuySec: 10 }).blocked === false, 'S7b circPct null fail-open');
    // S8 releaseNoBuySec=0 显式关 → 状态臂退场、撤退线恢复旧语义（时间窗臂释放路径）
    const cOff = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { releaseNoBuySec: 0 } }).normalized;
    ok(judgeFactorSellFilter(cOff, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 14 }).blocked === false, 'S8 releaseNoBuySec=0 显式关');
    ok(judgeFactorSellFilter(cOff, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.64, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 14 }).blocked === false, 'S8b 关状态臂后撤退线恢复独立释放（旧时间窗语义）');
    // S9 时间窗臂独立：大买窗内 ∧ 撤退线未达 → 拦（anyBuySec 缺席）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 50, recentFamousSellBnb: 0 }).blocked === true, 'S9 时间窗臂独立工作（不传新键）');
    // S10 大买窗内 ∧ 撤退达线 ∧ anyBuy 出窗 → 时间窗臂也放（0.4 释放不被无新入场场景压制）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: 50, recentFamousSellBnb: 0.5, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 200 }).blocked === false, 'S10 撤退线 ∧ anyBuy 出窗 → 放行');
    // S11 cheapExit 豁免同判（T219：famous 低价建仓 ≥0.2 且已开始卖 → 照走）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0.05, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 5, sinceEntryFamousNearLaunchBuyBnb: 0.25 }).blocked === false, 'S11 cheapExit 豁免同判');
    // S12 管辖门外恒放行（状态臂不扩管辖域）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 40, currentVsLaunchPct: 5, sinceLastFamousBigBuySec: 5, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 5 }).blocked === false, 'S12 pp<50 ∧ curVs<10 管辖外放行');
    // S13 info 留痕三键（复盘载体）
    const r = judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, famousCopyWalletCircPct: 2.5, sinceLastFamousAnyBuySec: 14 });
    ok(r.info.famousCopyWalletCircPct === 2.5 && r.info.sinceLastFamousAnyBuySec === 14 && r.info.releaseNoBuySec === 180, 'S13 info 留痕（circPct/anyBuySec/releaseNoBuySec）');
}


// ── D. 事故现场反证（0x29921a53…7777 bt-v140，2026-11-03）────────
// 原条件串 0.2 线四笔全放行；D 修（买优先于卖+0.4 线）后卖出①（pp=105.6）被拦，
// ②③④ pp≥100∧famous 出窗（190/222/258s>180）放行——T157c 下四帧与 T157b 同判
//（管辖门=pp≥100，四帧全在管辖内，判定只看 famous 三因子）。
{
    const s1 = judgeFactorSellFilter(CFG, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(s1.blocked === true, 'D1 卖出①帧拦截（0.287<0.4 新线，D 修靶心）');
    ok(0.287 >= 0.2 && 0.287 < 0.4, 'D2 0.287 ∈ [0.2,0.4) 差异带（原 0.2 线放行=本案权源）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 190.8, sinceLastFamousBigBuySec: 190, recentFamousSellBnb: 0 }).blocked === false, 'D3 卖出②帧放行（190s>180 出窗 10s）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 157.3, sinceLastFamousBigBuySec: 222, recentFamousSellBnb: 0 }).blocked === false, 'D4 卖出③帧放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 127.1, sinceLastFamousBigBuySec: 258, recentFamousSellBnb: 0 }).blocked === false, 'D5 卖出④帧放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.41 }).blocked === false, 'D6 撤退达 0.4 线放行');
}

// ── E. 与原条件串释放臂等价性对拍 ──────────────────────────
// 原腿形（bt-v140 sell_3_7）：profitPercent > 100 AND (profitPercent < 100 OR
//   sinceLastFamousBigBuySec IS NULL OR sinceLastFamousBigBuySec > 180 OR
//   recentFamousSellBnb >= 0.2)。T157c 管辖门=pp≥minProfitPct 与原外层
//   pp>100 同域（边界 100 处 >= vs > 差异在原外层同样不触发腿，无行为差）。
// 对拍 240 帧：除 D 线差异带 [0.2,0.4)（原放行新拦截=刻意收紧）外逐帧等价。
// T211（管辖线 100→50）：对拍域限定 pp≥100=原腿 fire 域（原腿在 pp<100 从不
// fire，等价性在该域空洞）；pp∈[50,100) 为 T211 刻意扩管辖收紧带非对拍对象。
{
    const relOld = (pp, since, sell) =>
        pp < 100 || since === null || since > 180 || (sell !== null && sell >= 0.2);
    const relNew = (pp, since, sell) => !judgeFactorSellFilter(CFG, {
        profitPercent: pp, sinceLastFamousBigBuySec: since, recentFamousSellBnb: sell,
    }).blocked;
    const frames = [];
    for (const pp of [100, 105.6, 190.8, 300]) {
        for (const since of [null, 5, 42, 180, 181, 258]) {
            for (const sell of [0, 0.1, 0.199, 0.2, 0.287, 0.3999, 0.4, 0.5]) {
                frames.push([pp, since, sell]);
            }
        }
    }
    let diff = 0;
    for (const [pp, since, sell] of frames) {
        const a = relOld(pp, since, sell);
        const b = relNew(pp, since, sell);
        if (a === b) continue;
        const tightened = a === true && b === false; // 原放行新拦截=D 收紧带
        ok(tightened && pp >= 100 && since !== null && since <= 180 && sell >= 0.2 && sell < 0.4,
            `E 对拍差异超界 pp=${pp} since=${since} sell=${sell} old=${a} new=${b}`);
        diff++;
    }
    ok(diff > 0, 'E 差异带非空（D 修确实收紧）');
}

// ── F. 校验链（腿字段退役防线）───────────────────────────
{
    const { StrategyEngine } = require('../src/strategies/StrategyEngine');
    assert.throws(() => new StrategyEngine({
        strategies: [{ id: 's1', name: 's', action: 'sell', priority: 1, condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true }],
    }), /已退役字段 factorSellFilter/, 'F1 卖腿携带退役字段拒启');
    const se = new StrategyEngine({
        strategies: [{ id: 's2', name: 's2', action: 'sell', priority: 1, condition: 'profitPercent > 100', cards: 'all' }],
    });
    const fired = se.evaluate({ profitPercent: 150 }, '0xt', Date.now(), null, 'sell');
    ok(fired && fired.factorSellFilter === undefined, 'F2 strategy 对象无 factorSellFilter 键（全腿化）');
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    const v1 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all' }]);
    ok(v1.valid === true, 'F3 干净卖腿入库通过');
    const v2 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true }]);
    ok(v2.valid === false && (v2.errors || []).some(e => e.includes('已退役字段 factorSellFilter')), 'F4 validateLegs 退役字段 400');
}

// ── G. 引擎包装（配置关=恒放行；拦截落行+日志去重；落行桩零 DB）────
{
    const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
    const logs = [];
    const persisted = [];
    const fake = {
        _experimentId: 'test',
        logger: { info: (...a) => logs.push(a.join(' ')), warn: () => {} },
        _persistFactorSellFilterSignal: async (token, strategy, factors, res, nowTs) => {
            persisted.push({ token: token.token, leg: strategy.id, rule: res.rule, nowTs });
        },
    };
    const token = { token: '0xabc', symbol: 'TST' };
    const strat = { id: 'sell_3_7', name: 'P7', condition: 'profitPercent > 100' };
    const factors = { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 };
    const call = (cfg, ...a) => {
        fake._factorSellFilterCfg = cfg;
        return AbstractTradingEngine.prototype._factorSellFilterEvaluate.call(fake, ...a);
    };
    ok(call(null, token, strat, factors, 123).blocked === false && persisted.length === 0, 'G1 配置关恒放行');
    const r = call(CFG, token, strat, factors, 123456);
    ok(r.blocked === true && logs.length === 1 && persisted.length === 1, 'G2 首次拦截打日志+落行');
    ok(persisted[0].nowTs === 123456 && persisted[0].leg === 'sell_3_7', 'G3 落行参数（虚拟时钟透传）');
    call(CFG, token, strat, factors, 124000); call(CFG, token, strat, factors, 125000);
    ok(logs.length === 1 && persisted.length === 1, 'G4 持续拦截日志+落行去重');
    const r2 = call(CFG, token, strat, { ...factors, profitPercent: 45 }, 130000);
    ok(r2.blocked === false, 'G5 放行分支（pp 跌破管辖门 50，T211）');
    call(CFG, token, strat, factors, 140000);
    ok(logs.length === 2 && persisted.length === 2, 'G6 放行后重置，再拦截重打+重落');
    // T157c 全臂管辖：条件串不含 pp 的腿（如止损形状）pp≥100 同样拦截落痕
    const other = { id: 'sell_0_2', name: 'P2', condition: 'profitPercent <= -40' };
    const r3 = call(CFG, token, other, factors, 150000);
    ok(r3.blocked === true && persisted.length === 3, 'G7 全臂管辖：条件串不含 pp 的腿 pp≥100 同拦');
    const r4 = call(CFG, token, other, { ...factors, profitPercent: -40 }, 160000);
    ok(r4.blocked === false && persisted.length === 3, 'G8 止损域 pp<100 恒放行零落痕');
    ok(logs[0].includes('famous_hold') && logs[0].includes('recentFamousSellBnb=0.287'), 'G9 日志带判据');
}

// ── H. _initFactorSellFilter（缺段=关；非法 throw；arms 携带 throw）────
{
    const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
    const fake = {
        _experimentId: 'test',
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
    const init = (cfg) => AbstractTradingEngine.prototype._initFactorSellFilter.call(fake, cfg);
    init(null);
    ok(fake._factorSellFilterCfg === null, 'H1 缺段=关');
    init(undefined);
    ok(fake._factorSellFilterCfg === null, 'H2 undefined=关');
    assert.throws(() => init({ enabled: true, famousHold: { nope: 1 } }), /未知键/, 'H3 famousHold 未知键 throw');
    assert.throws(() => init({ enabled: true, famousHold: { sellReleaseBnb: -1 } }), /非法值/, 'H4 阈值越界 throw');
    assert.throws(() => init({ enabled: true, famousHold: { arms: ['x'] } }), /arms 已退役/, 'H5 arms 携带 throw（T157c 退役防线）');
    init({ enabled: true });
    ok(fake._factorSellFilterCfg && fake._factorSellFilterCfg.famousHold.minProfitPct === 50, 'H6 最简配置 {enabled:true} 初始化（famousHold 全默认，minProfitPct=50 T211）');
}

// ── I. T183 smartHold 聪明钱臂判定树（2026-11-18 bt-v150 0x2f17…7777 案）────
// 立法：famousHold 同构镜像（FA sinceLastSmartBigBuySec/recentSmartSellBnb 载体，
// 大买线 FA smartBigBuyBnb=0.02）；双臂独立判、双中 famous 优先；null=从未有
// 聪明钱大买/名单未加载 → 不命中 fail-open 不锁死卖出。
{
    // pp≥100 管辖内：smart 命中（famous 不在场）
    const r = judgeFactorSellFilter(CFG, {
        profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0,
        sinceLastSmartBigBuySec: 12.3, recentSmartSellBnb: 0.05,
    });
    ok(r.blocked === true && r.rule === 'smart_hold', 'I1 smart 命中拦截 rule=smart_hold');
    ok(r.info.sinceLastSmartBigBuySec === 12.3 && r.info.recentSmartSellBnb === 0.05, 'I2 info smart 判据值');
    ok(r.info.smartHoldEnabled === true && r.info.smartMaxSinceBuySec === 180 && r.info.smartSellReleaseBnb === 0.4, 'I3 info smart 阈值快照');
    ok(r.info.pumpArmJurisdiction === false, 'I4 无腿=pump 臂管辖 false');
    // smart 出窗/达释放线/null → 放行
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastSmartBigBuySec: 180.1, recentSmartSellBnb: 0 }).blocked === false, 'I5 smart 出窗放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0.4 }).blocked === false, 'I6 smart 释放线恰达放行（>=）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastSmartBigBuySec: null, recentSmartSellBnb: 0 }).blocked === false, 'I7 smart null（名单未加载/从未大买）放行 fail-open');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 105, sinceLastSmartBigBuySec: 5, recentSmartSellBnb: null }).blocked === true, 'I8 smart recentSell null 保持拦截（否定形状对齐）');
    // pp<50 无腿 → smart 也不管（管辖门先行，T211 线）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 45, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }).blocked === false, 'I9 pp<50 无腿 smart 放行（管辖门）');
    // T211 差带反证：pp=57.5（T183 立法案值，旧 100 线门外）今入管辖 → smart 拦
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }).blocked === true, 'I9b pp=57.5 入 T211 管辖拦截（旧 100 线放走）');
    // 双中 famous 优先
    const both = judgeFactorSellFilter(CFG, {
        profitPercent: 105, sinceLastFamousBigBuySec: 30, recentFamousSellBnb: 0,
        sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0,
    });
    ok(both.blocked === true && both.rule === 'famous_hold', 'I10 双中 famous 优先留痕');
    // smartHold.enabled=false 一键回滚 T157 单臂
    const cOff = normalizeFactorSellFilterConfig({ enabled: true, smartHold: { enabled: false } }).normalized;
    ok(cOff.smartHold.enabled === false, 'I11 smartHold.enabled=false 归一化');
    ok(judgeFactorSellFilter(cOff, { profitPercent: 105, sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0 }).blocked === false, 'I12 smartHold 关=smart 不命中（T157 形态）');
    ok(judgeFactorSellFilter(cOff, { profitPercent: 105, sinceLastFamousBigBuySec: 5, recentFamousSellBnb: 0 }).blocked === true, 'I13 smartHold 关不影响 famous 臂');
    // smartHold 阈值覆盖
    const cOv = normalizeFactorSellFilterConfig({ enabled: true, smartHold: { maxSinceBuySec: 60, sellReleaseBnb: 0.2 } }).normalized;
    ok(judgeFactorSellFilter(cOv, { profitPercent: 105, sinceLastSmartBigBuySec: 90, recentSmartSellBnb: 0 }).blocked === false, 'I14 覆盖窗 60s：90s 出窗放行');
    ok(judgeFactorSellFilter(cOv, { profitPercent: 105, sinceLastSmartBigBuySec: 30, recentSmartSellBnb: 0.2 }).blocked === false, 'I15 覆盖释放线 0.2 达线放行');
}

// ── J. T183 pump 臂签名管辖（pump-imbalance-exit 腿无论 pp 过门）──────────
// 案源：bt-v150 0x2f17 P5 腿（realHoldDuration>=30 AND sinceEntryNetBuyRatio>=90
// AND sinceEntryBuyBnb>=1）pp=57.5<100 被 T157c 管辖门放走 → 全清后卖后 +350%。
// 识别=condition 引用 sinceEntryNetBuyRatio（T113 家族唯一签名键，子串匹配抗
// 阈值漂移）；非 pump 腿 pp<50 恒放行（T211 起；100 时代放行带 [50,100) 已入管辖）。
// T186 起 pumpArmHold 默认开（臂级默认拦截遮蔽 famous/smart 证据型留痕）——
// 本段锁 T183 形态语义（pump 臂仅 HOLD 证据才拦），块内遮蔽 CFG 为回滚形态。
{
    const CFG = normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { enabled: false } }).normalized;
    const PUMP_LEG = { id: 'sell_pump', name: 'P5', condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
    const OTHER_LEG = { id: 'sell_7', name: 'P7', condition: 'profitPercent > 100 AND peakProfitPct > 50' };
    // 本案帧：pp=57.5 + smart 2s 前大买 → pump 臂管辖下拦截
    const caseF = { profitPercent: 57.5, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 };
    const rCase = judgeFactorSellFilter(CFG, caseF, PUMP_LEG);
    ok(rCase.blocked === true && rCase.rule === 'smart_hold', 'J1 立法案帧：pump 腿 pp=57.5 + smart 2s → 拦截');
    ok(rCase.info.pumpArmJurisdiction === true, 'J2 info.pumpArmJurisdiction=true');
    ok(judgeFactorSellFilter(CFG, { ...caseF, profitPercent: 45 }, OTHER_LEG).blocked === false, 'J3 同帧非 pump 腿 pp<50 放行（管辖门外，T211）');
    ok(judgeFactorSellFilter(CFG, caseF, OTHER_LEG).blocked === true, 'J3b 同帧非 pump 腿 pp=57.5 入 T211 管辖拦截（刻意收紧带）');
    ok(judgeFactorSellFilter(CFG, { ...caseF, profitPercent: 45 }).blocked === false, 'J4 同帧无腿（两参调用）放行——向后兼容');
    // pump 腿 pp 缺失也管（腿自身触发=明确卖出意志，pp 不构成放行）
    ok(judgeFactorSellFilter(CFG, { sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === true, 'J5 pump 腿 pp 缺失仍管');
    // pump 腿两臂均无在场证据 → 放行（smart null=fail-open 不锁死）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: null, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === false, 'J6 pump 腿无 HOLD 证据放行');
    // pump 腿 smart 出窗/释放达线 → 放行
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 300, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === false, 'J7 pump 腿 smart 出窗放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0.5 }, PUMP_LEG).blocked === false, 'J8 pump 腿 smart 撤退达线放行');
    // 签名匹配只认 sinceEntryNetBuyRatio：引用 sinceEntryBuyBnb 单键（观察键）不算
    //（帧移 pp=45 门外：caseF pp=57.5 在 T211 辖内会被 smart 证据拦=混淆签名匹配断言）
    const rJ9 = judgeFactorSellFilter(CFG, { ...caseF, profitPercent: 45 }, { id: 'x', name: 'x', condition: 'sinceEntryBuyBnb >= 1' });
    ok(rJ9.blocked === false && rJ9.info.pumpArmJurisdiction === false, 'J9 观察键单引用不触发 pump 管辖');
    // famous 臂同受 pump 管辖扩展（pump 腿 pp<100 + famous 在场也拦）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }, PUMP_LEG).blocked === true, 'J10 pump 腿 famous 臂同样管辖');
    // 阈值漂移抗性：v4 改线（>=95/>=1.5）仍识别
    ok(judgeFactorSellFilter(CFG, caseF, { id: 'x', name: 'x', condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 95 AND sinceEntryBuyBnb >= 1.5' }).info.pumpArmJurisdiction === true, 'J11 签名键匹配抗阈值漂移');
    // 引擎包装层透传腿：G 段同款 fake 验证
    {
        const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
        const logs = [];
        const persisted = [];
        const fake = {
            _experimentId: 'test',
            logger: { info: (...a) => logs.push(a.join(' ')), warn: () => {} },
            _persistFactorSellFilterSignal: async (token, strategy, factors, res, nowTs) => {
                persisted.push({ rule: res.rule, nowTs });
            },
        };
        const res = AbstractTradingEngine.prototype._factorSellFilterEvaluate.call(
            { ...fake, _factorSellFilterCfg: CFG },
            { token: '0x2f17', symbol: 'CASE' }, PUMP_LEG, caseF, 999);
        ok(res.blocked === true && persisted.length === 1 && persisted[0].rule === 'smart_hold', 'J12 引擎包装透传腿=pump 管辖拦截落行');
        ok(logs[0].includes('pump臂管辖'), 'J13 拦截日志带 pump 臂管辖标记');
    }
}

// ── K. T183 配置归一化扩展（smartHold 段）────────────────────────────
{
    const d = normalizeFactorSellFilterConfig({ enabled: true }).normalized;
    ok(d.smartHold && d.smartHold.enabled === true && d.smartHold.maxSinceBuySec === 180 && d.smartHold.sellReleaseBnb === 0.4, 'K1 smartHold 整体省略=全默认开');
    ok(/smartHold/.test(normalizeFactorSellFilterConfig({ enabled: true, nope: 1 }).error || ''), 'K2 顶层未知键报错文案含 smartHold 提示');
    ok(normalizeFactorSellFilterConfig({ enabled: true, smartHold: { nope: 1 } }).error, 'K3 smartHold 未知键 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, smartHold: { maxSinceBuySec: -1 } }).error, 'K4 smartHold 负值 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, smartHold: { enabled: 'no' } }).error, 'K5 smartHold.enabled 非 bool → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, smartHold: 42 }).error, 'K6 smartHold 非对象 → error');
    // famousHold 省略+smartHold 非法：早退分支也须报错（首版早退漏检反证）
    ok(normalizeFactorSellFilterConfig({ enabled: true, smartHold: { nope: 1 } }).error != null, 'K7 famousHold 省略时 smartHold 非法同报错');
    const { SMART_HOLD_DEFAULTS, PUMP_ARM_SIGNATURE_FACTOR } = require('../src/trading-engine/core/factor-sell-filter');
    ok(SMART_HOLD_DEFAULTS.maxSinceBuySec === 180 && SMART_HOLD_DEFAULTS.sellReleaseBnb === 0.4, 'K8 SMART_HOLD_DEFAULTS 常量');
    ok(PUMP_ARM_SIGNATURE_FACTOR === 'sinceEntryNetBuyRatio', 'K9 pump 签名键常量');
}

// ── L. T185 recoveryHold 低位回涨臂（2026-11-18 bt-v153 0x89aa…7777 案）──
// 案形：峰 +118% 后 4s 闪砸 -44%，bypass 卖在 +20%（pp<100 不在 T157c 管辖），
// 18.5s 后 V 反 +211%。用户裁定：debounce 确认后「暴跌后价格低（买入区间或略高）
// 且正在回涨=买入策略要买的点位」→ 拒绝卖出。三腿=peak≥80 ∧ curVs≤40 ∧ chg5>0，
// 独立管辖（深回撤卖出 pp 常 <100，挂 pp 管辖永远不生效）。
{
    // 立法案帧形状：高浮盈武装 + 价格已回买区 + 5s 动量转正 + pp=20.25（pp 管辖外）
    const caseF = { profitPercent: 20.25, peakProfitPct: 97, currentVsLaunchPct: 23.5, chg5Pct: 6.2,
        sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, sinceLastSmartBigBuySec: null, recentSmartSellBnb: 0 };
    const LEG = { id: 'sell_17_', name: 'P1·高浮盈保护全清', condition: 'peakProfitPct >= 80 AND drawdownFromHighestSinceLastBuy <= -35' };
    const r = judgeFactorSellFilter(CFG, caseF, LEG);
    ok(r.blocked === true && r.rule === 'recovery_hold', 'L1 立法案帧：pp<100 独立管辖仍拦（recovery_hold）');
    ok(r.info.peakProfitPct === 97 && r.info.currentVsLaunchPct === 23.5 && r.info.chg5Pct === 6.2, 'L2 info 判据三值快照');
    ok(r.info.recoveryMinPeakProfitPct === 80 && r.info.recoveryMaxLaunchPct === 40 && r.info.recoveryMinChg5Pct === 0, 'L3 info 阈值快照（默认 80/40/0）');
    ok(judgeFactorSellFilter(CFG, caseF).blocked === true, 'L4 无腿两参调用同拦（独立管辖不依赖腿）');
    // 三腿逐一拆：缺一不拦
    ok(judgeFactorSellFilter(CFG, { ...caseF, peakProfitPct: 79 }).blocked === false, 'L5 peak=79 未达武装门放行');
    ok(judgeFactorSellFilter(CFG, { ...caseF, currentVsLaunchPct: 40.1 }).blocked === false, 'L6 curVs=40.1 高于略高线上界放行（41+ 非买点域）');
    ok(judgeFactorSellFilter(CFG, { ...caseF, currentVsLaunchPct: 40 }).blocked === true, 'L7 curVs=40 恰达线拦（≤40 含）');
    ok(judgeFactorSellFilter(CFG, { ...caseF, chg5Pct: 0 }).blocked === false, 'L8 chg5=0 未回涨放行（严格 >）');
    ok(judgeFactorSellFilter(CFG, { ...caseF, chg5Pct: -0.5 }).blocked === false, 'L9 chg5 负=还在跌放行（本案 fire 时刻形状）');
    // null fail-open 三形状（证据缺席不冒充买点，宁卖）
    ok(judgeFactorSellFilter(CFG, { ...caseF, peakProfitPct: null }).blocked === false, 'L10 peak null 放行');
    ok(judgeFactorSellFilter(CFG, { ...caseF, currentVsLaunchPct: null }).blocked === false, 'L11 curVs null（未见可靠价）放行');
    ok(judgeFactorSellFilter(CFG, { ...caseF, chg5Pct: null }).blocked === false, 'L12 chg5 null 放行');
    ok(judgeFactorSellFilter(CFG, { peakProfitPct: 97, currentVsLaunchPct: 23.5, chg5Pct: 6.2 }).blocked === true, 'L13 pp 缺席不构成放行（独立管辖不看 pp）');
    // 与 pp 管辖并存：pp≥100 域 famous 在场优先留痕（T157 先例序 famous>smart>recovery）
    ok(judgeFactorSellFilter(CFG, { ...caseF, profitPercent: 150, sinceLastFamousBigBuySec: 5 }).rule === 'famous_hold', 'L14 双中 famous 优先留痕');
    ok(judgeFactorSellFilter(CFG, { ...caseF, profitPercent: 150, sinceLastSmartBigBuySec: 5 }).rule === 'smart_hold', 'L15 双中 smart 次先留痕');
    // enabled:false 一键回滚 T183 形态
    const cOff = normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { enabled: false } }).normalized;
    ok(cOff.recoveryHold.enabled === false, 'L16 recoveryHold.enabled=false 归一化');
    ok(judgeFactorSellFilter(cOff, caseF, LEG).blocked === false, 'L17 关臂=立法案帧放行（回滚 T183 形态）');
    // 阈值覆盖（负 minChg5Pct=跌幅收窄也算回涨的宽松档）
    const cOv = normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { maxLaunchPct: 28.5, minChg5Pct: -3 } }).normalized;
    ok(judgeFactorSellFilter(cOv, { ...caseF, currentVsLaunchPct: 30, chg5Pct: -1 }).blocked === false, 'L18 覆盖 28.5 门：curVs=30 放行');
    ok(judgeFactorSellFilter(cOv, { ...caseF, chg5Pct: -1 }).blocked === true, 'L19 覆盖 minChg5Pct=-3：跌幅收窄到 -1 也拦');
    ok(normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { minChg5Pct: -5 } }).normalized.recoveryHold.minChg5Pct === -5, 'L20 minChg5Pct 允许负值（唯一可负键）');
    // 归一化防线
    ok(normalizeFactorSellFilterConfig({ enabled: true }).normalized.recoveryHold.enabled === true, 'L21 recoveryHold 整体省略=全默认开');
    ok(normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { nope: 1 } }).error, 'L22 recoveryHold 未知键 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { minPeakProfitPct: -1 } }).error, 'L23 minPeakProfitPct 负值 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: { enabled: 'no' } }).error, 'L24 enabled 非 bool → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, recoveryHold: 42 }).error, 'L25 非对象 → error');
    ok(/recoveryHold/.test(normalizeFactorSellFilterConfig({ enabled: true, nope: 1 }).error || ''), 'L26 顶层未知键报错文案含 recoveryHold 提示');
    // famousHold 省略早退分支也归一化 recoveryHold（K7 早退漏检反证同款防线）
    const dFH = normalizeFactorSellFilterConfig({ enabled: true }).normalized;
    ok(dFH.recoveryHold && dFH.recoveryHold.minPeakProfitPct === 80, 'L27 famousHold 省略分支 recoveryHold 同默认');
    const { RECOVERY_HOLD_DEFAULTS } = require('../src/trading-engine/core/factor-sell-filter');
    ok(RECOVERY_HOLD_DEFAULTS.minPeakProfitPct === 80 && RECOVERY_HOLD_DEFAULTS.maxLaunchPct === 40 && RECOVERY_HOLD_DEFAULTS.minChg5Pct === 0, 'L28 RECOVERY_HOLD_DEFAULTS 常量');
    // 引擎包装层：拦截日志带 T185 判据段（J12 同款 fake）
    {
        const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
        const logs = [];
        const persisted = [];
        const fake = {
            _experimentId: 'test',
            logger: { info: (...a) => logs.push(a.join(' ')), warn: () => {} },
            _persistFactorSellFilterSignal: async (token, strategy, factors, res, nowTs) => {
                persisted.push({ rule: res.rule });
            },
        };
        const res = AbstractTradingEngine.prototype._factorSellFilterEvaluate.call(
            { ...fake, _factorSellFilterCfg: CFG },
            { token: '0x89aa', symbol: 'CASE' }, LEG, caseF, 999);
        ok(res.blocked === true && persisted.length === 1 && persisted[0].rule === 'recovery_hold', 'L29 引擎包装 recovery_hold 拦截落行');
        ok(logs[0].includes('T185 低位回涨'), 'L30 拦截日志带 T185 判据段');
    }
}

// ── M. T183a AST 腿签名管辖（2026-11-18 d345 熊二/狸花猫漏拦案）──────────
// 事故：StrategyEngine loadStrategies 构建腿对象 condition=parseCondition 的
// **AST 对象**（非字符串）→ 首版 `typeof leg.condition === 'string'` 恒 false
// → pump 臂签名管辖在引擎实跑中从未生效（d345 六笔 P5 全漏：熊二 pp=57.5
// smart 2s 前大买/狸花猫 pp=86 famous 29s 前大买均应拦；pp≥100 走 pp 管辖
// 不受影响=同进程 Tiltpad 拦截成功的反证）。T183 离线重放用手构字符串腿
// =测试盲区。修复=loadStrategies 腿对象保留原始条件串 conditionText +
// legConditionText 双形状兼容。
// T186 同 J 段：块内 CFG 遮蔽为 T183 回滚形态（本段锁 T183a 修复语义的 rule 留痕）。
{
    const CFG = normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { enabled: false } }).normalized;
    // 事故现场反证：AST 腿无 conditionText → 签名管辖 false（修复前引擎腿恒此形状=漏拦根源）
    const AST_LEG_BROKEN = { id: 'p5', name: 'P5', condition: { type: 'AND', left: {}, right: {} } };
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }, AST_LEG_BROKEN).info.pumpArmJurisdiction === false,
        'M1 事故反证：AST 腿无 conditionText=签名管辖 false（修复前引擎形状恒漏拦）');

    // 修复形状：AST condition + conditionText 原文 → 签名管辖命中
    const ENGINE_LEG = { id: 'p5', name: 'P5', condition: { type: 'AND' }, conditionText: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
    const rM = judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }, ENGINE_LEG);
    ok(rM.info.pumpArmJurisdiction === true, 'M2 AST 腿带 conditionText=签名管辖 true');
    ok(rM.blocked === true && rM.rule === 'smart_hold', 'M3 d345 熊二帧（pp=57.5+smart 2s）AST 腿拦截');
    const rM2 = judgeFactorSellFilter(CFG, { profitPercent: 86.0, sinceLastFamousBigBuySec: 29, recentFamousSellBnb: 0 }, ENGINE_LEG);
    ok(rM2.blocked === true && rM2.rule === 'famous_hold', 'M4 d345 狸花猫帧（pp=86+famous 29s）AST 腿拦截');

    // 端到端：真实 StrategyEngine loadStrategies 装载的腿形状锁定（防再漂移）
    const { StrategyEngine } = require('../src/strategies/StrategyEngine');
    const se = new StrategyEngine();
    se.loadStrategies([{ id: 'p5', name: '卖出策略 P5', action: 'sell', priority: 5, condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' }]);
    const leg0 = se._strategies[0];
    ok(leg0.condition != null && typeof leg0.condition === 'object', 'M5 装载腿 condition=AST 对象（事故根源形状锁定）');
    ok(typeof leg0.conditionText === 'string' && leg0.conditionText.includes('sinceEntryNetBuyRatio'), 'M6 装载腿 conditionText=原始条件串（T183a）');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }, leg0).blocked === true, 'M7 真实装载腿端到端拦截（d345 熊二案兑现）');
    // evaluate 返回的腿对象（引擎实跑消费点）同拦截
    const trig = se.evaluate({ realHoldDuration: 34, sinceEntryNetBuyRatio: 100, sinceEntryBuyBnb: 1.5, profitPercent: 57.5 }, '0x2f17', 0, { completedPairs: [] }, 'sell');
    ok(!!trig && judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }, trig).blocked === true, 'M8 evaluate 返回腿端到端拦截（引擎实跑链路）');
}

// ── N. T186 pumpArmHold 泵失衡臂默认拦截（2026-11-18 用户裁定）──────────
// 用户原话「这一臂卖出默认过滤掉，等我找到应该卖出的作弊票再提供过来构建
// 信号通过的策略，没有的话这一臂就相当于废了」。立法依据：d345 六笔+bt-v150
// 同窗九笔 P5 触发全部 pp<100 且卖后 15min 峰全正（+7%~+479%）=触发面 100%
// 误伤；T168 复盘 4/5 卖早 0/5 避险。默认（pumpArmHold 省略=开）下 pump 签名
// 腿无需 HOLD 证据直接拦，rule='pump_arm_hold'（臂级主因留痕，优先于
// famous/smart 证据型）；enabled:false 回滚 T183 形态。
{
    const PUMP_LEG = { id: 'sell_pump', name: 'P5', condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
    // N1 BIBI 帧（用户点名「BIBI 也应该拦住卖出」）：pp=80.9 无任何 famous/smart 证据 → 默认拦
    const bibiF = { profitPercent: 80.9, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, sinceLastSmartBigBuySec: null, recentSmartSellBnb: 0 };
    const rN1 = judgeFactorSellFilter(CFG, bibiF, PUMP_LEG);
    ok(rN1.blocked === true && rN1.rule === 'pump_arm_hold', 'N1 BIBI 帧（pp<100 零 HOLD 证据）默认拦截 pump_arm_hold');
    ok(rN1.info.pumpArmHoldEnabled === true, 'N2 info.pumpArmHoldEnabled=true');
    // N3 pp≥100 域同拦（臂级默认无 pp 豁免理由）
    ok(judgeFactorSellFilter(CFG, { ...bibiF, profitPercent: 250 }, PUMP_LEG).rule === 'pump_arm_hold', 'N3 pp≥100 域 pump 腿同拦（臂级主因）');
    // N4 famous 证据在场也记 pump_arm_hold（臂级默认=主因，证据型留痕让位）
    ok(judgeFactorSellFilter(CFG, { ...bibiF, sinceLastFamousBigBuySec: 29 }, PUMP_LEG).rule === 'pump_arm_hold', 'N4 famous 证据在场留痕=pump_arm_hold（臂级主因优先）');
    // N5 非 pump 腿不受默认拦截影响（pp=80.9 已在 T211 管辖内，famous/smart 双 null 无 HOLD 证据 → 放行）
    ok(judgeFactorSellFilter(CFG, bibiF, { id: 'p7', name: 'P7', condition: 'profitPercent > 100 AND peakProfitPct > 50' }).blocked === false, 'N5 非 pump 腿零 HOLD 证据放行（pp=80.9 辖内但证据缺席）');
    // N6 非 pump 腿 pp≥100 走 famous/smart 照旧（默认拦截只作用于 pump 签名腿）
    const rN6 = judgeFactorSellFilter(CFG, { ...bibiF, profitPercent: 150, sinceLastSmartBigBuySec: 5 }, { id: 'p7', name: 'P7', condition: 'profitPercent > 100' });
    ok(rN6.blocked === true && rN6.rule === 'smart_hold', 'N6 非 pump 腿 pp≥100 smart 臂照旧');
    // N7 回滚开关：enabled:false → T183 形态（零 HOLD 证据放行）
    const CFG183N = normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { enabled: false } }).normalized;
    ok(judgeFactorSellFilter(CFG183N, bibiF, PUMP_LEG).blocked === false, 'N7 enabled:false 回滚 T183 形态（BIBI 帧放行）');
    // N8 AST 腿（引擎实跑形状）默认拦截端到端
    const AST_LEG = { id: 'p5', name: 'P5', condition: { type: 'AND' }, conditionText: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
    ok(judgeFactorSellFilter(CFG, bibiF, AST_LEG).rule === 'pump_arm_hold', 'N8 AST 腿端到端默认拦截');
    // N9 归一化：省略=默认开；enabled 非法值/未知键拒绝
    ok(normalizeFactorSellFilterConfig({ enabled: true }).normalized.pumpArmHold.enabled === true, 'N9a 省略 pumpArmHold=默认开');
    ok(normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { enabled: false } }).normalized.pumpArmHold.enabled === false, 'N9b 显式 false=关');
    ok(!!normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { enabled: 'yes' } }).error, 'N9c enabled 非 bool 拒绝');
    ok(!!normalizeFactorSellFilterConfig({ enabled: true, pumpArmHold: { minBuyBnb: 1 } }).error, 'N9d 未知键拒绝（放行判据待案例立法后扩键）');
    // N10 引擎真实装载腿端到端（T183a conditionText × T186 默认拦）
    const { StrategyEngine } = require('../src/strategies/StrategyEngine');
    const seN = new StrategyEngine();
    seN.loadStrategies([{ id: 'p5', name: '卖出策略 P5', action: 'sell', priority: 5, condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' }]);
    ok(judgeFactorSellFilter(CFG, bibiF, seN._strategies[0]).rule === 'pump_arm_hold', 'N10 真实装载腿端到端默认拦截（BIBI 案兑现）');
}

// ── O. T211 管辖线 100→50（2026-11-22 bt-v179 0x4509…7777 金狗案源四帧）──────────
// 案源：15:09:02 P10（prio10 族，镜像取 mcap-arc）卖出 pp=92.8 差 7.2 点在旧 100 线门外，smart
// 0x2c26f58b 1s 前大买 0.3292B 照卖（用户「后面的卖出没有被聪明钱买入挡住」）；
// 15:08:15 P11 pp=77.3、smart 23s 前大买 0.0988B 同形状；15:10:51 P7 pp=195.1 辖内
// 但同钱包 60s 内自卖 0.4104B ≥ 释放线=撤退信号压倒（放行不变——T211 只动管辖
// 线，释放线/新鲜窗不动）。四帧因子值=ticks 离线重放（与引擎留痕逐位对拍：
// 15:05:20 被拦帧 sinceSmart=92/smartSell60=0.1246 复现一致）；腿条件=现行包
// trading-standard-v1 v4 真实卖腿镜像（P 编号=priority 字段：P10=prio10 族任一、
// P11=prio11 peak-protect 族、P7=profitPercent>100 主了结 1 卡；均非 pump 签名）。
{
    const P10 = { id: 'sell_mcap_arc', name: 'P10', condition: 'mcapPeakBnb > 20.1 AND secSinceMcapPeak >= mcapRiseHalfSec' };
    const P11 = { id: 'sell_dd', name: 'P11', condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27' };
    const P7 = { id: 'sell_tp', name: 'P7', condition: 'profitPercent > 100' };
    const base = { sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0 };
    // 15:09:02 靶心帧：pp=92.8 + smart 1s 前大买 → T211 拦（旧 100 线放走=立法动因）
    const f1 = judgeFactorSellFilter(CFG, { ...base, profitPercent: 92.8, sinceLastSmartBigBuySec: 1, recentSmartSellBnb: 0 }, P10);
    ok(f1.blocked === true && f1.rule === 'smart_hold', 'O1 15:09:02 案源帧：pp=92.8+smart 1s 拦截（T211 靶心）');
    // 15:08:15 帧：pp=77.3 + smart 23s → 拦
    const f2 = judgeFactorSellFilter(CFG, { ...base, profitPercent: 77.3, sinceLastSmartBigBuySec: 23, recentSmartSellBnb: 0 }, P11);
    ok(f2.blocked === true && f2.rule === 'smart_hold', 'O2 15:08:15 帧：pp=77.3+smart 23s 拦截');
    // 15:07:43 帧：pp=55.0（T211 辖内）但 smart 出窗 235s → 放行（证据缺席不锁死）
    ok(judgeFactorSellFilter(CFG, { ...base, profitPercent: 55.0, sinceLastSmartBigBuySec: 235, recentSmartSellBnb: 0 }, P10).blocked === false, 'O3 15:07:43 帧：smart 出窗 235s 放行（辖内但证据缺席）');
    // 15:10:51 帧：pp=195.1 辖内 + smart 110s 在窗，但 60s 自卖 0.4104 ≥ 释放线 0.4 → 放行（释放臂不动）
    ok(judgeFactorSellFilter(CFG, { ...base, profitPercent: 195.1, sinceLastSmartBigBuySec: 110, recentSmartSellBnb: 0.4104 }, P7).blocked === false, 'O4 15:10:51 帧：smart 自卖 0.4104≥0.4 释放放行（T211 只动管辖线）');
    // 案源腿均非 pump 签名（mcap-arc/峰后滞涨/回撤域——不触发 T186 默认拦）
    ok(f1.info.pumpArmJurisdiction === false && f2.info.pumpArmJurisdiction === false, 'O5 案源腿均非 pump 签名管辖');
}

// ═══════════════ T219 管辖扩展 + famous 低价止盈豁免 ═══════════════
{
  const F = { profitPercent: 30, sinceLastFamousBigBuySec: 60, recentFamousSellBnb: 0 }; // pp<50
  // 管辖扩展：curVs ≥ 10 → 进管辖（不管 pp）
  ok(judgeFactorSellFilter(CFG, { ...F, currentVsLaunchPct: 15 }).blocked === true,
    'T219 pp=30 ∧ curVs=15（almost launch 往上）∧ famous 在场 → 拦（管辖第二把尺）');
  ok(judgeFactorSellFilter(CFG, { ...F, currentVsLaunchPct: 5 }).blocked === false,
    'T219 pp=30 ∧ curVs=5（almost launch 域内）→ 不管辖放行');
  ok(judgeFactorSellFilter(CFG, { ...F }).blocked === false,
    'T219 curVs 缺失 → 不管辖 fail-open 放行');
  // 低价止盈豁免：famous near_launch 建仓 ≥0.2 ∧ 已开始卖 >0 → 放行
  ok(judgeFactorSellFilter(CFG, { profitPercent: 80, sinceLastFamousBigBuySec: 60, recentFamousSellBnb: 0.1, sinceEntryFamousNearLaunchBuyBnb: 0.25 }).blocked === false,
    'T219 低价建仓 0.25∧卖 0.1 → 止盈离场放行（原释放线 0.4 前的新豁免）');
  ok(judgeFactorSellFilter(CFG, { profitPercent: 80, sinceLastFamousBigBuySec: 60, recentFamousSellBnb: 0.1, sinceEntryFamousNearLaunchBuyBnb: 0.15 }).blocked === true,
    'T219 低价建仓 <0.2 线 → 豁免不成立照拦');
  ok(judgeFactorSellFilter(CFG, { profitPercent: 80, sinceLastFamousBigBuySec: 60, recentFamousSellBnb: 0, sinceEntryFamousNearLaunchBuyBnb: 0.25 }).blocked === true,
    'T219 低价建仓达标但 famous 还没卖 → 照拦（止盈还没开始）');
}

console.log(`✅ _test_factor_sell_filter 全部 ${passed} 断言通过`);
