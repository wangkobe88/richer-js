/**
 * T157 因子卖出过滤门（famous HOLD 迁移案，2026-11-17；T157b 同日全腿化二修）
 *
 * 定位：卖出环节的「基于因子的卖出信号过滤模块」——对标买侧 T143 因子购买前
 * 检查门（FP1）的纯代码因子过滤形态：零 Jev / 零 DB / 零网络，输入=fire 时刻
 * FA 因子表 + 实验级配置 + 触发腿，输出=放行/拦截。挂点=两引擎卖腿评估点
 * （evaluate 返回触发腿后、bypass/去抖分流前）与去抖 fire 重评点——拦截=视同
 * 腿未触发（与原条件串释放臂假=evaluate 不返回该腿 bit 对齐：pending 取消、
 * 放行后重新首真起算）。止损/毕业卖/cheat 清仓/stallClose/手工卖不走策略腿
 * 评估，天然不受本门管辖（与原释放臂管辖范围一致）。
 *
 * T157b 全腿化（用户裁定 2026-11-17）：**所有卖出信号都过本模块**——不再腿级
 * opt-in（factorSellFilter 腿字段已退役，携带即拒启）；famous 阻挡**不针对
 * 所有臂**——「该阻挡的触发条件」以管辖臂清单 arms 配置在模块内（归一化
 * 空白后与触发腿 condition 精确匹配）：命中管辖臂才评估阻挡条件，其余腿
 * （止损/毕业/bypass 保命腿等）恒放行。配置=实验级 fourmemeWs.factorSellFilter
 * 段（flap/gang 经 _mergedWsConfig 同键），缺段/关=零行为。
 *
 * 规则一 famousHold（自 bt-v115~v140 克隆链 5 条 HOLD 释放腿迁移，案源
 * 0x29921a53…7777 bt-v140 复盘）：
 *   管辖（arms 清单匹配触发腿）且：
 *     profitPercent >= minProfitPct(100)
 *     AND sinceLastFamousBigBuySec <= maxSinceBuySec(180)
 *     AND recentFamousSellBnb < sellReleaseBnb(0.4)
 *   → 拦截（拒绝卖出信号）。放行 = 未命中管辖臂 ∨ pp 缺失/未达保护域 ∨
 *   sinceLast null（从未有 famous 大买）/超窗 >180 ∨ recentFamousSellBnb ≥0.4
 *   （famous 撤退信号压倒买入证据）。
 *   D 修改（用户裁定，案源=卖出① 14:12:50 帧 recentSell=0.287）：famous 买卖
 *   并存时「买优先于卖」——释放线 0.2 → 0.4（原 0.2 线下 42s 前 famous 大买
 *   0.1478 的在场证据被 0.287 卖出压倒放行；新线 0.4 下同样帧拦截，卖出顺延
 *   至 famous 出窗/撤退达线/pp 跌破 100）。
 *   null 语义与原条件串 bit 对齐（否定形状实现，null 比较恒假自动对齐）：
 *     recentFamousSellBnb null/非有限数 → 不构成释放 → 保持拦截（FA 键恒
 *     Number，此分支纯防御）；profitPercent 缺失 → fail-open 放行（持仓票
 *     pp 恒有值，防御方向=不锁死卖出）。
 *
 * 拦截留痕（T157b 信号页可观测性）：引擎包装层落 SELL 信号行
 * metadata.execution_status='blocked' + factorSellFilter 判据段（连续拦截
 * per (token,腿) 只落首行）；signals 页蓝紫徽章展示。
 */

'use strict';

/** famousHold 默认阈值（T137 研究线 180s + T157 D 修释放线 0.4；配置可覆盖） */
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
 * 条件文本归一化（管辖臂匹配键）：压空白+trim——`profitPercent >  100` 与
 * `profitPercent > 100` 同键；数值写法（100 vs 100.0）不归一（配置侧自维护）。
 */
function normalizeCondText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * 归一化实验级配置 fourmemeWs.factorSellFilter 段。
 *   形状：{ enabled?: boolean, famousHold?: {
 *            minProfitPct?, maxSinceBuySec?, sellReleaseBnb?,
 *            arms: string[]   // 受 famousHold 阻挡的触发条件清单（非空，归一化空白
 *                             //   后与卖腿 condition 精确匹配）
 *          } }
 *   缺段/undefined → { normalized: null }（机制关，零行为）；显式 {enabled:false}
 *   同 null。arms 表达式语法/因子域校验由引擎加载时 ConditionEvaluator 做
 *   （本模块零依赖纯函数，不引评估器）；此处只做形状/值域。
 *   @returns {{normalized: Object|null, error: string|null}}
 *     normalized={ enabled:true, famousHold:{minProfitPct,maxSinceBuySec,
 *                sellReleaseBnb,arms:[归一化文本...], armsSet:Set} }
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
        return { error: 'factorSellFilter.enabled=true 须配 famousHold 段（含 arms 管辖臂清单）' };
    }
    if (typeof fhRaw !== 'object' || Array.isArray(fhRaw)) {
        return { error: `factorSellFilter.famousHold 必须是对象（minProfitPct/maxSinceBuySec/sellReleaseBnb/arms），实际 ${JSON.stringify(fhRaw)}` };
    }
    const out = { ...FACTOR_SELL_FILTER_DEFAULTS };
    for (const [k, v] of Object.entries(fhRaw)) {
        if (k === 'arms') continue;
        if (!(k in FACTOR_SELL_FILTER_DEFAULTS)) {
            return { error: `factorSellFilter.famousHold 未知键 "${k}"（仅支持 ${Object.keys(FACTOR_SELL_FILTER_DEFAULTS).join('/')}/arms）` };
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return { error: `factorSellFilter.famousHold.${k} 非法值 ${JSON.stringify(v)}（须有限数 ≥0）` };
        }
        out[k] = v;
    }
    const armsRaw = fhRaw.arms;
    if (!Array.isArray(armsRaw) || armsRaw.length === 0) {
        return { error: `factorSellFilter.famousHold.arms 非法值（须非空字符串数组=受 famous 阻挡的触发条件清单；famous 阻挡不针对所有臂，须显式圈定管辖）` };
    }
    const arms = [];
    for (const a of armsRaw) {
        if (typeof a !== 'string' || normalizeCondText(a) === '') {
            return { error: `factorSellFilter.famousHold.arms 含非法条目 ${JSON.stringify(a)}（须非空字符串因子表达式）` };
        }
        if (a.length > 500) {
            return { error: `factorSellFilter.famousHold.arms 条目超长（${a.length} > 500 字符）` };
        }
        arms.push(normalizeCondText(a));
    }
    if (new Set(arms).size !== arms.length) {
        return { error: 'factorSellFilter.famousHold.arms 含重复条目（归一化空白后）' };
    }
    return {
        normalized: {
            enabled: true,
            famousHold: { ...out, arms, armsSet: new Set(arms) },
        },
    };
}

/**
 * 因子卖出过滤判定（纯函数；fire 时刻因子表+触发腿直评，全腿调用）。
 *   @param {Object|null} config — normalizeFactorSellFilterConfig 归一化产物
 *     （引擎 ctor 初始化持有；null/关=恒放行零行为）
 *   @param {Object} strategy — 触发腿（loadStrategies 产物；消费 condition 做
 *     管辖臂匹配——condition 文本不在 arms 清单=该臂不受 famous 阻挡恒放行）
 *   @param {Object} factors — fire 时刻 FA 因子表（profitPercent/
 *     sinceLastFamousBigBuySec/recentFamousSellBnb 三键消费）
 *   @returns {{blocked:boolean, rule:string|null, info:Object|null}}
 *     blocked=true 时 rule='famous_hold'；info=管辖臂+判据三因子值+阈值快照
 */
function judgeFactorSellFilter(config, strategy, factors) {
    const fh = config && config.famousHold;
    if (!fh) return { blocked: false, rule: null, info: null };
    // 管辖臂匹配：触发腿 condition（归一化空白）∈ arms 清单——famous 阻挡只对
    // 圈定的触发条件生效（止盈/回撤类盈利保护臂），其余臂（止损/毕业/bypass
    // 保命腿等）恒放行（T157b：不针对所有臂）
    const condKey = normalizeCondText(strategy && strategy.condition);
    if (!condKey || !fh.armsSet.has(condKey)) {
        return { blocked: false, rule: null, info: { matchedArm: false } };
    }
    const pp = factors ? factors.profitPercent : undefined;
    const sinceLast = factors ? factors.sinceLastFamousBigBuySec : undefined;
    const recentSell = factors ? factors.recentFamousSellBnb : undefined;
    const info = {
        matchedArm: true,
        arm: condKey,
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
    normalizeCondText,
    normalizeFactorSellFilterConfig,
    judgeFactorSellFilter,
};
