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
        const isCachedPreCheck = !!cached.pre_check_result;
        return {
          ...this.formatResult(cached),
          meta: {
            fromCache: true,
            fromFallback: false,
            preCheckTriggered: isCachedPreCheck,
            preCheckReason: isCachedPreCheck ? cached.pre_check_reason : null,
            analyzedAt: cached.analyzed_at,
            sourceExperimentId: cached.experiment_id
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

    // 准备数据收集变量
    let stage1DataToSave = null;
    let stage2DataToSave = null;
    let preCheckDataToSave = null;
    let urlExtractionResult = null;
    let dataFetchResults = null;

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
      amazonInfo,
      classifiedUrls,
      fetchErrors,  // 获取数据收集的错误信息
      url_extraction_result,  // URL提取结果
      data_fetch_results  // 数据获取结果
    } = await this._fetchAllDataViaClassifier(tokenData, extractedInfo);

    // 保存URL提取和数据获取结果
    urlExtractionResult = url_extraction_result;
    dataFetchResults = data_fetch_results;

    console.log('[NarrativeAnalyzer] 数据获取完成');

    // 7. 预检查规则（不调用LLM，直接返回结果）
    const preCheckResult = await this.performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo }, githubInfo, backgroundInfo, { ignoreExpired });
    let isPreCheckTriggered = preCheckResult !== null;

    let llmResult;
    let promptUsed = '';
    let promptType = '';
    let analysisFailed = false;

    if (isPreCheckTriggered) {
      // 预检查触发，使用预设结果
      console.log('[NarrativeAnalyzer] 预检查触发，跳过LLM分析');

      // 收集预检查数据
      preCheckDataToSave = {
        category: preCheckResult.category,
        reason: preCheckResult.preCheckReason,
        result: preCheckResult
      };

      llmResult = {
        ...preCheckResult,
        raw: null // 预检查结果没有原始LLM输出
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
        const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo, classifiedUrls };

        // 检查是否有任何有效数据供分析
        const hasAnyData = this._hasValidDataForAnalysis(fetchResults);
        if (!hasAnyData) {
          console.log('[NarrativeAnalyzer] 没有有效数据可供分析，返回unrated');
          llmResult = {
            category: 'unrated',
            reasoning: '没有可用的数据进行分析（所有推文/内容获取失败）',
            scores: null,
            total_score: null,
            raw: null
          };
          promptUsed = null;
          promptType = 'no_data';
          analysisFailed = false;
        } else {
          console.log('[NarrativeAnalyzer] 使用两阶段分析模式');

        // Stage 1: 低质量检测
        console.log('[NarrativeAnalyzer] Stage 1: 低质量检测');
        const stage1Prompt = PromptBuilder.buildStage1(tokenData, fetchResults);
        const stage1PromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);
        console.log(`[NarrativeAnalyzer] Stage 1 Prompt类型: ${stage1PromptType}`);

        // Stage 1: 调用API获取原始响应（带元数据）
        const stage1CallResult = await this._callLLMAPI(stage1Prompt);

        // 检查Stage 1是否成功
        if (!stage1CallResult.success) {
          throw new Error(`Stage 1 LLM调用失败: ${stage1CallResult.error}`);
        }

        const stage1Data = this._parseStage1Response(stage1CallResult.content);

        if (!stage1Data.pass) {
          // Stage 1检测到低质量，直接返回
          const stageNum = stage1Data.stage || 0;
          const scenarioNum = stage1Data.scenario || 0;

          // 构建原因文本
          let reasonText = stage1Data.reason;
          if (stageNum === 1) {
            reasonText = `第一阶段（内容空洞）: ${stage1Data.reason}`;
          } else if (stageNum === 2) {
            reasonText = `第二阶段（无相关性）: ${stage1Data.reason}`;
          } else if (stageNum === 3 && scenarioNum > 0) {
            reasonText = `第三阶段（场景${scenarioNum}）: ${stage1Data.reason}`;
          }

          console.log(`[NarrativeAnalyzer] Stage 1: 检测到低质量 - 阶段${stageNum}${scenarioNum > 0 ? ', 场景' + scenarioNum : ''}: ${stage1Data.reason}`);
          console.log(`[NarrativeAnalyzer] Stage 1: 识别的实体:`, JSON.stringify(stage1Data.entities));

          llmResult = {
            category: 'low',
            reasoning: reasonText,
            scores: null,
            total_score: null
          };

          // 收集Stage 1数据
          stage1DataToSave = {
            category: 'low',
            model: stage1CallResult.model,
            prompt: stage1Prompt,
            raw_output: stage1CallResult.content,
            parsed_output: stage1Data,
            started_at: stage1CallResult.startedAt,
            finished_at: stage1CallResult.finishedAt,
            success: stage1CallResult.success,
            error: stage1CallResult.error
          };

          promptType = stage1PromptType;
        } else {
          // Stage 1通过，进入Stage 2
          console.log('[NarrativeAnalyzer] Stage 1: 通过，进入Stage 2');
          console.log('[NarrativeAnalyzer] Stage 1: 识别的实体:', JSON.stringify(stage1Data.entities));
          const stage2Prompt = PromptBuilder.buildStage2(tokenData, fetchResults);
          const stage2PromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 2);
          console.log(`[NarrativeAnalyzer] Stage 2 Prompt类型: ${stage2PromptType}`);

          // Stage 2: 调用API（带元数据）
          const stage2CallResult = await LLMClient.analyzeWithMetadata(stage2Prompt);

          // 检查Stage 2是否成功
          if (!stage2CallResult.success) {
            throw new Error(`Stage 2 LLM调用失败: ${stage2CallResult.error}`);
          }

          llmResult = {
            ...stage2CallResult.parsed
          };

          // 收集Stage 2数据
          stage2DataToSave = {
            category: stage2CallResult.parsed.category,
            model: stage2CallResult.model,
            prompt: stage2Prompt,
            raw_output: stage2CallResult.raw.raw,
            parsed_output: stage2CallResult.parsed,
            started_at: stage2CallResult.startedAt,
            finished_at: stage2CallResult.finishedAt,
            success: stage2CallResult.success,
            error: stage2CallResult.error
          };

          // Stage 1通过，也需要记录
          stage1DataToSave = {
            category: null,  // 通过，所以category为null
            model: stage1CallResult.model,
            prompt: stage1Prompt,
            raw_output: stage1CallResult.content,
            parsed_output: stage1Data,
            started_at: stage1CallResult.startedAt,
            finished_at: stage1CallResult.finishedAt,
            success: stage1CallResult.success,
            error: stage1CallResult.error
          };

          promptType = stage2PromptType;
        }
        } // 关闭 hasAnyData 检查的 else 分支
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
          sourceExperimentId: cached.experiment_id
        }
      };
    }

    // 9. 保存结果（包含 experiment_id 和 prompt_type）- 只有在分析成功时才保存
    // 注意：只保存 twitter_info，微博等背景信息不保存（已缓存到 external_resource_cache）

    // 清理数据中的空字符和控制字符（PostgreSQL不支持）
    const cleanedTwitterInfo = this._cleanDataForDB(twitterInfo);

    const saveResult = await NarrativeRepository.save({
      // === 基础字段 ===
      token_address: normalizedAddress,
      token_symbol: tokenData.symbol,
      raw_api_data: tokenData.raw_api_data,
      extracted_info: extractedInfo,
      twitter_info: cleanedTwitterInfo,
      classified_urls: classifiedUrls,
      analyzed_at: new Date().toISOString(),
      experiment_id: experimentId,

      // === 预检查字段（3个）===
      pre_check_category: preCheckDataToSave?.category || null,
      pre_check_reason: preCheckDataToSave?.reason || null,
      pre_check_result: preCheckDataToSave?.result || null,

      // === Stage 1 字段（9个）===
      llm_stage1_category: stage1DataToSave?.category || null,
      llm_stage1_model: stage1DataToSave?.model || null,
      llm_stage1_prompt: stage1DataToSave?.prompt || null,
      llm_stage1_raw_output: stage1DataToSave?.raw_output || null,
      llm_stage1_parsed_output: stage1DataToSave?.parsed_output || null,
      llm_stage1_started_at: stage1DataToSave?.started_at || null,
      llm_stage1_finished_at: stage1DataToSave?.finished_at || null,
      llm_stage1_success: stage1DataToSave?.success ?? null,
      llm_stage1_error: stage1DataToSave?.error || null,

      // === Stage 2 字段（9个）===
      llm_stage2_category: stage2DataToSave?.category || null,
      llm_stage2_model: stage2DataToSave?.model || null,
      llm_stage2_prompt: stage2DataToSave?.prompt || null,
      llm_stage2_raw_output: stage2DataToSave?.raw_output || null,
      llm_stage2_parsed_output: stage2DataToSave?.parsed_output || null,
      llm_stage2_started_at: stage2DataToSave?.started_at || null,
      llm_stage2_finished_at: stage2DataToSave?.finished_at || null,
      llm_stage2_success: stage2DataToSave?.success ?? null,
      llm_stage2_error: stage2DataToSave?.error || null,

      // === Debug字段（2个）===
      url_extraction_result: urlExtractionResult || null,
      data_fetch_results: dataFetchResults || null
    });

    return {
      ...this.formatResult(saveResult),
      backgroundInfo: backgroundInfo, // 返回背景信息供调试使用
      classifiedUrls: classifiedUrls, // 返回分类后的URL供前端展示
      fetchErrors: fetchErrors, // 添加数据获取错误信息（来自_fetchDataSequentially）
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
        promptType: promptType,
        // 根据执行的stage确定analysisStage
        analysisStage: stage2DataToSave ? 2 : stage1DataToSave ? 1 : 0,
        // 新增：Stage 1/2 数据
        stage1Data: stage1DataToSave,
        stage2Data: stage2DataToSave,
        preCheckData: preCheckDataToSave,
        // 新增：URL提取和数据获取结果
        urlExtractionResult: urlExtractionResult,
        dataFetchResults: dataFetchResults
      }
    };
  }

  /**
   * 预检查规则（不调用LLM，直接返回结果）
   * @param {Object} tokenData - 代币数据
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} extractedInfo - 提取的结构化信息
   * @param {Object} websiteInfo - Website信息
   * @param {Object} classifiedUrls - 分类URLs
   * @param {Object} videoInfos - 视频信息对象
   * @param {Object} githubInfo - GitHub信息
   * @param {Object} backgroundInfo - 背景信息（微博等）
   * @param {Object} options - 预检查选项
   * @param {boolean} options.ignoreExpired - 是否忽略过期时间限制
   * @returns {Object|null} 如果触发预检查规则，返回预设结果；否则返回null
   */
  static async performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls = {}, videoInfos = {}, githubInfo = null, backgroundInfo = null, options = {}) {
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

    // 规则1.1：通过账号发币且粉丝数/发帖数过少检查
    // 【已注释】出现反例：小粉丝账号也可能有潜力
    // 如果只是账号链接（无推文内容），且粉丝数少于100或发帖数少于10，缺乏传播基础
    /*
    const isAccountOnly = twitterInfo?.type === 'account' && !twitterInfo?.text;
    const followersCount = twitterInfo?.followers_count || twitterInfo?.author_followers_count || 0;
    const statusesCount = twitterInfo?.statuses_count || 0;

    if (isAccountOnly) {
      const reasons = [];
      if (followersCount < 100) {
        reasons.push(`粉丝数仅${followersCount}`);
      }
      if (statusesCount < 10) {
        reasons.push(`发帖数仅${statusesCount}`);
      }

      // 首次发帖时间检查（仅在发帖数少时执行，避免额外API调用）
      let firstTweetAgeDays = null;
      if (statusesCount > 0 && statusesCount < 10) {
        try {
          const twitterValidationModule = await import('../../utils/twitter-validation/new-apis.js');
          const { getUserTweets } = twitterValidationModule;

          const userId = twitterInfo?.id;
          if (userId) {
            const tweets = await getUserTweets(userId, { count: '50' });
            if (tweets && tweets.length > 0) {
              // 最后一条是最早的推文
              const oldestTweet = tweets[tweets.length - 1];
              const tweetDate = new Date(oldestTweet.created_at);
              const now = new Date();
              firstTweetAgeDays = (now - tweetDate) / (1000 * 60 * 60 * 24);

              console.log(`[NarrativeAnalyzer] 检查首次发帖时间: ${Math.floor(firstTweetAgeDays)}天前`);

              // 首次发帖时间在2周内（14天）
              if (firstTweetAgeDays < 14) {
                reasons.push(`首次发帖仅${Math.floor(firstTweetAgeDays)}天（新账号）`);
              }
            }
          }
        } catch (err) {
          console.warn('[NarrativeAnalyzer] 获取首次发帖时间失败:', err.message);
          // 失败时继续，不影响其他检查
        }
      }

      if (reasons.length > 0) {
        const screenName = twitterInfo?.screen_name || authorScreenName;
        console.log(`[NarrativeAnalyzer] 预检查触发: 账号发币且数据过少 (@${screenName}, ${followersCount}粉丝, ${statusesCount}推文)`);
        return {
          category: 'low',
          reasoning: `通过账号发币但${reasons.join('、')}，缺乏传播基础和社区支持（买的老号无历史内容）`,
          scores: { credibility: 5, virality: 5 },
          total_score: 10,
          preCheckTriggered: true,
          preCheckReason: 'account_low_stats'
        };
      }
    }
    */

    // 规则1.5：项目币-账号名匹配检查
    // 如果是账号类型，说明是项目币，发展情况不明
    // 如果账号名与代币名匹配，返回 unrated（无法评估项目发展潜力）
    if (twitterInfo?.type === 'account') {
      const tokenSymbol = (tokenData.symbol || '').toLowerCase().trim();
      const accountScreenName = (twitterInfo.screen_name || '').toLowerCase().trim();
      const accountName = (twitterInfo.name || '').toLowerCase().trim();

      // 匹配函数：检查两个字符串是否匹配（包含/被包含/去掉空格匹配）
      const isMatch = (str1, str2) => {
        if (!str1 || !str2) return false;
        // 直接包含
        if (str1.includes(str2) || str2.includes(str1)) return true;
        // 去掉空格、下划线、横线后匹配
        const clean1 = str1.replace(/[\s_\-]/g, '');
        const clean2 = str2.replace(/[\s_\-]/g, '');
        return clean1.includes(clean2) || clean2.includes(clean1);
      };

      // 检查代币名与账号名是否匹配
      if (isMatch(tokenSymbol, accountScreenName) || isMatch(tokenSymbol, accountName)) {
        const screenName = twitterInfo.screen_name || accountScreenName;
        console.log(`[NarrativeAnalyzer] 预检查触发: 项目币账号名匹配 (代币:${tokenSymbol}, 账号:@${screenName})`);
        return {
          category: 'unrated',
          reasoning: `项目币账号名匹配（@${screenName}），发展情况不明，无法评估meme潜力`,
          scores: null,
          total_score: null,
          preCheckTriggered: true,
          preCheckReason: 'project_account_match'
        };
      }
    }

    // 规则1.6：应用商店链接检查
    // 应用商店App不适合构建meme币（产品而非事件，缺乏传播属性）
    const appStoreDomains = [
      'apps.apple.com',           // Apple App Store
      'play.google.com',          // Google Play Store
      'appgallery.huawei.com',    // Huawei AppGallery
      'store.steampowered.com',   // Steam Store
      'apps.microsoft.com',       // Microsoft Store
      'www.amazon.com/appstore',  // Amazon Appstore
      'apkcombo.com',             // APK下载站
      'apkpure.com',              // APK下载站
      'apkmirror.com'             // APK下载站
    ];

    // 检查website URL
    const websiteUrl = extractedInfo?.website;
    if (websiteUrl) {
      try {
        const urlObj = new URL(websiteUrl);
        const hostname = urlObj.hostname.toLowerCase();

        if (appStoreDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
          console.log(`[NarrativeAnalyzer] 预检查触发: 检测到应用商店链接 (${websiteUrl})`);
          return {
            category: 'low',
            reasoning: `检测到应用商店链接，App产品不适合构建meme币（缺乏事件驱动和病毒传播属性）`,
            scores: { credibility: 5, virality: 5 },
            total_score: 10,
            preCheckTriggered: true,
            preCheckReason: 'app_store_link'
          };
        }

        // 规则1.7：微信链接检查（已注释，存在反例）
        // 微信文章无法在Web3良好传播（封闭生态，无法分享到外网）
        // const wechatPatterns = [
        //   'mp.weixin.qq.com',      // 微信公众号文章
        //   'wx.',                    // 微信相关域名（如 wx.tech-melon.top）
        //   'weixin.qq.com',          // 微信其他链接
        // ];

        // if (wechatPatterns.some(pattern => hostname === pattern || hostname.includes(pattern))) {
        //   console.log(`[NarrativeAnalyzer] 预检查触发: 检测到微信链接 (${websiteUrl})`);
        //   return {
        //     category: 'low',
        //     reasoning: `检测到微信链接，微信文章无法在Web3良好传播（封闭生态，无法分享到外网）`,
        //     scores: { credibility: 5, virality: 5 },
        //     total_score: 10,
        //     preCheckTriggered: true,
        //     preCheckReason: 'wechat_link'
        //   };
        // }
      } catch (e) {
        // URL解析失败，继续后续检查
        console.warn('[NarrativeAnalyzer] 解析URL失败:', websiteUrl, e.message);
      }
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
      // 视频过期阈值：30天（1个月）
      const expiredVideoDaysThreshold = 30;

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

    // 规则2.5：币安相关检查
    // 如果代币名 + 任何语料都包含币安关键词，返回unrated（项目币，发展情况不明）
    const binanceCheck = this._checkBinanceRelated(tokenData, {
      twitterInfo,
      websiteInfo,
      classifiedUrls,
      extractedInfo
    });

    if (binanceCheck.isBinanceRelated) {
      console.log(`[NarrativeAnalyzer] 币安相关，返回unrated: ${binanceCheck.reason}`);
      return {
        category: 'unrated',
        reasoning: `${binanceCheck.reason}，项目币发展情况不明，无法评估meme潜力`,
        scores: null,
        total_score: null,
        preCheckTriggered: true,
        preCheckReason: 'binance_related'
      };
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

      // 检查播放量和点赞数
      const viewCount = video.info[video.viewField];
      const likeCount = video.info[video.likeField];

      // 优先检查播放量，如果没有播放量则检查点赞数
      const hasViewData = viewCount !== undefined && viewCount !== null;
      const hasLikeData = likeCount !== undefined && likeCount !== null;

      if (!hasViewData && !hasLikeData) continue;

      // 设置阈值（播放量或点赞数任一达到即可）
      const unratedViewThreshold = video.name === 'Bilibili' ? 500 : 1000;
      const unratedLikeThreshold = 100000; // 10万点赞

      // 判断是否达到 unrated 阈值
      const viewMeetsThreshold = hasViewData && viewCount >= unratedViewThreshold;
      const likeMeetsThreshold = hasLikeData && likeCount >= unratedLikeThreshold;

      // 获取用于显示的数据
      const displayValue = hasViewData ? viewCount : likeCount;
      const displayType = hasViewData ? '播放量' : '点赞数';

      if (viewMeetsThreshold || likeMeetsThreshold) {
        console.log(`[NarrativeAnalyzer] 规则3触发: ${video.name}视频${displayType}=${displayValue}，达到unrated阈值`);
        return {
          category: 'unrated',
          reasoning: `${video.name}视频${displayType}${displayValue}，无法解析视频内容进行完整叙事评估`,
          scores: null,
          total_score: null,
          preCheckTriggered: true,
          preCheckReason: 'video_unrated'
        };
      }

      // 播放量/点赞数过低 → low
      if (hasViewData && viewCount < unratedViewThreshold) {
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

      // 点赞数过低（如果没有播放量数据）
      if (!hasViewData && hasLikeData && likeCount < 1000) {
        console.log(`[NarrativeAnalyzer] 规则3结果: ${video.name}视频点赞数(${likeCount})过低，返回low`);
        return {
          category: 'low',
          reasoning: `${video.name}视频点赞数仅${likeCount}，传播力不足`,
          scores: { credibility: 10, virality: 10 },
          total_score: 20,
          preCheckTriggered: true,
          preCheckReason: 'video_low_likes'
        };
      }
    }

    // 规则4：公开信息检查（基于 classifiedUrls）
    // 区分两种情况：没有公开信息（unrated） vs 有信息但失效（low）

    // 公开信息平台（排除 Telegram/Discord 通讯应用）
    const publicUrlPlatforms = ['twitter', 'weibo', 'youtube', 'tiktok', 'douyin', 'bilibili', 'github', 'amazon', 'websites'];

    // 检查是否有任何公开URL
    const hasAnyPublicUrl = publicUrlPlatforms.some(platform =>
      classifiedUrls[platform] && classifiedUrls[platform].length > 0
    );

    // 情况A：没有公开URL → unrated
    if (!hasAnyPublicUrl) {
      const hasTelegram = !!(classifiedUrls.telegram && classifiedUrls.telegram.length > 0);
      const hasDiscord = !!(classifiedUrls.discord && classifiedUrls.discord.length > 0);
      const reason = (hasTelegram || hasDiscord)
        ? '仅有通讯应用链接（Telegram/Discord），缺少公开可验证的叙事信息'
        : '缺少任何有效的公开信息来源（网站、社交媒体、视频等），无法评估叙事';

      console.log(`[NarrativeAnalyzer] 规则4触发: ${reason}`);
      return {
        category: 'unrated',
        reasoning: reason,
        scores: null,
        total_score: null,
        preCheckTriggered: true,
        preCheckReason: 'no_public_info'
      };
    }

    // 情况B：有公开URL，检查数据是否获取成功
    const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo };
    const hasValidData = this._hasValidDataForAnalysis(fetchResults);

    if (!hasValidData) {
      // 有URL但都没获取到数据 → low
      console.log(`[NarrativeAnalyzer] 规则4触发: 有公开信息但内容获取失败或已失效`);
      return {
        category: 'low',
        reasoning: '有公开信息链接但内容获取失败或已失效（推文删除、网站无法访问、视频下架等），叙事价值已耗尽',
        scores: { credibility: 5, virality: 5 },
        total_score: 10,
        preCheckTriggered: true,
        preCheckReason: 'public_info_fetch_failed'
      };
    }

    // 有有效数据，继续后续规则检查

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
    if (allUrls.length > 0) {
      console.log('[NarrativeAnalyzer] 提取到的URL:', allUrls.join(', '));
    } else {
      // 调试：输出关键字段帮助排查
      console.log('[NarrativeAnalyzer] URL提取失败，调试信息:');
      console.log('  - rawData.keys:', Object.keys(rawData).join(', '));
      console.log('  - rawData部分字段:', JSON.stringify({
        socials: rawData.socials,
        socialLinks: rawData.socialLinks,
        links: rawData.links,
        website: rawData.website,
        webUrl: rawData.webUrl,
        twitter: rawData.twitter,
        telegram: rawData.telegram,
        discord: rawData.discord
      }, null, 2));
      console.log('  - extractedInfo:', JSON.stringify(extractedInfo, null, 2));
      console.log('  - appendix:', JSON.stringify(appendix, null, 2));
    }

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
        amazonInfo: null,
        classifiedUrls: {  // 空的分类URL对象
          twitter: [],
          weibo: [],
          youtube: [],
          tiktok: [],
          douyin: [],
          bilibili: [],
          github: [],
          amazon: [],
          telegram: [],
          discord: [],
          websites: []
        },
        fetchErrors: {  // 空的错误对象
          twitterError: null,
          websiteError: null,
          githubError: null,
          videoErrors: {}
        },
        bestUrls: null
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
      telegram: classifiedUrls.telegram.length,
      discord: classifiedUrls.discord.length,
      websites: classifiedUrls.websites.length
    });

    // 准备URL提取结果
    const url_extraction_result = {
      total_urls: allUrls.length,
      classified_urls: classifiedUrls,
      extraction_errors: []
    };

    // 4. 顺序获取数据（按优先级）
    const fetchData = await this._fetchDataSequentially(classifiedUrls, tokenData, extractedInfo);

    return {
      ...fetchData,
      url_extraction_result
    };
  }

  /**
   * 顺序获取各平台数据
   * @param {Object} classifiedUrls - 分类后的所有URL
   * @param {Object} tokenData - 代币数据
   * @param {Object} extractedInfo - 提取的结构化信息
   * @returns {Object} 获取到的所有数据
   */
  static async _fetchDataSequentially(classifiedUrls, tokenData, extractedInfo) {
    const results = {
      twitterInfo: null,
      websiteInfo: null,
      backgroundInfo: null,
      githubInfo: null,
      youtubeInfo: null,
      douyinInfo: null,
      tiktokInfo: null,
      bilibiliInfo: null,
      amazonInfo: null,
      // 存储数据获取错误信息
      fetchErrors: {
        twitterError: null,
        websiteError: null,
        githubError: null,
        videoErrors: {}
      }
    };

    // 新增：数据获取结果记录
    const dataFetchResults = {};

    // === 辅助函数：从 classifiedUrls 中选择 URL ===
    const selectTwitterUrl = () => {
      if (!classifiedUrls.twitter || classifiedUrls.twitter.length === 0) return null;
      // 优先选择 tweet 类型
      const tweet = classifiedUrls.twitter.find(u => u.type === 'tweet');
      if (tweet) return tweet;
      // 否则返回第一个（可能是 account）
      return classifiedUrls.twitter[0];
    };

    const selectFirstUrl = (platform) => {
      const urls = classifiedUrls[platform];
      if (!urls || urls.length === 0) return null;
      return urls[0];
    };

    // === 1. Twitter数据（最高优先级）===
    const twitterUrlInfo = selectTwitterUrl();
    if (twitterUrlInfo) {
      const twitterFetch = await this._recordDataFetch(
        async () => {
          let info = await TwitterFetcher.fetchFromUrls(twitterUrlInfo.url, null);

          // 如果成功获取推文，尝试获取推文中的链接内容
          if (info && info.text) {
            console.log('[NarrativeAnalyzer] 推文已获取，尝试获取推文链接内容');
            info = await TwitterFetcher.enrichWithLinkContent(info);
          }

          // 图片分析（如果启用）
          if (NARRATIVE_CONFIG.enableImageAnalysis && info?.media && TwitterMediaExtractor.hasImages(info)) {
            console.log('[NarrativeAnalyzer] 推文包含图片，开始分析...');
            const imageUrls = TwitterMediaExtractor.extractImageUrls(info);
            const firstImage = imageUrls[0];
            if (firstImage) {
              try {
                const imageData = await ImageDownloader.downloadAsBase64(firstImage.url);
                if (imageData) {
                  const imageAnalysis = await LLMClient.analyzeTwitterImage(imageData.dataUrl);
                  info.image_analysis = {
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
          if (info && info.text) {
            const tweetLang = this.detectLanguage(info.text);
            if (tweetLang && tweetLang !== 'zh' && tweetLang !== 'en') {
              console.log(`[NarrativeAnalyzer] 检测到非中英文推文 (${tweetLang})，尝试翻译...`);
              try {
                const translated = await LLMClient.translate(info.text, 'zh');
                if (translated) {
                  const standardized = this.standardizeTranslatedNames(translated, tokenData.symbol);
                  info.text_original = info.text;
                  info.text = standardized;
                  info.text_translated = true;
                  info.original_language = tweetLang;
                  console.log('[NarrativeAnalyzer] 推文翻译成功');
                }
              } catch (error) {
                console.warn('[NarrativeAnalyzer] 推文翻译失败:', error.message);
              }
            }
          }

          // 检查是否有第二个推文（classifiedUrls中的第二个twitter URL）
          let secondTweetUrl = null;

          // 检查classifiedUrls.twitter中是否有多个推文
          if (classifiedUrls.twitter && classifiedUrls.twitter.length > 1) {
            // 第一个是主推文，查找第二个不同的推文
            const mainUrl = twitterUrlInfo.url;
            const secondTweetInfo = classifiedUrls.twitter.find(t => t.url !== mainUrl && t.type === 'tweet');
            // 如果没有第二个推文，查找第二个账号（作为补充）
            const secondInfo = secondTweetInfo || classifiedUrls.twitter.find(t => t.url !== mainUrl);
            if (secondInfo) {
              secondTweetUrl = secondInfo.url;
            }
          }

          // 获取第二个推文
          if (secondTweetUrl) {
            console.log('[NarrativeAnalyzer] 检测到第二个推文链接，获取中...');
            try {
              const websiteTweet = await TwitterFetcher.fetchFromUrls(secondTweetUrl, null);
              if (websiteTweet && websiteTweet.type === 'tweet' && websiteTweet.text) {
                info.website_tweet = websiteTweet;
                console.log('[NarrativeAnalyzer] 成功获取第二个推文');
              }
            } catch (error) {
              console.warn('[NarrativeAnalyzer] 获取第二个推文失败:', error.message);
            }
          }

          return info;
        },
        'twitter',
        twitterUrlInfo.url
      );
      results.twitterInfo = twitterFetch.data;
      dataFetchResults.twitter = twitterFetch.record;
      if (!twitterFetch.record.success) {
        results.fetchErrors.twitterError = twitterFetch.record.error;
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
    const githubUrlInfo = selectFirstUrl('github');
    if (githubUrlInfo) {
      const githubFetch = await this._recordDataFetch(
        async () => {
          const info = await GithubFetcher.fetchRepoInfo(githubUrlInfo.url);
          if (info) {
            const influenceLevel = GithubFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = GithubFetcher.getInfluenceDescription(influenceLevel);
            info.is_official_token = GithubFetcher.isOfficialToken(info, tokenData.symbol);
            console.log(`[NarrativeAnalyzer] GitHub信息: ${info.stargazers_count} stars`);
          }
          return info;
        },
        'github',
        githubUrlInfo.url
      );
      results.githubInfo = githubFetch.data;
      dataFetchResults.github = githubFetch.record;
    }

    // === 4. YouTube数据 ===
    const youtubeUrlInfo = selectFirstUrl('youtube');
    if (youtubeUrlInfo) {
      const youtubeFetch = await this._recordDataFetch(
        async () => {
          const info = await YoutubeFetcher.fetchVideoInfo(youtubeUrlInfo.url);
          if (info) {
            const influenceLevel = YoutubeFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = YoutubeFetcher.getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] YouTube信息: "${info.title}"`);
          }
          return info;
        },
        'youtube',
        youtubeUrlInfo.url
      );
      results.youtubeInfo = youtubeFetch.data;
      dataFetchResults.youtube = youtubeFetch.record;
      if (!youtubeFetch.record.success) {
        results.fetchErrors.videoErrors.youtube = youtubeFetch.record.error;
      }
    }

    // === 5. 抖音数据 ===
    const douyinUrlInfo = selectFirstUrl('douyin');
    if (douyinUrlInfo) {
      const douyinFetch = await this._recordDataFetch(
        async () => {
          const info = await DouyinFetcher.fetchVideoInfo(douyinUrlInfo.url);
          if (info) {
            const influenceLevel = DouyinFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = DouyinFetcher.getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] 抖音信息: "${info.title}"`);
          }
          return info;
        },
        'douyin',
        douyinUrlInfo.url
      );
      results.douyinInfo = douyinFetch.data;
      dataFetchResults.douyin = douyinFetch.record;
      if (!douyinFetch.record.success) {
        results.fetchErrors.videoErrors.douyin = douyinFetch.record.error;
      }
    }

    // === 6. TikTok数据 ===
    const tiktokUrlInfo = selectFirstUrl('tiktok');
    if (tiktokUrlInfo) {
      const tiktokFetch = await this._recordDataFetch(
        async () => {
          const info = await fetchTikTokVideoInfo(tiktokUrlInfo.url);
          if (info) {
            const influenceLevel = getTikTokInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = getTikTokInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] TikTok信息: @${info.author_username}`);
          }
          return info;
        },
        'tiktok',
        tiktokUrlInfo.url
      );
      results.tiktokInfo = tiktokFetch.data;
      dataFetchResults.tiktok = tiktokFetch.record;
      if (!tiktokFetch.record.success) {
        results.fetchErrors.videoErrors.tiktok = tiktokFetch.record.error;
      }
    }

    // === 7. Bilibili数据 ===
    const bilibiliUrlInfo = selectFirstUrl('bilibili');
    if (bilibiliUrlInfo) {
      const bilibiliFetch = await this._recordDataFetch(
        async () => {
          const info = await BilibiliFetcher.fetchVideoInfo(bilibiliUrlInfo.url);
          if (info) {
            const influenceLevel = BilibiliFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = BilibiliFetcher.getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] Bilibili信息: "${info.title}"`);
          }
          return info;
        },
        'bilibili',
        bilibiliUrlInfo.url
      );
      results.bilibiliInfo = bilibiliFetch.data;
      dataFetchResults.bilibili = bilibiliFetch.record;
      if (!bilibiliFetch.record.success) {
        results.fetchErrors.videoErrors.bilibili = bilibiliFetch.record.error;
      }
    }

    // === 8. Amazon数据 ===
    const amazonUrlInfo = selectFirstUrl('amazon');
    if (amazonUrlInfo) {
      const amazonFetch = await this._recordDataFetch(
        async () => {
          const info = await fetchProductInfo(amazonUrlInfo.url);
          if (info) {
            const influenceLevel = getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] Amazon信息: "${info.title}"`);
          }
          return info;
        },
        'amazon',
        amazonUrlInfo.url
      );
      results.amazonInfo = amazonFetch.data;
      dataFetchResults.amazon = amazonFetch.record;
      if (!amazonFetch.record.success) {
        results.fetchErrors.videoErrors.amazon = amazonFetch.record.error;
      }
    }

    // === 9. 普通网站数据 ===
    const websiteUrlInfo = selectFirstUrl('websites');
    if (websiteUrlInfo) {
      const websiteUrl = websiteUrlInfo.url;
      // 排除视频平台、GitHub和Amazon（已经处理过）
      const isVideoPlatform = /youtube|youtu\.be|tiktok|douyin|bilibili|b23\.tv/i.test(websiteUrl);
      const isGithub = /github\.com/i.test(websiteUrl);
      const isAmazon = /amazon\.com/i.test(websiteUrl);

      if (!isVideoPlatform && !isGithub && !isAmazon && isFetchableUrl(websiteUrl)) {
        const websiteFetch = await this._recordDataFetch(
          () => fetchWebsiteContent(websiteUrl, { maxLength: 5000 }),
          'website',
          websiteUrl
        );
        results.websiteInfo = websiteFetch.data;
        dataFetchResults.website = websiteFetch.record;
        if (!websiteFetch.record.success) {
          results.fetchErrors.websiteError = websiteFetch.record.error;
        }
      }
    }

    return { ...results, classifiedUrls, dataFetchResults };
  }


  /**
   * 记录数据获取的元数据
   * @param {Function} fetcherFn - 数据获取函数
   * @param {string} platform - 平台名称
   * @param {string} url - 请求的URL
   * @returns {Promise<Object>} { data, record } - data是获取的数据，record是元数据
   * @private
   */
  static async _recordDataFetch(fetcherFn, platform, url) {
    if (!url) {
      return { data: null, record: null };
    }

    const startedAt = new Date().toISOString();
    let data, error;

    try {
      data = await fetcherFn();
      return {
        data,
        record: {
          success: true,
          url,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error: null
        }
      };
    } catch (e) {
      error = e.message;
      return {
        data: null,
        record: {
          success: false,
          url,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error
        }
      };
    }
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
   * 检查是否是币安相关（代币名 + 任何语料都包含币安关键词）
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {Object} { isBinanceRelated: boolean, reason: string }
   */
  static _checkBinanceRelated(tokenData, fetchResults) {
    const binanceKeywords = [
      'binance', '币安', 'bnb', 'bsc',
      'cz', '何一'  // 币安创始人
    ];

    const tokenSymbol = (tokenData.symbol || '').toLowerCase();

    // 1. 检查代币名是否包含币安关键词
    const tokenMatch = binanceKeywords.some(kw =>
      tokenSymbol.includes(kw.toLowerCase())
    );

    if (!tokenMatch) {
      return { isBinanceRelated: false };
    }

    // 2. 检查任何语料是否包含币安关键词（且数据获取成功）
    const { twitterInfo, websiteInfo, classifiedUrls, extractedInfo } = fetchResults;

    // 2.1 检查推文内容（必须有实际获取到的内容）
    if (twitterInfo?.text && twitterInfo.text.trim().length > 0) {
      const text = twitterInfo.text.toLowerCase();
      if (binanceKeywords.some(kw => text.includes(kw.toLowerCase()))) {
        return {
          isBinanceRelated: true,
          reason: `代币名"${tokenSymbol}" + 推文内容包含币安关键词`
        };
      }
    }

    // 2.2 检查推特账号信息（必须有实际获取到的账号数据）
    if (twitterInfo?.type === 'account' && twitterInfo.screen_name) {
      const screenName = twitterInfo.screen_name.toLowerCase();
      const name = (twitterInfo.name || '').toLowerCase();
      const description = (twitterInfo.description || '').toLowerCase();

      // 检查账号名、显示名、简介
      if (binanceKeywords.some(kw =>
        screenName.includes(kw.toLowerCase()) ||
        name.includes(kw.toLowerCase()) ||
        description.includes(kw.toLowerCase())
      )) {
        return {
          isBinanceRelated: true,
          reason: `代币名"${tokenSymbol}" + 推特账号信息包含币安关键词`
        };
      }
    }

    // 2.3 检查网站内容（必须有实际获取到的内容）
    if (websiteInfo?.content && websiteInfo.content.trim().length > 50) {
      const content = websiteInfo.content.toLowerCase();
      if (binanceKeywords.some(kw => content.includes(kw.toLowerCase()))) {
        return {
          isBinanceRelated: true,
          reason: `代币名"${tokenSymbol}" + 网站内容包含币安关键词`
        };
      }
    }

    // 注意：介绍信息（extractedInfo）不算外部数据，不检查
    // 注意：不检查 classifiedUrls 中的URL字符串，因为URL存在不代表数据获取成功
    // 必须有实际获取到的外部内容才算

    return { isBinanceRelated: false };
  }

  /**
   * 检查是否有有效数据可供分析
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {boolean} 是否有有效数据
   */
  static _hasValidDataForAnalysis(fetchResults) {
    const {
      twitterInfo,
      websiteInfo,
      extractedInfo,
      backgroundInfo,
      githubInfo,
      youtubeInfo,
      douyinInfo,
      tiktokInfo,
      bilibiliInfo,
      amazonInfo
    } = fetchResults;

    // 检查推文数据
    if (twitterInfo) {
      if (twitterInfo.text && twitterInfo.text.trim().length > 0) {
        return true; // 有推文内容
      }
      // 检查账号信息（只要有账号信息就算有效数据，让 LLM 来判断质量）
      if (twitterInfo.type === 'account') {
        // 只要是账号类型就算有效数据（账号名、粉丝数、发帖数都是信息）
        return true;
      }
    }

    // 检查背景信息（微博等）
    if (backgroundInfo) {
      // 微博数据检查
      if (backgroundInfo.source === 'weibo') {
        if (backgroundInfo.text && backgroundInfo.text.trim().length > 0) {
          return true; // 有微博内容
        }
        if (backgroundInfo.title || backgroundInfo.author_name || backgroundInfo.screen_name) {
          return true; // 有微博基本信息（账号名等）
        }
      }
      // 其他背景信息（视频平台账号、网站抓取等）
      if (backgroundInfo.content || backgroundInfo.description || backgroundInfo.title) {
        return true;
      }
    }

    // 检查网站内容
    if (websiteInfo && websiteInfo.content && websiteInfo.content.trim().length > 50) {
      return true; // 有足够的网站内容
    }

    // 检查介绍
    if (extractedInfo) {
      const intro = extractedInfo.intro_en || extractedInfo.intro_cn || '';
      if (intro.trim().length >= 20) {
        return true; // 有足够的介绍
      }
    }

    // 检查其他数据源

    // GitHub: 检查是否有仓库信息（readme、name、description等）
    if (githubInfo) {
      if (githubInfo.readme) return true;
      if (githubInfo.name || githubInfo.description || githubInfo.topics) {
        return true; // 有基本仓库信息就算有效数据
      }
    }

    // 视频平台: 检查是否有实际内容（title、description、view_count等）
    const videoPlatforms = [
      { info: youtubeInfo, name: 'YouTube' },
      { info: douyinInfo, name: '抖音' },
      { info: tiktokInfo, name: 'TikTok' },
      { info: bilibiliInfo, name: 'Bilibili' }
    ];

    for (const platform of videoPlatforms) {
      if (platform.info) {
        // 检查是否有视频标题或描述（至少有一个非空）
        const hasContent = (platform.info.title && platform.info.title.trim().length > 0) ||
                          (platform.info.description && platform.info.description.trim().length > 0);
        if (hasContent) {
          return true; // 有视频内容
        }
      }
    }

    // Amazon: 检查是否有商品信息（title、price等）
    if (amazonInfo) {
      if (amazonInfo.title || amazonInfo.price || amazonInfo.features) {
        return true; // 有商品信息
      }
    }

    // 其他背景信息文本
    if (backgroundInfo?.text && backgroundInfo.text.trim().length > 0) {
      return true;
    }

    return false; // 没有任何有效数据
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
    // 处理 classified_urls（如果缺失则重新提取）
    const isClassifiedUrlsEmpty = (urls) => {
      if (!urls) return true;
      const values = Object.values(urls);
      return values.length === 0 || values.every(arr => !arr || arr.length === 0);
    };

    let classifiedUrls = record.classified_urls;
    if (!classifiedUrls || isClassifiedUrlsEmpty(classifiedUrls)) {
      console.log('[NarrativeAnalyzer] 缓存数据缺少 classified_urls 或为空，重新提取URL');
      try {
        const rawData = record.raw_api_data || {};
        let appendix = {};
        if (rawData.appendix && typeof rawData.appendix === 'string') {
          try {
            appendix = JSON.parse(rawData.appendix);
          } catch (e) {}
        } else if (rawData.appendix && typeof rawData.appendix === 'object') {
          appendix = rawData.appendix;
        }

        // 重新构建提取信息
        const extractedInfo = {
          twitter_url: appendix.twitter || rawData.webUrl || rawData.twitterUrl || '',
          website: appendix.website || rawData.website || rawData.websiteUrl || '',
          weibo_url: appendix.weibo || rawData.weibo || rawData.weiboUrl || '',
          intro_en: rawData.intro_en || rawData.introduction || '',
          intro_cn: rawData.intro_cn || '',
          description: rawData.description || ''
        };

        const fullData = { ...rawData, ...extractedInfo, appendix };
        const allUrls = extractAllUrls(fullData);
        classifiedUrls = classifyAllUrls(allUrls);
        console.log('[NarrativeAnalyzer] 重新提取到URL:', {
          total: allUrls.length,
          twitter: classifiedUrls.twitter.length,
          websites: classifiedUrls.websites.length
        });
      } catch (e) {
        console.warn('[NarrativeAnalyzer] 重新提取URL失败:', e.message);
        classifiedUrls = {
          twitter: [],
          weibo: [],
          youtube: [],
          tiktok: [],
          douyin: [],
          bilibili: [],
          github: [],
          amazon: [],
          telegram: [],
          discord: [],
          websites: []
        };
      }
    }

    // 确定分析阶段
    let analysisStage = 0;  // 0=预检查, 1=Stage1低质量, 2=Stage2详细评分
    if (record.llm_stage2_parsed_output) {
      analysisStage = 2;
    } else if (record.llm_stage1_parsed_output) {
      analysisStage = 1;
    }

    // 计算最终分类（用于快速访问）
    const llm_category = record.llm_stage2_category || record.llm_stage1_category || record.pre_check_category || null;

    // 构建返回结果（直接使用新字段）
    return {
      token: {
        address: record.token_address,
        symbol: record.token_symbol,
        raw_api_data: record.raw_api_data
      },
      extracted_info: record.extracted_info,
      twitter: record.twitter_info,
      classifiedUrls: classifiedUrls,
      is_valid: record.is_valid,

      // 顶层字段（用于兼容）
      llm_category: llm_category,

      // LLM分析结果
      llmAnalysis: {
        // 预检查数据
        preCheck: record.pre_check_result ? {
          category: record.pre_check_category,
          reason: record.pre_check_reason,
          result: record.pre_check_result
        } : null,
        // Stage 1 数据
        stage1: record.llm_stage1_parsed_output ? {
          category: record.llm_stage1_category,
          model: record.llm_stage1_model,
          prompt: record.llm_stage1_prompt,
          rawOutput: record.llm_stage1_raw_output,
          parsedOutput: record.llm_stage1_parsed_output,
          startedAt: record.llm_stage1_started_at,
          finishedAt: record.llm_stage1_finished_at,
          success: record.llm_stage1_success,
          error: record.llm_stage1_error
        } : null,
        // Stage 2 数据
        stage2: record.llm_stage2_parsed_output ? {
          category: record.llm_stage2_category,
          model: record.llm_stage2_model,
          prompt: record.llm_stage2_prompt,
          rawOutput: record.llm_stage2_raw_output,
          parsedOutput: record.llm_stage2_parsed_output,
          startedAt: record.llm_stage2_started_at,
          finishedAt: record.llm_stage2_finished_at,
          success: record.llm_stage2_success,
          error: record.llm_stage2_error
        } : null,
        // 当前结果（根据分析阶段决定使用哪个stage的数据）
        category: llm_category,
        summary: record.llm_stage2_parsed_output ? {
          total_score: record.llm_stage2_parsed_output.total_score,
          credibility_score: record.llm_stage2_parsed_output.scores?.credibility,
          virality_score: record.llm_stage2_parsed_output.scores?.virality,
          reasoning: record.llm_stage2_parsed_output.reasoning
        } : record.llm_stage1_parsed_output ? {
          reasoning: record.llm_stage1_parsed_output.reason,
          scenario: record.llm_stage1_parsed_output.scenario,
          stage: record.llm_stage1_parsed_output.stage,
          entities: record.llm_stage1_parsed_output.entities
        } : record.pre_check_result ? {
          total_score: record.pre_check_result.total_score,
          credibility_score: record.pre_check_result.scores?.credibility,
          virality_score: record.pre_check_result.scores?.virality,
          reasoning: record.pre_check_result.reasoning
        } : null
      },

      // 顶层字段（用于兼容）
      llm_summary: record.llm_stage2_parsed_output ? {
        total_score: record.llm_stage2_parsed_output.total_score,
        credibility_score: record.llm_stage2_parsed_output.scores?.credibility,
        virality_score: record.llm_stage2_parsed_output.scores?.virality,
        reasoning: record.llm_stage2_parsed_output.reasoning
      } : record.llm_stage1_parsed_output ? {
        reasoning: record.llm_stage1_parsed_output.reason,
        scenario: record.llm_stage1_parsed_output.scenario,
        stage: record.llm_stage1_parsed_output.stage,
        entities: record.llm_stage1_parsed_output.entities
      } : record.pre_check_result ? {
        total_score: record.pre_check_result.total_score,
        credibility_score: record.pre_check_result.scores?.credibility,
        virality_score: record.pre_check_result.scores?.virality,
        reasoning: record.pre_check_result.reasoning
      } : null,

      // Debug信息
      debugInfo: {
        analysisStage: analysisStage,
        urlExtractionResult: record.url_extraction_result,
        dataFetchResults: record.data_fetch_results
      },

      // 元数据
      meta: {
        analyzedAt: record.analyzed_at,
        sourceExperimentId: record.experiment_id
      },

      // 生成数据获取错误信息
      fetchErrors: (() => {
        const errors = {};
        const dataFetch = record.data_fetch_results || {};

        // 从 data_fetch_results 提取错误信息
        for (const [platform, result] of Object.entries(dataFetch)) {
          if (result && !result.success && result.error) {
            if (platform === 'website') {
              errors.websiteError = result.error;
            } else if (platform === 'twitter') {
              errors.twitterError = result.error;
            } else if (platform === 'github') {
              errors.githubError = result.error;
            } else {
              // 视频平台
              if (!errors.videoErrors) errors.videoErrors = {};
              errors.videoErrors[platform] = result.error;
            }
          }
        }

        // 如果没有任何错误，返回null
        if (Object.keys(errors).length === 0 ||
            (Object.keys(errors).length === 1 && Object.keys(errors.videoErrors || {}).length === 0)) {
          return null;
        }
        return errors;
      })()
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

      // 必须包含stage字段：0=通过，1=第一阶段触发，2=第二阶段触发，3=第三阶段触发
      if (result.stage === undefined) {
        throw new Error('Stage 1: stage字段缺失');
      }

      return {
        pass: result.pass,
        reason: result.reason || '',
        stage: result.stage,
        scenario: result.scenario || 0,  // stage=3时对应的场景编号
        entities: result.entities || {}
      };
    } catch (parseError) {
      console.error('[NarrativeAnalyzer] Stage 1: JSON解析失败，提取的字符串:', jsonStr);
      throw new Error(`Stage 1: JSON解析失败 - ${parseError.message}`);
    }
  }

  /**
   * 直接调用LLM API并返回原始响应（带元数据）
   * 用于Stage 1等需要自定义响应格式的场景
   * @param {string} prompt - Prompt内容
   * @returns {Promise<Object>} 包含响应内容和元数据 { content, model, startedAt, finishedAt, success, error }
   * @private
   */
  static async _callLLMAPI(prompt) {
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

    console.log(`[NarrativeAnalyzer] 开始调用LLM API... 模型: ${model}`);
    console.log(`[NarrativeAnalyzer] Prompt 长度: ${prompt.length} 字符`);
    console.log(`[NarrativeAnalyzer] Prompt 前500字符: ${prompt.substring(0, 500)}`);

    let content, error, success;

    try {
      console.log('[NarrativeAnalyzer] 发送 fetch 请求...');
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
      content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('LLM 返回内容为空');
      }

      const finishedAt = new Date().toISOString();
      success = true;
      error = null;

      console.log('[NarrativeAnalyzer] API调用完成');
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
