/**
 * 叙事评级统一工具模块
 * 所有 category ↔ rating 的映射逻辑都在这里，消费方统一调用
 */

/**
 * category → numeric rating 映射
 */
const CATEGORY_TO_RATING = {
  high: 3,
  mid: 2,
  low: 1,
  unrated: 9
};

/**
 * 从 category 获取 numeric rating
 * @param {string} category - 叙事类别 (high/mid/low/unrated/account_based_meme 等)
 * @returns {number} 评级 (1=低质量, 2=中质量, 3=高质量, 9=未评级)
 */
export function categoryToRating(category) {
  if (!category) return 9;
  return CATEGORY_TO_RATING[category] ?? 9;
}

/**
 * 从数据库记录中提取 prestage 的 category
 * 特殊处理 account_based_meme：用 rating 而不是 tokenType
 * @param {Object} record - 数据库记录
 * @returns {string} category
 */
function resolvePrestageCategory(record) {
  const parsedOutput = record.llm_prestage_parsed_output;
  if (!parsedOutput) return record.llm_prestage_category || null;

  const tokenType = parsedOutput.tokenType;
  // account_based_meme 的 category 取 rating（low/unrated），不是 tokenType
  if (tokenType === 'account_based_meme') {
    return parsedOutput.rating || 'low';
  }
  // project 类型：category 使用 rating 字段（mid/high/low），不是 tokenType
  if (tokenType === 'project') {
    return parsedOutput.rating || record.llm_prestage_category || null;
  }
  return tokenType || record.llm_prestage_category || null;
}

/**
 * 从数据库记录或 llmAnalysis 对象中解析最终 category
 * 优先级：preCheck > stage3 > stage2(pass检查) > stage1 > prestage
 * @param {Object} record - 数据库记录
 * @returns {string} 最终 category (high/mid/low/unrated)
 */
export function resolveFinalCategory(record) {
  if (!record) return 'unrated';

  // 各阶段的 category
  const stage3Category = record.llm_stage3_parsed_output?.raw?.category || record.llm_stage3_category;
  const stage2Category = record.llm_stage2_parsed_output?.raw?.categoryAnalysis?.category || record.llm_stage2_category;
  const stage1Category = record.llm_stage1_parsed_output?.eventClassification?.primaryCategory || record.llm_stage1_category;
  const prestageCategory = resolvePrestageCategory(record);
  const preCheckCategory = record.pre_check_category;

  // Stage 2 是否未通过
  const stage2Pass = record.llm_stage2_parsed_output?.raw?.pass;

  // 优先级判断
  if (preCheckCategory && preCheckCategory !== 'unrated') {
    return preCheckCategory;
  }
  if (record.llm_stage2_parsed_output || record.llm_stage2_category) {
    if (stage2Pass === false) {
      return 'low';
    }
  }
  return stage3Category || stage2Category || stage1Category || prestageCategory || 'unrated';
}

/**
 * rating 的元信息（供后端和前端渲染用）
 * @param {number} rating - 评级数字 (1/2/3/9)
 * @returns {Object} { label, emoji, colorClass, bgClass, borderClass }
 */
export function getRatingMeta(rating) {
  const MAP = {
    3: { label: '高质量', emoji: '🚀', colorClass: 'text-green-400', bgClass: 'bg-green-900', borderClass: 'border-green-700' },
    2: { label: '中质量', emoji: '📊', colorClass: 'text-blue-400', bgClass: 'bg-blue-900', borderClass: 'border-blue-700' },
    1: { label: '低质量', emoji: '📉', colorClass: 'text-orange-400', bgClass: 'bg-orange-900', borderClass: 'border-orange-700' },
    9: { label: '未评级', emoji: '❓', colorClass: 'text-gray-400', bgClass: 'bg-gray-900', borderClass: 'border-gray-700' }
  };
  return MAP[rating] ?? MAP[9];
}
