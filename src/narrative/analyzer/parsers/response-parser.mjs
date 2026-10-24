/**
 * Response Parser —— DB 记录 → 展示层结构
 * （C86：旧 LLM 文本协议三解析器 parseStage1Response/parseEventResponse/
 * parseJSONResponse ~584 行删除——Jev 迁移后零外部引用，判定全在 jev-result-mapper；
 * 本文件只保留 formatResult/buildLLMAnalysis 两个活导出）
 */

import { resolveFinalRating, categoryToRating } from '../../utils/rating-utils.mjs';
import { deriveSuperIpLabels } from '../../../core/narrative/superip-labels.js';


/**
 * 从数据库记录构造 llmAnalysis 对象
 * 适配评估链 schema（2026-10-24 列名重构）：event/event_score/relation 三段
 * result + jev_prompt/jev_raw_output 单份 IO（legacy_stage2/3_* 不再产出）
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
  // 展开核心字段 + 附加 prompt/rawOutput，与实时分析路径返回格式一致。
  // resultName=评估链段名（result 列）；ioName=LLM IO 前缀（jev 单份真源挂 event 段；
  // event_score/relation 段旧 prompt/raw 为冗余拷贝已停写，io 缺省读不到=null）
  const buildStage = (resultName, ioName = null) => {
    const result = record[`${resultName}_result`];
    if (!result) return null;
    return {
      ...result,
      prompt: (ioName && record[`${ioName}_prompt`]) || null,
      rawOutput: (ioName && record[`${ioName}_raw_output`]) || null,
    };
  };

  const prestage = buildStage('prestage', 'prestage');
  const event = buildStage('event', 'jev');
  const eventScore = buildStage('event_score');
  const relation = buildStage('relation');

  // 获取最终评级 - 使用统一解析算法
  const rating = resolveFinalRating(record);

  // 从最近的阶段获取 reasoning
  let reasoning = '';
  for (const stageResult of [
    record.final_result,
    record.relation_result,
    record.event_score_result,
    record.event_result,
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
  const finalScore = record.final_result?.score
    ?? record.relation_result?.score
    ?? record.event_score_result?.score
    ?? record.prestage_result?.score
    ?? record.pre_check_result?.score
    ?? null;

  // 获取 scores（详细评分）
  const scores = record.final_result?.details
    ?? record.relation_result?.details
    ?? record.event_score_result?.details?.scoringResult
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
    event,
    eventScore,
    relation,
    final: record.final_result || null,
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
    record.final_result,
    record.relation_result,
    record.event_score_result,
    record.event_result,
    record.prestage_result,
    record.pre_check_result
  ]) {
    if (stageResult?.reason) {
      reason = stageResult.reason;
      break;
    }
  }

  // 获取 score
  const score = record.final_result?.score
    ?? record.relation_result?.score
    ?? record.event_score_result?.score
    ?? record.prestage_result?.score
    ?? record.pre_check_result?.score
    ?? null;

  // 获取 scores（详细评分）
  const scores = record.final_result?.details
    ?? record.relation_result?.details
    ?? record.event_score_result?.details?.scoringResult
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
    // C88 超级IP两标签（2026-10-18 CZ 出书簇）：零列推导——event 段 super_ip 概率带
    // 与 event_score 段 C88 恒落 hit 键；1/0/null 三态（null=未分析/prestage/旧行无键），
    // 新鲜路由 NarrativeAnalyzer 显式覆盖（save 回读瘦列无 stage 列）
    ...deriveSuperIpLabels(record.event_result, record.event_score_result),
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
