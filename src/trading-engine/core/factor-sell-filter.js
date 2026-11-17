/**
 * T157 因子卖出过滤门（famous HOLD 迁移案，2026-11-17；T157b 全腿化→T157c 管辖
 * 门简化同日三修）
 *
 * 定位：卖出环节的「基于因子的卖出信号过滤模块」——对标买侧 T143 因子购买前
 * 检查门（FP1）的纯代码因子过滤形态：零 Jev / 零 DB / 零网络，输入=fire 时刻
 * FA 因子表 + 实验级配置，输出=放行/拦截。挂点=两引擎卖腿评估点（evaluate
 * 返回触发腿后、bypass/去抖分流前）与去抖 fire 重评点——拦截=视同腿未触发（与
 * 原条件串释放臂假=evaluate 不返回该腿 bit 对齐：pending 取消、放行后重新
 * 首真起算）。止损/毕业卖/cheat 清仓/stallClose/手工卖不走策略腿评估，天然
 * 不受本门管辖（与原释放臂管辖范围一致）。
 *
 * T157c 管辖门简化（用户裁定 2026-11-17）：**所有卖出臂统一过门，管辖判定=
 * `profitPercent >= minProfitPct(100)` 本身**——当前收益 >100% 的卖信号即被
 * famous 卖出门管住，与触发腿条件串里有没有 profitPercent 因子无关（T157b 的
 * arms 条件文本清单匹配整链退役——配置漂移失配风险随之消灭）；pp<100 的卖信
 * 号（止损/低盈亏减仓等）恒放行。famousHold 判据三键全部收进模块配置，不再
 * 另置。
 *
 * 规则一 famousHold（自 bt-v115~v140 克隆链 5 条 HOLD 释放腿迁移，案源
 * 0x29921a53…7777 bt-v140 复盘）：
 *   拦截（拒绝卖出）= profitPercent >= 100
 *                     AND sinceLastFamousBigBuySec <= 180
 *                     AND recentFamousSellBnb < 0.4
 *   放行 = pp 缺失/未达 100 ∨ sinceLast null（从未有 famous 大买）/超窗 >180
 *          ∨ recentFamousSellBnb >= 0.4（famous 撤退信号压倒买入证据）
 *   D 修改（用户裁定，案源=卖出① 14:12:50 帧 recentSell=0.287）：famous 买卖
 *   并存时「买优先于卖」——释放线 0.2 → 0.4。
 *   null 语义与原条件串 bit 对齐（否定形状实现）：recentFamousSellBnb null/
 *   非有限数 → 不构成释放 → 保持拦截（FA 键恒 Number，纯防御）；profitPercent
 *   缺失 → fail-open 放行（防锁死卖出）。
 *
 * 与 bypass 卖臂的关系（T157c 全臂管辖知情面）：peak-protect 深回撤/famous-
 * entry-exit 等 bypass 腿同样受管（pp≥100 ∧ famous 180s 内大买 ∧ 卖出未达线
 * → 拦截顺延）——「famous 还在入场就不急着卖」的 HOLD 语义一致适用于保命腿；
 * famous-entry-exit 触发域=near_launch (10,40]（价格贴近发行价），与我们
 * pp≥100（已翻倍）天然近似互斥，冲突面极小。
 *
 * 拦截留痕（T157b 信号页可观测性）：引擎包装层落 SELL 信号行
 * metadata.execution_status='blocked' + factorSellFilter 判据段（连续拦截
 * per (token,腿) 只落首行）；signals 页蓝紫徽章展示。
 */

'use strict';

/** famousHold 默认阈值（T137 研究线 180s + T157 D 修释放线 0.4；配置可覆盖） */
const FACTOR_SELL_FILTER_DEFAULTS = Object.freeze({
    // 管辖门+HOLD 保护域下限：当前浮盈 ≥100% 的卖信号才受 famous 卖出门管
    //（pp<100 恒放行——T157c：管辖判定即本键，不再按腿条件文本圈定）
    minProfitPct: 100,
    // famous 大买新鲜窗（秒）：sinceLastFamousBigBuySec ≤ 此值=famous 仍在入场
    maxSinceBuySec: 180,
    // famous 卖出释放线（BNB）：60s 窗内 famous 卖出合计 ≥ 此值=撤退信号压倒
    // 买入证据（T157 D 修：0.2→0.4，famous 买卖并存时买优先于卖）
    sellReleaseBnb: 0.4,
});

/**
 * 归一化实验级配置 fourmemeWs.factorSellFilter 段（T157c：famousHold 三键收进
 * 模块，arms 清单整链退役——携带即报错防旧配置静默失效）。
 *   形状：{ enabled: true, famousHold?: {
 *            minProfitPct?, maxSinceBuySec?, sellReleaseBnb? } }
 *   缺段/undefined → { normalized: null }（机制关，零行为）；
 *   { enabled: false } 同 null；famousHold 可整体省略=全默认。
 *   @returns {{normalized: Object|null, error: string|null}}
 *     normalized={ enabled:true, famousHold:{...三键} }
 */
function normalizeFactorSellFilterConfig(raw) {
    if (raw == null) return { normalized: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter 必须是对象（键：enabled/famousHold），实际 ${JSON.stringify(raw)}` };
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'enabled' && k !== 'famousHold') {
            return { error: `factorSellFilter 未知键 "${k}"（仅支持 enabled/famousHold）` };
        }
    }
    if (raw.enabled === undefined || raw.enabled === null) {
        return { error: 'factorSellFilter.enabled 缺失（显式 true 开启；删整段=关）' };
    }
    if (typeof raw.enabled !== 'boolean') {
        return { error: `factorSellFilter.enabled 非法值 ${JSON.stringify(raw.enabled)}（须 bool）` };
    }
    if (raw.enabled === false) return { normalized: null };
    const fhRaw = raw.famousHold;
    if (fhRaw == null) {
        // famousHold 整体省略=全默认（管辖门 pp≥100 本身就是 famousHold 的 minProfitPct）
        return { normalized: { enabled: true, famousHold: { ...FACTOR_SELL_FILTER_DEFAULTS } } };
    }
    if (typeof fhRaw !== 'object' || Array.isArray(fhRaw)) {
        return { error: `factorSellFilter.famousHold 必须是对象（${Object.keys(FACTOR_SELL_FILTER_DEFAULTS).join('/')}），实际 ${JSON.stringify(fhRaw)}` };
    }
    if ('arms' in fhRaw) {
        return { error: 'factorSellFilter.famousHold.arms 已退役（T157c 管辖门简化：所有卖出臂统一过门，管辖判定=profitPercent ≥ minProfitPct 本身，不再按腿条件文本圈定）——请删除 arms 键' };
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
    return { normalized: { enabled: true, famousHold: out } };
}

/**
 * 因子卖出过滤判定（纯函数；fire 时刻因子表直评，**全臂统一调用**——T157c：
 * 管辖判定=minProfitPct 本身，不再按触发腿条件匹配）。
 *   @param {Object|null} config — normalizeFactorSellFilterConfig 归一化产物
 *     （引擎 ctor 初始化持有；null/关=恒放行零行为）
 *   @param {Object} factors — fire 时刻 FA 因子表（profitPercent/
 *     sinceLastFamousBigBuySec/recentFamousSellBnb 三键消费）
 *   @returns {{blocked:boolean, rule:string|null, info:Object|null}}
 *     blocked=true 时 rule='famous_hold'；info=判据三因子值+阈值快照
 */
function judgeFactorSellFilter(config, factors) {
    const fh = config && config.famousHold;
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
    // ① pp 缺失（fail-open 防锁死卖出）/ 未达管辖门（<100 的卖信号不管——
    //    止损/低盈亏减仓等恒放行）→ 放行
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
    normalizeFactorSellFilterConfig,
    judgeFactorSellFilter,
};
