/**
 * 叙事知识库配置段读取与校验
 *
 * 语义（getSearchFallbackConfig 同款）：段缺失 / enabled=false → null（静默关，
 * 注入路径全旁路）；enabled=true 但必填键残缺 → throw fail-loud（部署错误不得静默）。
 * 知识文件在磁盘缺失 = 正常态跳过（loader 层处理，非配置错误——代码先于数据落地安全）。
 */

import { getConfig } from '../../engine/config.mjs';

/** 代码侧默认值（enabled 时可省的键回退此处；files 路径四/五键必须显式可解析） */
const CODE_DEFAULTS = {
  match: { maxEntries: 5, minCjk: 2, minLatin: 4, includePrestage: true },
  inject: { maxChars: 2000 },
  feedback: {
    enabled: true, captureRatings: ['high'], graduatedAlso: true, maxEntries: 300,
    path: 'data/knowledge/quasi-feedback.json',
  },
  files: {
    concepts: 'config/knowledge/concepts.json',
    bluechips: 'config/knowledge/bluechips.json',
    manual: 'config/knowledge/manual-entries.json',
    quasiGraduations: 'data/knowledge/quasi-graduations.json',
    quasiFeedback: 'data/knowledge/quasi-feedback.json',
  },
};

/**
 * 读取并校验 knowledgeBase 配置节
 * @param {Object} [options] - 单测注入 { config }（整个 config 对象形状，覆盖全局读取）
 * @returns {Object|null} 完整配置（含代码默认值，浅合并到段/子段级）；段缺失/enabled=false → null
 * @throws enabled=true 但必填键残缺：match.maxEntries<=0 / inject.maxChars<=0 /
 *   feedback.maxEntries<=0 / files 五路径非非空字符串 / captureRatings 非法
 */
export function getKnowledgeConfig(options = {}) {
  const section = options.config
    ? (options.config.knowledgeBase ?? null)
    : (getConfig().knowledgeBase ?? null);
  if (!section || !section.enabled) return null;

  const merged = {
    match: { ...CODE_DEFAULTS.match, ...(section.match || {}) },
    inject: { ...CODE_DEFAULTS.inject, ...(section.inject || {}) },
    feedback: { ...CODE_DEFAULTS.feedback, ...(section.feedback || {}) },
    files: { ...CODE_DEFAULTS.files, ...(section.files || {}) },
  };

  if (!Number.isFinite(merged.match.maxEntries) || merged.match.maxEntries <= 0) {
    throw new Error('knowledgeBase 配置残缺：match.maxEntries 须为正数');
  }
  if (!Number.isFinite(merged.match.minCjk) || merged.match.minCjk < 1
    || !Number.isFinite(merged.match.minLatin) || merged.match.minLatin < 1) {
    throw new Error('knowledgeBase 配置残缺：match.minCjk/minLatin 须为 ≥1 的数');
  }
  if (!Number.isFinite(merged.inject.maxChars) || merged.inject.maxChars <= 0) {
    throw new Error('knowledgeBase 配置残缺：inject.maxChars 须为正数');
  }
  if (!Array.isArray(merged.feedback.captureRatings)
    || !merged.feedback.captureRatings.every((r) => ['high', 'mid', 'low'].includes(r))) {
    throw new Error('knowledgeBase 配置残缺：feedback.captureRatings 须为 high/mid/low 的数组');
  }
  if (!Number.isFinite(merged.feedback.maxEntries) || merged.feedback.maxEntries <= 0) {
    throw new Error('knowledgeBase 配置残缺：feedback.maxEntries 须为正数');
  }
  if (typeof merged.feedback.path !== 'string' || !merged.feedback.path) {
    throw new Error('knowledgeBase 配置残缺：feedback.path 须为非空字符串');
  }
  for (const [k, v] of Object.entries(merged.files)) {
    if (typeof v !== 'string' || !v) {
      throw new Error(`knowledgeBase 配置残缺：files.${k} 须为非空字符串路径`);
    }
  }
  return merged;
}
