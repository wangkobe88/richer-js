'use strict';

/**
 * C88 超级IP标签零列推导（2026-10-18 CZ 出书簇用户裁定：「是否超级IP，可以作为一个
 * 代币的叙事分析标签，也同样返回给实验引擎并展示在界面上」）。
 *
 * 零列方案：不落 DB 列，全部从既有 stage1/stage2 JSON 推导——
 *   narrativeSuperIp      = stage1 jev.probabilities.web3_user_name_entity_acceptance.accepted ≥ 0.5 → 1，
 *                           否则 0；stage1 缺失（prestage/precheck fail/未分析）→ null
 *   narrativeSuperIpSlogan = stage2 jev.recognizedEntitySlogan（mapper C88 恒落键）.hit → 1/0；
 *                           键缺失（C88 前旧缓存行）→ null
 *
 * 三态语义（与 narrativeCategory null 放行臂同形）：1=是，0=评估未中（有 stage 数据
 * 但腿没全中），null=未分析/旧行无键。0 与 null 必须区分——策略腿写
 * `narrativeSuperIpSlogan == 1` 时 0/null 同为不买，但观察层（UI badge/扫描统计）
 * 靠 null 识别「存量行未升级」。
 *
 * 消费方（C85 narrativeCategory 管线镜像，值链：mapper 恒落 → DB 行 → 本函数三路）：
 *   - response-parser.mjs formatResult（缓存/fallback 路，select('*') 行）
 *   - NarrativeAnalyzer.mjs 新鲜路（内存 stage1DataToSave/stage2DataToSave，形状同落库值）
 *   - BacktestEngine._preloadNarrativeRows（rowCache select('*') 行）
 *   - ExperimentDataService.getExperimentNarratives（NARRATIVE_LIGHT_COLUMNS 含两列）
 * CJS 单实现双生态共享（src/core/gmgn-api/risk-fields.js 先例：narrative ESM 经具名
 * import 消费、交易引擎 CJS require 消费）。
 */

/** jsonb 列 Supabase 返回对象、旧数据/手造 fixture 可能是 JSON 字符串——双态归一 */
function _asObj(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

/**
 * 取 stage 结果里的 parsed_output 等价物（双形状兼容，2026-10-18 v22 页面实测发现）：
 * - 落库信封（buildStageSaveData 转换后）：{rating, pass, details, ...}，mapper 的
 *   parsed_output 整包在 `details` 键——DB 行（formatResult 缓存路/回测 preload/
 *   getExperimentNarratives）全部是该形状。初版只认 parsed_output 键 = 三条 DB 路
 *   恒 null（v22 659 票实测全 null 实锤），只有内存新鲜路能用
 * - 内存形状（NarrativeAnalyzer 新鲜路直传 mapper 的 *DataToSave）：原键 parsed_output
 * 只认两形状其一，不做递归搜索（兜底搜索会掩盖形状漂移）
 */
function _stagePayload(s) {
  return s?.details ?? s?.parsed_output ?? null;
}

/**
 * 从 stage1/stage2 结果推导超级IP两标签。
 * @param {Object|string|null} stage1Result - stage1_result 列值（或内存 stage1DataToSave）
 * @param {Object|string|null} stage2Result - stage2_result 列值（或内存 stage2DataToSave）
 * @returns {{narrativeSuperIp: number|null, narrativeSuperIpSlogan: number|null}}
 */
function deriveSuperIpLabels(stage1Result, stage2Result) {
  const s1po = _stagePayload(_asObj(stage1Result));
  const s2po = _stagePayload(_asObj(stage2Result));
  // J1.56（C126）：实体题轴改 accepted（映射到用户认得的实体）；旧行无新键 → null
  const superIpProb = s1po?.jev?.probabilities?.web3_user_name_entity_acceptance?.accepted ?? null;
  const narrativeSuperIp = superIpProb == null ? null : (superIpProb >= 0.5 ? 1 : 0);
  const slog = s2po?.jev?.recognizedEntitySlogan ?? null;
  const narrativeSuperIpSlogan = slog == null ? null : (slog.hit === true ? 1 : 0);
  return { narrativeSuperIp, narrativeSuperIpSlogan };
}

module.exports = { deriveSuperIpLabels };
