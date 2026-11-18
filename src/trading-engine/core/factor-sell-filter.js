/**
 * T157 因子卖出过滤门（famous HOLD 迁移案，2026-11-17；T157b 全腿化→T157c 管辖
 * 门简化同日三修；T183 聪明钱臂+pump 臂管辖扩展 2026-11-18）
 *
 * 定位：卖出环节的「基于因子的卖出信号过滤模块」——对标买侧 T143 因子购买前
 * 检查门（FP1）的纯代码因子过滤形态：零 Jev / 零 DB / 零网络，输入=fire 时刻
 * FA 因子表 + 实验级配置，输出=放行/拦截。挂点=两引擎卖腿评估点（evaluate
 * 返回触发腿后、bypass/去抖分流前）与去抖 fire 重评点——拦截=视同腿未触发（与
 * 原条件串释放臂假=evaluate 不返回该腿 bit 对齐：pending 取消、放行后重新
 * 首真起算）。止损/毕业卖/cheat 清仓/stallClose/手工卖不走策略腿评估，天然
 * 不受本门管辖（与原释放臂管辖范围一致）。
 *
 * T157c 管辖门（用户裁定 2026-11-17）：**所有卖出臂统一过门，管辖判定=
 * `profitPercent >= minProfitPct(100)` 本身**——当前收益 >100% 的卖信号即被
 * famous 卖出门管住，与触发腿条件串里有没有 profitPercent 因子无关；pp<100 的
 * 卖信号（止损/低盈亏减仓等）恒放行。
 *
 * T183 管辖扩展（用户裁定 2026-11-18，案源 bt-v150 0x2f17…7777：P5 泵失衡臂
 * 买入 34s 后 pp=57.5 全清、卖后 +350%）：**pump-imbalance-exit 臂（T113 泵失衡
 * 全清家族）无论 pp 过门**——识别载体=触发腿 condition 引用 `sinceEntryNetBuyRatio`
 * （该家族唯一签名因子键：三防线保证真键；子串匹配抗阈值漂移——v3→v4 改线
 * 不影响识别；T157b 全文匹配退役不复活，此为单键签名非条件文本清单）。语义：
 * 泵失衡臂「他人净买极失衡→顺势兑现」的卖出意志恰与 HOLD 证据同源——famous/
 * 聪明钱还在入场时该臂最不该卖（本案正是聪明钱买 2s 后被全清）。
 *
 * 规则一 famousHold（自 bt-v115~v140 克隆链 5 条 HOLD 释放腿迁移，案源
 * 0x29921a53…7777 bt-v140 复盘）：
 *   拦截（拒绝卖出）= 管辖内 AND sinceLastFamousBigBuySec <= 180
 *                     AND recentFamousSellBnb < 0.4
 *   放行 = sinceLast null（从未有 famous 大买）/超窗 >180
 *          ∨ recentFamousSellBnb >= 0.4（famous 撤退信号压倒买入证据）
 *   D 修改（用户裁定，案源=卖出① 14:12:50 帧 recentSell=0.287）：famous 买卖
 *   并存时「买优先于卖」——释放线 0.2 → 0.4。
 *   null 语义与原条件串 bit 对齐（否定形状实现）：recentFamousSellBnb null/
 *   非有限数 → 不构成释放 → 保持拦截（FA 键恒 Number，纯防御）；profitPercent
 *   缺失 → 非 pump 臂 fail-open 放行（防锁死卖出）/ pump 臂仍管（腿自身触发
 *   已是明确卖出意志，pp 不构成放行条件）。
 *
 * 规则二 smartHold（T183 2026-11-18 用户立法「卖出信号过滤中，除了基于 famous，
 * 也把聪明钱的买入行为放进去，如果聪明钱也在买入，那么挡住卖出」；名单=
 * data/kol-study/smartmoney-accum.json GMGN smartmoney 流 union 累积——signals
 * 页 🧠 标记同源单一真相，FA loadSmartMoneyWallets 装载）：
 *   拦截（拒绝卖出）= 管辖内 AND sinceLastSmartBigBuySec <= 180
 *                     AND recentSmartSellBnb < 0.4
 *   famousHold 逐行镜像（FA 键 sinceLastSmartBigBuySec/recentSmartSellBnb，
 *   T137 双段喂食流同构，大买线 smartBigBuyBnb=0.02 刻意低于 famous 0.1——
 *   GMGN smartmoney 流钱包单笔规模小于 KOL，立法案唯一窗内命中 0.0494）。
 *   null=从未有聪明钱大买/名单未加载（data 文件不在实验机）→ 不命中 fail-open
 *   （不锁死卖出）。双臂同中 famous 优先留痕（rule='famous_hold'，info 带两臂
 *   判据；释放线/窗独立可调）。smartHold.enabled=false 一键回滚 T157 单臂形态。
 *
 * 与 bypass 卖臂的关系（T157c 全臂管辖知情面）：peak-protect 深回撤/famous-
 * entry-exit 等 bypass 腿同样受管（HOLD 证据在场 → 拦截顺延）——「famous/聪明钱
 * 还在入场就不急着卖」的 HOLD 语义一致适用于保命腿；famous-entry-exit 触发域=
 * near_launch (10,40]（价格贴近发行价），与我们 pp≥100（已翻倍）天然近似互斥，
 * 冲突面极小。
 *
 * 拦截留痕（T157b 信号页可观测性）：引擎包装层落 SELL 信号行
 * metadata.execution_status='blocked' + factorSellFilter 判据段（连续拦截
 * per (token,腿) 只落首行）；signals 页蓝紫徽章展示。
 */

'use strict';

/** famousHold/smartHold 默认阈值（T137 研究线 180s + T157 D 修释放线 0.4；配置可覆盖） */
const FACTOR_SELL_FILTER_DEFAULTS = Object.freeze({
    // 管辖门+HOLD 保护域下限：当前浮盈 ≥100% 的卖信号才受 famous/smart 卖出门管
    //（pp<100 恒放行——T157c：管辖判定即本键，不再按腿条件文本圈定；T183 起
    // pump-imbalance 家族腿（condition 引用 sinceEntryNetBuyRatio）无论 pp 过门）
    minProfitPct: 100,
    // famous 大买新鲜窗（秒）：sinceLastFamousBigBuySec ≤ 此值=famous 仍在入场
    maxSinceBuySec: 180,
    // famous 卖出释放线（BNB）：60s 窗内 famous 卖出合计 ≥ 此值=撤退信号压倒
    // 买入证据（T157 D 修：0.2→0.4，famous 买卖并存时买优先于卖）
    sellReleaseBnb: 0.4,
});

/** smartHold 默认阈值（T183：famousHold 同窗同释放线；大买线在 FA smartBigBuyBnb） */
const SMART_HOLD_DEFAULTS = Object.freeze({
    maxSinceBuySec: 180,   // 聪明钱大买新鲜窗（秒）
    sellReleaseBnb: 0.4,   // 聪明钱卖出释放线（BNB，60s 窗——FA smartSellWinMs）
});

/** T183 pump 臂管辖签名键：condition 引用该因子=泵失衡全清家族（T113）腿 */
const PUMP_ARM_SIGNATURE_FACTOR = 'sinceEntryNetBuyRatio';

/**
 * 归一化实验级配置 fourmemeWs.factorSellFilter 段（T157c：famousHold 三键收进
 * 模块，arms 清单整链退役——携带即报错防旧配置静默失效；T183：smartHold 姊妹臂）。
 *   形状：{ enabled: true, famousHold?: {
 *            minProfitPct?, maxSinceBuySec?, sellReleaseBnb? },
 *          smartHold?: { enabled?, maxSinceBuySec?, sellReleaseBnb? } }
 *   缺段/undefined → { normalized: null }（机制关，零行为）；
 *   { enabled: false } 同 null；famousHold/smartHold 可整体省略=全默认
 *   （smartHold.enabled=false=单关聪明钱臂，回滚 T157 形态）。
 *   @returns {{normalized: Object|null, error: string|null}}
 *     normalized={ enabled:true, famousHold:{...三键}, smartHold:{enabled, ...两键} }
 */
function normalizeFactorSellFilterConfig(raw) {
    if (raw == null) return { normalized: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter 必须是对象（键：enabled/famousHold/smartHold），实际 ${JSON.stringify(raw)}` };
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'enabled' && k !== 'famousHold' && k !== 'smartHold') {
            return { error: `factorSellFilter 未知键 "${k}"（仅支持 enabled/famousHold/smartHold）` };
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
        const sh0 = _normalizeSmartHold(raw.smartHold);
        if (sh0.error) return { error: sh0.error };
        return {
            normalized: {
                enabled: true,
                famousHold: { ...FACTOR_SELL_FILTER_DEFAULTS },
                smartHold: sh0.normalized,
            },
        };
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
    const sh = _normalizeSmartHold(raw.smartHold);
    if (sh.error) return { error: sh.error };
    return { normalized: { enabled: true, famousHold: out, smartHold: sh.normalized } };
}

/** smartHold 段归一化（T183）：省略/null=全默认开；{enabled:false}=单关（回滚
 *  T157 单臂形态）；键校验同 famousHold（enabled 除外）。 */
function _normalizeSmartHold(raw) {
    if (raw == null) {
        return { normalized: { enabled: true, ...SMART_HOLD_DEFAULTS } };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter.smartHold 必须是对象（enabled/${Object.keys(SMART_HOLD_DEFAULTS).join('/')}），实际 ${JSON.stringify(raw)}` };
    }
    const out = { enabled: true, ...SMART_HOLD_DEFAULTS };
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'enabled') {
            if (typeof v !== 'boolean') {
                return { error: `factorSellFilter.smartHold.enabled 非法值 ${JSON.stringify(v)}（须 bool）` };
            }
            out.enabled = v;
            continue;
        }
        if (!(k in SMART_HOLD_DEFAULTS)) {
            return { error: `factorSellFilter.smartHold 未知键 "${k}"（仅支持 enabled/${Object.keys(SMART_HOLD_DEFAULTS).join('/')}）` };
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return { error: `factorSellFilter.smartHold.${k} 非法值 ${JSON.stringify(v)}（须有限数 ≥0）` };
        }
        out[k] = v;
    }
    return { normalized: out };
}

/** 数值守卫：有限数且 ≤ 上限（null/undefined/NaN → false） */
function _freshWithin(value, maxSec) {
    return value != null && typeof value === 'number' && Number.isFinite(value) && value <= maxSec;
}

/** 释放守卫：窗内卖出合计达线（null/非有限数不构成释放——保持拦截，FA 键恒 Number 纯防御） */
function _released(recentSell, releaseBnb) {
    return typeof recentSell === 'number' && Number.isFinite(recentSell) && recentSell >= releaseBnb;
}

/**
 * 因子卖出过滤判定（纯函数；fire 时刻因子表直评，**全臂统一调用**——T157c：
 * 管辖判定=minProfitPct 本身 ∨ T183 pump 臂签名；拦截=famousHold ∨ smartHold
 * 任一命中，双中 famous 优先留痕）。
 *   @param {Object|null} config — normalizeFactorSellFilterConfig 归一化产物
 *     （引擎 ctor 初始化持有；null/关=恒放行零行为）
 *   @param {Object} factors — fire 时刻 FA 因子表（profitPercent/
 *     sinceLastFamousBigBuySec/recentFamousSellBnb/sinceLastSmartBigBuySec/
 *     recentSmartSellBnb 消费）
 *   @param {Object|null} [leg] — 触发卖腿对象（T183 管辖扩展：condition 引用
 *     sinceEntryNetBuyRatio=泵失衡家族 → 无论 pp 过门；缺省/null=仅 pp 管辖）
 *   @returns {{blocked:boolean, rule:string|null, info:Object|null}}
 *     blocked=true 时 rule='famous_hold'|'smart_hold'；info=判据因子值+阈值快照
 */
function judgeFactorSellFilter(config, factors, leg) {
    const fh = config && config.famousHold;
    const sh = config && config.smartHold;
    if (!fh) return { blocked: false, rule: null, info: null };
    const pp = factors ? factors.profitPercent : undefined;
    const sinceLast = factors ? factors.sinceLastFamousBigBuySec : undefined;
    const recentSell = factors ? factors.recentFamousSellBnb : undefined;
    const smartSinceLast = factors ? factors.sinceLastSmartBigBuySec : undefined;
    const smartRecentSell = factors ? factors.recentSmartSellBnb : undefined;
    const info = {
        profitPercent: pp ?? null,
        sinceLastFamousBigBuySec: sinceLast ?? null,
        recentFamousSellBnb: recentSell ?? null,
        minProfitPct: fh.minProfitPct,
        maxSinceBuySec: fh.maxSinceBuySec,
        sellReleaseBnb: fh.sellReleaseBnb,
        sinceLastSmartBigBuySec: smartSinceLast ?? null,
        recentSmartSellBnb: smartRecentSell ?? null,
        smartHoldEnabled: !!(sh && sh.enabled),
        smartMaxSinceBuySec: sh ? sh.maxSinceBuySec : null,
        smartSellReleaseBnb: sh ? sh.sellReleaseBnb : null,
        pumpArmJurisdiction: !!(leg && typeof leg.condition === 'string'
            && leg.condition.includes(PUMP_ARM_SIGNATURE_FACTOR)),
    };
    // 管辖判定（T157c + T183 扩展）：
    // ① pp ≥ minProfitPct（一般管辖——pp<100 的卖信号〔止损/低盈亏减仓〕恒放行；
    //    pp 缺失 fail-open 放行防锁死卖出）
    // ② pump 臂签名（T183）：触发腿 condition 引用 sinceEntryNetBuyRatio
    //    （T113 泵失衡全清家族）→ 无论 pp 过门（该臂常在 pp<100 触发=立法案
    //    pp=57.5 被 T157c 缝隙放走的形状；腿自身触发已是明确卖出意志）
    const ppGoverned = typeof pp === 'number' && Number.isFinite(pp) && pp >= fh.minProfitPct;
    if (!ppGoverned && !info.pumpArmJurisdiction) {
        return { blocked: false, rule: null, info };
    }
    // famousHold 命中（原三键去掉 pp 门——管辖已上方判定，逐位同 T157c）：
    // famous 仍在入场（180s 内大买）且卖出未达释放线（<0.4）
    const famousHit = _freshWithin(sinceLast, fh.maxSinceBuySec)
        && !_released(recentSell, fh.sellReleaseBnb);
    // smartHold 命中（T183 镜像）：聪明钱 180s 内大买且 60s 卖出未达释放线
    let smartHit = false;
    if (sh && sh.enabled) {
        smartHit = _freshWithin(smartSinceLast, sh.maxSinceBuySec)
            && !_released(smartRecentSell, sh.sellReleaseBnb);
    }
    if (famousHit) return { blocked: true, rule: 'famous_hold', info };
    if (smartHit) return { blocked: true, rule: 'smart_hold', info };
    // 放行：出窗/撤退达线/两臂均无在场证据（sinceLast null=从未有大买 fail-open）
    return { blocked: false, rule: null, info };
}

module.exports = {
    FACTOR_SELL_FILTER_DEFAULTS,
    SMART_HOLD_DEFAULTS,
    PUMP_ARM_SIGNATURE_FACTOR,
    normalizeFactorSellFilterConfig,
    judgeFactorSellFilter,
};
