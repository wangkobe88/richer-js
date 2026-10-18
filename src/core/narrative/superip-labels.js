'use strict';

/**
 * C88 超级IP标签零列推导（2026-10-18 CZ 出书簇用户裁定：「是否超级IP，可以作为一个
 * 代币的叙事分析标签，也同样返回给实验引擎并展示在界面上」）。
 *
 * 零列方案：不落 DB 列，全部从既有 stage1/stage2 JSON 推导——
 *   narrativeSuperIp      = stage1 jev.probabilities.name_referent.super_ip ≥ 0.5 → 1，
 *                           否则 0；stage1 缺失（prestage/precheck fail/未分析）→ null
 *   narrativeSuperIpSlogan = stage2 jev.superIpSlogan（mapper C88 恒落键）.hit → 1/0；
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
 * 从 stage1/stage2 结果推导超级IP两标签。
 * @param {Object|string|null} stage1Result - stage1_result 列值（或内存 stage1DataToSave）
 * @param {Object|string|null} stage2Result - stage2_result 列值（或内存 stage2DataToSave）
 * @returns {{narrativeSuperIp: number|null, narrativeSuperIpSlogan: number|null}}
 */
function deriveSuperIpLabels(stage1Result, stage2Result) {
  const s1 = _asObj(stage1Result);
  const s2 = _asObj(stage2Result);
  const superIpProb = s1?.parsed_output?.jev?.probabilities?.name_referent?.super_ip ?? null;
  const narrativeSuperIp = superIpProb == null ? null : (superIpProb >= 0.5 ? 1 : 0);
  const slog = s2?.parsed_output?.jev?.superIpSlogan ?? null;
  const narrativeSuperIpSlogan = slog == null ? null : (slog.hit === true ? 1 : 0);
  return { narrativeSuperIp, narrativeSuperIpSlogan };
}

module.exports = { deriveSuperIpLabels };
