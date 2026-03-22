/**
 * 叙事分析器
 * 核心服务：协调各组件完成叙事分析
 */

import { NarrativeRepository } from '../db/NarrativeRepository.mjs';
import { TwitterFetcher } from '../utils/twitter-fetcher.mjs';
import { fetchWebsiteContent, isFetchableUrl } from '../utils/web-fetcher.mjs';
import { PromptBuilder } from './prompt-builder.mjs';
import { LLMClient } from './llm-client.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

export class NarrativeAnalyzer {

  /**
   * 分析代币叙事（带缓存）
   * @param {string} address - 代币地址
   * @param {Object} options - 选项
   * @param {boolean} options.ignoreCache - 是否忽略缓存，强制重新分析
   * @param {string} options.experimentId - 实验ID，用于标识数据来源
   */
  static async analyze(address, options = {}) {
    const { ignoreCache = false, experimentId = null } = options;

    // 标准化地址
    const normalizedAddress = address.toLowerCase();

    // 1. 检查缓存（查询最新的记录，任何实验的都可以）
    const cached = await NarrativeRepository.findByAddress(normalizedAddress);

    // 2. 判断是否可以使用缓存
    if (cached && cached.is_valid) {
      if (!ignoreCache) {
        // ===== 不设置重新分析（ignoreCache=false）=====
        // 直接使用已有的分析结果（任何实验的都可以）
        return this.formatResult(cached);
      } else {
        // ===== 设置了重新分析（ignoreCache=true）=====
        // 检查缓存的 experiment_id 是否是当前实验
        if (cached.experiment_id === experimentId) {
          // 缓存是当前实验的 → 说明本实验已经分析过这个代币了
          // 直接使用缓存，不再重复分析
          return this.formatResult(cached);
        }
        // 缓存是别的实验的（或 experiment_id 为空）
        // → 需要重新分析，保存时带上当前 experiment_id
        // 这样后续再遇到这个代币时，就会命中本实验的缓存
      }
    }

    // 3. 执行叙事分析（缓存未命中 或 需要重新分析）
    // 分析结果会保存时带上当前 experiment_id，用于后续缓存判断

    // 2. 从数据库获取代币数据
    const tokenData = await this.fetchTokenData(normalizedAddress);
    if (!tokenData) {
      throw new Error('代币不存在');
    }

    // 3. 提取结构化信息
    const extractedInfo = this.extractInfo(tokenData);

    // 4. 获取推文内容
    let twitterInfo = await TwitterFetcher.fetchFromUrls(
      extractedInfo.twitter_url,
      extractedInfo.website
    );

    // 4.5 如果成功获取推文，尝试获取推文中的链接内容
    if (twitterInfo && twitterInfo.text) {
      console.log('[NarrativeAnalyzer] 推文已获取，尝试获取推文链接内容');
      twitterInfo = await TwitterFetcher.enrichWithLinkContent(twitterInfo);
    }

    // 4.5 如果没有Twitter信息且有网站，尝试获取网页内容
    // 注意：当Twitter获取失败时，即使网站是YouTube/TikTok等，也会尝试获取
    let websiteInfo = null;
    if (!twitterInfo && extractedInfo.website) {
      // Twitter失败时，尝试获取任何类型的网站内容
      websiteInfo = await fetchWebsiteContent(extractedInfo.website, { maxLength: 5000 });
    } else if (!extractedInfo.twitter_url && extractedInfo.website && isFetchableUrl(extractedInfo.website)) {
      // 没有Twitter URL时，只获取可安全获取的网站（排除视频平台等）
      websiteInfo = await fetchWebsiteContent(extractedInfo.website, { maxLength: 5000 });
    }

    // 5. 构建Prompt并调用LLM
    let llmResult;
    let promptUsed = '';
    let analysisFailed = false;
    try {
      promptUsed = PromptBuilder.build(tokenData, twitterInfo, websiteInfo, extractedInfo);
      llmResult = await LLMClient.analyze(promptUsed);
    } catch (error) {
      console.error('LLM分析失败:', error.message);
      llmResult = {
        category: 'unrated',
        reasoning: `分析失败: ${error.message}`
      };
      analysisFailed = true;
    }

    // 6. 如果分析失败且有缓存，使用缓存作为fallback
    if (analysisFailed && cached && cached.is_valid) {
      console.log(`分析失败，使用已有缓存作为fallback | address=${normalizedAddress}, cached_experiment=${cached.experiment_id}`);
      return {
        ...this.formatResult(cached),
        meta: {
          fromCache: true,
          fromFallback: true, // 标记这是fallback缓存
          analyzedAt: cached.analyzed_at,
          sourceExperimentId: cached.experiment_id,
          promptVersion: cached.prompt_version
        },
        debugInfo: {
          promptUsed: cached.prompt_used,
          promptVersion: cached.prompt_version
        }
      };
    }

    // 7. 保存结果（包含 experiment_id）- 只有在分析成功时才保存
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
      prompt_version: PromptBuilder.getPromptVersion(),
      experiment_id: experimentId,  // 记录来源实验
      analyzed_at: new Date().toISOString()
    });

    return {
      ...this.formatResult(saveResult),
      meta: {
        fromCache: false,
        analyzedAt: saveResult.analyzed_at,
        sourceExperimentId: experimentId,
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

    // 提取twitter_url（按优先级）：
    // 1. appendix.twitter
    // 2. rawData.webUrl
    // 3. rawData.twitterUrl
    // 4. fourmeme_creator_info.full_info.raw.twitterUrl
    // 5. fourmeme_creator_info.full_info.twitterUrl
    let twitterUrl = appendix.twitter || rawData.webUrl || rawData.twitterUrl || '';

    // 尝试从 fourmeme_creator_info 获取
    if (!twitterUrl && rawData.fourmeme_creator_info) {
      const creatorInfo = rawData.fourmeme_creator_info;
      if (creatorInfo.full_info && creatorInfo.full_info.raw && creatorInfo.full_info.raw.twitterUrl) {
        twitterUrl = creatorInfo.full_info.raw.twitterUrl;
      } else if (creatorInfo.full_info && creatorInfo.full_info.twitterUrl) {
        twitterUrl = creatorInfo.full_info.twitterUrl;
      }
    }

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
