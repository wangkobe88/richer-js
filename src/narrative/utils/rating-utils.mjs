/**
 * 叙事评级统一工具模块
 * 所有 rating 解析逻辑都在这里，消费方统一调用
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
 * 从 rating 字符串获取 numeric rating
 * @param {string} rating - 叙事评级 (high/mid/low/unrated)
 * @returns {number} 评级 (1=低质量, 2=中质量, 3=高质量, 9=未评级)
 */
export function categoryToRating(rating) {
  if (rating === null || rating === undefined) return null;
  return CATEGORY_TO_RATING[rating] ?? null;
}

/**
 * 从数据库记录中解析最终 rating
 *
 * 解析算法（从最早的阶段往后找）：
 * 1. rating = "unrated" → 立即返回（流程无法判断）
 * 2. rating = "high"/"mid"/"low" → 直接返回（最终结果）
 * 3. pass = false → rating 必须是 low → 直接返回
 * 4. pass = true → 还没出最终结果，继续往后看
 * 5. 所有阶段都无结果 → null（无结果，与 unrated 区分）
 *
 * @param {Object} record - 数据库记录
 * @returns {string|null} 最终 rating (high/mid/low/unrated) 或 null（无结果）
 */
export function resolveFinalRating(record) {
  if (!record) return null;

  const stages = [
    'pre_check_result',
    'prestage_result',
    'stage1_result',
    'stage2_result',
    'stage3_result',
    'stage_final_result'
  ];

  let hasAnyStage = false;

  for (const field of stages) {
    const result = record[field];
    if (!result) continue;

    hasAnyStage = true;

    // 规则1: unrated → 立即返回
    if (result.rating === 'unrated') return 'unrated';

    // 规则2: low/mid/high → 直接返回（最终结果）
    if (['high', 'mid', 'low'].includes(result.rating)) return result.rating;

    // 规则3: pass=false → rating 必须是 low → 直接返回
    if (result.pass === false) return 'low';

    // 规则3.5: pass=null 但 category='low' → 兼容旧数据（pass 未正确从 raw 提取）
    if (result.pass === null && result.category === 'low') return 'low';

    // 规则4: pass=true → 继续往后看
    if (result.pass === true) continue;
  }

  // 有阶段数据但无法确定评级 → unrated；没有任何阶段数据 → null（无结果）
  return hasAnyStage ? 'unrated' : null;
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
