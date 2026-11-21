/**
 * T205 活跃度阶段前提共享线（fix①「未火过票活跃度让位」——2026-11-21 金狗 GWC
 * 0xb71209cb…7777 案立法，用户原则：「活跃度在买入点位的重要度主要是在后期——
 * 已经火过一段时间，活跃度为 low 说明流动性失去了不可买入；前期活跃度的检测
 * 显得不重要」）。
 *
 * 「火过一轮」判据 = 锚前 ATH 较地板发行价 ≥ 80%（FP27/T188「票还没走完一轮
 * 大周期」同线；80-100 带三窗 194 票 6.2% 右尾/74% 死透=最平庸带照拦不吃亏）。
 * 键源=锚窗最高可靠价 ÷ floorLaunchPriceBnb（平台常量, 窗内最低可靠价）——
 * FA `_minRelPriceBnb`/BP snapshot launchAnchor/CD snapshot 三点同源（T134 滚动
 * 地板）；各消费点窗口截窗口径一致（窗内 min ≥ 全史 min=锚只偏高不冒充低锚）。
 *
 * 三消费点（一个原则三个挂点，灰度键各自独立、缺省 false=零行为）：
 * - FP act low 家族（factor-pre-buy-check judgeActivityLevel——
 *   buyPointCheck.factorCheck.actStageColdExempt）
 * - AF1 reject_low 分流（CheatCheckService actFrontRoute——
 *   cheatCheck.gate.actStageColdExempt）
 * - cheat 分级门 E 通道（cheat-grade gradeObservation——同 cheatCheck.gate 键）
 * ultra 档刻意不受阶段前提影响（协同出货/极端密度是当下事实非静默语义）。
 *
 * null 语义（fail-closed 放行方向证据缺席不释放）：athVsLaunchPct null/非数
 * → isColdStage=false=照拦——保持各门现行行为（截窗无可靠价/无常量平台）。
 *
 * 三窗跨验面（bt-v164/159/155，act 语义拒绝 2054 票按 ATH 档）：
 * ATH<80 943 票右尾 8.7%/死 63% vs ATH≥80 1111 票右尾 6.5%/死 71%——未火过带
 * 全面更肥；金狗 30 票 9 票（GWC +932%/铁匠 +928%/胖橘貓/MOYNOK…）≥100% 右尾
 * 时刻死在 act 语义拦截。台档金狗 JG-15+交易 T205。
 */
'use strict';

/** 火过线：锚前 ATH 较地板发行价 ≥ 此值才算「火过一轮」（act low 家族才适用） */
const ACT_STAGE_HOT_MIN_ATH_VS_PCT = 80;

/**
 * 是否「未火过」（冷阶段）——act low 家族让位的前提。
 * @param {number|null} athVsLaunchPct 锚窗最高可靠价较地板发行价 %（null=证据
 *   缺席，返回 false=照拦——放行方向 fail-closed，与各门 null 容缺语义一致）
 * @returns {boolean}
 */
function isColdStage(athVsLaunchPct) {
  return typeof athVsLaunchPct === 'number' && Number.isFinite(athVsLaunchPct)
    && athVsLaunchPct < ACT_STAGE_HOT_MIN_ATH_VS_PCT;
}

module.exports = { ACT_STAGE_HOT_MIN_ATH_VS_PCT, isColdStage };
