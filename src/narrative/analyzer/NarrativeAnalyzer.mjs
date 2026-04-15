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
import { XiaohongshuFetcher } from '../utils/xiaohongshu-fetcher.mjs';
import { fetchTikTokVideoInfo, isTikTokUrl } from '../utils/tiktok-fetcher.mjs';
import { WeixinFetcher } from '../utils/weixin-fetcher.mjs';
import { fetchWebsiteContent, isFetchableUrl, isTwitterTweetUrl } from '../utils/web-fetcher.mjs';
import { fetchProductInfo, getInfluenceLevel, getInfluenceDescription } from '../utils/amazon-fetcher.mjs';
import { PromptBuilder } from './prompt-builder.mjs';
import { extractAllUrls, classifyAllUrls, selectBestUrls } from '../utils/url-classifier.mjs';
import { isHighInfluenceAccount, getHighInfluenceAccountBackground } from './prompts/account-backgrounds.mjs';
import { fetchCommunityForTweet } from '../../utils/twitter-validation/communities-api.js';
import { getLogger } from '../core/logger.mjs';

// 新增：从拆分的模块导入
import { cleanSymbol, getVisualLength, hasValidDataForAnalysis, hasIndependentWebsite, shouldUseAccountCommunityAnalysis, isProjectCoin, extractScreenNameFromTwitterUrl } from './utils/narrative-utils.mjs';
import { detectLanguage, standardizeTranslatedNames } from './utils/language-utils.mjs';
import { cleanDataForDB } from './utils/data-cleaner.mjs';
import { parseStage1Response, parseEventResponse, parseJSONResponse, formatResult, buildLLMAnalysis } from './parsers/response-parser.mjs';
import { performPreCheck } from './services/pre-check-service.mjs';
import { fetchAllDataViaClassifier, fetchDataSequentially, recordDataFetch } from './services/data-fetch-service.mjs';
import { fetchTokenData, extractInfo, checkBinanceRelated } from './services/token-info-service.mjs';
import { collectAllAccountsWithFullInfo, getFullAccountInfo, analyzeAccountCommunityToken } from './services/account-analysis-service.mjs';
import { analyzeMemeTokenTwoStage } from './services/meme-analysis-service.mjs';
import { saveStage1Data, saveStage2Data } from './services/stage-data-service.mjs';
import { callLLMAPI, LLMClient } from './llm/llm-api-client.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

// 获取日志实例
const logger = getLogger();

/**
 * 将旧格式的阶段数据转换为新的统一 result 格式
 * 旧格式: { category, model, prompt, raw_output, parsed_output, started_at, finished_at, success, error }
 * 新格式: { prestage_result, prestage_prompt, prestage_raw_output }
 *
 * @param {string} stageName - 阶段名称 (prestage/stage1/stage2/stage3)
 * @param {Object} stageData - 旧格式的阶段数据
 * @param {Object} overrides - 覆盖字段（如 rating, pass, reason, category, score, details）
 * @returns {Object} 新格式的保存数据 { [stageName]_result, [stageName]_prompt, [stageName]_raw_output }
 */
function buildStageSaveData(stageName, stageData, overrides = {}) {
  if (!stageData || stageData.__clear) {
    return { [`${stageName}_result`]: { __clear: true } };
  }

  // 从 parsed_output 中提取 score（支持 raw 嵌套和扁平结构）
  const po = stageData.parsed_output;
  const extractedScore = overrides.score
    ?? po?.raw?.scoringResult?.totalScore
    ?? po?.scoringResult?.totalScore
    ?? po?.total_score
    ?? null;

  const result = {
    rating: overrides.rating ?? null,
    pass: overrides.pass ?? po?.pass ?? po?.raw?.pass ?? null,
    reason: overrides.reason ?? po?.reason ?? po?.blockReason ?? po?.raw?.blockReason ?? null,
    category: overrides.category ?? stageData.category ?? null,
    score: extractedScore,
    model: stageData.model || null,
    startedAt: stageData.started_at || null,
    finishedAt: stageData.finished_at || null,
    success: stageData.success ?? null,
    error: stageData.error || null,
    details: overrides.details ?? po ?? null,
  };

  return {
    [`${stageName}_result`]: result,
    [`${stageName}_prompt`]: stageData.prompt || null,
    [`${stageName}_raw_output`]: stageData.raw_output || null,
  };
}

/**
 * 将 buildStageSaveData 的输出扁平化为前端可用的格式
 * 合并 result + prompt + rawOutput 到同一层级
 * @param {Object} saveData - buildStageSaveData 的返回值
 * @param {string} stageName - 阶段名称
 * @returns {Object|null} 扁平化的阶段对象
 */
function flattenStageForLLMAnalysis(saveData, stageName) {
  const result = saveData?.[`${stageName}_result`];
  if (!result) return null;
  return {
    ...result,
    prompt: saveData[`${stageName}_prompt`] || null,
    rawOutput: saveData[`${stageName}_raw_output`] || null,
  };
}

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
        const llmAnalysis = buildLLMAnalysis(cached);
        return {
          ...formatResult(cached),
          llmAnalysis: llmAnalysis,  // 添加 llmAnalysis 字段
          classifiedUrls: cached.classified_urls || null,
          twitter: cached.twitter_info || null,
          fetchErrors: null,
          debugInfo: {
            urlExtractionResult: cached.url_extraction_result || null,
            dataFetchResults: cached.data_fetch_results || null,
            promptVersion: cached.prompt_version || null,
            analysisStage: cached.analysis_stage || null
          },
          meta: {
            fromCache: true,
            fromFallback: false,
            preCheckTriggered: isCachedPreCheck,
            preCheckReason: isCachedPreCheck ? cached.pre_check_result?.details?.ruleName : null,
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
          const llmAnalysis = buildLLMAnalysis(cached);
          return {
            ...formatResult(cached),
            llmAnalysis: llmAnalysis,  // 添加 llmAnalysis 字段
            classifiedUrls: cached.classified_urls || null,
            twitter: cached.twitter_info || null,
            fetchErrors: null,
            debugInfo: {
              urlExtractionResult: cached.url_extraction_result || null,
              dataFetchResults: cached.data_fetch_results || null,
              promptVersion: cached.prompt_version || null,
              analysisStage: cached.analysis_stage || null
            }
          };
        }
        // 缓存是别的实验的（或 experiment_id 为空）或 experimentId 未指定
        // → 需要重新分析，保存时带上当前 experiment_id
        // 这样后续再遇到这个代币时，就会命中本实验的缓存
      }
    }

    // 3. 执行叙事分析（缓存未命中 或 需要重新分析）
    // 分析结果会保存时带上当前 experiment_id，用于后续缓存判断

    // 2. 从数据库获取代币数据
    const tokenData = await fetchTokenData(normalizedAddress);
    if (!tokenData) {
      throw new Error('代币不存在');
    }

    // 3. 提取结构化信息
    const extractedInfo = extractInfo(tokenData);

    // 准备数据收集变量
    let prestageDataToSave = null;  // 前置LLM阶段（账号/社区分析判断币种类型）
    let preCheckDataToSave = null;
    let urlExtractionResult = null;
    let dataFetchResults = null;

    // 4. 使用URL分类器统一获取所有数据
    logger.info('NarrativeAnalyzer', '开始使用URL分类器获取数据');
    const {
      twitterInfo,
      websiteInfo,
      backgroundInfo,
      githubInfo,
      youtubeInfo,
      douyinInfo,
      tiktokInfo,
      bilibiliInfo,
      weixinInfo,
      amazonInfo,
      classifiedUrls,
      fetchErrors,  // 获取数据收集的错误信息
      url_extraction_result,  // URL提取结果
      data_fetch_results  // 数据获取结果
    } = await fetchAllDataViaClassifier(tokenData, extractedInfo);

    // 保存URL提取和数据获取结果
    urlExtractionResult = url_extraction_result;
    dataFetchResults = data_fetch_results;

    // 立即保存URL提取结果到数据库，供前端轮询使用
    await NarrativeRepository.save({
      token_address: tokenData.address,
      url_extraction_result: url_extraction_result,
      classified_urls: classifiedUrls
    });

    logger.info('NarrativeAnalyzer', 'URL提取结果已保存到数据库');

    logger.info('NarrativeAnalyzer', '数据获取完成');

    // 新增：如果有独立网站，收集所有相关账号的完整信息
    let relatedAccounts = [];
    const hasIndependentWebsiteResult = hasIndependentWebsite(classifiedUrls);
    logger.info('NarrativeAnalyzer', '独立网站检测结果', { hasIndependentWebsite: hasIndependentWebsiteResult, classifiedUrls: classifiedUrls?.websites?.length });
    logger.info('NarrativeAnalyzer', 'twitterInfo 信息', {
      hasTwitterInfo: !!twitterInfo,
      twitterType: twitterInfo?.type,
      twitterScreenName: twitterInfo?.screen_name,
      hasInReplyTo: !!twitterInfo?.in_reply_to
    });

    // 检查是否应该收集账号信息：有独立网站 且 有Twitter相关信息（account/community/tweet）
    const shouldCollectAccounts = hasIndependentWebsiteResult && twitterInfo &&
      (twitterInfo.type === 'account' || twitterInfo.type === 'community' || twitterInfo.type === 'tweet');

    if (shouldCollectAccounts) {
      logger.info('NarrativeAnalyzer', '检测到独立网站，开始收集所有账号信息', {
        twitterType: twitterInfo.type,
        twitterScreenName: twitterInfo.screen_name,
        hasInReplyTo: !!twitterInfo.in_reply_to
      });
      relatedAccounts = await collectAllAccountsWithFullInfo(twitterInfo);
      logger.info('NarrativeAnalyzer', '账号信息收集完成', { count: relatedAccounts.length });
    }

    // 项目币检测（代币地址出现在推文/网站/账号内容中 → 项目方自己发的币）
    const isProjectCoinResult = isProjectCoin(normalizedAddress, { twitterInfo, websiteInfo, classifiedUrls });
    if (isProjectCoinResult) {
      logger.info('NarrativeAnalyzer', '检测到项目币（地址出现在内容中）');
    }

    // 如果是项目币但还没收集过账号，尝试收集
    if (isProjectCoinResult && relatedAccounts.length === 0) {
      if (twitterInfo) {
        // 有twitterInfo，从推文作者收集
        logger.info('NarrativeAnalyzer', '项目币补充收集账号信息（通过twitterInfo）');
        relatedAccounts = await collectAllAccountsWithFullInfo(twitterInfo);
      } else if (classifiedUrls?.twitter?.length > 0) {
        // 推文被删/获取失败，但URL中有screen_name，直接获取账号信息
        for (const tw of classifiedUrls.twitter) {
          const screenName = extractScreenNameFromTwitterUrl(tw.url);
          if (screenName) {
            logger.info('NarrativeAnalyzer', '项目币补充收集账号信息（通过URL提取）', { screenName });
            const accountInfo = await getFullAccountInfo(screenName);
            if (accountInfo) {
              relatedAccounts.push({ ...accountInfo, role: 'primary' });
            }
            break; // 只需取第一个有效的
          }
        }
      }
      logger.info('NarrativeAnalyzer', '项目币账号信息收集完成', { count: relatedAccounts.length });
    }

    // 7. 预检查规则（不调用LLM，直接返回结果）
    const preCheckResult = await performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo }, githubInfo, backgroundInfo, { ignoreExpired });
    let isPreCheckTriggered = preCheckResult !== null;

    let llmResult;
    let promptUsed = '';
    let promptType = '';
    let analysisFailed = false;
    let stage1DataToSave = null;
    let stage2DataToSave = null;
    let stage3DataToSave = null;
    let stageFinalData = null;

    if (isPreCheckTriggered) {
      // 预检查触发，使用预设结果
      logger.info('NarrativeAnalyzer', '预检查触发，跳过LLM分析');

      // preCheckResult 已经是统一的 { rating, pass, reason, details } 格式
      // 直接作为 pre_check_result 存储
      preCheckDataToSave = preCheckResult;

      llmResult = {
        rating: preCheckResult.rating,
        reason: preCheckResult.reason,
        score: preCheckResult.score,
        pass: preCheckResult.pass
      };
      // 预检查结果也记录prompt类型（用于后续判断）
      const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, classifiedUrls, relatedAccounts };
      promptType = PromptBuilder.getPromptTypeDesc(fetchResults);
      // 预检查时不构建Prompt（不需要）
      promptUsed = null;
    } else {
      // 8. 正常流程：两阶段分析
      try {
        // twitterInfo已包含website_tweet（如果有第二个推文）
        const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, classifiedUrls, relatedAccounts };

        // 检查是否有任何有效数据供分析
        const hasAnyData = hasValidDataForAnalysis(fetchResults);
        if (!hasAnyData) {
          logger.warn('NarrativeAnalyzer', '没有有效数据可供分析，返回unrated');
          llmResult = {
            rating: 'unrated',
            reason: '没有可用的数据进行分析（所有推文/内容获取失败）',
            score: null,
            pass: null
          };
          promptUsed = null;
          promptType = 'no_data';
          analysisFailed = false;
        } else {
          // 检查是否应该使用账号/社区分析流程
          const shouldUseAccountCommunity = shouldUseAccountCommunityAnalysis(fetchResults)
            || (isProjectCoinResult && fetchResults.relatedAccounts?.length > 0);

          if (shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用账号/社区代币分析流程');
            const analysisResult = await analyzeAccountCommunityToken(tokenData, fetchResults, {
              callLLMAPI,
              analyzeMemeTokenTwoStage
            }, {
              skipAddressValidation: isProjectCoinResult
            });

            // 检查是否是规则验证失败（返回preCheckData）
            if (analysisResult.preCheckData) {
              // 规则验证失败，按预检查处理
              llmResult = {
                rating: analysisResult.category,
                reason: analysisResult.reasoning,
                score: analysisResult.total_score,
                pass: false
              };
              promptUsed = 'rules_validation';
              promptType = 'precheck';
              analysisFailed = false;
              isPreCheckTriggered = true;

              // preCheckData 格式来自 account-analysis-service，需要转换为统一格式
              const pcd = analysisResult.preCheckData;
              preCheckDataToSave = {
                rating: pcd.category || 'low',
                pass: false,
                reason: pcd.reason || analysisResult.reasoning,
                category: null,
                score: analysisResult.total_score || null,
                details: pcd.result || {}
              };
            } else if (analysisResult.stage1Data) {
              // meme币分流：使用stage2Data作为最终结果（如果有）
              llmResult = {
                rating: analysisResult.category,
                reason: analysisResult.reasoning,
                score: analysisResult.total_score,
                pass: true
              };
              promptUsed = analysisResult.stage2Data?.prompt || analysisResult.stage1Data.prompt || 'meme_two_stage';
              promptType = 'meme_two_stage';
              analysisFailed = false;

              // 保存前置LLM数据（账号/社区分析判断币种类型）
              prestageDataToSave = analysisResult.prestageData;
              // 保存两阶段数据到stage1和stage2字段（stage2Data可能为null）
              stage1DataToSave = analysisResult.stage1Data;
              stage2DataToSave = analysisResult.stage2Data;
            } else {
              // 项目币或Web3原生IP早期：前置LLM判断结果
              llmResult = {
                rating: analysisResult.category,
                reason: analysisResult.reasoning,
                score: analysisResult.total_score,
                pass: analysisResult.category !== 'unrated'
              };
              promptUsed = analysisResult.prestageData?.prompt || 'account_community_analysis';
              promptType = 'account_community';
              analysisFailed = false;

              // 保存前置LLM数据（账号/社区分析判断币种类型）
              prestageDataToSave = analysisResult.prestageData;

              // 对于 unrated 类别（如 Web3 原生 IP 早期），显式清除旧的 stage1/stage2 数据
              if (analysisResult.category === 'unrated') {
                // 使用特殊标记对象指示需要清除旧数据
                stage1DataToSave = { __clear: true };
                stage2DataToSave = { __clear: true };
              }
            }
          }

          // ═══════════════════════════════════════════════════════════════════════════
          // 3阶段架构：Stage 1事件预处理 + Stage 2分类评分 + Stage 3代币分析
          // 进入条件：
          // 1. 原本不使用账号/社区分析流程（!shouldUseAccountCommunity）
          // 2. 或者账号质量检查通过，跳过Prestage LLM（skipToThreeStageFromAccountCheck）
          // ═══════════════════════════════════════════════════════════════════════════
          if (!shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用3阶段架构：Stage1事件预处理 + Stage2分类评分 + Stage3代币分析');

            // ========== Stage 1: 事件预处理 ==========
            logger.debug('NarrativeAnalyzer', '开始Stage 1：事件预处理');
            const stage1Prompt = PromptBuilder.buildStage1Preprocessing(tokenData, fetchResults);
            const stage1PromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);
            logger.debug('NarrativeAnalyzer', `Stage 1 Prompt类型: ${stage1PromptType}`);

            // Stage 1：调用API获取原始响应（带元数据）
            const stage1CallResult = await callLLMAPI(stage1Prompt);

            // 检查Stage 1是否成功
            if (!stage1CallResult.success) {
              throw new Error(`Stage 1 LLM调用失败: ${stage1CallResult.error}`);
            }

            const stage1Data = parseJSONResponse(stage1CallResult.content);

            if (!stage1Data.pass) {
              // Stage 1未通过，直接返回
              logger.info('Stage1', '事件预处理未通过', {
                reason: stage1Data.reason
              });

              llmResult = {
                rating: 'low',
                reason: stage1Data.reason,
                score: null,
                pass: false
              };

              // 收集Stage 1数据（旧格式，会在 save 时通过 buildStageSaveData 转换）
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
              logger.info('Stage1', '事件预处理通过', {
                eventTheme: stage1Data.eventDescription?.eventTheme,
                primaryCategory: stage1Data.eventClassification?.primaryCategory
              });

              // 保存Stage 1数据（即使后续Stage失败，Stage1数据也应该被保存）
              stage1DataToSave = {
                category: stage1Data.eventClassification?.primaryCategory || null,
                model: stage1CallResult.model,
                prompt: stage1Prompt,
                raw_output: stage1CallResult.content,
                parsed_output: stage1Data,
                started_at: stage1CallResult.startedAt,
                finished_at: stage1CallResult.finishedAt,
                success: stage1CallResult.success,
                error: stage1CallResult.error
              };

              // ========== Stage 2: 分类评分 ==========
              logger.debug('NarrativeAnalyzer', '开始Stage 2：分类评分');
              const stage2Prompt = await PromptBuilder.buildStage2Scoring(
                stage1Data.eventDescription,
                stage1Data.eventClassification
              );
              logger.debug('NarrativeAnalyzer', `Stage 2 Prompt类型: 分类特定（${stage1Data.eventClassification?.primaryCategory}类）`);

              // Stage 2：调用API（带元数据）
              const stage2CallResult = await LLMClient.analyzeWithMetadata(stage2Prompt);

              // 检查 Stage 2 调用是否成功
              if (!stage2CallResult.success) {
                throw new Error(`Stage 2 LLM调用失败: ${stage2CallResult.error}`);
              }

              // 收集Stage 2数据
              // analyzeWithMetadata 返回的 raw 包含 { raw: 原始响应, ...parsed }
              const stage2RawContent = stage2CallResult.raw?.raw?.raw || stage2CallResult.raw?.raw;
              if (!stage2RawContent) {
                throw new Error('Stage 2 LLM返回数据为空');
              }

              // 使用 parseResponse 的结果（已支持新格式）
              const stage2Data = stage2CallResult.parsed || {};
              // 调试日志：打印 stage2Data 的关键信息
              console.log('[NarrativeAnalyzer] Stage 2 解析结果:', JSON.stringify({
                hasPass: typeof stage2Data.pass !== 'undefined',
                pass: stage2Data.pass,
                hasCategory: !!stage2Data.category,
                category: stage2Data.category,
                hasTotalScore: !!stage2Data.total_score,
                totalScore: stage2Data.total_score,
                hasBlockReason: !!stage2Data.blockReason,
                blockReason: stage2Data.blockReason
              }));
              stage2DataToSave = {
                category: stage2Data.scoringResult?.category || stage2CallResult.parsed?.category || null,
                model: stage2CallResult.model,
                prompt: stage2Prompt,
                raw_output: stage2RawContent,
                parsed_output: stage2Data,
                started_at: stage2CallResult.startedAt,
                finished_at: stage2CallResult.finishedAt,
                success: stage2CallResult.success,
                error: stage2CallResult.error
              };

              // 检查Stage 2是否成功
              if (!stage2CallResult.success || !stage2Data.pass) {
                // Stage 2失败或未通过
                const failReason = !stage2CallResult.success ? stage2CallResult.error : stage2Data.blockReason;
                logger.warn('NarrativeAnalyzer', `Stage 2 ${!stage2CallResult.success ? '失败' : '未通过'}: ${failReason}`);

                // Stage 2未通过，category设为low（保证概览卡片正确显示）
                stage2DataToSave.category = 'low';

                // Stage 3被跳过，清除旧的Stage 3数据（防止重新分析时残留旧结果）
                stage3DataToSave = { __clear: true };

                llmResult = {
                  rating: 'low',
                  reason: `Stage 1通过，但Stage 2${!stage2CallResult.success ? '失败' : '未通过'}: ${failReason}`,
                  score: stage2Data.scoringResult?.totalScore || null,
                  pass: false,
                  analysis_stage: 2
                };

                promptType = `stage1+stage2(${stage1Data.eventClassification?.primaryCategory}类)`;
              } else {
                // Stage 2通过，进入Stage 3
                logger.info('Stage2', '分类评分通过', {
                  category: stage2Data.scoringResult?.category,
                  totalScore: stage2Data.scoringResult?.totalScore
                });

                // ========== Stage 3: 代币分析 ==========
                logger.debug('NarrativeAnalyzer', '开始Stage 3：代币分析');
                const stage3Prompt = PromptBuilder.buildStage3TokenAnalysis(
                  tokenData,
                  stage1Data
                );
                logger.debug('NarrativeAnalyzer', `Stage 3 Prompt类型: 代币分析（使用Stage1输出）`);

                // Stage 3：调用API（带元数据）
                const stage3CallResult = await LLMClient.analyzeWithMetadata(stage3Prompt);

                // 检查 Stage 3 调用是否成功
                if (!stage3CallResult.success) {
                  throw new Error(`Stage 3 LLM调用失败: ${stage3CallResult.error}`);
                }

                // 收集Stage 3数据
                // analyzeWithMetadata 返回的 raw 包含 { raw: 原始响应, ...parsed }
                const stage3RawContent = stage3CallResult.raw?.raw?.raw || stage3CallResult.raw?.raw;

                // 使用 parseResponse 的结果（已支持新格式）
                const stage3Data = stage3CallResult.parsed || {};

                // ========== 分数聚合：Stage 2（事件分）+ Stage 3（代币分） ==========
                // Stage 3 输出 pass/fail + 分数，Stage 2 输出事件分，最终 category 由代码聚合
                // 注意：LLMClient.analyzeWithMetadata() 返回的 parsed 中，原始响应被包在 raw 里
                // 外层有扁平字段（total_score, category, pass 等），内层 raw 有详细结构
                const stage3Pass = stage3Data.pass ?? stage3Data.raw?.pass;
                const relevanceScore = stage3Data.relevanceScore ?? stage3Data.raw?.relevanceScore ?? stage3Data.breakdown?.relevanceScore;
                const qualityScore = stage3Data.qualityScore ?? stage3Data.raw?.qualityScore ?? stage3Data.breakdown?.qualityScore;

                let aggregatedCategory;
                let aggregatedTotalScore;
                let eventScore = null;
                const stage2TotalScore = stage2Data.scoringResult?.totalScore ?? stage2Data.raw?.scoringResult?.totalScore ?? stage2Data.total_score;

                if (stage3Pass === false) {
                  // Stage 3 截断触发（品牌劫持/拼写错误/关联性不足/质量过低）
                  aggregatedCategory = 'low';
                  aggregatedTotalScore = null;
                  logger.info('NarrativeAnalyzer', 'Stage 3截断触发', {
                    blockReason: stage3Data.blockReason,
                    relevanceScore: relevanceScore,
                    qualityScore: qualityScore
                  });
                } else {
                  // Stage 3 通过，计算加权总分
                  if (stage2TotalScore !== undefined) {
                    eventScore = Math.round(stage2TotalScore * 0.6 * 100) / 100;
                  }
                  aggregatedTotalScore = (eventScore || 0) + (relevanceScore || 0) + (qualityScore || 0);

                  if (aggregatedTotalScore >= 70) aggregatedCategory = 'high';
                  else if (aggregatedTotalScore >= 50) aggregatedCategory = 'mid';
                  else aggregatedCategory = 'low';

                  logger.info('NarrativeAnalyzer', '分数聚合结果', {
                    stage2TotalScore: stage2TotalScore,
                    eventScore: eventScore,
                    relevanceScore: relevanceScore,
                    qualityScore: qualityScore,
                    aggregatedTotalScore: aggregatedTotalScore,
                    aggregatedCategory: aggregatedCategory
                  });
                }

                // ========== Stage Final：聚合结果 ==========
                stageFinalData = {
                  category: aggregatedCategory,
                  totalScore: aggregatedTotalScore,
                  eventScore: eventScore,
                  relevanceScore: relevanceScore,
                  qualityScore: qualityScore,
                  eventWeight: 0.6,
                  stage2TotalScore: stage2TotalScore || null,
                  blockReason: stage3Pass === false ? stage3Data.blockReason : null
                };

                // 将聚合结果写入 stage3Data，供 resolveFinalRating 和后续代码使用
                stage3Data.category = aggregatedCategory;
                stage3Data.total_score = aggregatedTotalScore;

                // 同步 raw.category，确保 resolveFinalRating 读取到聚合后的值
                if (stage3Data.raw && stage3Data.raw.category !== aggregatedCategory) {
                  stage3Data.raw.category = aggregatedCategory;
                }

                stage3DataToSave = {
                  category: stage3Data.category || stage3CallResult.parsed?.category || null,
                  model: stage3CallResult.model,
                  prompt: stage3Prompt,
                  raw_output: stage3RawContent || stage3CallResult.raw?.raw || null,
                  parsed_output: stage3Data,
                  started_at: stage3CallResult.startedAt,
                  finished_at: stage3CallResult.finishedAt,
                  success: stage3CallResult.success,
                  error: stage3CallResult.error
                };

                // 检查Stage 3是否成功
                if (!stage3CallResult.success) {
                  // Stage 3失败，但不抛出错误，而是设置llmResult为Stage 2的结果
                  logger.warn('NarrativeAnalyzer', `Stage 3失败，使用Stage 2结果: ${stage3CallResult.error}`);
                  llmResult = {
                    rating: stage2Data.scoringResult?.category || 'unrated',
                    reason: `Stage 1和Stage 2通过，但Stage 3失败: ${stage3CallResult.error}`,
                    score: stage2Data.scoringResult?.totalScore || null,
                    pass: true,
                    analysis_stage: 2
                  };
                } else {
                  // Stage 3成功，使用完整的分析结果
                  llmResult = {
                    ...stage3Data,
                    analysis_stage: 3
                  };
                }

                promptType = `stage1+stage2(${stage1Data.eventClassification?.primaryCategory}类)+stage3`;
              }
            } // 关闭3阶段架构 else 分支（第334行的else）
          } // 关闭hasAnyData的else分支（第267行的else）
          }
        } catch (error) {  // 关闭try块（第249行）
        logger.error('NarrativeAnalyzer', 'LLM分析失败', { error: error.message });
        llmResult = {
          rating: 'unrated',
          reason: `分析失败: ${error.message}`,
          score: null,
          pass: null,
          analysis_stage: 0
        };
        analysisFailed = true;
      }
    }

    // 9. 如果分析失败且有缓存，使用缓存作为fallback
    if (analysisFailed && cached && cached.is_valid) {
      console.log(`分析失败，使用已有缓存作为fallback | address=${normalizedAddress}, cached_experiment=${cached.experiment_id}`);
      return {
        ...formatResult(cached),
        classifiedUrls: cached.classified_urls || null,
        twitter: cached.twitter_info || null,
        fetchErrors: null,
        debugInfo: {
          urlExtractionResult: cached.url_extraction_result || null,
          dataFetchResults: cached.data_fetch_results || null,
          promptVersion: cached.prompt_version || null,
          analysisStage: cached.analysis_stage || null
        },
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
    const cleanedTwitterInfo = cleanDataForDB(twitterInfo);

    // 构建各阶段的新格式保存数据
    const prestageSaveData = buildStageSaveData('prestage', prestageDataToSave);
    const stage1SaveData = buildStageSaveData('stage1', stage1DataToSave);
    const stage2SaveData = buildStageSaveData('stage2', stage2DataToSave);
    const stage3SaveData = buildStageSaveData('stage3', stage3DataToSave);

    // 构建 stage_final_result
    const stageFinalSaveData = stageFinalData ? {
      stage_final_result: {
        rating: stageFinalData.category, // high/mid/low
        pass: true,
        reason: null,
        category: stageFinalData.category,
        score: stageFinalData.totalScore,
        details: {
          eventScore: stageFinalData.eventScore,
          eventWeight: stageFinalData.eventWeight,
          relevanceScore: stageFinalData.relevanceScore,
          qualityScore: stageFinalData.qualityScore,
          stage2TotalScore: stageFinalData.stage2TotalScore,
          blockReason: stageFinalData.blockReason
        }
      }
    } : {};

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
      is_valid: true,
      prompt_version: PromptBuilder.getPromptVersion(),
      analysis_stage: llmResult?.analysis_stage || null,
      prompt_type: promptType || null,

      // === 预检查结果 ===
      pre_check_result: preCheckDataToSave || null,

      // === 各阶段结果 ===
      ...prestageSaveData,
      ...stage1SaveData,
      ...stage2SaveData,
      ...stage3SaveData,
      ...stageFinalSaveData,

      // === Debug字段 ===
      url_extraction_result: urlExtractionResult || null,
      data_fetch_results: dataFetchResults || null
    });

    // 构造 llmAnalysis 对象供前端使用（扁平格式，与缓存路径 buildLLMAnalysis 一致）
    const llmAnalysis = {
      preCheck: preCheckDataToSave || null,
      prestage: flattenStageForLLMAnalysis(prestageSaveData, 'prestage'),
      stage1: flattenStageForLLMAnalysis(stage1SaveData, 'stage1'),
      stage2: flattenStageForLLMAnalysis(stage2SaveData, 'stage2'),
      stage3: flattenStageForLLMAnalysis(stage3SaveData, 'stage3'),
      stageFinal: stageFinalSaveData?.stage_final_result || null,
      // 评分和理由（用于概览卡片）
      summary: {
        rating: stageFinalData?.category || llmResult.rating,
        reason: llmResult.reason || llmResult.reasoning,
        score: stageFinalData?.totalScore ?? llmResult.score ?? llmResult.total_score,
        scores: llmResult.scores
      }
    };

    return {
      ...formatResult(saveResult),
      llmAnalysis: llmAnalysis,  // 添加 llmAnalysis 字段供前端使用
      twitter: twitterInfo,  // 添加 twitter 字段供前端使用
      backgroundInfo: backgroundInfo, // 返回背景信息供调试使用
      classifiedUrls: classifiedUrls, // 返回分类后的URL供前端展示
      fetchErrors: fetchErrors, // 添加数据获取错误信息（来自_fetchDataSequentially）
      meta: {
        fromCache: false,
        preCheckTriggered: isPreCheckTriggered,
        preCheckReason: isPreCheckTriggered ? preCheckDataToSave?.details?.ruleName : null,
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
        analysisStage: stage3DataToSave ? 3 : stage2DataToSave ? 2 : stage1DataToSave ? 1 : 0,
        // 新增：PreStage/Stage 1/2/3 数据
        prestageData: prestageDataToSave,
        stage1Data: stage1DataToSave,
        stage2Data: stage2DataToSave,
        stage3Data: stage3DataToSave,
        preCheckData: preCheckDataToSave,
        // 新增：URL提取和数据获取结果
        urlExtractionResult: urlExtractionResult,
        dataFetchResults: dataFetchResults
      }
    };
  }

  /**
   * 格式化返回结果（静态方法，供路由使用）
   * @param {Object} record - 数据库记录
   * @returns {Object} 格式化后的结果
   */
  static formatResult(record) {
    return formatResult(record);
  }

  /**
   * 构建 LLM 分析对象（静态方法，供路由使用）
   * @param {Object} record - 数据库记录
   * @returns {Object} LLM 分析对象
   */
  static buildLLMAnalysis(record) {
    return buildLLMAnalysis(record);
  }

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
