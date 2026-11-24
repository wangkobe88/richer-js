/**
 * T157 因子卖出过滤门（famous HOLD 迁移案，2026-11-17；T157b 全腿化→T157c 管辖
 * 门简化同日三修；T183 聪明钱臂+pump 臂管辖扩展 2026-11-18；T185 低位回涨臂
 * recoveryHold 同日）
 *
 * 定位：卖出环节的「基于因子的卖出信号过滤模块」——对标买侧 T143 因子购买前
 * 检查门（FP1）的纯代码因子过滤形态：零 Jev / 零 DB / 零网络，输入=fire 时刻
 * FA 因子表 + 实验级配置，输出=放行/拦截。挂点=两引擎卖腿评估点（evaluate
 * 返回触发腿后、bypass/去抖分流前）与去抖 fire 重评点——拦截=视同腿未触发（与
 * 原条件串释放臂假=evaluate 不返回该腿 bit 对齐：pending 取消、放行后重新
 * 首真起算）。止损/毕业卖/cheat 清仓/stallClose/手工卖不走策略腿评估，天然
 * 不受本门管辖（与原释放臂管辖范围一致）。
 *
 * T157c 管辖门（用户裁定 2026-11-17；T211 2026-11-22 管辖线 100→50）：**所有
 * 卖出臂统一过门，管辖判定=`profitPercent >= minProfitPct(50)` 本身**——当前
 * 收益 ≥50% 的卖信号即被 famous/smart 卖出门管住，与触发腿条件串里有没有
 * profitPercent 因子无关；pp<50 的卖信号（止损/低盈亏减仓等）恒放行。
 *
 * T211 管辖线 100→50（2026-11-22 用户立法「将触发 famous/聪明钱阻挡的 pp 改为
 * 50」，案源 bt-v179 0x4509…7777 金狗复盘：15:09:02 P10 卖出 pp=92.8 差 7.2
 * 点在管辖门外，smart 0x2c26f58b 1s 前大买 0.3292B 照卖；15:08:15 pp=77.3、
 * smart 23s 前大买 0.0988B 同形状）——famous/smart 两臂共用的 minProfitPct
 * 缺省 100→50（famous 自 T157、smart 自 T183 均继承 100 线，本案一并放低）；
 * pump 臂签名管辖（无论 pp）与 recoveryHold 独立管辖（peak≥80）不受影响；
 * 止损域 pp<50 恒放行不变；释放线/新鲜窗（0.4/180s）不动。
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
 * 规则三 recoveryHold（T185 2026-11-18 用户立法，案源 bt-v153 0x89aa…7777：
 * 峰 +118% 后 4s 闪砸 -44%，bypass 卖在半山腰 +20%，18.5s 后 V 反 +211%——
 * 用户裁定「debounce 确认后，如果是暴跌后价格低（买入价格区间，或者略高）且
 * 正在回涨（也就是说这是我们的买入策略要买的点位），就拒绝卖出」）：
 *   拦截（拒绝卖出）= **独立管辖**：peakProfitPct ≥ minPeakProfitPct(80)
 *                     （高浮盈武装在场=「暴跌后」操作化，peak-protect-exit 同线）
 *                     AND currentVsLaunchPct ≤ maxLaunchPct(40)
 *                     （买入区间 28.5 或略高=near_launch 上界，含破发）
 *                     AND chg5Pct > minChg5Pct(0)（FA T185 短窗动量「正在回涨」）
 *   独立于 pp/pump 管辖的原因：深回撤卖出的 pp 常 <100（立法案 +20）——挂 T157c
 *   pp 管辖下本臂永远不生效；peak 武装门本身即「曾高浮盈现深跌」的场景圈定。
 *   null 语义 fail-open 放行（照卖）：peak/curVs/chg5 任一缺席不拦（低位回涨
 *   证据不全宁卖不冒充「买点」，与 T157 不锁死卖出同向）。
 *   recoveryHold.enabled=false 一键回滚 T183 形态；chg10Pct/chg30Pct 纯观察
 *   落 metadata（阈值待触发分布裁定）。
 *
 * 规则四 pumpArmHold（T186 2026-11-18 用户裁定「这一臂卖出默认过滤掉，等我找到
 * 应该卖出的作弊票再提供过来构建信号通过的策略，没有的话这一臂就相当于废了」）：
 *   拦截（拒绝卖出）= pump 臂签名管辖（condition 引用 sinceEntryNetBuyRatio）
 *                     → **默认全部拦截**，无需 famous/smart HOLD 证据
 *   立法依据：d345 六笔+bt-v150 同窗九笔 P5 触发全部 pp<100 且卖后 15min 峰全正
 *   （+7%~+479%）=当前触发面 100% 误伤；T168 复盘十一实验 5 次触发 4/5 卖早
 *   0/5 避险（v70 时代机器推盘对象已被买侧门链前置拦截，触发面变质为健康票
 *   首波拉升）。放行判据（真作弊票「应该卖出」的信号特征）待案例立法后扩键。
 *   pumpArmHold.enabled=false 一键回滚 T183 形态（pump 臂仅 HOLD 证据才拦）。
 *
 * 与 bypass 卖臂的关系（T157c 全臂管辖知情面）：peak-protect 深回撤/famous-
 * entry-exit 等 bypass 腿同样受管（HOLD 证据在场 → 拦截顺延）——「famous/聪明钱
 * 还在入场就不急着卖」的 HOLD 语义一致适用于保命腿；famous-entry-exit 触发域=
 * near_launch (10,40]（价格贴近发行价），与我们 pp≥50（T211 起管辖线；获利已
 * 厚）近似互斥（pp 锚=本仓买价≠发行价锚，低开票可同低），冲突面小。
 *
 * 拦截留痕（T157b 信号页可观测性）：引擎包装层落 SELL 信号行
 * metadata.execution_status='blocked' + factorSellFilter 判据段（连续拦截
 * per (token,腿) 只落首行）；signals 页蓝紫徽章展示。
 */

'use strict';

// T232 stall 断流卖腿签名（recoveryHold 对 stall 腿放行——见 judge 内注释）
const { STALL_SIGNATURE_FACTOR } = require('./stall-sell-leg');

/** famousHold/smartHold 默认阈值（T137 研究线 180s + T157 D 修释放线 0.4；T211
 * 管辖线 100→50（2026-11-22，案源 bt-v179 0x4509…7777 pp=92.8 smart 1s 前大买
 * 0.33B 照卖——差 7.2 点被 T157c 100 线放走）；配置可覆盖） */
const FACTOR_SELL_FILTER_DEFAULTS = Object.freeze({
    // 管辖门+HOLD 保护域下限：当前浮盈 ≥50% 的卖信号才受 famous/smart 卖出门管
    //（pp<50 恒放行——T157c：管辖判定即本键，不再按腿条件文本圈定；T183 起
    // pump-imbalance 家族腿（condition 引用 sinceEntryNetBuyRatio）无论 pp 过门）
    minProfitPct: 50,
    // T219（2026-11-23 用户裁定「基于聪明钱/famous 卖出阻挡，扩展到 almost
    // launch 价格往上的所有情况」）：管辖第二把尺——curVs ≥ 此值即受门管
    //（不管 pp）；curVs null/未见可靠价=不管辖 fail-open 照卖
    almostLaunchPct: 10,
    // T219 用户裁定「除非它们在低价买入，需要卖出离场」：famous 低价建仓
    //（near_launch 域买入 ≥ 此 BNB）且已开始卖（>0）→ famousHold 放行
    //（它们止盈离场=我们跟着走，不挡）；0 显式关豁免
    cheapExitBuyBnb: 0.2,
    // famous 大买新鲜窗（秒）：sinceLastFamousBigBuySec ≤ 此值=famous 仍在入场
    maxSinceBuySec: 180,
    // famous 卖出释放线（BNB）：60s 窗内 famous 卖出合计 ≥ 此值=撤退信号压倒
    // 买入证据（T157 D 修：0.2→0.4，famous 买卖并存时买优先于卖）
    sellReleaseBnb: 0.4,
    // T227d 状态窗释放窗（秒）：距最近**任意金额** famous 买入超过此值=近期无新
    // 入场 → 状态臂释放放行卖出；0=显式关状态臂。用户裁定「止盈也很常见……只要
    // 有新入场的即可」——卖出金额（0.4 线）在状态臂中退役，释放唯一判据=本窗出
    //（缺省 180 与时间窗臂同窗；개구리씨 案 03:45:18 卖 0.48 后 03:48:03 买 0.132
    // 回归续命，吃到 03:49 主升 +116.5% vs 挂起形状 +34.7）
    releaseNoBuySec: 180,
});

/** smartHold 默认阈值（T183：famousHold 同窗同释放线；大买线在 FA smartBigBuyBnb。
 *  T228（2026-11-24）状态臂：famousHold T227d 逐行镜像——smart 仍持仓 ∧ 180s 内
 *  任意金额新入场 → HOLD 不限时且压制 0.4 撤退线；releaseNoBuySec=0 显式关。 */
const SMART_HOLD_DEFAULTS = Object.freeze({
    maxSinceBuySec: 180,   // 聪明钱大买新鲜窗（秒）
    sellReleaseBnb: 0.4,   // 聪明钱卖出释放线（BNB，60s 窗——FA smartSellWinMs）
    releaseNoBuySec: 180,  // T228 状态臂释放窗（秒）：距最近任意 smart 买入超此值=无新入场 → 释放
});

/** machineHold 默认阈值（T228k 2026-11-24 流轴探针立法：机器钱包在回调中净吸筹
 *  ≥0.2B〔180s 窗〕∧ chg30≤0 → HOLD——用户观察「机器钱包很活跃」+法医 쿠우타
 *  选择性吸筹+活跃度匹配对照通过；minNetBuyBnb 可覆盖、enabled:false 单关。 */
const MACHINE_HOLD_DEFAULTS = Object.freeze({
    minNetBuyBnb: 0.2,   // 180s 机器净买下限（BNB，≥0.2 桶 +104.5%/回调版 +158.5% 探针线）
    maxChg30Pct: 0,      // chg30 上限（≤0=回调/横盘中接货；>0=追高放行——探针交叉控）
});

/** recoveryHold 默认阈值（T185 2026-11-18，案源 bt-v153 0x89aa…7777：4s 闪砸 -44%
 * 后 V 反 +211% 被 bypass 卖在半山腰——用户裁定「debounce 确认后，如果是暴跌后
 * 价格低（买入价格区间，或者略高）且正在回涨（=我们的买入策略要买的点位），就
 * 拒绝卖出」）。三腿联立才拦：高浮盈武装在场 ∧ 现价已回低位 ∧ 5s 动量回涨。 */
const RECOVERY_HOLD_DEFAULTS = Object.freeze({
    // 高浮盈武装门（管辖线）：持仓期峰值浮盈 ≥80% 才受本臂管（与 peak-protect-exit
    // 武装门同线——「暴跌后」的操作化=曾高浮盈现回落；<80 的常态回撤卖出不受管）
    minPeakProfitPct: 80,
    // 低位门：现价较发行锚 ≤+40%（买入价格区间=28.5 门 +「略高」=near_launch 上界
    // 40 同线；含破发）——「这是我们的买入策略要买的点位」的位置腿
    maxLaunchPct: 40,
    // 回涨门：chg5Pct > 此值（FA T185 短窗动量，可靠价链 5s 窗）——「正在回涨」
    // 的动量腿；0=任何正动量（阈值待触发分布裁定，观察键 chg10Pct/chg30Pct 落档）
    minChg5Pct: 0,
});

/** T183 pump 臂管辖签名键：condition 引用该因子=泵失衡全清家族（T113）腿 */
const PUMP_ARM_SIGNATURE_FACTOR = 'sinceEntryNetBuyRatio';

/**
 * T183a 腿条件原文读取（2026-11-18 d345 熊二/狸花猫漏拦案）：引擎 StrategyEngine
 * loadStrategies 构建的腿对象 condition 字段是 parseCondition() 的 **AST 对象**
 * （非字符串）——T183 首版 `typeof leg.condition === 'string'` 在引擎实跑中恒
 * false → pump 臂签名管辖（pp<100 域）从未生效（d345 六笔 P5 全漏；pp≥100 域
 * 走 pp 管辖不受影响）。修复=loadStrategies 腿对象保留原始条件串 conditionText，
 * 本函数双形状兼容：字符串腿（手构/重放）读 condition，AST 腿读 conditionText。
 */
function legConditionText(leg) {
    if (leg == null) return null;
    if (typeof leg.condition === 'string') return leg.condition;
    if (typeof leg.conditionText === 'string') return leg.conditionText;
    return null;
}

/**
 * 归一化实验级配置 fourmemeWs.factorSellFilter 段（T157c：famousHold 三键收进
 * 模块，arms 清单整链退役——携带即报错防旧配置静默失效；T183：smartHold 姊妹臂；
 * T185：recoveryHold 低位回涨臂）。
 *   形状：{ enabled: true, famousHold?: {
 *            minProfitPct?, maxSinceBuySec?, sellReleaseBnb? },
 *          smartHold?: { enabled?, maxSinceBuySec?, sellReleaseBnb? },
 *          recoveryHold?: { enabled?, minPeakProfitPct?, maxLaunchPct?, minChg5Pct? } }
 *   缺段/undefined → { normalized: null }（机制关，零行为）；
 *   { enabled: false } 同 null；famousHold/smartHold/recoveryHold 可整体省略=
 *   全默认（smartHold.enabled=false=单关聪明钱臂，回滚 T157 形态；
 *   recoveryHold.enabled=false=单关低位回涨臂，回滚 T183 形态）。
 *   @returns {{normalized: Object|null, error: string|null}}
 *     normalized={ enabled:true, famousHold:{...三键},
 *                  smartHold:{enabled, ...两键}, recoveryHold:{enabled, ...三键} }
 */
function normalizeFactorSellFilterConfig(raw) {
    if (raw == null) return { normalized: null };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter 必须是对象（键：enabled/famousHold/smartHold/recoveryHold/pumpArmHold），实际 ${JSON.stringify(raw)}` };
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'enabled' && k !== 'famousHold' && k !== 'smartHold' && k !== 'recoveryHold' && k !== 'pumpArmHold' && k !== 'machineHold') {
            return { error: `factorSellFilter 未知键 "${k}"（仅支持 enabled/famousHold/smartHold/recoveryHold/pumpArmHold/machineHold）` };
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
        // famousHold 整体省略=全默认（管辖门 pp≥50〔T211〕本身就是 famousHold 的 minProfitPct）
        const sh0 = _normalizeSmartHold(raw.smartHold);
        if (sh0.error) return { error: sh0.error };
        const rh0 = _normalizeRecoveryHold(raw.recoveryHold);
        if (rh0.error) return { error: rh0.error };
        const pa0 = _normalizePumpArmHold(raw.pumpArmHold);
        if (pa0.error) return { error: pa0.error };
        const mh0 = _normalizeMachineHold(raw.machineHold);
        if (mh0.error) return { error: mh0.error };
        return {
            normalized: {
                enabled: true,
                famousHold: { ...FACTOR_SELL_FILTER_DEFAULTS },
                smartHold: sh0.normalized,
                recoveryHold: rh0.normalized,
                pumpArmHold: pa0.normalized,
                machineHold: mh0.normalized,
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
    const rh = _normalizeRecoveryHold(raw.recoveryHold);
    if (rh.error) return { error: rh.error };
    const pa = _normalizePumpArmHold(raw.pumpArmHold);
    if (pa.error) return { error: pa.error };
    const mh = _normalizeMachineHold(raw.machineHold);
    if (mh.error) return { error: mh.error };
    return { normalized: { enabled: true, famousHold: out, smartHold: sh.normalized, recoveryHold: rh.normalized, pumpArmHold: pa.normalized, machineHold: mh.normalized } };
}

/** pumpArmHold 段归一化（T186）：省略/null=默认开（用户裁定「这一臂卖出默认过滤掉」）；
 *  {enabled:false}=回滚 T183 形态（pump 臂仅 famous/smart HOLD 证据才拦）；仅 enabled 一键。 */
function _normalizePumpArmHold(raw) {
    if (raw == null) return { normalized: { enabled: true } };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter.pumpArmHold 必须是对象（enabled），实际 ${JSON.stringify(raw)}` };
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'enabled') {
            return { error: `factorSellFilter.pumpArmHold 未知键 "${k}"（仅支持 enabled——放行判据待真作弊票案例立法后再扩键）` };
        }
    }
    if (typeof raw.enabled !== 'boolean') {
        return { error: `factorSellFilter.pumpArmHold.enabled 非法值 ${JSON.stringify(raw.enabled)}（须 bool）` };
    }
    return { normalized: { enabled: raw.enabled } };
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

/** machineHold 段归一化（T228k）：省略/null=全默认开；{enabled:false}=单关；
 *  键校验同 smartHold（minNetBuyBnb ≥0；maxChg30Pct 任意有限数——可为负）。 */
function _normalizeMachineHold(raw) {
    if (raw == null) {
        return { normalized: { enabled: true, ...MACHINE_HOLD_DEFAULTS } };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter.machineHold 必须是对象（enabled/${Object.keys(MACHINE_HOLD_DEFAULTS).join('/')}），实际 ${JSON.stringify(raw)}` };
    }
    const out = { enabled: true, ...MACHINE_HOLD_DEFAULTS };
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'enabled') {
            if (typeof v !== 'boolean') {
                return { error: `factorSellFilter.machineHold.enabled 非法值 ${JSON.stringify(v)}（须 bool）` };
            }
            out.enabled = v;
            continue;
        }
        if (!(k in MACHINE_HOLD_DEFAULTS)) {
            return { error: `factorSellFilter.machineHold 未知键 "${k}"（仅支持 enabled/${Object.keys(MACHINE_HOLD_DEFAULTS).join('/')}）` };
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            return { error: `factorSellFilter.machineHold.${k} 非法值 ${JSON.stringify(v)}（须有限数）` };
        }
        out[k] = v;
    }
    return { normalized: out };
}

/** recoveryHold 段归一化（T185）：省略/null=全默认开；{enabled:false}=单关（回滚
 *  T183 形态）；键校验同 smartHold（enabled 除外，minChg5Pct 允许负值——回涨门
 *  阈值可调负=「跌幅收窄也算回涨」的宽松档留给分布裁定后调参）。 */
function _normalizeRecoveryHold(raw) {
    if (raw == null) {
        return { normalized: { enabled: true, ...RECOVERY_HOLD_DEFAULTS } };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `factorSellFilter.recoveryHold 必须是对象（enabled/${Object.keys(RECOVERY_HOLD_DEFAULTS).join('/')}），实际 ${JSON.stringify(raw)}` };
    }
    const out = { enabled: true, ...RECOVERY_HOLD_DEFAULTS };
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'enabled') {
            if (typeof v !== 'boolean') {
                return { error: `factorSellFilter.recoveryHold.enabled 非法值 ${JSON.stringify(v)}（须 bool）` };
            }
            out.enabled = v;
            continue;
        }
        if (!(k in RECOVERY_HOLD_DEFAULTS)) {
            return { error: `factorSellFilter.recoveryHold 未知键 "${k}"（仅支持 enabled/${Object.keys(RECOVERY_HOLD_DEFAULTS).join('/')}）` };
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            return { error: `factorSellFilter.recoveryHold.${k} 非法值 ${JSON.stringify(v)}（须有限数）` };
        }
        if (k !== 'minChg5Pct' && v < 0) {
            return { error: `factorSellFilter.recoveryHold.${k} 非法值 ${JSON.stringify(v)}（须 ≥0）` };
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
    const rh = config && config.recoveryHold;
    const ph = config && config.pumpArmHold;
    const mh = config && config.machineHold;
    if (!fh) return { blocked: false, rule: null, info: null };
    const pp = factors ? factors.profitPercent : undefined;
    const sinceLast = factors ? factors.sinceLastFamousBigBuySec : undefined;
    const recentSell = factors ? factors.recentFamousSellBnb : undefined;
    const smartSinceLast = factors ? factors.sinceLastSmartBigBuySec : undefined;
    const smartRecentSell = factors ? factors.recentSmartSellBnb : undefined;
    const peakPct = factors ? factors.peakProfitPct : undefined;
    const curVsLaunch = factors ? factors.currentVsLaunchPct : undefined;
    const chg5 = factors ? factors.chg5Pct : undefined;
    const chg30 = factors ? factors.chg30Pct : undefined;
    const machNet = factors ? factors.machineNetBuy180 : undefined;
    const nearBuy = factors ? factors.sinceEntryFamousNearLaunchBuyBnb : undefined;
    const info = {
        profitPercent: pp ?? null,
        sinceLastFamousBigBuySec: sinceLast ?? null,
        recentFamousSellBnb: recentSell ?? null,
        minProfitPct: fh.minProfitPct,
        almostLaunchPct: fh.almostLaunchPct,
        cheapExitBuyBnb: fh.cheapExitBuyBnb,
        sinceEntryFamousNearLaunchBuyBnb: nearBuy ?? null,
        maxSinceBuySec: fh.maxSinceBuySec,
        sellReleaseBnb: fh.sellReleaseBnb,
        sinceLastSmartBigBuySec: smartSinceLast ?? null,
        recentSmartSellBnb: smartRecentSell ?? null,
        smartHoldEnabled: !!(sh && sh.enabled),
        smartMaxSinceBuySec: sh ? sh.maxSinceBuySec : null,
        smartSellReleaseBnb: sh ? sh.sellReleaseBnb : null,
        pumpArmJurisdiction: (() => {
            // T183a：引擎腿 condition=AST（非字符串），签名匹配读 conditionText 双形状兼容
            const condText = legConditionText(leg);
            return !!(condText && condText.includes(PUMP_ARM_SIGNATURE_FACTOR));
        })(),
        // T232 stall 断流卖腿签名（recoveryHold 对 stall 腿放行——冻结形状永久拦截
        // 风险；与 pump 签名互斥：sinceEntryNetBuyRatio 与 idleSec 条件文本无交集）
        stallArmJurisdiction: (() => {
            const condText = legConditionText(leg);
            return !!(condText && condText.includes(STALL_SIGNATURE_FACTOR));
        })(),
        // T185 recoveryHold 判据段（独立管辖：peak≥80 武装在场——不依赖 pp/pump
        // 管辖，深回撤卖出的 pp 常 <100〔立法案 +20〕，挂 pp 管辖下永远不生效）
        recoveryHoldEnabled: !!(rh && rh.enabled),
        peakProfitPct: peakPct ?? null,
        currentVsLaunchPct: curVsLaunch ?? null,
        chg5Pct: chg5 ?? null,
        recoveryMinPeakProfitPct: rh ? rh.minPeakProfitPct : null,
        recoveryMaxLaunchPct: rh ? rh.maxLaunchPct : null,
        recoveryMinChg5Pct: rh ? rh.minChg5Pct : null,
        pumpArmHoldEnabled: !!(ph && ph.enabled),
        // T228k machineHold 判据段（机器回调吸筹 hold——零 Jev 零网络，流轴探针立法）
        machineHoldEnabled: !!(mh && mh.enabled),
        machineNetBuy180: machNet ?? null,
        chg30Pct: chg30 ?? null,
        machineMinNetBuyBnb: mh ? mh.minNetBuyBnb : null,
        machineMaxChg30Pct: mh ? mh.maxChg30Pct : null,
    };
    // T185 recoveryHold 命中（**独立管辖**：peakProfitPct ≥ minPeakProfitPct 本身
    // 即管辖——与 T157c「管辖判定=pp 本身」同构但换锚到峰值武装门）：
    // 深跌后价格已回低位（curVs ≤ maxLaunchPct=买入区间或略高）∧ 5s 动量回涨
    // （chg5 > minChg5Pct）=「这是我们的买入策略要买的点位」→ 拒绝卖出。
    // null 语义（fail-open 放行=照卖，与 T157 同向不锁死卖出）：peak null（无仓
    // /无峰）、curVs null（未见可靠价/锚缺失）、chg5 null（未见可靠价）任一
    // 缺席不拦——低位回涨证据不全宁卖不冒充「买点」
    let recoveryHit = false;
    if (rh && rh.enabled && !info.stallArmJurisdiction) {
        // T232：stall 断流卖腿不享 recoveryHold 拦截——recoveryHold 三键
        // （peakProfitPct/currentVsLaunchPct/chg5Pct）全价格系，断流期冻结：末 tick
        // 若恰处「峰≥80 ∧ 低位 ∧ 回涨」形状会**永久**拦截 stall 卖腿（流动性死亡≠
        // 「买点」，T185 语义前提=活跃市场）。famous/smart/machine 臂时间键随 now
        // 走钟自然衰减（≤180s 后放行），照常拦。
        recoveryHit = typeof peakPct === 'number' && Number.isFinite(peakPct) && peakPct >= rh.minPeakProfitPct
            && typeof curVsLaunch === 'number' && Number.isFinite(curVsLaunch) && curVsLaunch <= rh.maxLaunchPct
            && typeof chg5 === 'number' && Number.isFinite(chg5) && chg5 > rh.minChg5Pct;
    }
    // 管辖判定（T157c + T183 扩展）：
    // ① pp ≥ minProfitPct（一般管辖——pp<50 的卖信号〔止损/低盈亏减仓〕恒放行；
    //    pp 缺失 fail-open 放行防锁死卖出）
    // ② pump 臂签名（T183）：触发腿 condition 引用 sinceEntryNetBuyRatio
    //    （T113 泵失衡全清家族）→ 无论 pp 过门（该臂常在 pp<100 触发=立法案
    //    pp=57.5 被 T157c 缝隙放走的形状；腿自身触发已是明确卖出意志）
    const ppGoverned = typeof pp === 'number' && Number.isFinite(pp) && pp >= fh.minProfitPct;
    // T219 管辖第二把尺：curVs ≥ almostLaunchPct（almost launch 往上全域）——
    // 「价格已经拉起来了，卖出必须过 famous/smart 阻挡」；null fail-open 不管辖
    const curVsGoverned = typeof curVsLaunch === 'number' && Number.isFinite(curVsLaunch)
        && curVsLaunch >= fh.almostLaunchPct;
    if (!ppGoverned && !info.pumpArmJurisdiction && !curVsGoverned) {
        if (recoveryHit) return { blocked: true, rule: 'recovery_hold', info };
        return { blocked: false, rule: null, info };
    }
    // T186 pumpArmHold（2026-11-18 用户裁定「这一臂卖出默认过滤掉」）：泵失衡家族腿
    //（condition 引用 sinceEntryNetBuyRatio）**默认拦截**——d345 六笔+bt-v150 同窗
    // 九笔 P5 全部 pp<100 且卖后 15min 峰全正（+7%~+479%），T168 复盘「触发面变质
    // 为健康票首波拉升」（11 实验 5 次触发 4/5 卖早 0/5 避险）——臂本意的机器推盘
    // 对象已被买侧门链前置拦截，当前触发面=纯误伤。放行判据（真作弊票案例的
    // 「应该卖出」信号）待用户提供案例后立法；enabled:false 一键回滚 T183 形态
    //（pump 臂仅 famous/smart HOLD 证据才拦）。留痕 rule='pump_arm_hold'（臂级
    // 默认拦截=主因，优先于 famous/smart 证据型留痕）。
    if (info.pumpArmJurisdiction && ph && ph.enabled) {
        return { blocked: true, rule: 'pump_arm_hold', info };
    }
    // famousHold 命中（原三键去掉 pp 门——管辖已上方判定，逐位同 T157c）：
    // famous 仍在入场（180s 内大买）且卖出未达释放线（<0.4）
    // T219 低价建仓止盈豁免：famous 在 near_launch 低价建仓（≥cheapExitBuyBnb）
    // 且已开始卖（>0）→ 它们止盈离场=我们跟着走，famousHold 不拦
    //（键缺失/0 线显式关 → 豁免失效照原判）
    const famousCheapExit = fh.cheapExitBuyBnb > 0
        && typeof nearBuy === 'number' && Number.isFinite(nearBuy) && nearBuy >= fh.cheapExitBuyBnb
        && typeof recentSell === 'number' && Number.isFinite(recentSell) && recentSell > 0;
    // T227d 状态窗臂（用户裁定「止盈也很常见……只要有新入场的即可」）：famous
    // 仍持仓（famousCopyWalletCircPct > 0）∧ 近期有新入场（sinceLastFamousAnyBuySec
    // ≤ releaseNoBuySec——任意金额买，卖出金额不构成释放）→ 同拦不限 180s 时间窗。
    // null/0 语义全部 fail-open：circPct/anyBuySec 缺席（旧 FA）不拦；
    // releaseNoBuySec=0 显式关。cheapExit 豁免同判（低价建仓止盈照走）。
    const famousCirc = factors ? factors.famousCopyWalletCircPct : undefined;
    const sinceAnyBuy = factors ? factors.sinceLastFamousAnyBuySec : undefined;
    info.famousCopyWalletCircPct = famousCirc ?? null;
    info.sinceLastFamousAnyBuySec = sinceAnyBuy ?? null;
    info.releaseNoBuySec = fh.releaseNoBuySec;
    const famousStateHit = fh.releaseNoBuySec > 0
        && typeof famousCirc === 'number' && Number.isFinite(famousCirc) && famousCirc > 0
        && _freshWithin(sinceAnyBuy, fh.releaseNoBuySec);
    const famousHit = !famousCheapExit
        && (!_released(recentSell, fh.sellReleaseBnb) || famousStateHit)
        && (_freshWithin(sinceLast, fh.maxSinceBuySec) || famousStateHit);
    // smartHold 命中（T183 时间窗臂 + T228 状态臂=T227d 逐行镜像）：时间窗臂=
    // 聪明钱 180s 内大买且 60s 卖出未达释放线；状态臂=smart 仍持仓（smartCirc>0）
    // ∧ 180s 内任意金额新入场（anyBuy≤releaseNoBuySec）→ HOLD 不限时且压制 0.4
    // 撤退线（「止盈也很常见，只要有新入场的即可」）。null/0 全 fail-open：
    // circ/anyBuy 缺席（旧 FA）不拦；releaseNoBuySec=0 显式关状态臂。
    const smartCirc = factors ? factors.smartCopyWalletCircPct : undefined;
    const smartAnyBuy = factors ? factors.sinceLastSmartAnyBuySec : undefined;
    info.smartCopyWalletCircPct = smartCirc ?? null;
    info.sinceLastSmartAnyBuySec = smartAnyBuy ?? null;
    info.smartReleaseNoBuySec = sh ? sh.releaseNoBuySec : null;
    const smartStateHit = !!(sh && sh.enabled && sh.releaseNoBuySec > 0
        && typeof smartCirc === 'number' && Number.isFinite(smartCirc) && smartCirc > 0
        && _freshWithin(smartAnyBuy, sh.releaseNoBuySec));
    let smartHit = false;
    if (sh && sh.enabled) {
        smartHit = (!_released(smartRecentSell, sh.sellReleaseBnb) || smartStateHit)
            && (_freshWithin(smartSinceLast, sh.maxSinceBuySec) || smartStateHit);
    }
    // T228k machineHold 命中（机器回调吸筹）：180s 机器净买 ≥ minNetBuyBnb ∧
    // chg30 ≤ maxChg30Pct（回调/横盘中接货=选择性吸筹；追高放行）。null 语义
    // fail-open：machNet null（旧 FA）/chg30 null（未见可靠价）不拦——宁卖不冒充
    // 吸筹证据；0=窗内无机器行/净额归零（有证据零值自然不命中）。
    let machineHit = false;
    if (mh && mh.enabled) {
        machineHit = typeof machNet === 'number' && Number.isFinite(machNet) && machNet >= mh.minNetBuyBnb
            && typeof chg30 === 'number' && Number.isFinite(chg30) && chg30 <= mh.maxChg30Pct;
    }
    if (famousHit) return { blocked: true, rule: 'famous_hold', info };
    if (smartHit) return { blocked: true, rule: 'smart_hold', info };
    if (machineHit) return { blocked: true, rule: 'machine_hold', info };
    if (recoveryHit) return { blocked: true, rule: 'recovery_hold', info };
    // 放行：出窗/撤退达线/两臂均无在场证据（sinceLast null=从未有大买 fail-open）
    return { blocked: false, rule: null, info };
}

module.exports = {
    FACTOR_SELL_FILTER_DEFAULTS,
    SMART_HOLD_DEFAULTS,
    MACHINE_HOLD_DEFAULTS,
    RECOVERY_HOLD_DEFAULTS,
    PUMP_ARM_SIGNATURE_FACTOR,
    normalizeFactorSellFilterConfig,
    judgeFactorSellFilter,
};
