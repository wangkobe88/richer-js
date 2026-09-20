/**
 * TypeSafe Jev (System One) 客户端
 *
 * Jev 是结构化决策模型：一次调用传入 state + 多个类型化问题
 * （Choice/Score/Noul），返回每个问题的概率分布与置信度，不生成文本。
 * 叙事分析引擎的全部判定（分类/阻断/评分）都经由此客户端完成。
 *
 * 配置：config/narrative-engine.json 的 jev 节
 *   { endpoint, model, apiKeyEnv, timeoutMs, retryCount }
 *
 * 错误语义（无跨模型 fallback，经用户确认）：
 *   - 429 / 5xx / 网络错误：同模型短退避重试（默认 2 次，500/1500ms）
 *   - 4xx（除 429）：直接抛错（请求本身有错，重试无意义）
 *   - 响应缺少任何请求的问题 id：抛 SCHEMA 错（不吞错、不兼容降级）
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getConfig } from '../../engine/config.mjs';
import logger from '../../core/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../../config/.env') });

const RETRY_BACKOFF_MS = [500, 1500];

/** 读取 jev 配置节（config.mjs 已加载同一份 .env） */
function _jevConfig() {
  const config = getConfig();
  const jev = config.jev;
  if (!jev || !jev.endpoint) {
    throw new Error('config/narrative-engine.json 缺少 jev 配置节');
  }
  return jev;
}

export class JevClient {

  /**
   * 执行一次 systemone 调用
   * @param {Object} state - 待判定材料（string / JSON object / array）
   * @param {Object} questions - 问题集 {id: {type, instructions, criteria}}
   * @param {Object} [options]
   * @param {number} [options.timeoutMs] - 覆盖配置超时
   * @param {string} [options.label] - 日志标签（如 'stage123'）
   * @returns {Promise<Object>} {model, answers, usage}
   *   answers[id] = {type, choice|score|noul, probabilities, confidence?, legend?}
   */
  static async ask(state, questions, options = {}) {
    const jev = _jevConfig();
    const apiKey = process.env[jev.apiKeyEnv || 'TYPESAFE_API_KEY'];
    if (!apiKey) {
      throw new Error(`${jev.apiKeyEnv || 'TYPESAFE_API_KEY'} 未配置`);
    }

    const timeoutMs = options.timeoutMs || jev.timeoutMs || 30000;
    const maxRetries = jev.retryCount ?? 2;
    const label = options.label || 'jev';
    const questionIds = Object.keys(questions);

    if (questionIds.length === 0) {
      throw new Error('questions 不能为空');
    }

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
        logger.warn('JevClient', `第 ${attempt} 次重试（${backoff}ms 后）: ${lastError.message}`);
        await new Promise(r => setTimeout(r, backoff));
      }

      const result = await this._singleCall(
        jev.endpoint, jev.model, apiKey, state, questions, timeoutMs, label,
      );

      if (result.ok) {
        return this._validate(result.body, questionIds);
      }

      lastError = result.error;
      const retryable = result.retryable;
      logger.warn('JevClient', `调用失败[${label}] attempt=${attempt} retryable=${retryable}: ${lastError.message}`);
      if (!retryable) {
        throw lastError;
      }
    }
    throw lastError;
  }

  /**
   * 单次 HTTP 调用（不发日志、不重试）
   * @returns {Promise<{ok:true, body:Object} | {ok:false, error:Error, retryable:boolean}>}
   */
  static async _singleCall(endpoint, model, apiKey, state, questions, timeoutMs, label) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ state, model, questions }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${errorText.substring(0, 500)}`);
        // 429 限速与 5xx 服务端错误可重试；其余 4xx 是请求本身错误
        return { ok: false, error, retryable: response.status === 429 || response.status >= 500 };
      }

      const body = await response.json();
      logger.info('JevClient', `调用成功[${label}] ${Date.now() - startedAt}ms model=${body.model} tokens=${body.usage?.input_tokens ?? '?'}`);
      return { ok: true, body };
    } catch (e) {
      clearTimeout(timeoutId);
      const error = e.name === 'AbortError'
        ? new Error(`请求超时（${timeoutMs / 1000}秒）`)
        : e;
      // 网络抖动（fetch 异常）与超时可重试
      return { ok: false, error, retryable: true };
    }
  }

  /**
   * 校验响应结构：每个请求的问题 id 必须有对应 answer
   * @returns {Object} {model, answers, usage}
   */
  static _validate(body, questionIds) {
    const answers = body.answers;
    if (!answers || typeof answers !== 'object') {
      throw new Error(`Jev 响应 SCHEMA 错误：缺少 answers（model=${body.model}）`);
    }
    const missing = questionIds.filter(id => !answers[id]);
    if (missing.length > 0) {
      throw new Error(`Jev 响应 SCHEMA 错误：缺少问题答案 [${missing.join(', ')}]`);
    }
    return { model: body.model, answers, usage: body.usage || null };
  }
}
