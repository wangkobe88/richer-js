#!/usr/bin/env node
/**
 * T157 因子卖出过滤门单测（零 DB 零网络）
 *
 * 覆盖：
 *  A. normalizeFactorSellFilter 归一化全形状（true/false/null/对象覆盖/未知键/越界）
 *  B. judgeFactorSellFilter 判定树全分支（放行四形状 + 拦截 + info 快照 + 阈值覆盖）
 *  C. 事故现场反证断言（0x29921a53…7777 bt-v140 四笔卖出帧回放——D 修靶心：
 *     卖出① recentSell=0.287 ∈ [0.2,0.4) 差异带：原条件串 0.2 线放行、新门 0.4 线拦截）
 *  D. 与原条件串释放臂的等价性对拍（释放臂四形状逐条；唯一刻意差异=D 线 0.2→0.4）
 *  E. loadStrategies / validateLegs 校验链（仅卖腿可配/非法形状拒启/strategy 透传）
 *  F. 引擎包装 _factorSellFilterEvaluate 日志去重（同 (token,腿) 持续拦截只打首条，放行重置）
 */

'use strict';

const assert = require('assert');
const {
    FACTOR_SELL_FILTER_DEFAULTS,
    normalizeFactorSellFilter,
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

// ── A. 归一化 ─────────────────────────────────────────────
{
    // 缺省关：null/undefined/false = 不走
    for (const v of [null, undefined, false]) {
        ok(normalizeFactorSellFilter(v).normalized === null, `A1 缺省关 ${v}`);
    }
    // true = 全默认
    const t = normalizeFactorSellFilter(true);
    ok(t.normalized && t.normalized.famousHold, 'A2 true → famousHold 在场');
    ok(t.normalized.famousHold.minProfitPct === 100, 'A3 默认 minProfitPct=100');
    ok(t.normalized.famousHold.maxSinceBuySec === 180, 'A4 默认 maxSinceBuySec=180');
    ok(t.normalized.famousHold.sellReleaseBnb === 0.4, 'A5 默认 sellReleaseBnb=0.4（D 修）');
    // 对象覆盖
    const o = normalizeFactorSellFilter({ famousHold: { sellReleaseBnb: 0.6 } });
    ok(o.normalized.famousHold.sellReleaseBnb === 0.6, 'A6 覆盖 sellReleaseBnb');
    ok(o.normalized.famousHold.maxSinceBuySec === 180, 'A7 未覆盖键回落默认');
    // {famousHold: true} 同全默认；{famousHold: false} 显式关
    ok(normalizeFactorSellFilter({ famousHold: true }).normalized.famousHold.minProfitPct === 100, 'A8 famousHold:true');
    ok(normalizeFactorSellFilter({ famousHold: false }).normalized === null, 'A9 famousHold:false 显式关');
    // 非法形状
    ok(normalizeFactorSellFilter('yes').error, 'A10 顶层字符串 → error');
    ok(normalizeFactorSellFilter([1]).error, 'A11 顶层数组 → error');
    ok(normalizeFactorSellFilter({ famousHoldX: 1 }).error, 'A12 顶层未知键 → error');
    ok(normalizeFactorSellFilter({ famousHold: { maxSinceBuySecX: 1 } }).error, 'A13 famousHold 未知键 → error');
    ok(normalizeFactorSellFilter({ famousHold: { sellReleaseBnb: -0.1 } }).error, 'A14 负值 → error');
    ok(normalizeFactorSellFilter({ famousHold: { sellReleaseBnb: '0.4' } }).error, 'A15 字符串数值 → error');
    ok(normalizeFactorSellFilter({ famousHold: 'fast' }).error, 'A16 famousHold 字符串 → error');
    // 归一化产物冻结默认不被污染
    normalizeFactorSellFilter({ famousHold: { sellReleaseBnb: 99 } });
    ok(FACTOR_SELL_FILTER_DEFAULTS.sellReleaseBnb === 0.4, 'A17 默认常量不被覆盖污染');
}

// ── B. 判定树全分支 ───────────────────────────────────────
{
    const F = normalizeFactorSellFilter(true).normalized;
    // filter null / famousHold 缺 → 恒放行
    ok(judgeFactorSellFilter(null, {}).blocked === false, 'B1 无 filter 放行');
    ok(judgeFactorSellFilter({}, {}).blocked === false, 'B2 famousHold 缺放行');
    // ① pp 未达保护域 / 缺失
    ok(judgeFactorSellFilter(F, { profitPercent: 99.9, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'B3 pp<100 放行');
    ok(judgeFactorSellFilter(F, { profitPercent: null, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'B4 pp null fail-open 放行');
    ok(judgeFactorSellFilter(F, { sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'B5 pp 缺席放行');
    // ② sinceLast null / 超窗
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0 }).blocked === false, 'B6 sinceLast null 放行（原 IS NULL 释放臂）');
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 180.1, recentFamousSellBnb: 0 }).blocked === false, 'B7 sinceLast>180 放行');
    // ③ famous 撤退达线（D 线 0.4；恰达线=放行）
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.4 }).blocked === false, 'B8 recentSell=0.4 恰达线放行（>=）');
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.3999 }).blocked === true, 'B9 recentSell=0.3999 拦截');
    // recentSell null/非有限数 → 不构成释放 → 保持拦截（原 OR 形状 null 比较恒假 bit 对齐）
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: null }).blocked === true, 'B10 recentSell null 保持拦截');
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: NaN }).blocked === true, 'B11 recentSell NaN 保持拦截');
    // 边界：sinceLast=180 恰在窗内 → 拦截
    ok(judgeFactorSellFilter(F, { profitPercent: 105, sinceLastFamousBigBuySec: 180, recentFamousSellBnb: 0 }).blocked === true, 'B12 sinceLast=180 恰窗内拦截（<=）');
    // pp=100 恰达保护域 → 拦截
    ok(judgeFactorSellFilter(F, { profitPercent: 100, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === true, 'B13 pp=100 恰达保护域拦截（>=）');
    // 拦截产物形状：rule + info 快照
    const r = judgeFactorSellFilter(F, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(r.blocked === true && r.rule === 'famous_hold', 'B14 rule=famous_hold');
    ok(r.info.profitPercent === 105.6 && r.info.sinceLastFamousBigBuySec === 42 && r.info.recentFamousSellBnb === 0.287, 'B15 info 判据三因子值');
    ok(r.info.sellReleaseBnb === 0.4 && r.info.maxSinceBuySec === 180 && r.info.minProfitPct === 100, 'B16 info 阈值快照');
    // 阈值覆盖生效
    const F2 = normalizeFactorSellFilter({ famousHold: { maxSinceBuySec: 300, sellReleaseBnb: 0.2 } }).normalized;
    ok(judgeFactorSellFilter(F2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.1 }).blocked === true, 'B17 覆盖窗 300s 内拦截');
    ok(judgeFactorSellFilter(F2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.2 }).blocked === false, 'B18 覆盖线 0.2 达线放行');
}

// ── C. 事故现场反证（0x29921a53…7777 bt-v140，2026-11-03）────────
// 链上事实（wss_price_ticks + roster v9 对拍取证）：最后 famous 大买 14:12:08
//（0xef395d6a 0.1478）；famous 60s 卖出窗 14:11:55/14:12:03/14:12:37 三笔合计
// 0.0584+0.1406+0.0880=0.2870。原条件串 0.2 线下四笔卖出全放行；D 修（买优先
// 于卖+0.4 线）后卖出①被拦（42s 前大买在场 ∧ 0.287<0.4）。
{
    const F = normalizeFactorSellFilter(true).normalized;
    // 卖出① 14:12:50 sell_3_7 帧（pp=105.6 sinceLast=42 recentSell=0.287）→ D 修靶心：拦截
    const s1 = judgeFactorSellFilter(F, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(s1.blocked === true, 'C1 卖出①帧拦截（0.287<0.4 新线，D 修靶心）');
    // 差异带锁：0.287 在原线 [0.2,0.4) 之上之下——原版放行、新版拦截的唯一刻意差异
    ok(0.287 >= 0.2 && 0.287 < 0.4, 'C2 0.287 ∈ [0.2,0.4) 差异带（原 0.2 线放行=本案权源）');
    // 卖出② 14:15:18 sell_3_7 帧（sinceLast=190 出窗 10s）→ 放行
    ok(judgeFactorSellFilter(F, { profitPercent: 190.8, sinceLastFamousBigBuySec: 190, recentFamousSellBnb: 0 }).blocked === false, 'C3 卖出②帧放行（190s>180 出窗）');
    // 卖出③ 14:15:50 sell_12_10 帧（sinceLast=222）→ 放行
    ok(judgeFactorSellFilter(F, { profitPercent: 157.3, sinceLastFamousBigBuySec: 222, recentFamousSellBnb: 0 }).blocked === false, 'C4 卖出③帧放行');
    // 卖出④ 14:16:26 sell_11_10 帧（sinceLast=258）→ 放行
    ok(judgeFactorSellFilter(F, { profitPercent: 127.1, sinceLastFamousBigBuySec: 258, recentFamousSellBnb: 0 }).blocked === false, 'C5 卖出④帧放行');
    // 假如 famous 撤退加剧（60s 窗 ≥0.4）→ 放行（famous 撤退压倒买入证据）
    ok(judgeFactorSellFilter(F, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.41 }).blocked === false, 'C6 撤退达 0.4 线放行');
}

// ── D. 与原条件串释放臂等价性对拍 ──────────────────────────
// 原腿形（bt-v140 sell_3_7）：profitPercent > 100 AND (profitPercent < 100 OR
//   sinceLastFamousBigBuySec IS NULL OR sinceLastFamousBigBuySec > 180 OR
//   recentFamousSellBnb >= 0.2)
// 迁移后：干净条件 profitPercent > 100 + 本门（0.4 线）。对拍释放臂布尔代数：
// 原放行（腿 fire）= NOT(pp<100 ∨ IS NULL ∨ >180 ∨ sell>=0.2) 在 pp>100 前提下
// 新放行（不拦） = NOT(pp<100 缺席) ∧ NOT(IS NULL/超窗) ∧ NOT(sell>=0.4)
// 除 D 线差异带 [0.2,0.4) 外逐帧等价。
{
    const F = normalizeFactorSellFilter(true).normalized;
    const relOld = (pp, since, sell) =>
        pp < 100 || since === null || since > 180 || (sell !== null && sell >= 0.2); // 原释放臂
    const relNew = (pp, since, sell) => !judgeFactorSellFilter(F, {
        profitPercent: pp, sinceLastFamousBigBuySec: since, recentFamousSellBnb: sell,
    }).blocked;
    const frames = [];
    for (const pp of [50, 100, 105.6, 190.8, 300]) {
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
        const inDBand = a === false && b === true; // 原拦（不释放）新放？不可能——D 只收紧
        // D 收紧方向：原放行（释放）∧ 新拦截 = 差异带
        const inDBand2 = a === true && b === false;
        if (a === b) continue;
        // 唯一允许差异：D 线收紧（原释放、新拦截）且必在 sell ∈ [0.2,0.4) ∧ pp>=100 ∧ since<=180 非 null
        ok(inDBand2 && pp >= 100 && since !== null && since <= 180 && sell >= 0.2 && sell < 0.4,
            `D 对拍差异超界 pp=${pp} since=${since} sell=${sell} old=${a} new=${b}`);
        ok(!inDBand, `D 对拍出现反向放 pp=${pp} since=${since} sell=${sell}`);
        diff++;
    }
    ok(diff > 0, 'D 差异带非空（D 修确实收紧）');
}

// ── E. 校验链（loadStrategies / validateLegs）────────────────
{
    const { StrategyEngine } = require('../src/strategies/StrategyEngine');
    // 卖腿携带 → 加载成功 + 透传
    const se = new StrategyEngine({
        strategies: [{
            id: 'sell_1', name: '测试卖腿', action: 'sell', priority: 1,
            condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true,
        }],
    });
    const leg = se.getStrategies ? se.getStrategies()[0] : se._strategies[0];
    ok(leg.factorSellFilter && leg.factorSellFilter.famousHold.sellReleaseBnb === 0.4, 'E1 loadStrategies 归一化透传');
    // evaluate 返回对象带 factorSellFilter（引擎消费点前提）
    const fired = se.evaluate({ profitPercent: 150 }, '0xtoken', Date.now(), null, 'sell');
    ok(fired && fired.factorSellFilter && fired.factorSellFilter.famousHold, 'E2 evaluate 透传 factorSellFilter');
    // 买腿携带 → throw
    assert.throws(() => new StrategyEngine({
        strategies: [{
            id: 'buy_1', name: '测试买腿', action: 'buy', priority: 1,
            condition: 'tradeCount >= 6', factorSellFilter: true,
        }],
    }), /非卖腿携带 factorSellFilter/, 'E3 买腿携带拒启');
    // 非法形状 → throw
    assert.throws(() => new StrategyEngine({
        strategies: [{
            id: 'sell_2', name: '测试卖腿2', action: 'sell', priority: 1,
            condition: 'profitPercent > 100', cards: 'all', factorSellFilter: { famousHold: { sellReleaseBnb: 'x' } },
        }],
    }), /factorSellFilter.*非法值/, 'E4 非法形状拒启');
    // validateLegs 同口径
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    const v1 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true }]);
    ok(v1.valid === true, `E5 validateLegs 卖腿通过（${(v1.errors || []).join(';')}）`);
    const v2 = validateLegs('buy', [{ condition: 'tradeCount >= 6', factorSellFilter: true }]);
    ok(v2.valid === false && (v2.errors || []).some(e => e.includes('factorSellFilter')), 'E6 validateLegs 买腿 400');
    const v3 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all', factorSellFilter: { famousHold: { nope: 1 } } }]);
    ok(v3.valid === false && (v3.errors || []).some(e => e.includes('未知键')), 'E7 validateLegs 未知键 400');
}

// ── F. 引擎包装日志去重 ────────────────────────────────────
{
    const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
    const logs = [];
    const fakeThis = {
        _experimentId: 'test',
        logger: { info: (exp, tag, msg) => logs.push(msg), warn: () => {} },
    };
    const token = { token: '0xabc', symbol: 'TST' };
    const F = normalizeFactorSellFilter(true).normalized;
    const strat = { id: 'sell_3_7', name: 'P7', factorSellFilter: F };
    const factors = { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 };
    const call = () => AbstractTradingEngine.prototype._factorSellFilterEvaluate.call(fakeThis, token, strat, factors);
    ok(call().blocked === true && logs.length === 1, 'F1 首次拦截打日志');
    call(); call();
    ok(logs.length === 1, 'F2 持续拦截日志去重（同 token+腿只打一条）');
    // 放行（factors 变化）→ 重置 → 再拦截再打
    const r2 = AbstractTradingEngine.prototype._factorSellFilterEvaluate.call(fakeThis, token, strat,
        { profitPercent: 90, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(r2.blocked === false, 'F3 放行分支');
    call();
    ok(logs.length === 2, 'F4 放行后重置，再拦截重打');
    ok(logs[0].includes('famous_hold') && logs[0].includes('recentFamousSellBnb=0.287'), 'F5 日志带判据');
}

console.log(`✅ _test_factor_sell_filter 全部 ${passed} 断言通过`);
