/**
 * LLM客户端
 * 调用SiliconFlow API进行叙事分析和文本翻译
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getModelConfig } from '../../engine/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '../../../config/.env') });

const API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
const API_KEY = process.env.SILICONFLOW_API_KEY;
const MODEL = process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-V3';
const VISION_MODEL = process.env.SILICONFLOW_VISION_MODEL || 'Qwen/Qwen3-Omni-30B-A3B-Captioner';

export class LLMClient {

  /**
   * 获取当前使用的模型配置
   * 优先使用环境变量 LLM_MODEL，否则使用配置文件中的主模型
   * @returns {Object} { name, parameters }
   */
  static _getCurrentModelConfig() {
    const modelName = process.env.LLM_MODEL;

    // 如果环境变量指定了模型，尝试从配置文件查找参数
    if (modelName) {
      // 检查是否是主模型
      const primaryConfig = getModelConfig('primary');
      if (primaryConfig && primaryConfig.name === modelName) {
        return {
          name: modelName,
          parameters: primaryConfig.parameters || {}
        };
      }

      // 检查是否是备用模型
      const fallbackConfig = getModelConfig('fallback');
      if (fallbackConfig && fallbackConfig.name === modelName) {
        return {
          name: modelName,
          parameters: fallbackConfig.parameters || {}
        };
      }

      // 模型不在配置文件中，使用默认参数
      return {
        name: modelName,
        parameters: {}
      };
    }

    // 没有环境变量，使用配置文件的主模型
    const primaryConfig = getModelConfig('primary');
    return {
      name: primaryConfig?.name || MODEL,
      parameters: primaryConfig?.parameters || {}
    };
  }

  /**
   * 获取备用模型配置
   * @returns {Object|null} { name, parameters } 或 null
   */
  static _getFallbackModelConfig() {
    const fallbackConfig = getModelConfig('fallback');
    if (!fallbackConfig) {
      return null;
    }

    return {
      name: fallbackConfig.name,
      parameters: fallbackConfig.parameters || {}
    };
  }

  /**
   * 翻译文本到中文/英文
   * @param {string} text - 要翻译的文本
   * @param {string} targetLang - 目标语言（'zh' 或 'en'）
   * @returns {Promise<string>} 翻译后的文本
   */
  static async translate(text, targetLang = 'zh') {
    if (!text) {
      return '';
    }

    if (!API_KEY) {
      throw new Error('SILICONFLOW_API_KEY 未配置');
    }

    const timeout = 30000; // 30秒超时（翻译应该更快）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    console.log(`[LLMClient] 开始翻译文本 (${targetLang})...`);

    const langName = targetLang === 'zh' ? '中文' : '英文';
    const prompt = `请将以下文本翻译成${langName}，只返回翻译结果，不要有任何解释：

${text}`;

    try {
      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1, // 翻译需要更低的温度，更确定的结果
          max_tokens: 2000
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM 翻译请求失败: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const translated = data.choices[0]?.message?.content?.trim();

      if (!translated) {
        throw new Error('LLM 翻译返回内容为空');
      }

      console.log(`[LLMClient] 翻译成功: ${translated.substring(0, 50)}...`);
      return translated;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('[LLMClient] 翻译请求超时');
        throw new Error(`LLM 翻译超时（${timeout/1000}秒）`);
      }
      throw error;
    }
  }

  /**
   * 调用LLM进行叙事分析
   */
  static async analyze(prompt) {
    const result = await this.analyzeWithMetadata(prompt);
    return result.parsed;
  }

  /**
   * 执行单次LLM调用
   * @param {string} prompt - Prompt内容
   * @param {Object} modelConfig - 模型配置 { name, parameters }
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<Object>} { success, error, raw, content }
   */
  static async _callLLM(prompt, modelConfig, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    console.log(`[LLMClient] 调用模型: ${modelConfig.name} (超时: ${timeout/1000}秒)`);

    try {
      // 合并默认参数和配置文件中的参数
      const defaultParams = {
        temperature: 0,
        max_tokens: 2000,
        top_p: 1,
        top_k: 50,
        frequency_penalty: 0
      };

      const parameters = { ...defaultParams, ...modelConfig.parameters };

      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: modelConfig.name,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          ...parameters
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const raw = await response.json();
      const content = raw.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(`LLM 返回内容为空。响应结构: ${JSON.stringify({
          hasChoices: !!raw.choices,
          choicesLength: raw.choices?.length
        })}`);
      }

      return { success: true, error: null, raw, content };
    } catch (e) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: e.name === 'AbortError' ? `请求超时（${timeout/1000}秒）` : e.message,
        raw: null,
        content: null
      };
    }
  }

  /**
   * 调用LLM进行叙事分析（带元数据和自动故障转移）
   * @param {string} prompt - Prompt内容
   * @returns {Promise<Object>} 包含解析结果和元数据 { parsed, raw, model, startedAt, finishedAt, success, error, fallbackFrom }
   */
  static async analyzeWithMetadata(prompt) {
    if (!API_KEY) {
      throw new Error('SILICONFLOW_API_KEY 未配置');
    }

    const startedAt = new Date().toISOString();
    const primaryConfig = this._getCurrentModelConfig();
    const fallbackConfig = this._getFallbackModelConfig();

    console.log('[LLMClient] 开始调用LLM API...');
    console.log(`[LLMClient] 主模型: ${primaryConfig.name}`);
    if (fallbackConfig) {
      console.log(`[LLMClient] 备用模型: ${fallbackConfig.name}`);
    }

    // 尝试主模型
    const primaryTimeout = 180000; // 180秒超时
    let result = await this._callLLM(prompt, primaryConfig, primaryTimeout);

    let finalModel = primaryConfig.name;
    let fallbackFrom = null;

    // 如果主模型失败且存在备用模型，尝试故障转移
    if (!result.success && fallbackConfig && fallbackConfig.name !== primaryConfig.name) {
      console.warn(`[LLMClient] 主模型失败: ${result.error}`);
      console.log(`[LLMClient] 切换到备用模型: ${fallbackConfig.name}`);

      fallbackFrom = primaryConfig.name;
      const fallbackTimeout = 180000; // 备用模型也使用相同超时
      result = await this._callLLM(prompt, fallbackConfig, fallbackTimeout);
      finalModel = fallbackConfig.name;

      if (result.success) {
        console.log(`[LLMClient] 备用模型调用成功`);
      } else {
        console.error(`[LLMClient] 备用模型也失败: ${result.error}`);
      }
    }

    if (!result.success) {
      return {
        parsed: null,
        raw: null,
        model: finalModel,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        error: result.error,
        fallbackFrom
      };
    }

    console.log('[LLMClient] API响应成功，解析中...');
    console.log('[LLMClient] 原始响应结构:', JSON.stringify({
      hasChoices: !!result.raw.choices,
      choicesLength: result.raw.choices?.length,
      firstChoice: result.raw.choices?.[0] ? 'exists' : 'null',
      hasMessage: !!result.raw.choices?.[0]?.message,
      hasContent: !!result.raw.choices?.[0]?.message?.content
    }));

    try {
      const parsed = this.parseResponse(result.content);
      console.log('[LLMClient] 解析响应完成');

      return {
        parsed,
        raw: {
          raw: result.raw,
          ...parsed
        },
        model: finalModel,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: true,
        error: null,
        fallbackFrom
      };
    } catch (e) {
      return {
        parsed: null,
        raw: null,
        model: finalModel,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        error: `解析响应失败: ${e.message}`,
        fallbackFrom
      };
    }
  }

  /**
   * 解析LLM响应
   * 支持多种格式：新版 Stage 2/3 (scoringResult.totalScore) 和旧版 (顶层 category)
   */
  static parseResponse(content) {
    // 尝试提取JSON
    let jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.error('[LLMClient] 无法提取JSON，原始响应:', content);
      throw new Error('无法从LLM响应中提取JSON');
    }

    try {
      const result = JSON.parse(jsonMatch[0]);

      // 支持多种格式
      // 新版 Stage 2/3: { scoringResult: { totalScore: 100, ... }, ... }
      // rating: 质量评级 (high/mid/low)
      const scoring = result.scoringResult || {};
      const rating = scoring.rating || result.rating || null;

      // 支持多种评分格式
      const totalScore = scoring.totalScore || result.total_score || null;

      // 支持多种 reasoning 格式
      const reasoning = scoring.reason || result.reasoning || result.reason || '';

      const parsed = {
        raw: result,
        rating: rating,
        total_score: totalScore,
        scores: result.scores || scoring.scores || {},
        reasoning: reasoning,
        // 添加 pass 字段（Stage 2/3 需要）
        pass: result.pass || scoring.pass || null,
        // 添加 blockReason 字段
        blockReason: result.blockReason || scoring.blockReason || null
      };
      // 调试日志：打印解析结果
      console.log('[LLMClient] parseResponse 返回值:', JSON.stringify({
        hasPass: !!parsed.pass,
        pass: parsed.pass,
        hasRating: !!parsed.rating,
        rating: parsed.rating,
        hasTotalScore: !!parsed.total_score,
        totalScore: parsed.total_score
      }));
      return parsed;
    } catch (error) {
      throw new Error(`解析LLM响应失败: ${error.message}`);
    }
  }

  /**
   * 分析图片内容（多模态）
   * @param {string} base64Image - base64 编码的图片（可以是 data:image/...;base64,... 或纯 base64 字符串）
   * @param {string} prompt - 分析提示词
   * @param {Object} options - 选项
   * @param {string} options.model - 使用的模型，默认使用 VISION_MODEL
   * @param {number} options.timeout - 请求超时（毫秒），默认 120000
   * @param {number} options.maxTokens - 最大 token 数，默认 2000
   * @returns {Promise<Object>} 图片分析结果
   */
  static async analyzeImage(base64Image, prompt, options = {}) {
    if (!API_KEY) {
      throw new Error('SILICONFLOW_API_KEY 未配置');
    }

    const config = {
      model: options.model || VISION_MODEL,
      timeout: options.timeout || 30000,  // 30秒超时（Qwen3-Omni 响应约5秒）
      maxTokens: options.maxTokens || 2000
    };

    // 处理 base64 格式
    let imageUrl = base64Image;
    if (!base64Image.startsWith('data:')) {
      // 如果是纯 base64，添加 data URL 前缀
      imageUrl = `data:image/jpeg;base64,${base64Image}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    console.log(`[LLMClient] 开始分析图片（模型: ${config.model}）...`);

    try {
      const response = await fetch(`${API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl
                  }
                }
              ]
            }
          ],
          temperature: 0.7,
          max_tokens: config.maxTokens
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`多模态 API 调用失败: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('多模态 API 返回内容为空');
      }

      console.log('[LLMClient] 图片分析完成');
      return {
        content: content,
        raw: data
      };

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('[LLMClient] 图片分析超时');
        throw new Error(`图片分析超时（${config.timeout/1000}秒）`);
      }
      throw error;
    }
  }

  /**
   * 分析 Twitter 推文图片（专用）
   * @param {string} base64Image - base64 编码的图片
   * @returns {Promise<Object>} 图片分析结果
   */
  static async analyzeTwitterImage(base64Image) {
    const prompt = `请分析这张 Twitter 推文配图，用于代币叙事分析。

请提供以下信息：
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字等
2. **梗图/表情包识别**：如果是流行梗图或表情包，请指出其名称和常见含义
3. **关键元素**：列出图片中的所有关键元素（如人物、动物、符号、文字等）
4. **情感色彩**：图片传达的情感基调（如幽默、讽刺、严肃等）
5. **代币关联性**：如果图片内容可能与某个代币、人物或概念相关，请指出

请以 JSON 格式返回：
{
  "description": "图片内容描述",
  "meme_type": "梗图/表情包名称（如果有）",
  "meme_meaning": "梗图含义（如果是梗图）",
  "key_elements": ["元素1", "元素2", ...],
  "emotion": "情感基调",
  "token_relevance": "可能的代币关联（如果有）"
}`;

    const result = await this.analyzeImage(base64Image, prompt);

    // 尝试解析 JSON 响应
    let jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...parsed,
          raw_content: result.content
        };
      } catch (e) {
        // JSON 解析失败，返回原始内容
      }
    }

    // 如果无法解析 JSON，返回原始内容
    return {
      description: result.content,
      raw_content: result.content
    };
  }
}
