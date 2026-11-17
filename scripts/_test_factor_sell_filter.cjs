#!/usr/bin/env node
/**
 * T157/T157b 因子卖出过滤门单测（零 DB 零网络）
 *
 * T157b 全腿化二修（2026-11-17 用户裁定）：所有卖出信号统一过模块（腿字段
 * factorSellFilter 退役，携带即拒启）；famous 阻挡不针对所有臂——管辖臂清单
 * arms 配置在模块内（归一化空白后与触发腿 condition 精确匹配）。
 *
 * 覆盖：
 *  A. normalizeFactorSellFilterConfig 实验级配置全形状（enabled/arms/阈值/未知键/越界）
 *  B. 管辖臂匹配（归一化空白/失配放行/其它腿恒放行）
 *  C. judgeFactorSellFilter 判定树全分支（放行四形状+拦截+info 快照+阈值覆盖）
 *  D. 事故现场反证（0x29921a53…7777 bt-v140 四笔卖出帧回放——D 修靶心：
 *     卖出① recentSell=0.287 ∈ [0.2,0.4) 差异带：原条件串 0.2 线放行、新门 0.4 线拦截）
 *  E. 与原条件串释放臂的等价性对拍（管辖臂命中前提下；唯一刻意差异=D 线 0.2→0.4）
 *  F. 校验链（loadStrategies 腿字段退役防线 / validateLegs 同口径）
 *  G. 引擎包装 _factorSellFilterEvaluate（配置关=恒放行；拦截落行+日志去重；
 *     落行桩替换 _persistFactorSellFilterSignal——零 DB 红线）
 *  H. _initFactorSellFilter（缺段=关；配置非法 throw；arms 未知因子 throw）
 */

'use strict';

const assert = require('assert');
const {
    FACTOR_SELL_FILTER_DEFAULTS,
    normalizeCondText,
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

// bt-v140 迁移后的 5 条管辖臂（干净条件，模块 arms 清单同款）
const ARMS = [
    'profitPercent > 100',
    'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1',
    'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap >= 8.1 AND marketCap < 27',
    'peakProfitPct >= 10 AND secSincePeak > 60',
    'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 13.4 AND marketCap < 27',
];
const CFG = normalizeFactorSellFilterConfig({
    enabled: true,
    famousHold: { arms: ARMS },
}).normalized;

// ── A. 配置归一化 ─────────────────────────────────────────
{
    ok(CFG && CFG.enabled === true, 'A1 enabled=true 归一化');
    ok(CFG.famousHold.minProfitPct === 100 && CFG.famousHold.maxSinceBuySec === 180 && CFG.famousHold.sellReleaseBnb === 0.4, 'A2 默认阈值');
    ok(CFG.famousHold.armsSet && CFG.famousHold.armsSet.size === 5, 'A3 armsSet 预构建');
    // 缺段/undefined = 关
    ok(normalizeFactorSellFilterConfig(null).normalized === null, 'A4 缺段=关');
    ok(normalizeFactorSellFilterConfig(undefined).normalized === null, 'A5 undefined=关');
    // 显式关
    ok(normalizeFactorSellFilterConfig({ enabled: false }).normalized === null, 'A6 enabled=false=关');
    // 配段忘 enabled → error（引导显式开）
    ok(normalizeFactorSellFilterConfig({ famousHold: { arms: ARMS } }).error, 'A7 配段忘 enabled → error');
    ok(normalizeFactorSellFilterConfig({ enabled: 'yes' }).error, 'A8 enabled 非 bool → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true }).error, 'A9 enabled=true 无 famousHold → error');
    // arms 形状
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: [] } }).error, 'A10 arms 空 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ['x', 1] } }).error, 'A11 arms 非字符串 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ['a', ' a '] } }).error, 'A12 arms 归一化后重复 → error');
    // 未知键/越界
    ok(normalizeFactorSellFilterConfig({ enabled: true, nope: 1 }).error, 'A13 顶层未知键 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { nope: 1, arms: ARMS } }).error, 'A14 famousHold 未知键 → error');
    ok(normalizeFactorSellFilterConfig({ enabled: true, famousHold: { sellReleaseBnb: -1, arms: ARMS } }).error, 'A15 负值 → error');
    // 阈值覆盖
    const c = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ARMS, maxSinceBuySec: 300, sellReleaseBnb: 0.6 } }).normalized;
    ok(c.famousHold.maxSinceBuySec === 300 && c.famousHold.sellReleaseBnb === 0.6 && c.famousHold.minProfitPct === 100, 'A16 阈值覆盖+回落');
    // 默认常量冻结不污染
    normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ARMS, sellReleaseBnb: 99 } });
    ok(FACTOR_SELL_FILTER_DEFAULTS.sellReleaseBnb === 0.4, 'A17 默认常量不被污染');
    // 条件文本归一化
    ok(normalizeCondText('  profitPercent   >  100 ') === 'profitPercent > 100', 'A18 空白归一化');
}

// ── B. 管辖臂匹配 ─────────────────────────────────────────
{
    const leg = (condition) => ({ id: 'sell_3_7', name: 'P7', condition });
    // 命中管辖臂（含空白变体）
    ok(judgeFactorSellFilter(CFG, leg('profitPercent > 100'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === true, 'B1 精确命中拦截');
    ok(judgeFactorSellFilter(CFG, leg('profitPercent  >  100'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === true, 'B2 空白变体同键命中');
    ok(judgeFactorSellFilter(CFG, leg('peakProfitPct >= 10 AND secSincePeak > 60'), { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0 }).blocked === true, 'B3 P10 臂命中');
    // 失配=恒放行（famous 阻挡不针对所有臂——T157b 核心）
    ok(judgeFactorSellFilter(CFG, leg('profitPercent <= -40'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === false, 'B4 止损臂失配放行');
    ok(judgeFactorSellFilter(CFG, leg('peakProfitPct >= 80 AND drawdownFromHighestSinceLastBuy <= -35'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === false, 'B5 bypass 深回撤臂失配放行');
    ok(judgeFactorSellFilter(CFG, leg('sinceEntryFamousNearLaunchBuyBnb >= 0.5'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === false, 'B6 famous-entry-exit 臂失配放行（互不代位）');
    ok(judgeFactorSellFilter(CFG, leg('graduationProgress >= 0.9'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === false, 'B7 毕业臂失配放行');
    ok(judgeFactorSellFilter(CFG, leg('profitPercent > 101'), { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 }).blocked === false, 'B8 阈值改写后失配放行（配置漂移=显式不匹配）');
    ok(judgeFactorSellFilter(CFG, { id: 'x', name: 'x', condition: null }, { profitPercent: 105 }).blocked === false, 'B9 condition null 放行');
    // info.matchedArm 标注
    const r = judgeFactorSellFilter(CFG, leg('profitPercent > 100'), { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0 });
    ok(r.info.matchedArm === true && r.info.arm === 'profitPercent > 100', 'B10 info.arm 管辖臂快照');
    const r2 = judgeFactorSellFilter(CFG, leg('x'), {});
    ok(r2.info && r2.info.matchedArm === false, 'B11 info.matchedArm=false');
}

// ── C. 判定树全分支（管辖臂命中前提下）───────────────────
{
    const arm = { id: 's', name: 's', condition: 'profitPercent > 100' };
    // config null/关 → 恒放行
    ok(judgeFactorSellFilter(null, arm, { profitPercent: 500, sinceLastFamousBigBuySec: 1, recentFamousSellBnb: 0 }).blocked === false, 'C1 配置关恒放行');
    ok(judgeFactorSellFilter({}, arm, { profitPercent: 500 }).blocked === false, 'C2 无 famousHold 放行');
    // ① pp 未达保护域 / 缺失
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 99.9, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'C3 pp<100 放行');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: null, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'C4 pp null fail-open 放行');
    ok(judgeFactorSellFilter(CFG, arm, { sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === false, 'C5 pp 缺席放行');
    // ② sinceLast null / 超窗
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: null, recentFamousSellBnb: 0 }).blocked === false, 'C6 sinceLast null 放行（原 IS NULL 释放臂）');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 180.1, recentFamousSellBnb: 0 }).blocked === false, 'C7 sinceLast>180 放行');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 180, recentFamousSellBnb: 0 }).blocked === true, 'C8 sinceLast=180 恰窗内拦截（<=）');
    // ③ famous 撤退达线（D 线 0.4；恰达线=放行）
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.4 }).blocked === false, 'C9 recentSell=0.4 恰达线放行（>=）');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.3999 }).blocked === true, 'C10 recentSell=0.3999 拦截');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: null }).blocked === true, 'C11 recentSell null 保持拦截（否定形状 bit 对齐）');
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: NaN }).blocked === true, 'C12 recentSell NaN 保持拦截');
    // pp=100 恰达保护域
    ok(judgeFactorSellFilter(CFG, arm, { profitPercent: 100, sinceLastFamousBigBuySec: 10, recentFamousSellBnb: 0 }).blocked === true, 'C13 pp=100 恰达保护域拦截（>=）');
    // 拦截产物形状
    const r = judgeFactorSellFilter(CFG, arm, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(r.blocked === true && r.rule === 'famous_hold', 'C14 rule=famous_hold');
    ok(r.info.profitPercent === 105.6 && r.info.sinceLastFamousBigBuySec === 42 && r.info.recentFamousSellBnb === 0.287, 'C15 info 判据三因子值');
    ok(r.info.sellReleaseBnb === 0.4 && r.info.maxSinceBuySec === 180 && r.info.minProfitPct === 100, 'C16 info 阈值快照');
    // 阈值覆盖生效
    const c2 = normalizeFactorSellFilterConfig({ enabled: true, famousHold: { arms: ARMS, maxSinceBuySec: 300, sellReleaseBnb: 0.2 } }).normalized;
    ok(judgeFactorSellFilter(c2, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.1 }).blocked === true, 'C17 覆盖窗 300s 内拦截');
    ok(judgeFactorSellFilter(c2, arm, { profitPercent: 105, sinceLastFamousBigBuySec: 250, recentFamousSellBnb: 0.2 }).blocked === false, 'C18 覆盖线 0.2 达线放行');
}

// ── D. 事故现场反证（0x29921a53…7777 bt-v140，2026-11-03）────────
// 链上事实：最后 famous 大买 14:12:08（0.1478）；60s 卖出窗 14:11:55/14:12:03/
// 14:12:37 三笔合计 0.0584+0.1406+0.0880=0.2870。原条件串 0.2 线四笔全放行；
// D 修（买优先于卖+0.4 线）后卖出①（sell_3_7 管辖臂）被拦。
{
    const p7 = { id: 'sell_3_7', name: '卖出策略 P7', condition: 'profitPercent > 100' };
    const s1 = judgeFactorSellFilter(CFG, p7, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.287 });
    ok(s1.blocked === true, 'D1 卖出①帧拦截（0.287<0.4 新线，D 修靶心）');
    ok(0.287 >= 0.2 && 0.287 < 0.4, 'D2 0.287 ∈ [0.2,0.4) 差异带（原 0.2 线放行=本案权源）');
    const p11 = { id: 'sell_5_11', name: '卖出策略 P11', condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1' };
    ok(judgeFactorSellFilter(CFG, p11, { profitPercent: 190.8, sinceLastFamousBigBuySec: 190, recentFamousSellBnb: 0 }).blocked === false, 'D3 卖出②帧放行（190s>180 出窗 10s）');
    const p10 = { id: 'sell_12_10', name: '卖出策略 P10', condition: 'peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -15 AND marketCap >= 13.4 AND marketCap < 27' };
    ok(judgeFactorSellFilter(CFG, p10, { profitPercent: 157.3, sinceLastFamousBigBuySec: 222, recentFamousSellBnb: 0 }).blocked === false, 'D4 卖出③帧放行');
    const p10b = { id: 'sell_11_10', name: '卖出策略 P10', condition: 'peakProfitPct >= 10 AND secSincePeak > 60' };
    ok(judgeFactorSellFilter(CFG, p10b, { profitPercent: 127.1, sinceLastFamousBigBuySec: 258, recentFamousSellBnb: 0 }).blocked === false, 'D5 卖出④帧放行');
    ok(judgeFactorSellFilter(CFG, p7, { profitPercent: 105.6, sinceLastFamousBigBuySec: 42, recentFamousSellBnb: 0.41 }).blocked === false, 'D6 撤退达 0.4 线放行');
}

// ── E. 与原条件串释放臂等价性对拍（管辖臂命中前提下）────────
// 原腿形（bt-v140 sell_3_7）：profitPercent > 100 AND (profitPercent < 100 OR
//   sinceLastFamousBigBuySec IS NULL OR sinceLastFamousBigBuySec > 180 OR
//   recentFamousSellBnb >= 0.2)——释放臂真=卖（放行）。对拍 240 帧：除 D 线
// 差异带 [0.2,0.4)（原放行新拦截=刻意收紧）外逐帧等价、无一处反向放。
{
    const arm = { condition: 'profitPercent > 100' };
    const relOld = (pp, since, sell) =>
        pp < 100 || since === null || since > 180 || (sell !== null && sell >= 0.2);
    const relNew = (pp, since, sell) => !judgeFactorSellFilter(CFG, arm, {
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
    // 卖腿/买腿携带 factorSellFilter 字段 → 拒启（已退役）
    assert.throws(() => new StrategyEngine({
        strategies: [{ id: 's1', name: 's', action: 'sell', priority: 1, condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true }],
    }), /已退役字段 factorSellFilter/, 'F1 卖腿携带退役字段拒启');
    assert.throws(() => new StrategyEngine({
        strategies: [{ id: 'b1', name: 'b', action: 'buy', priority: 1, condition: 'tradeCount >= 6', factorSellFilter: true }],
    }), /已退役字段 factorSellFilter/, 'F2 买腿携带退役字段拒启');
    // 正常卖腿加载（干净条件，无字段）
    const se = new StrategyEngine({
        strategies: [{ id: 's2', name: 's2', action: 'sell', priority: 1, condition: 'profitPercent > 100', cards: 'all' }],
    });
    const fired = se.evaluate({ profitPercent: 150 }, '0xt', Date.now(), null, 'sell');
    ok(fired && fired.factorSellFilter === undefined, 'F3 strategy 对象无 factorSellFilter 键（全腿化）');
    // validateLegs 同口径
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    const v1 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all' }]);
    ok(v1.valid === true, 'F4 干净卖腿入库通过');
    const v2 = validateLegs('sell', [{ condition: 'profitPercent > 100', cards: 'all', factorSellFilter: true }]);
    ok(v2.valid === false && (v2.errors || []).some(e => e.includes('已退役字段 factorSellFilter')), 'F5 validateLegs 退役字段 400');
}

// ── G. 引擎包装（配置关=恒放行；拦截落行+日志去重；落行桩零 DB）────
{
    const { AbstractTradingEngine } = require('../src/trading-engine/core/AbstractTradingEngine');
    const logs = [];
    const persisted = [];
    const fake = {
        _experimentId: 'test',
        logger: { info: (...a) => logs.push(a.join(' ')), warn: () => {} },
        // 落行桩（零 DB 红线：真实现 TradeSignal.save 连 Supabase）
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
    // 配置关=恒放行（快路径零日志零落行）
    ok(call(null, token, strat, factors, 123).blocked === false && persisted.length === 0, 'G1 配置关恒放行');
    // 拦截：日志+落行各一
    const r = call(CFG, token, strat, factors, 123456);
    ok(r.blocked === true && logs.length === 1 && persisted.length === 1, 'G2 首次拦截打日志+落行');
    ok(persisted[0].nowTs === 123456 && persisted[0].leg === 'sell_3_7', 'G3 落行参数（虚拟时钟透传）');
    call(CFG, token, strat, factors, 124000); call(CFG, token, strat, factors, 125000);
    ok(logs.length === 1 && persisted.length === 1, 'G4 持续拦截日志+落行去重');
    // 放行（pp 跌破）→ 重置 → 再拦再落
    const r2 = call(CFG, token, strat, { ...factors, profitPercent: 90 }, 130000);
    ok(r2.blocked === false, 'G5 放行分支');
    call(CFG, token, strat, factors, 140000);
    ok(logs.length === 2 && persisted.length === 2, 'G6 放行后重置，再拦截重打+重落');
    ok(logs[0].includes('famous_hold') && logs[0].includes('recentFamousSellBnb=0.287'), 'G7 日志带判据');
    // 非管辖臂腿：零日志零落行（famous 阻挡不针对所有臂）
    const other = { id: 'sell_0_2', name: 'P2', condition: 'profitPercent <= -40' };
    call(CFG, token, other, factors, 150000);
    ok(persisted.length === 2, 'G8 非管辖臂零落行');
}

// ── H. _initFactorSellFilter（缺段=关；非法 throw；arms 未知因子 throw）────
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
    assert.throws(() => init({ enabled: true, famousHold: { arms: [] } }), /arms/, 'H3 arms 空 throw');
    assert.throws(() => init({ enabled: true, famousHold: { arms: ['profitPercentX > 100'] } }), /未知因子|invalid/i, 'H4 arms 未知因子 throw');
    assert.throws(() => init({ enabled: true, famousHold: { sellReleaseBnb: -1, arms: ARMS } }), /非法值/, 'H5 阈值越界 throw');
    init({ enabled: true, famousHold: { arms: ARMS } });
    ok(fake._factorSellFilterCfg && fake._factorSellFilterCfg.famousHold.armsSet.size === 5, 'H6 合法配置初始化');
}

console.log(`✅ _test_factor_sell_filter 全部 ${passed} 断言通过`);
