/**
 * LLM API Client - LLM API调用客户端
 * 提供统一的LLM API调用接口
 */

import logger from '../../core/logger.mjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '../../../../config/.env') });

/**
 * 调用 LLM API（通用方法）
 * 与 NarrativeAnalyzer._callLLMAPI 保持一致的接口
 * @param {string} prompt - Prompt内容
 * @returns {Promise<Object>} { content, model, startedAt, finishedAt, success, error }
 */
export async function callLLMAPI(prompt) {
  // 从环境变量获取配置
  const { SILICONFLOW_API_URL, SILICONFLOW_API_KEY, LLM_MODEL } = process.env;

  const apiUrl = SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
  const apiKey = SILICONFLOW_API_KEY;
  const model = LLM_MODEL || 'deepseek-ai/DeepSeek-V3';
  const startedAt = new Date().toISOString();

  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY 未配置');
  }

  const timeout = 180000; // 180秒超时（3分钟，复杂case需要更多时间）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  logger.debug('LLMClient', '开始调用LLM API', { model, promptLength: prompt.length });

  let content, error, success;

  try {
    logger.debug('LLMClient', '发送 fetch 请求');
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0,
        max_tokens: 2000,
        top_p: 1,
        top_k: 50,
        frequency_penalty: 0
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API 调用失败: ${response.status} ${errorText}`);
    }

    logger.debug('LLMClient', 'API响应成功');
    const data = await response.json();
    content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('LLM 返回内容为空');
    }

    const finishedAt = new Date().toISOString();
    success = true;
    error = null;

    logger.debug('LLMClient', 'API调用完成');
    return { content, model, startedAt, finishedAt, success: true, error: null };
  } catch (e) {
    clearTimeout(timeoutId);
    success = false;
    error = e.message;

    if (e.name === 'AbortError') {
      console.error('[NarrativeAnalyzer] 请求超时');
      error = `LLM API 调用超时（${timeout/1000}秒）`;
    }

    return {
      content: null,
      model,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: false,
      error
    };
  }
}

// 重新导出 LLMClient 中的所有方法，保持向后兼容
export { LLMClient } from './LLMClient.mjs';
