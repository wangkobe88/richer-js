#!/usr/bin/env node
/**
 * T157 因子卖出过滤门单测（零 DB 零网络）
 *
 * T157c 管辖门简化（2026-11-17 用户裁定）：**所有卖出臂统一过门，管辖判定=
 * `profitPercent >= 100` 本身**——当前收益 >100% 的卖信号即被 famous 卖出门
 * 管住，与触发腿条件串里有没有 profitPercent 因子无关；arms 条件文本清单整链
 * 退役（配置漂移失配风险消灭），famousHold 三键收进模块配置。
 *
 * 覆盖：
 *  A. normalizeFactorSellFilterConfig 配置全形状（enabled/famousHold 三键/arms 退役防线）
 *  B. 全臂管辖（T157c 核心语义）：任何腿（止损/bypass/条件串不含 pp 的腿）
 *     pp≥100 即进 famousHold 管辖；pp<100 恒放行
 *  C. judgeFactorSellFilter 判定树全分支（放行三形状+拦截+info 快照+阈值覆盖）
 *  D. 事故现场反证（0x29921a53…7777 bt-v140 四笔卖出帧回放——D 修靶心：
 *     卖出① recentSell=0.287 ∈ [0.2,0.4) 差异带：原条件串 0.2 线放行、新门 0.4 线拦截）
 *  E. 与原条件串释放臂的等价性对拍（唯一刻意差异=D 线 0.2→0.4）
 *  F. 校验链（loadStrategies 腿字段退役防线 / validateLegs 同口径）
 *  G. 引擎包装 _factorSellFilterEvaluate（配置关=恒放行；拦截落行+日志去重；
 *     落行桩替换 _persistFactorSellFilterSignal——零 DB 红线）
 *  H. _initFactorSellFilter（缺段=关；非法 throw；arms 携带 throw）
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
    ok(CFG.famousHold.minProfitPct === 100 && CFG.famousHold.maxSinceBuySec === 180 && CFG.famousHold.sellReleaseBnb === 0.4, 'A2 默认阈值（famousHold 整体省略=全默认）');
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
    ok(c.famousHold.maxSinceBuySec === 300 && c.famousHold.sellReleaseBnb === 0.6 && c.famousHold.minProfitPct === 100, 'A11 阈值覆盖+回落');
    normalizeFactorSellFilterConfig({ enabled: true, famousHold: { sellReleaseBnb: 99 } });
    ok(FACTOR_SELL_FILTER_DEFAULTS.sellReleaseBnb === 0.4, 'A12 默认常量不被污染');
}

// ── B. 全臂管辖（T157c 核心语义）─────────────────────────
// 管辖判定=pp≥100 本身，与腿条件形状无关——任何卖臂 fire 时 pp≥100 都过 famousHold
{
    const F = { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 };
    // 各类腿（条件串含/不含 pp 因子、止损/bypass 形状）pp≥100 全部被拦
    ok(judgeFactorSellFilter(CFG, F).blocked === true, 'B1 pp 止盈腿被拦');
    // 同因子表下「腿」概念不再参与判定——条件串不含 pp 的回撤臂同样被拦
    ok(judgeFactorSellFilter(CFG, F).blocked === true, 'B2 判定与腿条件形状无关（judge 两参）');
    // pp<100 的卖信号恒放行（止损腿 pp 负值/低盈亏减仓）
    for (const pp of [-40, 0, 50, 99.9]) {
        ok(judgeFactorSellFilter(CFG, { ...F, profitPercent: pp }).blocked === false, `B3 pp=${pp} 恒放行（<管辖门 100）`);
    }
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
    // pp=100 恰达管辖门
    ok(judgeFactorSellFilter(CFG, { profitPercent: 100, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === true, 'C10 pp=100 恰达管辖门拦截（>=）');
    // 拦截产物形状
    const r = judgeFactorSellFilter(CFG, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(r.blocked === true && r.rule === 'famous_hold', 'C11 rule=famous_hold');
    ok(r.info.profitPercent === 105.6 && r.info.sinceLastFamousBigBuySec === 42 && r.info.recentFamousSellBnb === 0.287, 'C12 info 判据三因子值');
    ok(r.info.sellReleaseBnb === 0.4 && r.info.maxSinceBuySec === 180 && r.info.minProfitPct === 100, 'C13 info 阈值快照');
    // 阈值覆盖生效
    const c2 = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { maxSinceBuySec: 300, sellReleaseBnb: 0.2 } }).normalized;
    ok(judgeFactorSellFilter(c2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.1 }).blocked === true, 'C14 覆盖窗 300s 内拦截');
    ok(judgeFactorSellFilter(c2, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.2 }).blocked === false, 'C15 覆盖线 0.2 达线放行');
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
{
    const relOld = (pp, since, sell) =>
        pp < 100 || since === null || since > 180 || (sell !== null && sell >= 0.2);
    const relNew = (pp, since, sell) => !judgeFactorSellFilter(CFG, {
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
    const r2 = call(CFG, token, strat, { ...factors, profitPercent: 90 }, 130000);
    ok(r2.blocked === false, 'G5 放行分支（pp 跌破管辖门）');
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
    ok(fake._factorSellFilterCfg && fake._factorSellFilterCfg.famousHold.minProfitPct === 100, 'H6 最简配置 {enabled:true} 初始化（famousHold 全默认）');
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
    // pp<100 无腿 → smart 也不管（管辖门先行）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 }).blocked === false, 'I9 pp<100 无腿 smart 放行（管辖门）');
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
// 阈值漂移）；非 pump 腿 pp<100 恒放行不变。
{
    const PUMP_LEG = { id: 'sell_pump', name: 'P5', condition: 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1' };
    const OTHER_LEG = { id: 'sell_7', name: 'P7', condition: 'profitPercent > 100 AND peakProfitPct > 50' };
    // 本案帧：pp=57.5 + smart 2s 前大买 → pump 臂管辖下拦截
    const caseF = { profitPercent: 57.5, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0, sinceLastSmartBigBuySec: 2, recentSmartSellBnb: 0 };
    const rCase = judgeFactorSellFilter(CFG, caseF, PUMP_LEG);
    ok(rCase.blocked === true && rCase.rule === 'smart_hold', 'J1 立法案帧：pump 腿 pp=57.5 + smart 2s → 拦截');
    ok(rCase.info.pumpArmJurisdiction === true, 'J2 info.pumpArmJurisdiction=true');
    ok(judgeFactorSellFilter(CFG, caseF, OTHER_LEG).blocked === false, 'J3 同帧非 pump 腿 pp<100 放行（存量语义不变）');
    ok(judgeFactorSellFilter(CFG, caseF).blocked === false, 'J4 同帧无腿（两参调用）放行——向后兼容');
    // pump 腿 pp 缺失也管（腿自身触发=明确卖出意志，pp 不构成放行）
    ok(judgeFactorSellFilter(CFG, { sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === true, 'J5 pump 腿 pp 缺失仍管');
    // pump 腿两臂均无在场证据 → 放行（smart null=fail-open 不锁死）
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: null, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === false, 'J6 pump 腿无 HOLD 证据放行');
    // pump 腿 smart 出窗/释放达线 → 放行
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 300, recentSmartSellBnb: 0 }, PUMP_LEG).blocked === false, 'J7 pump 腿 smart 出窗放行');
    ok(judgeFactorSellFilter(CFG, { profitPercent: 57.5, sinceLastSmartBigBuySec: 5, recentSmartSellBnb: 0.5 }, PUMP_LEG).blocked === false, 'J8 pump 腿 smart 撤退达线放行');
    // 签名匹配只认 sinceEntryNetBuyRatio：引用 sinceEntryBuyBnb 单键（观察键）不算
    ok(judgeFactorSellFilter(CFG, caseF, { id: 'x', name: 'x', condition: 'sinceEntryBuyBnb >= 1' }).blocked === false, 'J9 观察键单引用不触发 pump 管辖');
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

console.log(`✅ _test_factor_sell_filter 全部 ${passed} 断言通过`);
