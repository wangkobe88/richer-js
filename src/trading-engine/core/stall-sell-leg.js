/**
 * T232 stall 断流卖出腿化纯函数（2026-11-24 用户裁定「断流卖出……同样使用因子
 * 表达式进行表达，作为卖出臂的一部分」）
 *
 * 常量单一真相源：deploy 脚本的 stall 卖腿 condition 与本模块同源生成——
 * 引擎/filter/单测都从这里读常量，改阈值只动本文件。
 *
 * 历史留档（原 stall-close-almost-launch.js 头注迁移）：
 *  - T170/T170b 两档域：almost 档 curVs≤+10 延长 60→90s（fd57 案）；破发档
 *    （currentVsFloorPct ≤ −5，180s）经 d345c 对拍 12/12 全负撤回，缺省关——
 *    本腿化不再表达破发档。
 *  - T219 大户在场豁免（bigBuyersHeldDust≥3 ∨ top1HolderCircPct≥30 跳过卖出）：
 *    bt-v206 对拍否证（卖行 16→0、PnL +0.8443→+0.5449）后缺省关——本腿化退役
 *    不迁移；famous/smart 状态臂已覆盖名单钱包在场语义（且 180s 后自然放行）。
 *  - T228i 铁律（用户原话）：stall 卖出「去掉是万万不能的，只能基于某一些条件
 *    调整，它在很多场景是救命用的」——本腿保命形状：priority 0 全卖腿最高、
 *    cards:'all'、bypassDebounce:true（空窗零 tick 确认窗永不凑齐）、
 *    触发精度 1s 级（45s 预扫门+1s 驱动节流）。
 */

'use strict';

/** stall 卖腿签名因子（filter/驱动识别的唯一判据——conditionText 子串匹配，
 *  pump 签名 sinceEntryNetBuyRatio 同款机制） */
const STALL_SIGNATURE_FACTOR = 'idleSecSinceLastSubstantialTick';

/** 基础断流阈值（秒）——v13 包 stallMs=55000 的腿化载体 */
const STALL_BASE_SEC = 55;

/** almost_launch 域延长阈值（秒）——T170 现行 90s */
const STALL_ALMOST_SEC = 90;

/** almost_launch 域界（%）：curVs ≤ 此值延长（原 STALL_CLOSE_ALMOST_LAUNCH_PCT=10） */
const STALL_ALMOST_LAUNCH_PCT = 10;

/** 断流驱动预扫门（秒）：idle 超过此值才开始 1s 级评估（BASE−10，保证 55s 阈值
 *  首次满足即可被评估到——1s 级精度） */
const DEFAULT_STALLED_SCAN_AFTER_SEC = 45;

/**
 * stall 卖腿条件串（真值表与旧 effectiveStallExtension 逐位等价，破发档不表达）：
 *   idleSec null            → 双臂恒 false，不触发（fail-closed 正确方向，无 IS NULL 豁免臂）
 *   curVs null + idle≥55    → 第二臂 IS NULL 臂放行 → 基础 55s 档（=旧「curVs null 不延长」）
 *   curVs≤10 + 55≤idle<90   → 不触发（almost 域延长生效）；idle≥90 → almost 档
 *   curVs>10 + idle≥55      → 基础档；curVs=10 恰线 → almost 档（≤ 语义）
 *   curVs<0（破发）         → almost 域内（breakdown 档已撤回不回迁）
 */
function buildStallLegCondition() {
    return `(idleSecSinceLastSubstantialTick >= ${STALL_ALMOST_SEC} AND currentVsLaunchPct <= ${STALL_ALMOST_LAUNCH_PCT})`
        + ` OR (idleSecSinceLastSubstantialTick >= ${STALL_BASE_SEC}`
        + ` AND (currentVsLaunchPct > ${STALL_ALMOST_LAUNCH_PCT} OR currentVsLaunchPct IS NULL))`;
}

/** 腿原文读取（factor-sell-filter legConditionText 同款双形状兼容：AST 腿读
 *  conditionText、字符串腿读 condition） */
function legConditionTextOf(leg) {
    if (leg == null) return null;
    if (typeof leg.condition === 'string') return leg.condition;
    if (typeof leg.conditionText === 'string') return leg.conditionText;
    return null;
}

/** 是否 stall 签名卖腿（驱动启停/filter 管辖/metadata 迁移的识别点） */
function isStallSellLeg(leg) {
    const text = legConditionTextOf(leg);
    return !!(text && text.includes(STALL_SIGNATURE_FACTOR));
}

/**
 * 触发上下文（signal metadata 用，形状与原 stallCloseInfo 一致
 * {stalledSec, tier:'almost'|null, effectiveSec}——前端零改动）。
 * factors.idleSecSinceLastSubstantialTick null → null（未触发场景不给上下文）。
 */
function stallTriggerContext(factors) {
    if (!factors) return null;
    const idleSec = factors.idleSecSinceLastSubstantialTick;
    if (typeof idleSec !== 'number' || !Number.isFinite(idleSec)) return null;
    const curVs = factors.currentVsLaunchPct;
    const almost = typeof curVs === 'number' && Number.isFinite(curVs) && curVs <= STALL_ALMOST_LAUNCH_PCT;
    return {
        stalledSec: Math.round(idleSec),
        tier: almost ? 'almost' : null,
        effectiveSec: almost ? STALL_ALMOST_SEC : STALL_BASE_SEC,
    };
}

module.exports = {
    STALL_SIGNATURE_FACTOR,
    STALL_BASE_SEC,
    STALL_ALMOST_SEC,
    STALL_ALMOST_LAUNCH_PCT,
    DEFAULT_STALLED_SCAN_AFTER_SEC,
    buildStallLegCondition,
    isStallSellLeg,
    stallTriggerContext,
};
