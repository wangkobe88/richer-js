/**
 * 叙事分析器
 * 核心服务：协调各组件完成叙事分析
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { NarrativeRepository } from '../db/NarrativeRepository.mjs';
import { TwitterFetcher } from '../utils/twitter-fetcher.mjs';
import { TwitterMediaExtractor } from '../utils/twitter-media-extractor.mjs';
import { ImageDownloader } from '../utils/image-downloader.mjs';
import { WeiboFetcher, WeiboExtractor } from '../utils/weibo-fetcher.mjs';
import { GithubFetcher } from '../utils/github-fetcher.mjs';
import { YoutubeFetcher } from '../utils/youtube-fetcher.mjs';
import { DouyinFetcher } from '../utils/douyin-fetcher.mjs';
import { BilibiliFetcher } from '../utils/bilibili-fetcher.mjs';
import { fetchTikTokVideoInfo, isTikTokUrl } from '../utils/tiktok-fetcher.mjs';
import { fetchWebsiteContent, isFetchableUrl, isTwitterTweetUrl } from '../utils/web-fetcher.mjs';
import { fetchProductInfo, getInfluenceLevel, getInfluenceDescription } from '../utils/amazon-fetcher.mjs';
import { PromptBuilder } from './prompt-builder.mjs';
import { LLMClient } from './llm-client.mjs';
import { extractAllUrls, classifyAllUrls, selectBestUrls } from '../utils/url-classifier.mjs';
import { isHighInfluenceAccount, getHighInfluenceAccountBackground } from './prompts/account-backgrounds.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

// 读取配置文件
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../../../config/default.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// 叙事分析配置
const NARRATIVE_CONFIG = config.narrative || {
  enableImageAnalysis: false,
  enableVideoAnalysis: false,
  twitterBlacklist: [],
  expiredTweetDaysThreshold: 14
};

export class NarrativeAnalyzer {

  /**
   * 清洗代币名称，去除不可见字符和组合字符
   * @param {string} symbol - 原始代币名称
   * @returns {string} 清洗后的代币名称
   */
  static cleanSymbol(symbol) {
    if (!symbol) return symbol;
    // 去除组合字符（U+0300-U+036F）和其他不可见字符
    // 使用normalize('NFC')然后过滤组合字符
    return symbol
      .normalize('NFC')
      .replace(/[\u0300-\u036f\u200b-\u200d\ufeff\u034f]/g, '')
      .trim();
  }

  /**
   * 分析代币叙事（带缓存）
   * @param {string} address - 代币地址
   * @param {Object} options - 选项
   * @param {boolean} options.ignoreCache - 是否忽略缓存，强制重新分析
   * @param {boolean} options.ignoreExpired - 是否忽略过期时间限制
   * @param {string} options.experimentId - 实验ID，用于标识数据来源
   */
  static async analyze(address, options = {}) {
    const { ignoreCache = false, ignoreExpired = false, experimentId = null } = options;

    // 标准化地址
    const normalizedAddress = address.toLowerCase();

    // 1. 检查缓存（查询最新的记录，任何实验的都可以）
    const cached = await NarrativeRepository.findByAddress(normalizedAddress);

    // 2. 判断是否可以使用缓存
    if (cached && cached.is_valid) {
      if (!ignoreCache) {
        // ===== 不设置重新分析（ignoreCache=false）=====
        // 直接使用已有的分析结果（任何实验的都可以）
        // 检查是否是预检查触发的结果
        const isCachedPreCheck = cached.llm_raw_output?.preCheckTriggered === true;
        return {
          ...this.formatResult(cached),
          meta: {
            fromCache: true,
            fromFallback: false,
            preCheckTriggered: isCachedPreCheck,
            preCheckReason: isCachedPreCheck ? cached.llm_raw_output?.preCheckReason : null,
            analyzedAt: cached.analyzed_at,
            sourceExperimentId: cached.experiment_id,
            promptVersion: cached.prompt_version,
            promptType: cached.prompt_type
          }
        };
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

    // 4. 使用URL分类器统一获取所有数据
    console.log('[NarrativeAnalyzer] 开始使用URL分类器获取数据...');
    const {
      twitterInfo,
      websiteInfo,
      backgroundInfo,
      githubInfo,
      youtubeInfo,
      douyinInfo,
      tiktokInfo,
      bilibiliInfo,
      amazonInfo
    } = await this._fetchAllDataViaClassifier(tokenData, extractedInfo);
    console.log('[NarrativeAnalyzer] 数据获取完成');

    // 7. 预检查规则（不调用LLM，直接返回结果）
    const preCheckResult = this.performPreCheck(tokenData, twitterInfo, extractedInfo, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo }, { ignoreExpired });
    let isPreCheckTriggered = preCheckResult !== null;

    let llmResult;
    let promptUsed = '';
    let promptType = '';
    let analysisFailed = false;

    if (isPreCheckTriggered) {
      // 预检查触发，使用预设结果
      console.log('[NarrativeAnalyzer] 预检查触发，跳过LLM分析');
      llmResult = {
        ...preCheckResult,
        raw: null, // 预检查结果没有原始LLM输出
        analysis_stage: 0 // 预检查不属于任何阶段，标记为0
      };
      // 预检查结果也记录prompt类型（用于后续判断）
      const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo };
      promptType = PromptBuilder.getPromptTypeDesc(fetchResults);
      // 预检查时不构建Prompt（不需要）
      promptUsed = null;
    } else {
      // 8. 正常流程：两阶段分析
      try {
        // twitterInfo已包含website_tweet（如果有第二个推文）
        const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo };

        console.log('[NarrativeAnalyzer] 使用两阶段分析模式');

        // Stage 1: 低质量检测
        console.log('[NarrativeAnalyzer] Stage 1: 低质量检测');
        const stage1Prompt = PromptBuilder.buildStage1(tokenData, fetchResults);
        const stage1PromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);
        console.log(`[NarrativeAnalyzer] Stage 1 Prompt类型: ${stage1PromptType}`);

        // Stage 1: 直接调用API获取原始响应（不使用analyze方法，因为它期望category字段）
        const stage1RawResponse = await this._callLLMAPI(stage1Prompt);
        const stage1Data = this._parseStage1Response(stage1RawResponse);

        if (!stage1Data.pass) {
          // Stage 1检测到低质量，直接返回
          const scenarioNum = stage1Data.scenario || 0;
          const reasonText = scenarioNum > 0
            ? `场景${scenarioNum}: ${stage1Data.reason}`
            : stage1Data.reason;
          console.log(`[NarrativeAnalyzer] Stage 1: 检测到低质量 - 场景${scenarioNum}: ${stage1Data.reason}`);
          console.log(`[NarrativeAnalyzer] Stage 1: 识别的实体:`, JSON.stringify(stage1Data.entities));
          llmResult = {
            category: 'low',
            reasoning: reasonText,
            scores: null,
            total_score: null,
            analysis_stage: 1,
            scenario: scenarioNum,
            entities: stage1Data.entities,  // 保存实体列表
            raw: stage1RawResponse
          };
          promptUsed = stage1Prompt;
          promptType = stage1PromptType;
        } else {
          // Stage 1通过，进入Stage 2
          console.log('[NarrativeAnalyzer] Stage 1: 通过，进入Stage 2');
          console.log('[NarrativeAnalyzer] Stage 1: 识别的实体:', JSON.stringify(stage1Data.entities));
          const stage2Prompt = PromptBuilder.buildStage2(tokenData, fetchResults);
          const stage2PromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 2);
          console.log(`[NarrativeAnalyzer] Stage 2 Prompt类型: ${stage2PromptType}`);

          const stage2Result = await LLMClient.analyze(stage2Prompt);

          llmResult = {
            ...stage2Result,
            analysis_stage: 2,
            entities: stage1Data.entities,  // 保存Stage 1的entities
            raw: stage2Result.raw
          };
          promptUsed = stage2Prompt;
          promptType = stage2PromptType;
        }
      } catch (error) {
        console.error('LLM分析失败:', error.message);
        llmResult = {
          category: 'unrated',
          reasoning: `分析失败: ${error.message}`,
          scores: null,
          total_score: null,
          analysis_stage: 0
        };
        analysisFailed = true;
      }
    }

    // 9. 如果分析失败且有缓存，使用缓存作为fallback
    if (analysisFailed && cached && cached.is_valid) {
      console.log(`分析失败，使用已有缓存作为fallback | address=${normalizedAddress}, cached_experiment=${cached.experiment_id}`);
      return {
        ...this.formatResult(cached),
        meta: {
          fromCache: true,
          fromFallback: true, // 标记这是fallback缓存
          analyzedAt: cached.analyzed_at,
          sourceExperimentId: cached.experiment_id,
          promptVersion: cached.prompt_version,
          promptType: cached.prompt_type
        },
        debugInfo: {
          promptUsed: cached.prompt_used,
          promptVersion: cached.prompt_version,
          promptType: cached.prompt_type
        }
      };
    }

    // 9. 保存结果（包含 experiment_id 和 prompt_type）- 只有在分析成功时才保存
    // 注意：只保存 twitter_info，微博等背景信息不保存（已缓存到 external_resource_cache）

    // 清理数据中的空字符和控制字符（PostgreSQL不支持）
    const cleanedTwitterInfo = this._cleanDataForDB(twitterInfo);
    const cleanedPromptUsed = this._cleanDataForDB(promptUsed);

    // 准备llm_raw_output：Stage 1的entities需要合并到rawOutput中
    let rawOutputToSave = llmResult.raw || llmResult;
    if (llmResult.entities && typeof rawOutputToSave === 'object') {
      // 有entities（Stage 1或Stage 2都可能携带），合并到保存的数据中
      rawOutputToSave = { ...rawOutputToSave, entities: llmResult.entities };
    }

    const saveResult = await NarrativeRepository.save({
      token_address: normalizedAddress,
      token_symbol: tokenData.symbol,
      raw_api_data: tokenData.raw_api_data,
      extracted_info: extractedInfo,
      twitter_info: cleanedTwitterInfo,
      llm_category: llmResult.category,
      llm_raw_output: rawOutputToSave,
      llm_summary: {
        total_score: llmResult.total_score,
        credibility_score: llmResult.scores?.credibility,
        virality_score: llmResult.scores?.virality,
        reasoning: llmResult.reasoning,
        category: llmResult.category,
        scenario: llmResult.scenario || null,  // Stage 1 低质量场景编号
        entities: llmResult.entities || null  // 仅Stage 1有entities
      },
      prompt_used: cleanedPromptUsed,
      prompt_version: PromptBuilder.getPromptVersion(),
      prompt_type: promptType,  // 记录使用的Prompt类型
      analysis_stage: llmResult.analysis_stage || 2,  // 分析阶段单独保存
      experiment_id: experimentId,  // 记录来源实验
      analyzed_at: new Date().toISOString()
    });

    return {
      ...this.formatResult(saveResult),
      backgroundInfo: backgroundInfo, // 返回背景信息供调试使用
      meta: {
        fromCache: false,
        preCheckTriggered: isPreCheckTriggered,
        preCheckReason: isPreCheckTriggered ? llmResult.preCheckReason : null,
        analyzedAt: saveResult.analyzed_at,
        sourceExperimentId: experimentId,
        promptVersion: PromptBuilder.getPromptVersion(),
        promptType: promptType
      },
      debugInfo: {
        promptUsed: promptUsed,
        promptVersion: PromptBuilder.getPromptVersion(),
        promptType: promptType
      }
    };
  }

  /**
   * 预检查规则（不调用LLM，直接返回结果）
   * @param {Object} tokenData - 代币数据
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} extractedInfo - 提取的结构化信息
   * @param {Object} videoInfos - 视频信息对象
   * @param {Object} options - 预检查选项
   * @param {boolean} options.ignoreExpired - 是否忽略过期时间限制
   * @returns {Object|null} 如果触发预检查规则，返回预设结果；否则返回null
   */
  static performPreCheck(tokenData, twitterInfo, extractedInfo, videoInfos = {}, options = {}) {
    const { ignoreExpired = false } = options;
    const { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo } = videoInfos;

    // 规则1：黑名单博主
    // 1.1 从twitterInfo中获取用户名
    let authorScreenName = twitterInfo?.author_screen_name;

    // 1.2 如果twitterInfo为空，尝试从URL提取用户名
    if (!authorScreenName && extractedInfo?.twitter_url) {
      const urlMatch = extractedInfo.twitter_url.match(/x\.com\/([^\/]+)/);
      if (urlMatch) {
        authorScreenName = urlMatch[1];
      }
    }

    if (authorScreenName && NARRATIVE_CONFIG.twitterBlacklist?.includes(authorScreenName)) {
      console.log(`[NarrativeAnalyzer] 预检查触发: 推文作者 @${authorScreenName} 在黑名单中`);
      return {
        category: 'low',
        reasoning: `推文作者@${authorScreenName}在黑名单中，该账号专门制造虚假叙事`,
        scores: { credibility: 0, virality: 0 },
        total_score: 0,
        preCheckTriggered: true,
        preCheckReason: 'blacklist'
      };
    }

    // 规则2：过期内容检查（推文或视频超过配置的天数阈值）
    // 如果设置了ignoreExpired，跳过过期检查
    if (!ignoreExpired) {
      const expiredDaysThreshold = NARRATIVE_CONFIG.expiredTweetDaysThreshold || 14;

      // 2.1 检查推文过期
      if (twitterInfo?.type === 'tweet' && twitterInfo?.created_at) {
        try {
          const tweetDate = new Date(twitterInfo.created_at);
          const now = new Date();
          const daysDiff = (now - tweetDate) / (1000 * 60 * 60 * 24);

          if (daysDiff > expiredDaysThreshold) {
            console.log(`[NarrativeAnalyzer] 预检查触发: 推文发布时间超过${expiredDaysThreshold}天 (${twitterInfo.formatted_created_at || twitterInfo.created_at})`);
            return {
              category: 'low',
              reasoning: `推文发布时间超过${expiredDaysThreshold}天（${twitterInfo.formatted_created_at || twitterInfo.created_at}），叙事价值已耗尽`,
              scores: { credibility: 10, virality: 10 },
              total_score: 20,
              preCheckTriggered: true,
              preCheckReason: 'expired_tweet'
            };
          }
        } catch (e) {
          console.warn('[NarrativeAnalyzer] 解析推文时间失败:', e.message);
        }
      }

      // 2.2 检查视频过期（抖音、YouTube、TikTok、Bilibili）
      // 视频过期阈值：180天（6个月）
      const expiredVideoDaysThreshold = 180;

      const videos = [
        { name: '抖音', info: douyinInfo },
        { name: 'YouTube', info: youtubeInfo },
        { name: 'TikTok', info: tiktokInfo },
        { name: 'Bilibili', info: bilibiliInfo }
      ];

      for (const video of videos) {
        // 获取视频发布时间（不同平台字段名不同）
        const videoTime = video.info?.create_time || video.info?.publish_date || video.info?.create;
        if (videoTime) {
          try {
            const videoDate = new Date(videoTime);
            const now = new Date();
            const daysDiff = (now - videoDate) / (1000 * 60 * 60 * 24);

            if (daysDiff > expiredVideoDaysThreshold) {
              console.log(`[NarrativeAnalyzer] 预检查触发: ${video.name}视频发布时间超过${expiredVideoDaysThreshold}天 (${videoTime})`);
              return {
                category: 'low',
                reasoning: `${video.name}视频发布时间超过${expiredVideoDaysThreshold}天（${Math.floor(daysDiff)}天前），叙事价值已耗尽`,
                scores: { credibility: 10, virality: 10 },
                total_score: 20,
                preCheckTriggered: true,
                preCheckReason: 'expired_video'
              };
            }
          } catch (e) {
            console.warn(`[NarrativeAnalyzer] 解析${video.name}视频时间失败:`, e.message);
          }
        } else if (video.info) {
          // 有视频数据但无发布时间：记录日志用于调试
          console.log(`[NarrativeAnalyzer] ${video.name}视频无发布时间数据，跳过过期检查`);
          console.log(`[NarrativeAnalyzer] ${video.name}视频数据:`, JSON.stringify(video.info).substring(0, 200));
        }
      }
    } else {
      console.log('[NarrativeAnalyzer] 忽略过期时间限制（ignoreExpired=true）');
    }

    // 规则3：视频传播力检查（有视频时直接判断，不走LLM）
    // 优先级：Bilibili > 抖音 > TikTok > YouTube
    const videoPriority = [
      { name: 'Bilibili', info: bilibiliInfo, viewField: 'view_count', likeField: 'like_count' },
      { name: '抖音', info: douyinInfo, viewField: 'stat_count', likeField: 'like_count' },
      { name: 'TikTok', info: tiktokInfo, viewField: 'view_count', likeField: 'like_count' },
      { name: 'YouTube', info: youtubeInfo, viewField: 'view_count', likeField: 'like_count' }
    ];

    for (const video of videoPriority) {
      if (!video.info) continue;

      // 检查是否有有效的播放量数据
      const viewCount = video.info[video.viewField];
      const likeCount = video.info[video.likeField];

      if (viewCount !== undefined && viewCount !== null) {
        console.log(`[NarrativeAnalyzer] 规则3触发: 发现${video.name}视频，播放量=${viewCount}`);

        // 根据播放量判断
        // Bilibili: >500播放 → unrated, <500 → low
        // 抖音: >1000播放 → unrated, <1000 → low
        const unratedThreshold = video.name === 'Bilibili' ? 500 : 1000;

        if (viewCount >= unratedThreshold) {
          console.log(`[NarrativeAnalyzer] 规则3结果: ${video.name}视频播放量(${viewCount})达到阈值，返回unrated`);
          return {
            category: 'unrated',
            reasoning: `${video.name}视频播放量${viewCount}，无法解析视频内容进行完整叙事评估`,
            scores: null,
            total_score: null,
            preCheckTriggered: true,
            preCheckReason: 'video_unrated'
          };
        } else {
          console.log(`[NarrativeAnalyzer] 规则3结果: ${video.name}视频播放量(${viewCount})过低，返回low`);
          return {
            category: 'low',
            reasoning: `${video.name}视频播放量仅${viewCount}，传播力不足`,
            scores: { credibility: 10, virality: 10 },
            total_score: 20,
            preCheckTriggered: true,
            preCheckReason: 'video_low_views'
          };
        }
      }
    }

    // 规则4：数据不足 → unrated
    // 同时满足以下条件时，没有足够的信息进行评估
    const hasTwitterInfo = twitterInfo && (twitterInfo.text || twitterInfo.type === 'account');
    const hasWebsite = extractedInfo && extractedInfo.website;
    const hasIntro = extractedInfo && (extractedInfo.intro_en || extractedInfo.intro_cn);
    const isIntroSimple = !hasIntro || (
      (extractedInfo.intro_en || '').length < 20 &&
      (extractedInfo.intro_cn || '').length < 20
    );

    if (!hasTwitterInfo && !hasWebsite && isIntroSimple) {
      console.log('[NarrativeAnalyzer] 规则4触发: 数据不足（无推文、无website、intro简单）');
      return {
        category: 'unrated',
        reasoning: '数据不足，无法评估叙事质量（缺少推文、网站等核心信息）',
        scores: null,
        total_score: null,
        preCheckTriggered: true,
        preCheckReason: 'insufficient_data'
      };
    }

    // 规则5：高影响力推文 + 媒体 → unrated（保护可能的好叙事）
    // 检查条件：
    // 1. 推文作者属于高影响力账号（Elon、Trump等）
    // 2. 或者推文交互数据高（点赞>5000 或 转发>2000）
    // 3. 并且推文带有图片/视频

    // 收集所有可能的推文信息
    const allTweets = [];
    if (twitterInfo?.type === 'tweet') {
      allTweets.push(twitterInfo);
    }
    if (twitterInfo?.website_tweet?.type === 'tweet') {
      allTweets.push(twitterInfo.website_tweet);
    }
    if (twitterInfo?.quoted_status?.type === 'tweet') {
      allTweets.push(twitterInfo.quoted_status);
    }

    for (const tweet of allTweets) {
      // 检查是否有媒体
      const hasMedia = tweet?.media?.has_media ||
                       (tweet?.media?.images && tweet.media.images.length > 0) ||
                       (tweet?.media?.videos && tweet.media.videos.length > 0);

      if (!hasMedia) continue;

      // 检查作者是否是高影响力账号
      const authorScreenName = tweet?.author_screen_name;
      const isHighInfluence = isHighInfluenceAccount(authorScreenName);

      // 检查交互数据是否高
      const metrics = tweet?.metrics || {};
      const likeCount = metrics.like_count || 0;
      const retweetCount = metrics.retweet_count || 0;
      const isHighEngagement = likeCount > 5000 || retweetCount > 2000;

      // 如果满足任一条件 + 有媒体 → unrated
      if (isHighInfluence || isHighEngagement) {
        const reasons = [];
        if (isHighInfluence) {
          const background = getHighInfluenceAccountBackground(authorScreenName);
          reasons.push(`推文作者@${authorScreenName}是高影响力账号（${background}）`);
        }
        if (isHighEngagement) {
          reasons.push(`推文交互数据高（点赞${likeCount}，转发${retweetCount}）`);
        }
        reasons.push('推文带有媒体内容');

        console.log(`[NarrativeAnalyzer] 规则4触发: ${reasons.join('，')}，返回unrated`);
        return {
          category: 'unrated',
          reasoning: `${reasons.join('，')}，无法解析媒体内容进行完整叙事评估`,
          scores: null,
          total_score: null,
          preCheckTriggered: true,
          preCheckReason: 'high_influence_with_media'
        };
      }
    }

    return null; // 通过预检查，继续LLM分析
  }

  /**
   * 基于URL分类器的统一数据获取流程
   * @param {Object} tokenData - 代币数据
   * @param {Object} extractedInfo - 提取的结构化信息
   * @returns {Object} 所有获取到的数据
   */
  static async _fetchAllDataViaClassifier(tokenData, extractedInfo) {
    // 1. 从appendix和raw_api_data中提取所有URL
    const rawData = tokenData.raw_api_data || {};
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

    // 构建完整的数据对象用于URL提取
    const fullData = {
      ...rawData,
      ...extractedInfo,
      appendix
    };

    // 2. 提取所有URL
    const allUrls = extractAllUrls(fullData);
    console.log(`[NarrativeAnalyzer] 从数据中提取到 ${allUrls.length} 个URL`);

    if (allUrls.length === 0) {
      console.log('[NarrativeAnalyzer] 未找到任何URL，返回空数据');
      return {
        twitterInfo: null,
        websiteInfo: null,
        backgroundInfo: null,
        githubInfo: null,
        youtubeInfo: null,
        douyinInfo: null,
        tiktokInfo: null,
        bilibiliInfo: null,
        amazonInfo: null
      };
    }

    // 3. 分类所有URL
    const classifiedUrls = classifyAllUrls(allUrls);
    console.log('[NarrativeAnalyzer] URL分类结果:', {
      twitter: classifiedUrls.twitter.length,
      weibo: classifiedUrls.weibo.length,
      youtube: classifiedUrls.youtube.length,
      tiktok: classifiedUrls.tiktok.length,
      douyin: classifiedUrls.douyin.length,
      bilibili: classifiedUrls.bilibili.length,
      github: classifiedUrls.github.length,
      amazon: classifiedUrls.amazon.length,
      websites: classifiedUrls.websites.length
    });

    // 4. 选择每个平台的最佳URL
    const bestUrls = selectBestUrls(classifiedUrls);
    console.log('[NarrativeAnalyzer] 选中的最佳URL:', {
      twitter: bestUrls.twitter?.url || null,
      weibo: classifiedUrls.weibo[0]?.url || null,
      youtube: bestUrls.youtube?.url || null,
      tiktok: bestUrls.tiktok?.url || null,
      douyin: bestUrls.douyin?.url || null,
      bilibili: bestUrls.bilibili?.url || null,
      github: bestUrls.github?.url || null,
      amazon: bestUrls.amazon?.url || null,
      website: bestUrls.website?.url || null
    });

    // 5. 顺序获取数据（按优先级）
    return await this._fetchDataSequentially(bestUrls, classifiedUrls, tokenData);
  }

  /**
   * 顺序获取各平台数据
   * @param {Object} bestUrls - 选中的最佳URL
   * @param {Object} classifiedUrls - 分类后的所有URL
   * @param {Object} tokenData - 代币数据
   * @returns {Object} 获取到的所有数据
   */
  static async _fetchDataSequentially(bestUrls, classifiedUrls, tokenData) {
    const results = {
      twitterInfo: null,
      websiteInfo: null,
      backgroundInfo: null,
      githubInfo: null,
      youtubeInfo: null,
      douyinInfo: null,
      tiktokInfo: null,
      bilibiliInfo: null,
      amazonInfo: null
    };

    // === 1. Twitter数据（最高优先级）===
    if (bestUrls.twitter) {
      console.log(`[NarrativeAnalyzer] 获取Twitter数据: ${bestUrls.twitter.url}`);
      try {
        results.twitterInfo = await TwitterFetcher.fetchFromUrls(bestUrls.twitter.url, null);

        // 如果成功获取推文，尝试获取推文中的链接内容
        if (results.twitterInfo && results.twitterInfo.text) {
          console.log('[NarrativeAnalyzer] 推文已获取，尝试获取推文链接内容');
          results.twitterInfo = await TwitterFetcher.enrichWithLinkContent(results.twitterInfo);
        }

        // 图片分析（如果启用）
        if (NARRATIVE_CONFIG.enableImageAnalysis && results.twitterInfo?.media && TwitterMediaExtractor.hasImages(results.twitterInfo)) {
          console.log('[NarrativeAnalyzer] 推文包含图片，开始分析...');
          const imageUrls = TwitterMediaExtractor.extractImageUrls(results.twitterInfo);
          const firstImage = imageUrls[0];
          if (firstImage) {
            try {
              const imageData = await ImageDownloader.downloadAsBase64(firstImage.url);
              if (imageData) {
                const imageAnalysis = await LLMClient.analyzeTwitterImage(imageData.dataUrl);
                results.twitterInfo.image_analysis = {
                  url: firstImage.url,
                  analysis: imageAnalysis
                };
                console.log('[NarrativeAnalyzer] 图片分析完成');
              }
            } catch (error) {
              console.warn('[NarrativeAnalyzer] 图片分析失败:', error.message);
            }
          }
        }

        // 非中英文推文翻译
        if (results.twitterInfo && results.twitterInfo.text) {
          const tweetLang = this.detectLanguage(results.twitterInfo.text);
          if (tweetLang && tweetLang !== 'zh' && tweetLang !== 'en') {
            console.log(`[NarrativeAnalyzer] 检测到非中英文推文 (${tweetLang})，尝试翻译...`);
            try {
              const translated = await LLMClient.translate(results.twitterInfo.text, 'zh');
              if (translated) {
                const standardized = this.standardizeTranslatedNames(translated, tokenData.symbol);
                results.twitterInfo.text_original = results.twitterInfo.text;
                results.twitterInfo.text = standardized;
                results.twitterInfo.text_translated = true;
                results.twitterInfo.original_language = tweetLang;
                console.log('[NarrativeAnalyzer] 推文翻译成功');
              }
            } catch (error) {
              console.warn('[NarrativeAnalyzer] 推文翻译失败:', error.message);
            }
          }
        }

        // 检查是否有第二个推文（可能来自website URL或classifiedUrls中的第二个twitter URL）
        let secondTweetUrl = null;

        // 首先检查bestUrls.website是否指向另一个推文
        if (bestUrls.website && bestUrls.website.type === 'tweet' && bestUrls.website.platform === 'twitter') {
          const websiteUrl = bestUrls.website.url;
          if (websiteUrl !== bestUrls.twitter.url) {
            secondTweetUrl = websiteUrl;
          }
        }

        // 如果website没有第二个推文，检查classifiedUrls.twitter中是否有多个推文
        if (!secondTweetUrl && classifiedUrls.twitter.length > 1) {
          // classifiedUrls.twitter[0] 是主推文，检查 [1] 是否是不同的推文
          const secondTweetInfo = classifiedUrls.twitter.find(t => t.url !== bestUrls.twitter.url);
          if (secondTweetInfo) {
            secondTweetUrl = secondTweetInfo.url;
          }
        }

        // 获取第二个推文
        if (secondTweetUrl) {
          console.log('[NarrativeAnalyzer] 检测到第二个推文链接，获取中...');
          try {
            const websiteTweet = await TwitterFetcher.fetchFromUrls(secondTweetUrl, null);
            if (websiteTweet && websiteTweet.type === 'tweet' && websiteTweet.text) {
              results.twitterInfo.website_tweet = websiteTweet;
              console.log('[NarrativeAnalyzer] 成功获取第二个推文');
            }
          } catch (error) {
            console.warn('[NarrativeAnalyzer] 获取第二个推文失败:', error.message);
          }
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] Twitter数据获取失败:', error.message);
      }
    }

    // === 2. 微博数据（作为背景信息）===
    if (classifiedUrls.weibo.length > 0) {
      const weiboUrl = classifiedUrls.weibo[0].url;
      console.log(`[NarrativeAnalyzer] 获取微博数据作为背景信息: ${weiboUrl}`);
      try {
        results.backgroundInfo = await WeiboFetcher.fetchFromUrl(weiboUrl);
        if (results.backgroundInfo) {
          results.backgroundInfo.source = 'weibo';
          console.log('[NarrativeAnalyzer] 微博数据获取成功');
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] 微博数据获取失败:', error.message);
      }
    }

    // === 3. GitHub数据 ===
    if (bestUrls.github) {
      console.log(`[NarrativeAnalyzer] 获取GitHub数据: ${bestUrls.github.url}`);
      try {
        results.githubInfo = await GithubFetcher.fetchRepoInfo(bestUrls.github.url);
        if (results.githubInfo) {
          const influenceLevel = GithubFetcher.getInfluenceLevel(results.githubInfo);
          results.githubInfo.influence_level = influenceLevel;
          results.githubInfo.influence_description = GithubFetcher.getInfluenceDescription(influenceLevel);
          results.githubInfo.is_official_token = GithubFetcher.isOfficialToken(results.githubInfo, tokenData.symbol);
          console.log(`[NarrativeAnalyzer] GitHub信息: ${results.githubInfo.stargazers_count} stars`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] GitHub数据获取失败:', error.message);
      }
    }

    // === 4. YouTube数据 ===
    if (bestUrls.youtube) {
      console.log(`[NarrativeAnalyzer] 获取YouTube数据: ${bestUrls.youtube.url}`);
      try {
        results.youtubeInfo = await YoutubeFetcher.fetchVideoInfo(bestUrls.youtube.url);
        if (results.youtubeInfo) {
          const influenceLevel = YoutubeFetcher.getInfluenceLevel(results.youtubeInfo);
          results.youtubeInfo.influence_level = influenceLevel;
          results.youtubeInfo.influence_description = YoutubeFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] YouTube信息: "${results.youtubeInfo.title}"`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] YouTube数据获取失败:', error.message);
      }
    }

    // === 5. 抖音数据 ===
    if (bestUrls.douyin) {
      console.log(`[NarrativeAnalyzer] 获取抖音数据: ${bestUrls.douyin.url}`);
      try {
        results.douyinInfo = await DouyinFetcher.fetchVideoInfo(bestUrls.douyin.url);
        if (results.douyinInfo) {
          const influenceLevel = DouyinFetcher.getInfluenceLevel(results.douyinInfo);
          results.douyinInfo.influence_level = influenceLevel;
          results.douyinInfo.influence_description = DouyinFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] 抖音信息: "${results.douyinInfo.title}"`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] 抖音数据获取失败:', error.message);
      }
    }

    // === 6. TikTok数据 ===
    if (bestUrls.tiktok) {
      console.log(`[NarrativeAnalyzer] 获取TikTok数据: ${bestUrls.tiktok.url}`);
      try {
        results.tiktokInfo = await fetchTikTokVideoInfo(bestUrls.tiktok.url);
        if (results.tiktokInfo) {
          const influenceLevel = getTikTokInfluenceLevel(results.tiktokInfo);
          results.tiktokInfo.influence_level = influenceLevel;
          results.tiktokInfo.influence_description = getTikTokInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] TikTok信息: @${results.tiktokInfo.author_username}`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] TikTok数据获取失败:', error.message);
      }
    }

    // === 7. Bilibili数据 ===
    if (bestUrls.bilibili) {
      console.log(`[NarrativeAnalyzer] 获取Bilibili数据: ${bestUrls.bilibili.url}`);
      try {
        results.bilibiliInfo = await BilibiliFetcher.fetchVideoInfo(bestUrls.bilibili.url);
        if (results.bilibiliInfo) {
          const influenceLevel = BilibiliFetcher.getInfluenceLevel(results.bilibiliInfo);
          results.bilibiliInfo.influence_level = influenceLevel;
          results.bilibiliInfo.influence_description = BilibiliFetcher.getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] Bilibili信息: "${results.bilibiliInfo.title}"`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] Bilibili数据获取失败:', error.message);
      }
    }

    // === 8. Amazon数据 ===
    if (bestUrls.amazon) {
      console.log(`[NarrativeAnalyzer] 获取Amazon数据: ${bestUrls.amazon.url}`);
      try {
        results.amazonInfo = await fetchProductInfo(bestUrls.amazon.url);
        if (results.amazonInfo) {
          const influenceLevel = getInfluenceLevel(results.amazonInfo);
          results.amazonInfo.influence_level = influenceLevel;
          results.amazonInfo.influence_description = getInfluenceDescription(influenceLevel);
          console.log(`[NarrativeAnalyzer] Amazon信息: "${results.amazonInfo.title}"`);
        }
      } catch (error) {
        console.warn('[NarrativeAnalyzer] Amazon数据获取失败:', error.message);
      }
    }

    // === 9. 普通网站数据 ===
    if (bestUrls.website) {
      const websiteUrl = bestUrls.website.url;
      // 排除视频平台、GitHub和Amazon（已经处理过）
      const isVideoPlatform = /youtube|youtu\.be|tiktok|douyin|bilibili|b23\.tv/i.test(websiteUrl);
      const isGithub = /github\.com/i.test(websiteUrl);
      const isAmazon = /amazon\.com/i.test(websiteUrl);

      if (!isVideoPlatform && !isGithub && !isAmazon && isFetchableUrl(websiteUrl)) {
        console.log(`[NarrativeAnalyzer] 获取网站内容: ${websiteUrl}`);
        try {
          results.websiteInfo = await fetchWebsiteContent(websiteUrl, { maxLength: 5000 });
          console.log('[NarrativeAnalyzer] 网站内容获取成功');
        } catch (error) {
          console.warn('[NarrativeAnalyzer] 网站内容获取失败:', error.message);
        }
      }
    }

    return results;
  }

  /**
   * 从数据库获取代币数据
   */
  static async fetchTokenData(address) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('experiment_tokens')
      .select('token_symbol, raw_api_data, blockchain, platform')
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
      symbol: this.cleanSymbol(data.token_symbol),  // 清洗代币名
      blockchain: data.blockchain,
      platform: data.platform,
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

    // 提取weibo_url（appendix.weibo > rawData.weibo）
    let weiboUrl = appendix.weibo || rawData.weibo || rawData.weiboUrl || '';

    return {
      intro_en: rawData.intro_en || rawData.introduction || '',
      intro_cn: rawData.intro_cn || '',
      website: website,
      twitter_url: twitterUrl,
      weibo_url: weiboUrl,
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
   * 清理数据以便保存到数据库（移除PostgreSQL不支持的控制字符）
   * @param {*} data - 要清理的数据
   * @returns {*} 清理后的数据
   */
  static _cleanDataForDB(data) {
    if (!data) return null;

    // 处理字符串
    if (typeof data === 'string') {
      // 移除空字符和其他控制字符（0x00-0x1F）
      return data.replace(/[\x00-\x1F\x7F]/g, '');
    }

    // 处理对象
    if (Array.isArray(data)) {
      return data.map(item => this._cleanDataForDB(item));
    }

    if (typeof data === 'object') {
      const cleaned = {};
      for (const [key, value] of Object.entries(data)) {
        cleaned[key] = this._cleanDataForDB(value);
      }
      return cleaned;
    }

    return data;
  }

  /**
   * 格式化返回结果
   */
  static formatResult(record) {
    const rawOutput = record.llm_raw_output || {};
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
        rawOutput: rawOutput,
        summary: record.llm_summary,
        entities: rawOutput.entities || null  // 明确提取entities字段
      },
      debugInfo: {
        promptUsed: record.prompt_used,
        promptVersion: record.prompt_version,
        promptType: record.prompt_type,
        analysisStage: record.analysis_stage
      }
    };
  }

  /**
   * 解析Stage 1响应
   * @param {string} content - LLM响应内容
   * @returns {Object} 解析结果 { pass: boolean, reason: string, entities: Object }
   * @private
   */
  static _parseStage1Response(content) {
    // 多种策略尝试提取JSON
    let jsonStr = null;

    // 策略1: 尝试提取markdown代码块中的JSON
    const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
      console.log('[NarrativeAnalyzer] Stage 1: 使用代码块策略提取JSON');
    }

    // 策略2: 尝试提取第一个完整的JSON对象（使用括号匹配）
    if (!jsonStr) {
      let depth = 0;
      let start = -1;
      for (let i = 0; i < content.length; i++) {
        if (content[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (content[i] === '}') {
          depth--;
          if (depth === 0 && start >= 0) {
            jsonStr = content.substring(start, i + 1);
            console.log('[NarrativeAnalyzer] Stage 1: 使用括号匹配策略提取JSON');
            break;
          }
        }
      }
    }

    // 策略3: 使用正则表达式匹配（兼容性后备方案）
    if (!jsonStr) {
      const regexMatch = content.match(/\{[\s\S]*\}/);
      if (regexMatch) {
        jsonStr = regexMatch[0];
        console.log('[NarrativeAnalyzer] Stage 1: 使用正则策略提取JSON');
      }
    }

    // 如果所有策略都失败，打印原始响应并抛出错误
    if (!jsonStr) {
      console.error('[NarrativeAnalyzer] Stage 1: 无法提取JSON，原始响应:', content);
      throw new Error('Stage 1: 无法提取JSON');
    }

    try {
      const result = JSON.parse(jsonStr);
      if (typeof result.pass !== 'boolean') {
        throw new Error('Stage 1: pass字段必须是boolean');
      }

      return {
        pass: result.pass,
        reason: result.reason || '',
        scenario: result.scenario || 0,
        entities: result.entities || {}  // 保存实体列表用于调试
      };
    } catch (parseError) {
      console.error('[NarrativeAnalyzer] Stage 1: JSON解析失败，提取的字符串:', jsonStr);
      throw new Error(`Stage 1: JSON解析失败 - ${parseError.message}`);
    }
  }

  /**
   * 直接调用LLM API并返回原始响应
   * 用于Stage 1等需要自定义响应格式的场景
   * @param {string} prompt - Prompt内容
   * @returns {Promise<string>} LLM原始响应内容
   * @private
   */
  static async _callLLMAPI(prompt) {
    // 从环境变量获取配置
    const { SILICONFLOW_API_URL, SILICONFLOW_API_KEY, LLM_MODEL } = process.env;

    const apiUrl = SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1';
    const apiKey = SILICONFLOW_API_KEY;
    const model = LLM_MODEL || 'deepseek-ai/DeepSeek-V3';

    if (!apiKey) {
      throw new Error('SILICONFLOW_API_KEY 未配置');
    }

    const timeout = 120000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    console.log(`[NarrativeAnalyzer] 开始调用LLM API... 模型: ${model}`);

    try {
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
          presence_penalty: 0,
          frequency_penalty: 0,
          seed: 42
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API 调用失败: ${response.status} ${errorText}`);
      }

      console.log('[NarrativeAnalyzer] API响应成功');
      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('LLM 返回内容为空');
      }

      console.log('[NarrativeAnalyzer] API调用完成');
      return content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('[NarrativeAnalyzer] 请求超时');
        throw new Error(`LLM API 调用超时（${timeout/1000}秒）`);
      }
      throw error;
    }
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

/**
 * 获取TikTok影响力等级
 * @param {Object} tiktokInfo - TikTok视频信息
 * @returns {string} 影响力等级
 */
function getTikTokInfluenceLevel(tiktokInfo) {
  const viewCount = tiktokInfo.view_count || 0;
  const likeCount = tiktokInfo.like_count || 0;

  // 根据播放量和点赞数判断影响力
  if (viewCount >= 1000000 || likeCount >= 100000) {
    return 'world'; // 世界级：100万播放或10万点赞
  } else if (viewCount >= 100000 || likeCount >= 10000) {
    return 'platform'; // 平台级：10万播放或1万点赞
  } else if (viewCount >= 10000 || likeCount >= 1000) {
    return 'community'; // 社区级：1万播放或1000点赞
  } else {
    return 'niche'; // 小众：低于1万播放且1000点赞
  }
}

/**
 * 获取TikTok影响力等级描述
 * @param {string} level - 影响力等级
 * @returns {string} 描述
 */
function getTikTokInfluenceDescription(level) {
  const descriptions = {
    'world': '世界级影响力（100万+播放）',
    'platform': '平台级影响力（10万+播放）',
    'community': '社区级影响力（1万+播放）',
    'niche': '小众影响力（1万以下播放）'
  };
  return descriptions[level] || '未知影响力';
}
