/**
 * T157 因子卖出过滤门（famous HOLD 迁移案，2026-11-17）
 *
 * 定位：卖出环节的「基于因子的卖出信号过滤模块」——对标买侧 T143 因子购买前
 * 检查门（FP1）的纯代码因子过滤形态：零 Jev / 零 DB / 零网络，输入=fire 时刻
 * FA 因子表 + 腿配置，输出=放行/拦截。挂点=两引擎卖腿评估点（evaluate 返回
 * 触发腿后、bypass/去抖分流前）与去抖 fire 重评点——拦截=视同腿未触发（与
 * 原条件串释放臂假=evaluate 不返回该腿 bit 对齐：pending 取消、放行后重新
 * 首真起算）。止损/毕业卖/cheat 清仓/stallClose/手工卖不走策略腿评估，天然
 * 不受本门管辖（与原释放臂管辖范围一致）。
 *
 * 腿级 opt-in：卖腿携带 `factorSellFilter` 才走（缺省/null/false=零行为，
 * 存量实验 bit 不变）；买腿携带 loadStrategies throw / validateLegs 400
 * （signalGate/buyPhase 同款防线）。归一化单点 normalizeFactorSellFilter，
 * loadStrategies 与 validateLegs 同源防漂移。
 *
 * 规则一 famousHold（自 bt-v115~v140 克隆链 5 条 HOLD 释放腿的条件串迁移，
 * 案源 0x29921a53…7777 bt-v140 复盘）：
 *   拦截（拒绝卖出）= profitPercent >= minProfitPct(100)
 *                     AND sinceLastFamousBigBuySec <= maxSinceBuySec(180)
 *                     AND recentFamousSellBnb < sellReleaseBnb(0.4)
 *   放行 = 原释放臂四形状逐条取反：
 *     pp < 100（HOLD 只保护浮盈过百——原释放臂第一条 `profitPercent < 100`
 *       由本门保护域承载，P10/P11 回撤腿迁移后条件串不再带）
 *     ∨ sinceLastFamousBigBuySec IS NULL（从未有 famous 大买=无 HOLD 依据）
 *     ∨ sinceLastFamousBigBuySec > 180（famous 超窗未入场）
 *     ∨ recentFamousSellBnb >= 0.4（famous 撤退信号压倒买入证据）
 *   D 修改（用户裁定 2026-11-17，案源=卖出① 14:12:50 帧 recentSell=0.287）：
 *     famous 买卖并存时「买优先于卖」——释放线 0.2 → 0.4（原 0.2 线下 42s 前
 *     famous 大买 0.1478 的在场证据被 0.287 卖出压倒放行；新线 0.4 下同样
 *     帧拦截，卖出顺延至 famous 出窗/撤退达线/pp 跌破 100）。
 *   null 语义与原条件串 bit 对齐（否定形状实现，null 比较恒假自动对齐）：
 *     recentFamousSellBnb null/非有限数 → 不构成释放 → 保持拦截（FA 键恒
 *     Number，此分支纯防御）；profitPercent 缺失 → fail-open 放行（持仓票
 *     pp 恒有值，防御方向=不锁死卖出）。
 *
 * 与 famous-entry-exit bypass 卖臂（sinceEntryFamousNearLaunchBuyBnb 门）
 * 的关系：互不代位——该腿不带 factorSellFilter 字段即不受本门管辖
 * （famous near_launch 抢筹撤离立法保持原样，两机制按腿 opt-in 各管各的）。
 */

'use strict';

/** famousHold 默认阈值（T137 研究线 180s + T157 D 修释放线 0.4；腿级可覆盖） */
const FACTOR_SELL_FILTER_DEFAULTS = Object.freeze({
    // HOLD 保护域下限：浮盈 ≥100% 才保护（原释放臂 `profitPercent < 100` 放行形状）
    minProfitPct: 100,
    // famous 大买新鲜窗（秒）：sinceLastFamousBigBuySec ≤ 此值=famous 仍在入场
    maxSinceBuySec: 180,
    // famous 卖出释放线（BNB）：60s 窗内 famous 卖出合计 ≥ 此值=撤退信号压倒
    // 买入证据（T157 D 修：0.2→0.4，famous 买卖并存时买优先于卖）
    sellReleaseBnb: 0.4,
});

/**
 * 归一化腿字段 factorSellFilter（loadStrategies throw / validateLegs 400
 * 共用单点；仅卖腿可配的域检查由调用方做）。
 *   输入形状：true（全默认）| false/null（不走）|
 *             { famousHold: true | false | { minProfitPct, maxSinceBuySec, sellReleaseBnb } }
 *   输出：{ normalized } — normalized=null=不走；{ error } — 非法形状/未知键/越界值
 */
function normalizeFactorSellFilter(raw) {
    if (raw == null || raw === false) return { normalized: null };
    if (raw === true) {
        return { normalized: { famousHold: { ...FACTOR_SELL_FILTER_DEFAULTS } } };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter 非法形状 ${JSON.stringify(raw)}（支持 true | false | { famousHold: {...} }）` };
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'famousHold') {
            return { error: `factorSellFilter 未知键 "${k}"（仅支持 famousHold）` };
        }
    }
    const fhRaw = raw.famousHold;
    if (fhRaw == null || fhRaw === false) return { normalized: null }; // 显式关=不走
    if (fhRaw === true) {
        return { normalized: { famousHold: { ...FACTOR_SELL_FILTER_DEFAULTS } } };
    }
    if (typeof fhRaw !== 'object' || Array.isArray(fhRaw)) {
        return { error: `factorSellFilter.famousHold 非法形状 ${JSON.stringify(fhRaw)}（支持 true | false | { ${Object.keys(FACTOR_SELL_FILTER_DEFAULTS).join(', ')} }）` };
    }
    const out = { ...FACTOR_SELL_FILTER_DEFAULTS };
    for (const [k, v] of Object.entries(fhRaw)) {
        if (!(k in FACTOR_SELL_FILTER_DEFAULTS)) {
            return { error: `factorSellFilter.famousHold 未知键 "${k}"（仅支持 ${Object.keys(FACTOR_SELL_FILTER_DEFAULTS).join('/')}）` };
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return { error: `factorSellFilter.famousHold.${k} 非法值 ${JSON.stringify(v)}（须有限数 ≥0）` };
        }
        out[k] = v;
    }
    return { normalized: { famousHold: out } };
}

/**
 * 因子卖出过滤判定（纯函数；fire 时刻因子表直评）。
 *   @param {Object|null} filter — normalizeFactorSellFilter 归一化产物（腿字段）
 *   @param {Object} factors — fire 时刻 FA 因子表（profitPercent/
 *     sinceLastFamousBigBuySec/recentFamousSellBnb 三键消费）
 *   @returns {{blocked:boolean, rule:string|null, info:Object|null}}
 *     blocked=true 时 rule='famous_hold'；info=判据三因子值+阈值快照（日志/审计）
 */
function judgeFactorSellFilter(filter, factors) {
    const fh = filter && filter.famousHold;
    if (!fh) return { blocked: false, rule: null, info: null };
    const pp = factors ? factors.profitPercent : undefined;
    const sinceLast = factors ? factors.sinceLastFamousBigBuySec : undefined;
    const recentSell = factors ? factors.recentFamousSellBnb : undefined;
    const info = {
        profitPercent: pp ?? null,
        sinceLastFamousBigBuySec: sinceLast ?? null,
        recentFamousSellBnb: recentSell ?? null,
        minProfitPct: fh.minProfitPct,
        maxSinceBuySec: fh.maxSinceBuySec,
        sellReleaseBnb: fh.sellReleaseBnb,
    };
    // 放行形状（原释放臂逐条取反，否定形状=null 比较恒假语义自动对齐）：
    // ① pp 缺失（fail-open 防锁死卖出）/ 未达保护域 → 放行
    if (!(typeof pp === 'number' && Number.isFinite(pp) && pp >= fh.minProfitPct)) {
        return { blocked: false, rule: null, info };
    }
    // ② sinceLast null（从未有 famous 大买）/ 超窗 → 放行
    if (!(sinceLast != null && typeof sinceLast === 'number' && Number.isFinite(sinceLast) && sinceLast <= fh.maxSinceBuySec)) {
        return { blocked: false, rule: null, info };
    }
    // ③ famous 撤退达线（≥ sellReleaseBnb）→ 放行；null/非有限数不构成释放（保持拦截）
    if (typeof recentSell === 'number' && Number.isFinite(recentSell) && recentSell >= fh.sellReleaseBnb) {
        return { blocked: false, rule: null, info };
    }
    // 拦截：famous 仍在入场（180s 内 ≥0.1B 大买）且卖出未达释放线（<0.4）∧ pp≥100
    return { blocked: true, rule: 'famous_hold', info };
}

module.exports = {
    FACTOR_SELL_FILTER_DEFAULTS,
    normalizeFactorSellFilter,
    judgeFactorSellFilter,
};
