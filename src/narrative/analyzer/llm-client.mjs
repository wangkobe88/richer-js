/**
 * LLM客户端
 * 调用SiliconFlow API进行叙事分析
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(__dirname, '../../../config/.env') });

const API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
const API_KEY = process.env.SILICONFLOW_API_KEY;
const MODEL = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3';

export class LLMClient {

  /**
   * 调用LLM进行叙事分析
   */
  static async analyze(prompt) {
    if (!API_KEY) {
      throw new Error('SILICONFLOW_API_KEY 未配置');
    }

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
        temperature: 0.3,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API 调用失败: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('LLM 返回内容为空');
    }

    // 解析JSON响应
    return this.parseResponse(content);
  }

  /**
   * 解析LLM响应
   */
  static parseResponse(content) {
    // 尝试提取JSON
    let jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('无法从LLM响应中提取JSON');
    }

    try {
      const result = JSON.parse(jsonMatch[0]);

      // 验证必要字段
      if (!result.category) {
        throw new Error('LLM响应缺少category字段');
      }

      return {
        raw: result,
        category: result.category,
        total_score: result.total_score || null,
        scores: result.scores || {},
        reasoning: result.reasoning || ''
      };
    } catch (error) {
      throw new Error(`解析LLM响应失败: ${error.message}`);
    }
  }
}
