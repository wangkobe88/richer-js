/**
 * Prompt 加载器 - V1.0
 * 3阶段LLM流程的Prompt动态加载
 *
 * 功能：
 * 1. 根据Stage 1的分类结果，动态加载Stage 2对应类别的Prompt
 * 2. 处理多分类情况
 * 3. 统一Prompt格式
 */

import { buildStage1EventPreprocessingPrompt } from './prompts/stage1-event-preprocessing.mjs';

// Stage 2 分类特定Prompt映射
const CATEGORY_PROMPT_BUILDERS = {
  'A': async () => (await import('./prompts/event-scoring-categories/category-a-visual-ip.mjs')).buildCategoryAPrompt,
  'W': async () => (await import('./prompts/event-scoring-categories/category-w-web3-project.mjs')).buildCategoryWPrompt,
  'B': async () => (await import('./prompts/event-scoring-categories/category-b-product-event.mjs')).buildCategoryBPrompt,
  'C': async () => (await import('./prompts/event-scoring-categories/category-c-personal-statement.mjs')).buildCategoryCPrompt,
  'D': async () => (await import('./prompts/event-scoring-categories/category-d-institutional-action.mjs')).buildCategoryDPrompt,
  'E': async () => (await import('./prompts/event-scoring-categories/category-e-social-hotspot.mjs')).buildCategoryEPrompt
};

/**
 * 构建Stage 1 Prompt（事件预处理）
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {string} Stage 1 Prompt
 */
export function buildStage1Prompt(tokenData, fetchResults) {
  return buildStage1EventPreprocessingPrompt(tokenData, fetchResults);
}

/**
 * 构建Stage 2 Prompt（分类特定分析）
 * @param {Object} eventDescription - Stage 1输出的事件描述
 * @param {Object} eventClassification - Stage 1输出的分类结果
 * @returns {Promise<string>} Stage 2 Prompt
 */
export async function buildStage2Prompt(eventDescription, eventClassification) {
  const { primaryCategory, possibleCategories, confidence } = eventClassification;

  // 确定要使用的类别
  const selectedCategory = selectCategory(primaryCategory, possibleCategories, confidence);

  // 动态加载对应类别的Prompt构建器
  const promptBuilderGetter = CATEGORY_PROMPT_BUILDERS[selectedCategory];
  if (!promptBuilderGetter) {
    throw new Error(`不支持的类别: ${selectedCategory}`);
  }

  const buildCategoryPrompt = await promptBuilderGetter();

  // 构建Prompt
  const categoryPrompt = buildCategoryPrompt(eventDescription, eventClassification);

  // 拼接当前时间信息，让 LLM 能判断预期事件的具体距离
  const currentDate = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });
  const currentTimePrefix = `【当前时间】${currentDate}\n\n`;

  return currentTimePrefix + categoryPrompt;
}

/**
 * 选择要使用的类别
 * @param {string} primaryCategory - 主要类别
 * @param {Array<string>} possibleCategories - 可能的类别列表
 * @param {string} confidence - 置信度
 * @returns {string} 选择的类别
 */
function selectCategory(primaryCategory, possibleCategories = [], confidence = 'medium') {
  // 如果置信度高且只有单一类别，直接使用
  if (confidence === 'high' && possibleCategories.length === 1) {
    return primaryCategory;
  }

  // 如果置信度低或类别过多，使用主要类别
  // TODO: 后续可以实现多类别综合分析的逻辑
  return primaryCategory;
}

/**
 * 获取Stage 1 Prompt版本号
 * @returns {string} 版本号
 */
export function getStage1PromptVersion() {
  const { STAGE1_EVENT_PREPROCESSING_VERSION } = require('./prompts/stage1-event-preprocessing.mjs');
  return STAGE1_EVENT_PREPROCESSING_VERSION;
}

/**
 * 获取Stage 2 Prompt版本号（根据类别）
 * @param {string} category - 类别（A-E）
 * @returns {Promise<string>} 版本号
 */
export async function getStage2PromptVersion(category) {
  const versionExports = {
    'A': 'CATEGORY_A_PROMPT_VERSION',
    'W': 'CATEGORY_W_PROMPT_VERSION',
    'B': 'CATEGORY_B_PROMPT_VERSION',
    'C': 'CATEGORY_C_PROMPT_VERSION',
    'D': 'CATEGORY_D_PROMPT_VERSION',
    'E': 'CATEGORY_E_PROMPT_VERSION'
  };

  const promptBuilderGetter = CATEGORY_PROMPT_BUILDERS[category];
  if (!promptBuilderGetter) {
    return 'UNKNOWN';
  }

  const module = await import(`./prompts/event-scoring-categories/category-${getCategoryFileName(category)}.mjs`);
  return module[versionExports[category]] || 'UNKNOWN';
}

/**
 * 获取类别文件名
 * @param {string} category - 类别
 * @returns {string} 文件名
 */
function getCategoryFileName(category) {
  const fileNames = {
    'A': 'category-a-visual-ip',
    'W': 'category-w-web3-project',
    'B': 'category-b-product-event',
    'C': 'category-c-personal-statement',
    'D': 'category-d-institutional-action',
    'E': 'category-e-social-hotspot'
  };
  return fileNames[category] || '';
}

/**
 * 获取所有支持的类别
 * @returns {Array<string>} 类别列表
 */
export function getSupportedCategories() {
  return Object.keys(CATEGORY_PROMPT_BUILDERS);
}
