/**
 * 叙事分析器
 * 核心服务：协调各组件完成叙事分析
 */

import { NarrativeRepository } from '../db/NarrativeRepository.mjs';
import { TwitterFetcher } from '../utils/twitter-fetcher.mjs';
import { PromptBuilder } from './prompt-builder.mjs';
import { LLMClient } from './llm-client.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

export class NarrativeAnalyzer {

  /**
   * 分析代币叙事（带缓存）
   */
  static async analyze(address) {
    // 标准化地址
    const normalizedAddress = address.toLowerCase();

    // 1. 检查缓存
    const cached = await NarrativeRepository.findByAddress(normalizedAddress);
    if (cached && cached.is_valid && this.isCacheValid(cached)) {
      return {
        ...this.formatResult(cached),
        meta: {
          fromCache: true,
          analyzedAt: cached.analyzed_at,
          promptVersion: cached.prompt_version
        },
        debugInfo: {
          promptUsed: cached.prompt_used,
          promptVersion: cached.prompt_version
        }
      };
    }

    // 2. 从数据库获取代币数据
    const tokenData = await this.fetchTokenData(normalizedAddress);
    if (!tokenData) {
      throw new Error('代币不存在');
    }

    // 3. 提取结构化信息
    const extractedInfo = this.extractInfo(tokenData);

    // 4. 获取推文内容
    const twitterInfo = await TwitterFetcher.fetchFromUrls(
      extractedInfo.twitter_url,
      extractedInfo.website
    );

    // 5. 构建Prompt并调用LLM
    let llmResult;
    let promptUsed = '';
    try {
      promptUsed = PromptBuilder.build(tokenData, twitterInfo);
      llmResult = await LLMClient.analyze(promptUsed);
    } catch (error) {
      console.error('LLM分析失败:', error.message);
      llmResult = {
        category: 'unrated',
        reasoning: `分析失败: ${error.message}`
      };
    }

    // 6. 保存结果
    const saveResult = await NarrativeRepository.save({
      token_address: normalizedAddress,
      token_symbol: tokenData.symbol,
      raw_api_data: tokenData.raw_api_data,
      extracted_info: extractedInfo,
      twitter_info: twitterInfo,
      llm_category: llmResult.category,
      llm_raw_output: llmResult.raw || llmResult,
      llm_summary: {
        total_score: llmResult.total_score,
        credibility_score: llmResult.scores?.credibility,
        virality_score: llmResult.scores?.virality,
        reasoning: llmResult.reasoning,
        category: llmResult.category
      },
      prompt_used: promptUsed,
      analyzed_at: new Date().toISOString()
    });

    return {
      ...this.formatResult(saveResult),
      meta: {
        fromCache: false,
        analyzedAt: saveResult.analyzed_at,
        promptVersion: PromptBuilder.getPromptVersion()
      },
      debugInfo: {
        promptUsed: promptUsed,
        promptVersion: PromptBuilder.getPromptVersion()
      }
    };
  }

  /**
   * 从数据库获取代币数据
   */
  static async fetchTokenData(address) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('experiment_tokens')
      .select('token_symbol, raw_api_data')
      .eq('token_address', address)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      address: address,
      symbol: data.token_symbol,
      raw_api_data: data.raw_api_data
    };
  }

  /**
   * 提取结构化信息
   */
  static extractInfo(tokenData) {
    const rawData = tokenData.raw_api_data || {};

    // 解析appendix字段（可能是JSON字符串）
    let appendix = {};
    if (rawData.appendix && typeof rawData.appendix === 'string') {
      try {
        appendix = JSON.parse(rawData.appendix);
      } catch (e) {
        console.warn('[NarrativeAnalyzer] 解析appendix失败:', e.message);
      }
    } else if (rawData.appendix && typeof rawData.appendix === 'object') {
      appendix = rawData.appendix;
    }

    // 提取twitter_url（优先级：appendix.twitter > rawData.webUrl > rawData.twitterUrl）
    let twitterUrl = appendix.twitter || rawData.webUrl || rawData.twitterUrl || '';

    // 提取website（appendix.website > rawData.website）
    let website = appendix.website || rawData.website || rawData.websiteUrl || '';

    return {
      intro_en: rawData.intro_en || rawData.introduction || '',
      intro_cn: rawData.intro_cn || '',
      website: website,
      twitter_url: twitterUrl,
      description: rawData.description || ''
    };
  }

  /**
   * 判断缓存是否有效
   */
  static isCacheValid(cached) {
    const currentVersion = PromptBuilder.getPromptVersion();
    return cached.prompt_version === currentVersion;
  }

  /**
   * 格式化返回结果
   */
  static formatResult(record) {
    return {
      token: {
        address: record.token_address,
        symbol: record.token_symbol,
        raw_api_data: record.raw_api_data
      },
      extracted_info: record.extracted_info,
      twitter: record.twitter_info,
      llmAnalysis: {
        category: record.llm_category,
        rawOutput: record.llm_raw_output,
        summary: record.llm_summary
      },
      debugInfo: {
        promptUsed: record.prompt_used,
        promptVersion: record.prompt_version
      }
    };
  }

  /**
   * 批量分析（可选功能）
   */
  static async analyzeBatch(addresses) {
    const results = [];
    for (const address of addresses) {
      try {
        const result = await this.analyze(address);
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, address, error: error.message });
      }
    }
    return results;
  }
}
