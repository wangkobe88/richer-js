/**
 * LLM API Client - LLM API调用便捷接口
 * 提供与旧版兼容的 callLLMAPI 函数，内部委托给 LLMClient
 */

import logger from '../../core/logger.mjs';
import { LLMClient } from './LLMClient.mjs';

/**
 * 执行单次LLM调用（内部方法，返回原始响应）
 * @param {string} prompt - Prompt内容
 * @param {Object} modelConfig - 模型配置 { name, parameters }
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Object>} { success, error, content (原始字符串), raw }
 */
async function _callLLM(prompt, modelConfig, timeout) {
  const result = await LLMClient._callLLM(prompt, modelConfig, timeout);
  return result;
}

/**
 * 调用 LLM API（便捷函数，兼容旧接口）
 * 支持自动故障转移，返回原始响应字符串
 *
 * @param {string} prompt - Prompt内容
 * @returns {Promise<Object>} { content (原始字符串), model, startedAt, finishedAt, success, error, fallbackFrom }
 */
export async function callLLMAPI(prompt) {
  const startedAt = new Date().toISOString();

  // 获取主/备模型配置
  const primaryConfig = LLMClient._getCurrentModelConfig();
  const fallbackConfig = LLMClient._getFallbackModelConfig();

  logger.debug('LLMClient', '开始调用LLM API', {
    primaryModel: primaryConfig.name,
    fallbackModel: fallbackConfig?.name,
    promptLength: prompt.length
  });

  const timeout = 180000; // 180秒超时

  // 尝试主模型
  let result = await _callLLM(prompt, primaryConfig, timeout);

  let finalModel = primaryConfig.name;
  let fallbackFrom = null;

  // 如果主模型失败且存在备用模型，尝试故障转移
  if (!result.success && fallbackConfig && fallbackConfig.name !== primaryConfig.name) {
    logger.warn('LLMClient', `主模型失败: ${result.error}，切换到备用模型: ${fallbackConfig.name}`);

    fallbackFrom = primaryConfig.name;
    result = await _callLLM(prompt, fallbackConfig, timeout);
    finalModel = fallbackConfig.name;

    if (result.success) {
      logger.info('LLMClient', `备用模型调用成功`);
    } else {
      logger.error('LLMClient', `备用模型也失败: ${result.error}`);
    }
  }

  return {
    content: result.content, // 原始字符串
    model: finalModel,
    startedAt,
    finishedAt: new Date().toISOString(),
    success: result.success,
    error: result.error,
    fallbackFrom
  };
}

// 导出 LLMClient 类，供需要使用更多方法的模块
export { LLMClient };
