/**
 * Response Parser —— DB 记录 → 展示层结构
 * （C86：旧 LLM 文本协议三解析器 parseStage1Response/parseEventResponse/
 * parseJSONResponse ~584 行删除——Jev 迁移后零外部引用，判定全在 jev-result-mapper；
 * 本文件只保留 formatResult/buildLLMAnalysis 两个活导出）
 */

import { resolveFinalRating, categoryToRating } from '../../utils/rating-utils.mjs';


/**
 * 从数据库记录构造 llmAnalysis 对象
 * 适配新 schema：每个阶段有 *_result JSONB + *_prompt text + *_raw_output text
 * @param {Object} record - 数据库记录
 * @returns {Object} llmAnalysis 对象
 */
export function buildLLMAnalysis(record) {
  if (!record) return null;

  // 预检查数据（扁平格式，与实时分析一致）
  const preCheck = record.pre_check_result ? {
    ...record.pre_check_result
  } : null;

  // 辅助函数：从 *_result JSONB 构造阶段对象（扁平格式）
  // 展开核心字段 + 附加 prompt/rawOutput，与实时分析路径返回格式一致
  const buildStage = (stageName) => {
    const result = record[`${stageName}_result`];
    if (!result) return null;
    return {
      ...result,
      prompt: record[`${stageName}_prompt`] || null,
      rawOutput: record[`${stageName}_raw_output`] || null,
    };
  };

  const prestage = buildStage('prestage');
  const stage1 = buildStage('stage1');
  const stage2 = buildStage('stage2');
  const stage3 = buildStage('stage3');

  // 获取最终评级 - 使用统一解析算法
  const rating = resolveFinalRating(record);

  // 从最近的阶段获取 reasoning
  let reasoning = '';
  for (const stageResult of [
    record.stage_final_result,
    record.stage3_result,
    record.stage2_result,
    record.stage1_result,
    record.prestage_result,
    record.pre_check_result
  ]) {
    if (stageResult?.reason) {
      reasoning = stageResult.reason;
      break;
    }
  }

  // 获取 score（pre-check 兜底取 pre_check_result.score 数字；details.scores 是
  // {credibility, virality} 评分明细对象，误用会以对象流出导致前端 .toFixed 崩渲染）
  const finalScore = record.stage_final_result?.score
    ?? record.stage3_result?.score
    ?? record.stage2_result?.score
    ?? record.prestage_result?.score
    ?? record.pre_check_result?.score
    ?? null;

  // 获取 scores（详细评分）
  const scores = record.stage_final_result?.details
    ?? record.stage3_result?.details
    ?? record.stage2_result?.details?.scoringResult
    ?? record.pre_check_result?.details?.scores
    ?? null;

  const summary = {
    rating: rating,
    numericRating: categoryToRating(rating),
    reason: reasoning,
    score: finalScore,
    scores: scores
  };

  return {
    preCheck,
    prestage,
    stage1,
    stage2,
    stage3,
    stageFinal: record.stage_final_result || null,
    summary
  };
}

/**
 * 格式化返回结果
 * 适配新 schema：使用 resolveFinalRating 和统一的 result 结构
 * @param {Object} record - 数据库记录
 * @returns {Object} 格式化后的结果
 */
export function formatResult(record) {
  if (!record) return null;

  const rating = resolveFinalRating(record);

  // 从最近的阶段获取 reason
  let reason = '';
  for (const stageResult of [
    record.stage_final_result,
    record.stage3_result,
    record.stage2_result,
    record.stage1_result,
    record.prestage_result,
    record.pre_check_result
  ]) {
    if (stageResult?.reason) {
      reason = stageResult.reason;
      break;
    }
  }

  // 获取 score
  const score = record.stage_final_result?.score
    ?? record.stage3_result?.score
    ?? record.stage2_result?.score
    ?? record.prestage_result?.score
    ?? record.pre_check_result?.score
    ?? null;

  // 获取 scores（详细评分）
  const scores = record.stage_final_result?.details
    ?? record.stage3_result?.details
    ?? record.stage2_result?.details?.scoringResult
    ?? record.pre_check_result?.details?.scores
    ?? null;

  return {
    token: {
      address: record.token_address,
      symbol: record.token_symbol,
      name: record.raw_api_data?.name || record.token_symbol || '',
      icon: (record.raw_api_data?.name || record.token_symbol || '?')[0]?.toUpperCase(),
      raw_api_data: record.raw_api_data || null,
      chain: record.raw_api_data?.chain || null
    },
    rating: rating,
    numericRating: categoryToRating(rating),
    // 顶层透出代币分类（2026-10-17 Nightshift 案 narrativeCategory 因子化）：缓存/
    // fallback 路的 record 来自 select('*') 含 token_category；新鲜路 save 回读瘦列
    // 不含该键，由 NarrativeAnalyzer 新鲜路 return 显式覆盖。null = 未分类/precheck
    // fail（「null 不带键」语义），门侧 IS NULL 臂放行
    tokenCategory: record.token_category ?? null,
    reason: reason,
    score: score,
    scores: scores,
    metadata: {
      analyzedAt: record.analyzed_at,
      promptVersion: record.prompt_version,
      isValid: record.is_valid,
      preCheckTriggered: !!record.pre_check_result
    }
  };
}
