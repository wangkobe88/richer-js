/**
 * 叙事分析器
 * 核心服务：协调各组件完成叙事分析
 */

import { NarrativeRepository } from '../db/NarrativeRepository.mjs';
import { TwitterFetcher } from '../utils/twitter-fetcher.mjs';
import { TwitterMediaExtractor } from '../utils/twitter-media-extractor.mjs';
import { ImageDownloader } from '../utils/image-downloader.mjs';
import { WeiboFetcher, WeiboExtractor } from '../utils/weibo-fetcher.mjs';
import { GithubFetcher } from '../utils/github-fetcher.mjs';
import { YoutubeFetcher } from '../utils/youtube-fetcher.mjs';
import { DouyinFetcher } from '../utils/douyin-fetcher.mjs';
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
        // 只有当 experimentId 明确指定且与缓存的 experiment_id 匹配时，才使用缓存
        if (experimentId && cached.experiment_id === experimentId) {
          // 缓存是当前实验的 → 说明本实验已经分析过这个代币了
          // 直接使用缓存，不再重复分析
          return this.formatResult(cached);
        }
        // 缓存是别的实验的（或 experiment_id 为空）或 experimentId 未指定
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

    // 4. 获取Twitter内容
    let twitterInfo = await TwitterFetcher.fetchFromUrls(
      extractedInfo.twitter_url,
      extractedInfo.website
    );

    // 4.2 如果推文包含图片，进行图片分析
    if (twitterInfo && twitterInfo.media && TwitterMediaExtractor.hasImages(twitterInfo)) {
      console.log('[NarrativeAnalyzer] 推文包含图片，开始分析...');
      const imageUrls = TwitterMediaExtractor.extractImageUrls(twitterInfo);

      // 只分析第一张图片（通常是主要图片）
      const firstImage = imageUrls[0];
      if (firstImage) {
        try {
          const imageData = await ImageDownloader.downloadAsBase64(firstImage.url);
          if (imageData) {
            const imageAnalysis = await LLMClient.analyzeTwitterImage(imageData.dataUrl);
            twitterInfo.image_analysis = {
              url: firstImage.url,
              analysis: imageAnalysis
            };
            console.log('[NarrativeAnalyzer] 图片分析完成');
          }
        } catch (error) {
          console.warn('[NarrativeAnalyzer] 图片分析失败:', error.message);
          // 图片分析失败不影响整体流程
        }
      }
    }

    // 4.3 如果成功获取推文且是非中英文，尝试翻译
    if (twitterInfo && twitterInfo.text) {
      const tweetLang = this.detectLanguage(twitterInfo.text);
      if (tweetLang && tweetLang !== 'zh' && tweetLang !== 'en') {
        console.log(`[NarrativeAnalyzer] 检测到非中英文推文 (${tweetLang})，尝试翻译...`);
        try {
          // 使用 LLM 翻译
          const translated = await LLMClient.translate(twitterInfo.text, 'zh');

          if (translated) {
            // 标准化常见译名（如：卢菲 → 路飞，川普 → 特朗普）
            const standardized = this.standardizeTranslatedNames(translated, tokenData.symbol);

            twitterInfo.text_original = twitterInfo.text;
            twitterInfo.text = standardized;
            twitterInfo.text_translated = true;
            twitterInfo.original_language = tweetLang;
            console.log('[NarrativeAnalyzer] 推文翻译成功');
          }
        } catch (error) {
          console.warn('[NarrativeAnalyzer] 推文翻译失败:', error.message);
          // 翻译失败，继续使用原文
        }
      }
    }

    // 4.5 如果成功获取推文，尝试获取推文中的链接内容
    if (twitterInfo && twitterInfo.text) {
      console.log('[NarrativeAnalyzer] 推文已获取，尝试获取推文链接内容');
      twitterInfo = await TwitterFetcher.enrichWithLinkContent(twitterInfo);
    }

    // 5. 获取背景信息（微博等外部资源）- 不存储到 token_narrative
    let backgroundInfo = null;

    // 检查是否是微博链接（作为背景信息）
    if (extractedInfo.website && WeiboExtractor.isValidWeiboUrl(extractedInfo.website)) {
      console.log('[NarrativeAnalyzer] 检测到微博链接，获取作为背景信息');
      backgroundInfo = await WeiboFetcher.fetchFromUrl(extractedInfo.website);
      backgroundInfo.source = 'weibo';
    }
    // 检查 twitter_url 是否是微博链接
    else if (extractedInfo.twitter_url && WeiboExtractor.isValidWeiboUrl(extractedInfo.twitter_url)) {
      console.log('[NarrativeAnalyzer] 检测到微博链接，获取作为背景信息');
      backgroundInfo = await WeiboFetcher.fetchFromUrl(extractedInfo.twitter_url);
      backgroundInfo.source = 'weibo';
    }

    // 6. 如果没有Twitter信息且有网站，尝试获取网页内容
    // 注意：当Twitter获取失败时，即使网站是YouTube/TikTok等，也会尝试获取
    let websiteInfo = null;
    if (!twitterInfo && extractedInfo.website) {
      // Twitter失败时，尝试获取任何类型的网站内容
      websiteInfo = await fetchWebsiteContent(extractedInfo.website, { maxLength: 5000 });
    } else if (!extractedInfo.twitter_url && extractedInfo.website && isFetchableUrl(extractedInfo.website)) {
      // 没有Twitter URL时，只获取可安全获取的网站（排除视频平台等）
      websiteInfo = await fetchWebsiteContent(extractedInfo.website, { maxLength: 5000 });
    } else if (twitterInfo && extractedInfo.website && isFetchableUrl(extractedInfo.website)) {
      // 有Twitter信息但也要获取网站内容的情况：
      // 1. Twitter只是账号信息，没有推文内容
      // 2. Twitter推文内容很少（少于50字符）
      const shouldFetchWebsite =
        (twitterInfo.type === 'account') ||  // 只是账号，没有推文
        (twitterInfo.text && twitterInfo.text.length < 50);  // 推文太短

      if (shouldFetchWebsite) {
        console.log('[NarrativeAnalyzer] Twitter信息不完整，尝试获取网站内容作为补充');
        websiteInfo = await fetchWebsiteContent(extractedInfo.website, { maxLength: 5000 });
      }
    }

    // 6.5. 获取 GitHub 仓库信息（如果有 GitHub 链接）
    let githubInfo = null;
    if (extractedInfo.website && GithubFetcher.isValidGithubUrl(extractedInfo.website)) {
      console.log('[NarrativeAnalyzer] 检测到 GitHub 链接，获取仓库信息');
      try {
        githubInfo = await GithubFetcher.fetchRepoInfo(extractedInfo.website);
        if (githubInfo) {
          // 添加影响力等级信息
          const influenceLevel = GithubFetcher.getInfluenceLevel(githubInfo);
          githubInfo.influence_level = influenceLevel;
          githubInfo.influence_description = GithubFetcher.getInfluenceDescription(influenceLevel);
          // 判断是否是官方代币
          githubInfo.is_official_token = GithubFetcher.isOfficialToken(githubInfo, tokenData.symbol);
          console.log(`[NarrativeAnalyzer] GitHub 信息: ${githubInfo.stargazers_count} stars, ${influenceLevel}`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] GitHub 信息获取失败:', error.message);
      }
    }

    // 6.6. 获取 YouTube 视频信息（如果有 YouTube 链接）
    let youtubeInfo = null;
    if (YoutubeFetcher.isValidYoutubeUrl(extractedInfo.website) ||
        YoutubeFetcher.isValidYoutubeUrl(extractedInfo.twitter_url)) {
      const youtubeUrl = extractedInfo.website && YoutubeFetcher.isValidYoutubeUrl(extractedInfo.website)
        ? extractedInfo.website
        : extractedInfo.twitter_url;
      console.log('[NarrativeAnalyzer] 检测到 YouTube 链接，获取视频信息');
      try {
        youtubeInfo = await YoutubeFetcher.fetchVideoInfo(youtubeUrl);
        if (youtubeInfo) {
          // 添加影响力等级信息
          const influenceLevel = YoutubeFetcher.getInfluenceLevel(youtubeInfo);
          youtubeInfo.influence_level = influenceLevel;
          youtubeInfo.influence_description = YoutubeFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] YouTube 信息: "${youtubeInfo.title}", ${influenceLevel}`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] YouTube 信息获取失败:', error.message);
      }
    }

    // 6.7. 获取抖音视频信息（如果有抖音链接）
    let douyinInfo = null;
    if (DouyinFetcher.isValidDouyinUrl(extractedInfo.website) ||
        DouyinFetcher.isValidDouyinUrl(extractedInfo.twitter_url)) {
      const douyinUrl = extractedInfo.website && DouyinFetcher.isValidDouyinUrl(extractedInfo.website)
        ? extractedInfo.website
        : extractedInfo.twitter_url;
      console.log('[NarrativeAnalyzer] 检测到抖音链接，获取视频信息');
      try {
        douyinInfo = await DouyinFetcher.fetchVideoInfo(douyinUrl);
        if (douyinInfo) {
          // 添加影响力等级信息
          const influenceLevel = DouyinFetcher.getInfluenceLevel(douyinInfo);
          douyinInfo.influence_level = influenceLevel;
          douyinInfo.influence_description = DouyinFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] 抖音信息: "${douyinInfo.title}", ${influenceLevel}`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] 抖音信息获取失败:', error.message);
      }
    }

    // 7. 构建Prompt并调用LLM
    let llmResult;
    let promptUsed = '';
    let analysisFailed = false;
    try {
      promptUsed = PromptBuilder.build(tokenData, twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo);
      llmResult = await LLMClient.analyze(promptUsed);
    } catch (error) {
      console.error('LLM分析失败:', error.message);
      llmResult = {
        category: 'unrated',
        reasoning: `分析失败: ${error.message}`
      };
      analysisFailed = true;
    }

    // 8. 如果分析失败且有缓存，使用缓存作为fallback
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

    // 9. 保存结果（包含 experiment_id）- 只有在分析成功时才保存
    // 注意：只保存 twitter_info，微博等背景信息不保存（已缓存到 external_resource_cache）
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
      backgroundInfo: backgroundInfo, // 返回背景信息供调试使用
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
   * 简单检测文本语言
   * @param {string} text - 要检测的文本
   * @returns {string|null} 语言代码（zh, en, th, ja, ko 等）
   */
  static detectLanguage(text) {
    if (!text || text.length < 10) {
      return null;
    }

    // 检查是否包含中文字符
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh';
    }

    // 检查是否包含泰文字符
    if (/[\u0e00-\u0e7f]/.test(text)) {
      return 'th';
    }

    // 检查是否包含日文字符
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      return 'ja';
    }

    // 检查是否包含韩文字符
    if (/[\uac00-\ud7af]/.test(text)) {
      return 'ko';
    }

    // 检查是否包含阿拉伯文字符
    if (/[\u0600-\u06ff]/.test(text)) {
      return 'ar';
    }

    // 检查是否包含俄文字符
    if (/[\u0400-\u04ff]/.test(text)) {
      return 'ru';
    }

    // 默认认为是英语
    return 'en';
  }

  /**
   * 标准化常见译名
   * 将翻译结果中的常见译名变体统一为标准译名
   * @param {string} text - 翻译后的文本
   * @param {string} tokenName - 代币名称
   * @returns {string} 标准化后的文本
   */
  static standardizeTranslatedNames(text, tokenName) {
    if (!text || !tokenName) {
      return text;
    }

    let standardized = text;

    // 路飞的常见译名变体
    if (tokenName === '路飞' || tokenName === 'Luffy' || tokenName === 'ルフィ') {
      standardized = standardized.replace(/卢菲/g, '路飞');
      standardized = standardized.replace(/鲁夫/g, '路飞');
      standardized = standardized.replace(/魯夫/g, '路飞');
    }

    // 特朗普的常见译名变体
    if (tokenName === '特朗普' || tokenName === 'Trump' || tokenName === 'トランプ') {
      standardized = standardized.replace(/川普/g, '特朗普');
    }

    // 可以继续添加其他常见译名的标准化规则

    return standardized;
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
