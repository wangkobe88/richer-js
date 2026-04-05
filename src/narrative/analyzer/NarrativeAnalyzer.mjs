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
import { LLMClient } from './llm-client.mjs';
import { extractAllUrls, classifyAllUrls, selectBestUrls } from '../utils/url-classifier.mjs';
import { isHighInfluenceAccount, getHighInfluenceAccountBackground } from './prompts/account-backgrounds.mjs';
import { fetchCommunityForTweet } from '../../utils/twitter-validation/communities-api.js';
import { getLogger } from '../core/logger.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

// 获取日志实例
const logger = getLogger();

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
   * 计算字符串的"视觉长度"
   * 中文字符（CJK）按2个单位计算，英文/数字/符号按1个单位计算
   * 这样可以更准确地反映字符串在显示时的实际占用空间
   * @param {string} str - 要计算的字符串
   * @returns {number} 视觉长度
   */
  static getVisualLength(str) {
    if (!str) return 0;
    let length = 0;
    for (const char of str) {
      // 判断是否为中日韩（CJK）统一表意文字
      // 范围包括：基本区、扩展A区、扩展B区、扩展C区、扩展D区、扩展E区、扩展F区
      const code = char.codePointAt(0);
      const isCJK = (
        (code >= 0x4E00 && code <= 0x9FFF) ||     // 基本区
        (code >= 0x3400 && code <= 0x4DBF) ||     // 扩展A区
        (code >= 0x20000 && code <= 0x2A6DF) ||   // 扩展B区
        (code >= 0x2A700 && code <= 0x2B73F) ||   // 扩展C区
        (code >= 0x2B740 && code <= 0x2B81F) ||   // 扩展D区
        (code >= 0x2B820 && code <= 0x2CEAF) ||   // 扩展E区
        (code >= 0x2CEB0 && code <= 0x2EBEF) ||   // 扩展F区
        (code >= 0xF900 && code <= 0xFAFF) ||     // 兼容汉字
        (code >= 0x2F800 && code <= 0x2FA1F)      // 兼容汉字补充
      );
      // CJK字符算2个单位，其他算1个单位
      length += isCJK ? 2 : 1;
    }
    return length;
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
    let prestageDataToSave = null;  // 前置LLM阶段（账号/社区分析判断币种类型）
    let stage1DataToSave = null;
    let stage2DataToSave = null;
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
    } = await this._fetchAllDataViaClassifier(tokenData, extractedInfo);

    // 保存URL提取和数据获取结果
    urlExtractionResult = url_extraction_result;
    dataFetchResults = data_fetch_results;

    logger.info('NarrativeAnalyzer', '数据获取完成');

    // 7. 预检查规则（不调用LLM，直接返回结果）
    const preCheckResult = await this.performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo }, githubInfo, backgroundInfo, { ignoreExpired });
    let isPreCheckTriggered = preCheckResult !== null;

    let llmResult;
    let promptUsed = '';
    let promptType = '';
    let analysisFailed = false;

    if (isPreCheckTriggered) {
      // 预检查触发，使用预设结果
      logger.info('NarrativeAnalyzer', '预检查触发，跳过LLM分析');

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
      const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo };
      promptType = PromptBuilder.getPromptTypeDesc(fetchResults);
      // 预检查时不构建Prompt（不需要）
      promptUsed = null;
    } else {
      // 8. 正常流程：两阶段分析
      try {
        // twitterInfo已包含website_tweet（如果有第二个推文）
        const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, classifiedUrls };

        // 检查是否有任何有效数据供分析
        const hasAnyData = this._hasValidDataForAnalysis(fetchResults);
        if (!hasAnyData) {
          logger.warn('NarrativeAnalyzer', '没有有效数据可供分析，返回unrated');
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
          // 检查是否应该使用账号/社区分析流程
          const shouldUseAccountCommunity = this._shouldUseAccountCommunityAnalysis(fetchResults);

          if (shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用账号/社区代币分析流程');
            const analysisResult = await this._analyzeAccountCommunityToken(tokenData, fetchResults);

            // 检查是否是规则验证失败（返回preCheckData）
            if (analysisResult.preCheckData) {
              // 规则验证失败，按预检查处理
              llmResult = {
                category: analysisResult.category,
                reasoning: analysisResult.reasoning,
                scores: analysisResult.scores,
                total_score: analysisResult.total_score
              };
              promptUsed = 'rules_validation';
              promptType = 'precheck';
              analysisFailed = false;
              isPreCheckTriggered = true;

              // 保存到预检查字段
              preCheckDataToSave = {
                category: analysisResult.preCheckData.category,
                reason: analysisResult.preCheckData.reason,
                result: analysisResult.preCheckData.result
              };
            } else if (analysisResult.stage1Data) {
              // meme币分流：使用stage2Data作为最终结果（如果有）
              llmResult = {
                category: analysisResult.category,
                reasoning: analysisResult.reasoning,
                scores: analysisResult.scores,
                total_score: analysisResult.total_score
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
                category: analysisResult.category,
                reasoning: analysisResult.reasoning,
                scores: analysisResult.scores,
                total_score: analysisResult.total_score
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
          } else {
            logger.info('NarrativeAnalyzer', '使用新框架：事件分析 + 代币分析');

        // 事件分析（对应原Stage 1）
        logger.debug('NarrativeAnalyzer', '开始事件分析');
        const eventPrompt = PromptBuilder.buildEventAnalysis(tokenData, fetchResults);
        const eventPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);
        logger.debug('NarrativeAnalyzer', `事件分析Prompt类型: ${eventPromptType}`);

        // 事件分析：调用API获取原始响应（带元数据）
        const eventCallResult = await this._callLLMAPI(eventPrompt);

        // 检查事件分析是否成功
        if (!eventCallResult.success) {
          throw new Error(`事件分析LLM调用失败: ${eventCallResult.error}`);
        }

        const eventData = this._parseEventResponse(eventCallResult.content);

        if (!eventData.pass) {
          // 事件分析未通过，直接返回
          logger.info('EventAnalysis', '事件分析未通过', {
            reason: eventData.reason,
            eventExists: eventData.eventAnalysis?.eventExists,
            blockReason: eventData.eventAnalysis?.blockReason
          });

          llmResult = {
            category: 'low',
            reasoning: eventData.reason,
            scores: null,
            total_score: null
          };

          // 收集事件分析数据（存储到stage1字段）
          stage1DataToSave = {
            category: 'low',
            model: eventCallResult.model,
            prompt: eventPrompt,
            raw_output: eventCallResult.content,
            parsed_output: eventData,
            started_at: eventCallResult.startedAt,
            finished_at: eventCallResult.finishedAt,
            success: eventCallResult.success,
            error: eventCallResult.error
          };

          promptType = eventPromptType;
        } else {
          // 事件分析通过，进入代币分析
          logger.info('EventAnalysis', '事件分析通过，进入代币分析', {
            eventDescription: eventData.eventAnalysis?.eventDescription,
            propagationScore: eventData.eventAnalysis?.propagationScore
          });

          // 先保存Stage1数据（即使Stage2失败，Stage1数据也应该被保存）
          stage1DataToSave = {
            category: null,  // 通过，所以category为null
            model: eventCallResult.model,
            prompt: eventPrompt,
            raw_output: eventCallResult.content,
            parsed_output: eventData,
            started_at: eventCallResult.startedAt,
            finished_at: eventCallResult.finishedAt,
            success: eventCallResult.success,
            error: eventCallResult.error
          };

          const tokenPrompt = PromptBuilder.buildTokenAnalysis(tokenData, fetchResults, eventData.eventAnalysis);
          const tokenPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 2);
          logger.debug('NarrativeAnalyzer', `代币分析Prompt类型: ${tokenPromptType}`);

          // 代币分析：调用API（带元数据）
          const tokenCallResult = await LLMClient.analyzeWithMetadata(tokenPrompt);

          // 收集代币分析数据（无论成功还是失败都要记录）
          stage2DataToSave = {
            category: tokenCallResult.parsed?.category || null,
            model: tokenCallResult.model,
            prompt: tokenPrompt,
            raw_output: tokenCallResult.raw?.raw || tokenCallResult.raw || null,
            parsed_output: tokenCallResult.parsed,
            started_at: tokenCallResult.startedAt,
            finished_at: tokenCallResult.finishedAt,
            success: tokenCallResult.success,
            error: tokenCallResult.error
          };

          // 检查代币分析是否成功
          if (!tokenCallResult.success) {
            // Stage2失败，但不抛出错误，而是设置llmResult为Stage1的结果
            logger.warn('NarrativeAnalyzer', `代币分析失败，仅保存Stage1数据: ${tokenCallResult.error}`);
            llmResult = {
              category: 'unrated',
              reasoning: `事件分析通过，但代币分析失败: ${tokenCallResult.error}`,
              scores: null,
              total_score: null,
              analysis_stage: 1,
              eventAnalysis: eventData.eventAnalysis
            };
          } else {
            // Stage2成功，使用完整的分析结果
            llmResult = {
              ...tokenCallResult.parsed
            };
          }

          promptType = tokenPromptType;
        }
        } // 关闭新框架 else 分支
        } // 关闭账号/社区检查的 else 分支
      } catch (error) {
        logger.error('NarrativeAnalyzer', 'LLM分析失败', { error: error.message });
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
      is_valid: true, // 显式设置为true（分析成功后）
      prompt_version: PromptBuilder.getPromptVersion(), // 保存当前prompt版本

      // === 预检查字段（3个）===
      pre_check_category: preCheckDataToSave?.category || null,
      pre_check_reason: preCheckDataToSave?.reason || null,
      pre_check_result: preCheckDataToSave?.result || null,

      // === 前置LLM阶段字段（9个）- 账号/社区分析判断币种类型 ===
      llm_prestage_category: prestageDataToSave?.category || null,
      llm_prestage_model: prestageDataToSave?.model || null,
      llm_prestage_prompt: prestageDataToSave?.prompt || null,
      llm_prestage_raw_output: prestageDataToSave?.raw_output || null,
      llm_prestage_parsed_output: prestageDataToSave?.parsed_output || null,
      llm_prestage_started_at: prestageDataToSave?.started_at || null,
      llm_prestage_finished_at: prestageDataToSave?.finished_at || null,
      llm_prestage_success: prestageDataToSave?.success ?? null,
      llm_prestage_error: prestageDataToSave?.error || null,

      // === Stage 1 字段（9个）===
      // 检查是否是清除标记
      llm_stage1_parsed_output: (stage1DataToSave && stage1DataToSave.__clear) ? stage1DataToSave : (stage1DataToSave?.parsed_output || null),
      llm_stage1_category: stage1DataToSave?.category || null,
      llm_stage1_model: stage1DataToSave?.model || null,
      llm_stage1_prompt: stage1DataToSave?.prompt || null,
      llm_stage1_raw_output: stage1DataToSave?.raw_output || null,
      llm_stage1_started_at: stage1DataToSave?.started_at || null,
      llm_stage1_finished_at: stage1DataToSave?.finished_at || null,
      llm_stage1_success: stage1DataToSave?.success ?? null,
      llm_stage1_error: stage1DataToSave?.error || null,

      // === Stage 2 字段（9个）===
      // 检查是否是清除标记
      llm_stage2_parsed_output: (stage2DataToSave && stage2DataToSave.__clear) ? stage2DataToSave : (stage2DataToSave?.parsed_output || null),
      llm_stage2_category: stage2DataToSave?.category || null,
      llm_stage2_model: stage2DataToSave?.model || null,
      llm_stage2_prompt: stage2DataToSave?.prompt || null,
      llm_stage2_raw_output: stage2DataToSave?.raw_output || null,
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
        // 新增：PreStage/Stage 1/2 数据
        prestageData: prestageDataToSave,
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
    const { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo } = videoInfos;

    // 规则0：代币名称长度检查（优先级最高）
    // 过滤名称过长的代币，通常是为了博眼球而故意使用长名称，缺乏真实叙事价值
    const tokenSymbol = (tokenData.symbol || '').trim();
    const tokenName = (tokenData.name || tokenData.raw_api_data?.name || '').trim();

    const MAX_SYMBOL_LENGTH = 12;  // Symbol最大视觉长度（>=触发）
    const MAX_NAME_LENGTH = 30;     // Name最大视觉长度（>=触发）
    const MAX_ENGLISH_WORDS = 4;   // 英文最大单词数（>触发）

    // 使用视觉长度计算（中文字符算2个单位）
    const symbolVisualLength = this.getVisualLength(tokenSymbol);
    const nameVisualLength = this.getVisualLength(tokenName);

    /**
     * 检查字符串是否主要为英文（按单词数判断）
     * @param {string} str - 要检查的字符串
     * @returns {boolean} true表示主要为英文
     */
    const isMostlyEnglish = (str) => {
      if (!str) return false;
      // 计算非CJK字符的比例
      let nonCJKChars = 0;
      for (const char of str) {
        const code = char.codePointAt(0);
        const isCJK = (
          (code >= 0x4E00 && code <= 0x9FFF) ||
          (code >= 0x3400 && code <= 0x4DBF) ||
          (code >= 0x20000 && code <= 0x2A6DF) ||
          (code >= 0x2A700 && code <= 0x2B73F) ||
          (code >= 0x2B740 && code <= 0x2B81F) ||
          (code >= 0x2B820 && code <= 0x2CEAF) ||
          (code >= 0x2CEB0 && code <= 0x2EBEF) ||
          (code >= 0xF900 && code <= 0xFAFF) ||
          (code >= 0x2F800 && code <= 0x2FA1F)
        );
        if (!isCJK && /[a-zA-Z]/.test(char)) {
          nonCJKChars++;
        }
      }
      // 如果英文字符占多数，认为是英文
      return nonCJKChars > str.length / 2;
    };

    /**
     * 计算英文单词数
     * @param {string} str - 英文字符串
     * @returns {number} 单词数
     */
    const countEnglishWords = (str) => {
      if (!str) return 0;
      // 按空格和常见分隔符分割单词
      const words = str.trim().split(/[\s\-_]+/).filter(w => w.length > 0 && /[a-zA-Z]/.test(w));
      return words.length;
    };

    // 检查Symbol长度
    if (tokenSymbol && symbolVisualLength > MAX_SYMBOL_LENGTH) {
      // 对于英文，检查单词数而非字符数
      if (isMostlyEnglish(tokenSymbol)) {
        const wordCount = countEnglishWords(tokenSymbol);
        if (wordCount > MAX_ENGLISH_WORDS) {
          console.log(`[NarrativeAnalyzer] 预检查触发: 代币Symbol过长 (英文单词数: ${wordCount}, 阈值: ${MAX_ENGLISH_WORDS})`);
          return {
            category: 'low',
            reasoning: `代币Symbol"${tokenSymbol}"包含${wordCount}个英文单词，超出正常范围（阈值：${MAX_ENGLISH_WORDS}），疑似博眼球而无真实叙事价值`,
            scores: { credibility: 0, virality: 0 },
            total_score: 0,
            preCheckTriggered: true,
            preCheckReason: 'symbol_too_long'
          };
        }
        // 英文单词数在合理范围内，通过检查
        console.log(`[NarrativeAnalyzer] Symbol长度检查通过: "${tokenSymbol}" (${wordCount}个英文单词 ≤ ${MAX_ENGLISH_WORDS})`);
      } else {
        // 非英文（如中文），使用视觉长度检查
        console.log(`[NarrativeAnalyzer] 预检查触发: 代币Symbol过长 (视觉长度: ${symbolVisualLength}, 实际字符: ${tokenSymbol.length})`);
        return {
          category: 'low',
          reasoning: `代币Symbol"${tokenSymbol}"视觉长度为${symbolVisualLength}（实际${tokenSymbol.length}字符），超出正常范围（阈值：${MAX_SYMBOL_LENGTH}），疑似博眼球而无真实叙事价值`,
          scores: { credibility: 0, virality: 0 },
          total_score: 0,
          preCheckTriggered: true,
          preCheckReason: 'symbol_too_long'
        };
      }
    }

    // 检查Name长度
    if (tokenName && nameVisualLength > MAX_NAME_LENGTH) {
      // 对于英文，检查单词数而非字符数
      if (isMostlyEnglish(tokenName)) {
        const wordCount = countEnglishWords(tokenName);
        if (wordCount > MAX_ENGLISH_WORDS * 2) {  // Name的单词数阈值是Symbol的2倍
          console.log(`[NarrativeAnalyzer] 预检查触发: 代币Name过长 (英文单词数: ${wordCount}, 阈值: ${MAX_ENGLISH_WORDS * 2})`);
          return {
            category: 'low',
            reasoning: `代币名称"${tokenName}"包含${wordCount}个英文单词，超出正常范围（阈值：${MAX_ENGLISH_WORDS * 2}），疑似博眼球而无真实叙事价值`,
            scores: { credibility: 0, virality: 0 },
            total_score: 0,
            preCheckTriggered: true,
            preCheckReason: 'name_too_long'
          };
        }
        // 英文单词数在合理范围内，通过检查
        console.log(`[NarrativeAnalyzer] Name长度检查通过: "${tokenName}" (${wordCount}个英文单词 ≤ ${MAX_ENGLISH_WORDS * 2})`);
      } else {
        // 非英文（如中文），使用视觉长度检查
        console.log(`[NarrativeAnalyzer] 预检查触发: 代币Name过长 (视觉长度: ${nameVisualLength}, 实际字符: ${tokenName.length})`);
        return {
          category: 'low',
          reasoning: `代币名称"${tokenName}"视觉长度为${nameVisualLength}（实际${tokenName.length}字符），超出正常范围（阈值：${MAX_NAME_LENGTH}），疑似博眼球而无真实叙事价值`,
          scores: { credibility: 0, virality: 0 },
          total_score: 0,
          preCheckTriggered: true,
          preCheckReason: 'name_too_long'
        };
      }
    }

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

    // 规则1.5：Twitter账号粉丝数量检查
    // 规则1.6：已移除 - 项目币账号名匹配不再直接返回unrated
    // 账号/社区代币将通过LLM流程进行分析（见_shouldUseAccountCommunityAnalysis）
    // 如果只有账号/社区信息且无其他内容，会走账号/社区分析流程

    // 粉丝数检查也已移除 - 统一由LLM流程来判断
    // 因为meme币可能有特殊原因（如新账号、营销活动等）导致粉丝少，但仍可能有价值
    /*
    // 粉丝数量太少（<60）说明缺乏社区基础和传播能力，优先级高于账号名匹配检查
    if (twitterInfo?.type === 'account' && twitterInfo.followers_count !== undefined) {
      const followersCount = twitterInfo.followers_count || 0;
      if (followersCount < 60) {
        const screenName = twitterInfo.screen_name || '未知';
        console.log(`[NarrativeAnalyzer] 预检查触发: Twitter账号粉丝数过低 (@${screenName}, ${followersCount}粉丝)`);
        return {
          category: 'low',
          reasoning: `Twitter账号@${screenName}粉丝数仅${followersCount}，缺乏社区基础和传播能力（阈值：60）`,
          scores: { credibility: 5, virality: 5 },
          total_score: 10,
          preCheckTriggered: true,
          preCheckReason: 'account_low_followers'
        };
      }
    }
    */

    // 规则1.7：应用商店链接检查
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
      // 视频过期阈值：365天（一年）
      const expiredVideoDaysThreshold = 365;

      const videos = [
        { name: '抖音', info: douyinInfo },
        { name: 'YouTube', info: youtubeInfo },
        { name: 'TikTok', info: tiktokInfo },
        { name: 'Bilibili', info: bilibiliInfo },
        { name: '微信', info: weixinInfo }
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

    // 规则2.5：币安相关检查 - 已禁用
    // 如果代币名 + 任何语料都包含币安关键词，返回unrated（项目币，发展情况不明）
    // const binanceCheck = this._checkBinanceRelated(tokenData, {
    //   twitterInfo,
    //   websiteInfo,
    //   classifiedUrls,
    //   extractedInfo
    // });
    //
    // if (binanceCheck.isBinanceRelated) {
    //   console.log(`[NarrativeAnalyzer] 币安相关，返回unrated: ${binanceCheck.reason}`);
    //   return {
    //     category: 'unrated',
    //     reasoning: `${binanceCheck.reason}，项目币发展情况不明，无法评估meme潜力`,
    //     scores: null,
    //     total_score: null,
    //     preCheckTriggered: true,
    //     preCheckReason: 'binance_related'
    //   };
    // }

    // 规则3：视频传播力检查（有视频时直接判断，不走LLM）
    // 优先级：Bilibili > 抖音 > TikTok > YouTube
    const videoPriority = [
      { name: 'Bilibili', info: bilibiliInfo, viewField: 'view_count', likeField: 'like_count' },
      { name: '抖音', info: douyinInfo, viewField: 'view_count', likeField: 'like_count' },
      { name: 'TikTok', info: tiktokInfo, viewField: 'view_count', likeField: 'like_count' },
      { name: 'YouTube', info: youtubeInfo, viewField: 'view_count', likeField: 'like_count' }
    ];

    for (const video of videoPriority) {
      if (!video.info) continue;

      // 检查播放量和点赞数
      const viewCount = video.info[video.viewField];
      const likeCount = video.info[video.likeField];

      // 调试日志：输出播放量和点赞数的值
      console.log(`[NarrativeAnalyzer] ${video.name}视频数据 - 播放量: ${viewCount}, 点赞数: ${likeCount}`);

      // 优先检查播放量，如果没有播放量则检查点赞数
      const hasViewData = viewCount !== undefined && viewCount !== null;
      const hasLikeData = likeCount !== undefined && likeCount !== null;

      if (!hasViewData && !hasLikeData) continue;

      // 设置阈值（播放量或点赞数任一达到即可）
      // 各平台的"爆款"门槛：达到此播放量时，内容过于流行无法准确分析
      const unratedViewThresholdMap = {
        'Bilibili': 500000,     // 50万播放量
        'YouTube': 1000000,     // 100万播放量
        'Twitter': 100000,      // 10万播放量
        'TikTok': 500000,       // 50万播放量（流量大，提高门槛）
        '抖音': 500000          // 50万播放量（流量大，提高门槛）
      };
      const unratedViewThreshold = unratedViewThresholdMap[video.name] || 100000; // 默认10万
      const unratedLikeThreshold = 100000; // 10万点赞（保持不变）

      // ============ 播放量过低阈值（已禁用，交给LLM判断）============
      // const lowViewThresholdMap = {
      //   'Bilibili': 500000,     // 50万播放量（娱乐平台，低于爆款即为low）
      //   'YouTube': 10000,       // 1万播放量（说明性视频平台）
      //   'Twitter': 2500,        // 2500播放量
      //   'TikTok': 500000,       // 50万播放量（娱乐平台，低于爆款即为low）
      //   '抖音': 500000          // 50万播放量（娱乐平台，低于爆款即为low）
      // };
      // const lowViewThreshold = lowViewThresholdMap[video.name] || 10000; // 默认1万

      // 判断是否达到 unrated 阈值
      const viewMeetsThreshold = hasViewData && viewCount >= unratedViewThreshold;
      const likeMeetsThreshold = hasLikeData && likeCount >= unratedLikeThreshold;

      // 调试日志：输出阈值判断结果
      console.log(`[NarrativeAnalyzer] ${video.name}阈值判断 - viewMeetsThreshold: ${viewMeetsThreshold} (${viewCount}>=${unratedViewThreshold}), likeMeetsThreshold: ${likeMeetsThreshold} (${likeCount}>=${unratedLikeThreshold})`);

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

      // ============ 播放量/点赞数过低判断（已禁用，交给LLM判断）============
      // 播放量/点赞数过低 → low
      // ⚠️ 特殊处理：当播放量为0（被隐藏）且点赞数较高时，不触发low
      // 抖音等平台可能隐藏播放量，此时用点赞数/分享数判断传播力
      // const isViewCountHidden = hasViewData && viewCount === 0;
      // const hasHighEngagement = hasLikeData && likeCount >= 10000; // 1万点赞以上
      // const shareCount = video.info.share_count || 0;

      // if (hasViewData && viewCount < lowViewThreshold && !(isViewCountHidden && hasHighEngagement)) {
      //   console.log(`[NarrativeAnalyzer] 规则3结果: ${video.name}视频播放量(${viewCount})过低，返回low`);
      //
      //   // 根据播放量是否被隐藏，生成不同的提示语
      //   let reasoning;
      //   if (viewCount === 0) {
      //     // 播放量被平台隐藏
      //     const engagementInfo = [];
      //     if (hasLikeData) engagementInfo.push(`点赞数${likeCount}`);
      //     if (shareCount > 0) engagementInfo.push(`分享数${shareCount}`);
      //     const engagementStr = engagementInfo.join('、');
      //     reasoning = `${video.name}视频播放量不可见（平台隐藏），${engagementStr}未达到传播阈值（需10000+点赞），传播力不足`;
      //   } else {
      //     // 播放量可见但低于阈值
      //     reasoning = `${video.name}视频播放量${viewCount}低于阈值${lowViewThreshold}，传播力不足`;
      //   }
      //
      //   return {
      //     category: 'low',
      //     reasoning,
      //     scores: { credibility: 10, virality: 10 },
      //     total_score: 20,
      //     preCheckTriggered: true,
      //     preCheckReason: 'video_low_views'
      //   };
      // }

      // 点赞数过低（如果没有播放量数据）
      // if (!hasViewData && hasLikeData && likeCount < 1000) {
      //   console.log(`[NarrativeAnalyzer] 规则3结果: ${video.name}视频点赞数(${likeCount})过低，返回low`);
      //   return {
      //     category: 'low',
      //     reasoning: `${video.name}视频点赞数仅${likeCount}，传播力不足`,
      //     scores: { credibility: 10, virality: 10 },
      //     total_score: 20,
      //     preCheckTriggered: true,
      //     preCheckReason: 'video_low_likes'
      //   };
      // }

      // ⚠️ 播放量/点赞数低的情况不再自动返回low，交给LLM判断
      console.log(`[NarrativeAnalyzer] ${video.name}视频未达到unrated阈值，将进入LLM分析`);
    }

    // 规则3.5：微信文章传播力检查
    if (weixinInfo) {
      const readCount = weixinInfo.read_num || 0;
      const likeCount = weixinInfo.like_num || 0;

      // 阅读数低于1000 → low
      if (readCount > 0 && readCount < 1000) {
        console.log(`[NarrativeAnalyzer] 规则3.5触发: 微信文章阅读数(${readCount})低于1000，返回low`);
        return {
          category: 'low',
          reasoning: `微信文章阅读数仅${readCount}，传播力不足（阈值：1000）`,
          scores: { credibility: 10, virality: 10 },
          total_score: 20,
          preCheckTriggered: true,
          preCheckReason: 'weixin_low_reads'
        };
      }

      // 阅读数为0但有文章内容 → 说明文章存在但无法获取统计数据，视为传播力不足
      if (readCount === 0 && weixinInfo.title) {
        console.log(`[NarrativeAnalyzer] 规则3.5触发: 微信文章无法获取阅读数，返回low`);
        return {
          category: 'low',
          reasoning: `微信文章无法获取阅读统计数据，视为传播力不足`,
          scores: { credibility: 10, virality: 10 },
          total_score: 20,
          preCheckTriggered: true,
          preCheckReason: 'weixin_no_stats'
        };
      }
    }

    // 规则3.6：微博交互数据检查
    // 如果引用微博且微博交互数据不高，直接返回 low
    if (backgroundInfo && backgroundInfo.source === 'weibo' && backgroundInfo.metrics) {
      const repostsCount = backgroundInfo.metrics.reposts_count || 0;
      const commentsCount = backgroundInfo.metrics.comments_count || 0;
      const attitudesCount = backgroundInfo.metrics.attitudes_count || 0;

      // 总交互数 = 转发 + 评论 + 点赞
      const totalEngagement = repostsCount + commentsCount + attitudesCount;

      // 阈值：总交互数 < 150 认为传播力不足
      const LOW_ENGAGEMENT_THRESHOLD = 150;

      if (totalEngagement < LOW_ENGAGEMENT_THRESHOLD) {
        const authorName = backgroundInfo.author_name || '未知';
        const engagementDetails = [];
        if (repostsCount > 0) engagementDetails.push(`转发${repostsCount}`);
        if (commentsCount > 0) engagementDetails.push(`评论${commentsCount}`);
        if (attitudesCount > 0) engagementDetails.push(`点赞${attitudesCount}`);

        const engagementStr = engagementDetails.length > 0
          ? engagementDetails.join('、')
          : '无交互数据';

        console.log(`[NarrativeAnalyzer] 规则3.6触发: 微博总交互数(${totalEngagement})低于阈值(${LOW_ENGAGEMENT_THRESHOLD})，返回low`);
        return {
          category: 'low',
          reasoning: `微博作者"${authorName}"的交互数据过低（${engagementStr}，总交互${totalEngagement}），传播力不足（阈值：${LOW_ENGAGEMENT_THRESHOLD}）`,
          scores: { credibility: 10, virality: 10 },
          total_score: 20,
          preCheckTriggered: true,
          preCheckReason: 'weibo_low_engagement'
        };
      }

      console.log(`[NarrativeAnalyzer] 微博交互数据检查通过: 总交互数=${totalEngagement}（转发${repostsCount}+评论${commentsCount}+点赞${attitudesCount}）`);
    }

    // 规则4：公开信息检查（基于 classifiedUrls）
    // 区分两种情况：没有公开信息（unrated） vs 有信息但失效（low）

    // 公开信息平台（排除 Telegram/Discord 通讯应用）
    const publicUrlPlatforms = ['twitter', 'weibo', 'youtube', 'tiktok', 'douyin', 'bilibili', 'weixin', 'github', 'amazon', 'websites'];

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
    const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo };
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

      // 如果满足任一条件 + 有媒体 → 进行图片识别或返回unrated
      if (isHighInfluence || isHighEngagement) {
        const hasImages = tweet?.media?.images && tweet.media.images.length > 0;
        const hasVideos = tweet?.media?.videos && tweet.media.videos.length > 0;

        // 高影响力账号 + 有图片 → 进行图片识别
        if (isHighInfluence && hasImages) {
          console.log(`[NarrativeAnalyzer] 高影响力账号 @${authorScreenName} 的推文包含图片，启动图片识别...`);

          const imageAnalysisResult = await this._analyzeImagesForHighInfluenceAccount(
            tweet.media.images,
            tokenData
          );

          if (imageAnalysisResult) {
            // 将图片分析结果附加到 twitterInfo
            if (!twitterInfo._imageAnalysis) {
              twitterInfo._imageAnalysis = [];
            }
            twitterInfo._imageAnalysis.push({
              account: authorScreenName,
              accountBackground: getHighInfluenceAccountBackground(authorScreenName),
              ...imageAnalysisResult
            });

            console.log(`[NarrativeAnalyzer] 图片识别完成（${imageAnalysisResult.images_analyzed}张），继续LLM分析`);
            // 不返回unrated，继续后续分析
            continue;
          }
        }

        // 有视频或高交互数据（非高影响力账号）→ 仍然返回 unrated
        const reasons = [];
        if (isHighInfluence) {
          const background = getHighInfluenceAccountBackground(authorScreenName);
          reasons.push(`推文作者@${authorScreenName}是高影响力账号（${background}）`);
        }
        if (isHighEngagement) {
          reasons.push(`推文交互数据高（点赞${likeCount}，转发${retweetCount}）`);
        }
        reasons.push(hasVideos ? '推文带有视频内容（暂不支持分析）' : '推文带有媒体内容');

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

    // 规则6：已移除 - Twitter社区名称匹配不再直接返回unrated
    // 社区代币将通过LLM流程进行分析（见_shouldUseAccountCommunityAnalysis）
    // 如果只有社区信息且无其他内容，会走账号/社区分析流程

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
        xiaohongshuInfo: null,
        weixinInfo: null,
        amazonInfo: null,
        classifiedUrls: {  // 空的分类URL对象
          twitter: [],
          weibo: [],
          youtube: [],
          tiktok: [],
          douyin: [],
          bilibili: [],
          xiaohongshu: [],
          weixin: [],
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
      xiaohongshu: classifiedUrls.xiaohongshu?.length || 0,
      weixin: classifiedUrls.weixin?.length || 0,
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
      xiaohongshuInfo: null,
      weixinInfo: null,
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
      // 其次选择 community 类型
      const community = classifiedUrls.twitter.find(u => u.type === 'community');
      if (community) return community;
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
          let info;

          // 特殊处理：Twitter Community 链接
          if (twitterUrlInfo.type === 'community') {
            console.log('[NarrativeAnalyzer] 检测到Twitter Community链接，获取社区信息');
            try {
              // 从URL中提取community ID
              const communityIdMatch = twitterUrlInfo.url.match(/\/communities\/(\d+)/);
              if (communityIdMatch) {
                const communityId = communityIdMatch[1];
                const { fetchCommunityById } = await import('../../utils/twitter-validation/communities-api.js');
                info = await fetchCommunityById(communityId);

                if (info) {
                  // 将社区信息转换为twitter_info兼容格式
                  info = {
                    id: info.id,  // 保留community_id，供后续规则验证使用
                    type: 'community',
                    name: info.name,
                    description: info.description,
                    members_count: info.members_count,
                    moderators_count: info.moderators_count,
                    rules: info.rules,
                    avatar_image_url: info.avatar_image_url,
                    banner_image_url: info.banner_image_url,
                    created_at: info.created_at,
                    // 保留原始community数据用于后续分析
                    community_results: info
                  };
                  console.log(`[NarrativeAnalyzer] 成功获取Twitter社区: "${info.name}" (${info.members_count}成员)`);
                }
              }
            } catch (err) {
              console.warn('[NarrativeAnalyzer] 获取Twitter社区信息失败:', err.message);
            }
          } else {
            // 常规推文/账号获取
            info = await TwitterFetcher.fetchFromUrls(twitterUrlInfo.url, null);
          }

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

    // === 8. 微信文章数据 ===
    const weixinUrlInfo = selectFirstUrl('weixin');
    if (weixinUrlInfo) {
      const weixinFetch = await this._recordDataFetch(
        async () => {
          const info = await WeixinFetcher.fetchArticleInfo(weixinUrlInfo.url);
          if (info) {
            console.log(`[NarrativeAnalyzer] 微信文章信息: "${info.title}"`);
          }
          return info;
        },
        'weixin',
        weixinUrlInfo.url
      );
      results.weixinInfo = weixinFetch.data;
      dataFetchResults.weixin = weixinFetch.record;
      if (!weixinFetch.record.success) {
        results.fetchErrors.videoErrors.weixin = weixinFetch.record.error;
      }
    }

    // === 9. Amazon数据 ===
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

    // === 10. 小红书数据 ===
    const xiaohongshuUrlInfo = selectFirstUrl('xiaohongshu');
    if (xiaohongshuUrlInfo) {
      const xiaohongshuFetch = await this._recordDataFetch(
        async () => {
          const info = await XiaohongshuFetcher.fetchNoteInfo(xiaohongshuUrlInfo.url);
          if (info) {
            const influenceLevel = XiaohongshuFetcher.getInfluenceLevel(info);
            info.influence_level = influenceLevel;
            info.influence_description = XiaohongshuFetcher.getInfluenceDescription(influenceLevel);
            console.log(`[NarrativeAnalyzer] 小红书信息: "${info.title}"`);
          }
          return info;
        },
        'xiaohongshu',
        xiaohongshuUrlInfo.url
      );
      results.xiaohongshuInfo = xiaohongshuFetch.data;
      dataFetchResults.xiaohongshu = xiaohongshuFetch.record;
      if (!xiaohongshuFetch.record.success) {
        results.fetchErrors.videoErrors.xiaohongshu = xiaohongshuFetch.record.error;
      }
    }

    // === 11. 普通网站数据 ===
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
      weixinInfo,
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
      // 检查社区信息（社区数据也算有效数据）
      if (twitterInfo.type === 'community') {
        // 社区名称、成员数、描述都是信息
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

    // 微信文章: 检查是否有实际内容（title、content等）
    if (weixinInfo) {
      if (weixinInfo.title && weixinInfo.title.trim().length > 0) {
        return true; // 有微信文章内容
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
   * 检查是否应该使用账号/社区分析流程
   * 条件：有账号/社区信息且无推文（网站、电报、Discord都不阻断）
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {boolean} 是否应该使用账号/社区分析
   */
  static _shouldUseAccountCommunityAnalysis(fetchResults) {
    const {
      twitterInfo
    } = fetchResults;

    // 必须有账号或社区类型的twitterInfo
    if (!twitterInfo || (twitterInfo.type !== 'account' && twitterInfo.type !== 'community')) {
      return false;
    }

    // 检查是否有其他可用信息
    // 有推文内容 → 走正常流程
    if (twitterInfo.text && twitterInfo.text.trim().length > 0) {
      return false;
    }

    // 有账号/社区信息且无推文 → 使用账号/社区分析流程
    // 注意：网站、电报、Discord都不阻断，只要有账号/社区且无推文就走账号分析
    return true;
  }

  /**
   * 执行账号/社区代币分析
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果
   * @returns {Promise<Object>} 分析结果
   */
  static async _analyzeAccountCommunityToken(tokenData, fetchResults) {
    const { buildAccountCommunityAnalysisPrompt } = await import('./prompts/account-community-analysis.mjs');
    const {
      getAccountWithFullTweets,
      getCommunityWithFullTweets,
      performRulesValidation
    } = await import('./prompts/account-community-rules.mjs');

    const twitterInfo = fetchResults.twitterInfo;
    const accountOrCommunityRef = twitterInfo.type === 'account'
      ? { type: 'account', screen_name: twitterInfo.screen_name }
      : { type: 'community', community_id: twitterInfo.id };

    logger.info('AccountCommunityAnalysis', `开始${twitterInfo.type === 'account' ? '账号' : '社区'}代币分析`, {
      type: twitterInfo.type,
      identifier: twitterInfo.type === 'account' ? twitterInfo.screen_name : twitterInfo.id
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 第一步：规则验证（地址验证 + 名称匹配）- 不使用LLM
    // ═══════════════════════════════════════════════════════════════════════════
    logger.info('AccountCommunityAnalysis', '执行规则验证（地址 + 名称）');

    // 获取完整的账号/社区数据（含完整推文，用于规则验证）
    const fullAccountOrCommunityData = accountOrCommunityRef.type === 'account'
      ? await getAccountWithFullTweets(accountOrCommunityRef.screen_name, 20)
      : await getCommunityWithFullTweets(accountOrCommunityRef.community_id, 20);

    if (!fullAccountOrCommunityData) {
      return {
        category: 'low',
        reasoning: '无法获取账号/社区完整数据（用于规则验证）',
        scores: null,
        total_score: null
      };
    }

    // 执行规则验证
    const tokenAddress = tokenData.address;
    const tokenSymbol = tokenData.symbol || '';
    const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

    const rulesResult = performRulesValidation(
      tokenAddress,
      tokenSymbol,
      tokenName,
      fullAccountOrCommunityData
    );

    logger.info('AccountCommunityAnalysis', '规则验证结果', {
      passed: rulesResult.passed,
      stage: rulesResult.stage,
      addressVerified: rulesResult.addressVerified,
      nameMatch: rulesResult.nameMatch
    });

    // 规则验证未通过，直接返回low
    if (!rulesResult.passed) {
      return {
        category: 'low',
        reasoning: rulesResult.reason,
        scores: null,
        total_score: null,
        addressVerified: rulesResult.addressVerified,
        nameMatch: rulesResult.nameMatch,
        details: rulesResult.details,
        rulesValidation: true, // 标记这是规则验证的结果
        // 规则验证失败返回preCheckData，在"预检查"卡片展示
        preCheckData: {
          category: 'low',
          reason: rulesResult.reason,
          result: {
            addressVerified: rulesResult.addressVerified,
            nameMatch: rulesResult.nameMatch,
            details: rulesResult.details,
            validationStage: rulesResult.stage
          }
        }
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 第二步：LLM分析（币种类型判断 + 评级）
    // ═══════════════════════════════════════════════════════════════════════════
    const prompt = await buildAccountCommunityAnalysisPrompt(tokenData, accountOrCommunityRef);

    if (!prompt) {
      return {
        category: 'low',
        reasoning: '无法构建账号/社区分析Prompt（数据获取失败）',
        scores: null,
        total_score: null,
        // prompt构建失败也返回preCheckData
        preCheckData: {
          category: 'low',
          reason: '无法构建账号/社区分析Prompt（数据获取失败）',
          result: {
            addressVerified: rulesResult.addressVerified,
            nameMatch: rulesResult.nameMatch,
            details: rulesResult.details,
            error: '无法构建Prompt'
          }
        }
      };
    }

    const callResult = await this._callLLMAPI(prompt);

    if (!callResult.success) {
      throw new Error(`账号/社区分析LLM调用失败: ${callResult.error}`);
    }

    // 解析响应
    let parsed;
    try {
      // 清理markdown代码块标记
      let content = callResult.content.trim();
      // 移除 ```json 和 ``` 标记
      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      parsed = JSON.parse(content);
    } catch (e) {
      logger.error('AccountCommunityAnalysis', '解析LLM响应失败', { error: e.message, content: callResult.content });
      return {
        category: 'low',
        reasoning: '分析响应解析失败',
        scores: null,
        total_score: null
      };
    }

    // 注意：地址验证和名称匹配已在规则验证阶段完成，无需再检查LLM返回的这些字段

    // 判断币种类型并分流处理
    const tokenType = parsed.tokenType || 'project'; // 默认为项目币

    // ═══════════════════════════════════════════════════════════════════════════════
    // 新增：Web3 原生 IP 早期判断
    // ═══════════════════════════════════════════════════════════════════════════════
    if (tokenType === 'web3_native_ip_early') {
      // Web3 原生 IP 处于早期发展阶段，直接返回 unrated
      logger.info('AccountCommunityAnalysis', '判断为Web3原生IP早期，返回unrated', {
        ipConcept: parsed.ipConcept?.substring(0, 100)
      });

      return {
        category: 'unrated',
        reasoning: parsed.reason || 'Web3原生IP处于早期发展阶段，需等待社区成长后再评估',
        scores: null,
        total_score: null,
        // 使用规则验证的结果
        addressVerified: rulesResult.addressVerified,
        nameMatch: rulesResult.nameMatch,
        // 前置LLM阶段数据（账号/社区分析判断币种类型）
        prestageData: {
          category: 'unrated', // Web3原生IP早期
          prompt: prompt,
          raw_output: callResult.content,
          parsed_output: {
            ...parsed,
            // 添加规则验证结果
            addressVerified: rulesResult.addressVerified,
            nameMatch: rulesResult.nameMatch,
            details: rulesResult.details
          },
          model: callResult.model,
          started_at: callResult.startedAt,
          finished_at: callResult.finishedAt,
          success: callResult.success,
          error: callResult.error
        }
      };
    }

    if (tokenType === 'meme') {
      // meme币：转入两阶段分析流程
      logger.info('AccountCommunityAnalysis', '判断为meme币，转入两阶段分析流程', {
        accountSummary: parsed.accountSummary?.substring(0, 100)
      });

      // 构建带账号摘要的fetchResults
      const memeFetchResults = {
        ...fetchResults,
        accountSummary: parsed.accountSummary || '' // 将账号摘要传入
      };

      // 调用meme币两阶段分析流程，传递规则验证结果和前置LLM数据
      const memeResult = await this._analyzeMemeTokenTwoStage(tokenData, memeFetchResults, {
        stage1Prompt: prompt,
        stage1CallResult: callResult,
        stage1Parsed: parsed,
        rulesResult: rulesResult // 传递规则验证结果
      });

      // 添加前置LLM阶段数据（账号/社区分析判断币种类型）
      memeResult.prestageData = {
        category: 'meme', // 前置LLM判断为meme币
        prompt: prompt,
        raw_output: callResult.content,
        parsed_output: {
          ...parsed,
          // 添加规则验证结果
          addressVerified: rulesResult.addressVerified,
          nameMatch: rulesResult.nameMatch,
          details: rulesResult.details
        },
        model: callResult.model,
        started_at: callResult.startedAt,
        finished_at: callResult.finishedAt,
        success: callResult.success,
        error: callResult.error
      };

      return memeResult;
    } else {
      // 项目币：直接返回评级结果
      const rating = parsed.rating || 'low';
      const reason = parsed.reason || '';

      // 映射到现有category
      const categoryMap = {
        'high': 'high',
        'mid': 'mid',
        'low': 'low'
      };

      return {
        category: categoryMap[rating] || 'low',
        reasoning: reason,
        scores: null, // 简化流程不返回详细评分
        total_score: null,
        // 使用规则验证的结果
        addressVerified: rulesResult.addressVerified,
        nameMatch: rulesResult.nameMatch,
        baselineMet: parsed.baselineMet,
        // 合并details（规则验证的 + LLM的）
        details: {
          ...rulesResult.details,
          projectReason: parsed.details?.projectReason,
          memeReason: parsed.details?.memeReason
        },
        // 前置LLM阶段数据（账号/社区分析判断币种类型）
        prestageData: {
          category: categoryMap[rating] || 'low',
          prompt: prompt,
          raw_output: callResult.content,
          parsed_output: {
            ...parsed,
            // 添加规则验证结果
            addressVerified: rulesResult.addressVerified,
            nameMatch: rulesResult.nameMatch,
            details: {
              ...rulesResult.details,
              projectReason: parsed.details?.projectReason,
              memeReason: parsed.details?.memeReason
            }
          },
          model: callResult.model,
          started_at: callResult.startedAt,
          finished_at: callResult.finishedAt,
          success: callResult.success,
          error: callResult.error
        }
      };
    }
  }

  /**
   * 执行meme币两阶段分析（用于账号/社区分析判断为meme币后的分流）
   * @param {Object} tokenData - 代币数据
   * @param {Object} fetchResults - 获取的数据结果（包含accountSummary）
   * @param {Object} stage1Info - 第一阶段信息（账号分析，不保存）
   * @returns {Promise<Object>} 分析结果
   */
  static async _analyzeMemeTokenTwoStage(tokenData, fetchResults, stage1Info) {
    logger.info('MemeTokenAnalysis', '开始meme币两阶段分析');

    // 事件分析（对应代币的第一阶段）
    logger.debug('MemeTokenAnalysis', '开始事件分析');
    const eventPrompt = PromptBuilder.buildEventAnalysis(tokenData, fetchResults);
    const eventPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 1);

    const eventCallResult = await this._callLLMAPI(eventPrompt);

    if (!eventCallResult.success) {
      throw new Error(`事件分析LLM调用失败: ${eventCallResult.error}`);
    }

    const eventData = this._parseEventResponse(eventCallResult.content);

    if (!eventData.pass) {
      // 事件分析未通过，直接返回
      logger.info('MemeTokenAnalysis', '事件分析未通过', {
        reason: eventData.reason
      });

      return {
        category: 'low',
        reasoning: eventData.reason,
        scores: null,
        total_score: null,
        // 添加规则验证结果
        addressVerified: stage1Info.rulesResult?.addressVerified,
        nameMatch: stage1Info.rulesResult?.nameMatch,
        // 只保存事件分析到stage1，不保存账号分析
        stage1Data: {
          category: 'low', // 事件分析未通过
          prompt: eventPrompt,
          raw_output: eventCallResult.content,
          parsed_output: {
            ...eventData,
            // 添加规则验证结果到parsed_output
            addressVerified: stage1Info.rulesResult?.addressVerified,
            nameMatch: stage1Info.rulesResult?.nameMatch,
            details: stage1Info.rulesResult?.details
          },
          model: eventCallResult.model,
          started_at: eventCallResult.startedAt,
          finished_at: eventCallResult.finishedAt,
          success: eventCallResult.success,
          error: eventCallResult.error
        },
        // 事件分析未通过，没有stage2
        stage2Data: null
      };
    }

    // 事件分析通过，进入代币分析（对应代币的第二阶段）
    logger.info('MemeTokenAnalysis', '事件分析通过，进入代币分析');

    // 先准备Stage1数据（即使Stage2失败也要保存Stage1）
    const stage1Data = {
      category: 'pass', // 事件分析通过，标记为pass
      prompt: eventPrompt,
      raw_output: eventCallResult.content,
      parsed_output: {
        ...eventData,
        // 添加规则验证结果到parsed_output
        addressVerified: stage1Info.rulesResult?.addressVerified,
        nameMatch: stage1Info.rulesResult?.nameMatch,
        details: stage1Info.rulesResult?.details
      },
      model: eventCallResult.model,
      started_at: eventCallResult.startedAt,
      finished_at: eventCallResult.finishedAt,
      success: eventCallResult.success,
      error: eventCallResult.error
    };

    const tokenPrompt = PromptBuilder.buildTokenAnalysis(tokenData, fetchResults, eventData.eventAnalysis);
    const tokenPromptType = PromptBuilder.getPromptTypeDesc(fetchResults, 2);

    const tokenCallResult = await LLMClient.analyzeWithMetadata(tokenPrompt);

    // 准备Stage2数据（无论成功还是失败）
    const stage2Data = {
      category: tokenCallResult.parsed?.category || null,
      prompt: tokenPrompt,
      raw_output: tokenCallResult.raw?.raw || tokenCallResult.raw || null,
      parsed_output: tokenCallResult.parsed,
      model: tokenCallResult.model,
      started_at: tokenCallResult.startedAt,
      finished_at: tokenCallResult.finishedAt,
      success: tokenCallResult.success,
      error: tokenCallResult.error
    };

    if (!tokenCallResult.success) {
      // Stage2失败，返回Stage1的结果
      logger.warn('MemeTokenAnalysis', `代币分析失败，仅返回Stage1结果: ${tokenCallResult.error}`);
      return {
        category: 'unrated',
        reasoning: `事件分析通过，但代币分析失败: ${tokenCallResult.error}`,
        scores: null,
        total_score: null,
        analysis_stage: 1,
        // 添加规则验证结果
        addressVerified: stage1Info.rulesResult?.addressVerified,
        nameMatch: stage1Info.rulesResult?.nameMatch,
        // 保存事件分析到stage1
        stage1Data: stage1Data,
        // Stage2失败，记录失败信息
        stage2Data: stage2Data
      };
    }

    // 返回最终结果
    return {
      ...tokenCallResult.parsed,
      // 添加规则验证结果
      addressVerified: stage1Info.rulesResult?.addressVerified,
      nameMatch: stage1Info.rulesResult?.nameMatch,
      // 保存事件分析到stage1，代币分析到stage2
      // 账号分析不保存（stage1Info中的数据不使用）
      stage1Data: stage1Data,
      stage2Data: stage2Data
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
    // 优先级: prestage > stage2 > stage1 > pre_check
    const llm_category = record.llm_prestage_category || record.llm_stage2_category || record.llm_stage1_category || record.pre_check_category || null;

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
        // 前置LLM阶段数据（账号/社区分析判断币种类型）
        prestage: record.llm_prestage_parsed_output ? {
          category: record.llm_prestage_category,
          model: record.llm_prestage_model,
          prompt: record.llm_prestage_prompt,
          rawOutput: record.llm_prestage_raw_output,
          parsedOutput: record.llm_prestage_parsed_output,
          startedAt: record.llm_prestage_started_at,
          finishedAt: record.llm_prestage_finished_at,
          success: record.llm_prestage_success,
          error: record.llm_prestage_error
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
        // 规则验证结果（优先从prestage获取，因为规则验证在前置LLM阶段执行）
        addressVerified: record.llm_prestage_parsed_output?.addressVerified ?? record.llm_stage1_parsed_output?.addressVerified ?? null,
        nameMatch: record.llm_prestage_parsed_output?.nameMatch ?? record.llm_stage1_parsed_output?.nameMatch ?? null,
        details: record.llm_prestage_parsed_output?.details ?? record.llm_stage1_parsed_output?.details ?? null,
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
   * 解析事件分析响应（新框架第一阶段）
   * 与_parseStage1Response类似，但支持eventAnalysis字段
   * @param {string} content - LLM响应内容
   * @returns {Object} 解析结果
   * @private
   */
  static _parseEventResponse(content) {
    // 多种策略尝试提取JSON
    let jsonStr = null;

    // 策略1: 尝试提取markdown代码块中的JSON
    const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
      console.log('[NarrativeAnalyzer] EventAnalysis: 使用代码块策略提取JSON');
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
            console.log('[NarrativeAnalyzer] EventAnalysis: 使用括号匹配策略提取JSON');
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
        console.log('[NarrativeAnalyzer] EventAnalysis: 使用正则策略提取JSON');
      }
    }

    // 如果所有策略都失败，打印原始响应并抛出错误
    if (!jsonStr) {
      console.error('[NarrativeAnalyzer] EventAnalysis: 无法提取JSON，原始响应:', content);
      throw new Error('EventAnalysis: 无法提取JSON');
    }

    try {
      const result = JSON.parse(jsonStr);
      if (typeof result.pass !== 'boolean') {
        throw new Error('EventAnalysis: pass字段必须是boolean');
      }

      // 必须包含stage字段：0=通过，1=事件分析触发
      if (result.stage === undefined) {
        throw new Error('EventAnalysis: stage字段缺失');
      }

      return {
        pass: result.pass,
        reason: result.reason || '',
        stage: result.stage,
        scenario: result.scenario || 0,  // 保留兼容性
        entities: result.entities || {},
        eventAnalysis: result.eventAnalysis || null  // 新字段：事件分析结果
      };
    } catch (parseError) {
      console.error('[NarrativeAnalyzer] EventAnalysis: JSON解析失败，提取的字符串:', jsonStr);
      throw new Error(`EventAnalysis: JSON解析失败 - ${parseError.message}`);
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

  /**
   * 执行 Stage 1：低质量检测
   * 用于独立的叙事分析引擎，只执行第一阶段检测
   * @param {string} address - 代币地址
   * @param {Object} options - 选项
   * @param {boolean} options.ignoreCache - 是否忽略缓存
   * @param {string} options.experimentId - 实验ID
   * @returns {Promise<Object>} Stage 1 结果 { pass, category, reason, stage, scenario, entities, started_at, finished_at, success, error }
   */
  static async analyzeStage1(address, options = {}) {
    const { ignoreCache = false, experimentId = null } = options;
    const normalizedAddress = address.toLowerCase();

    logger.info('Stage1', '分析开始', { address: normalizedAddress, experimentId });

    // 1. 检查缓存
    const cached = await NarrativeRepository.findByAddress(normalizedAddress);
    if (cached && cached.is_valid && !ignoreCache) {
      if (cached.llm_stage1_parsed_output) {
        logger.debug('Stage1', '使用缓存', { address: normalizedAddress });
        return {
          pass: cached.llm_stage1_category !== 'low',
          category: cached.llm_stage1_category || null,
          reason: cached.llm_stage1_parsed_output?.reason || '',
          stage: cached.llm_stage1_parsed_output?.stage || 0,
          scenario: cached.llm_stage1_parsed_output?.scenario || 0,
          entities: cached.llm_stage1_parsed_output?.entities || {},
          started_at: cached.llm_stage1_started_at,
          finished_at: cached.llm_stage1_finished_at,
          success: cached.llm_stage1_success ?? true,
          error: cached.llm_stage1_error || null
        };
      }
    }

    // 2. 获取代币数据
    const tokenData = await this.fetchTokenData(normalizedAddress);
    if (!tokenData) {
      throw new Error('代币不存在');
    }

    const extractedInfo = this.extractInfo(tokenData);

    // 3. 获取数据（使用URL分类器）
    console.log('[NarrativeAnalyzer] Stage 1: 开始获取数据...');
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
      url_extraction_result,
      data_fetch_results
    } = await this._fetchAllDataViaClassifier(tokenData, extractedInfo);

    logger.debug('Stage1', '数据获取完成');

    // 4. 预检查
    const preCheckResult = await this.performPreCheck(
      tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls,
      { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, amazonInfo },
      githubInfo, backgroundInfo, {}
    );

    if (preCheckResult) {
      logger.debug('Stage1', '预检查触发');
      // 预检查触发，保存并返回
      // 注意：不设置 category 字段，避免被保存到 llm_stage1_category
      // 预检查结果应该只保存在 pre_check_* 字段中
      const preCheckData = {
        pass: false,
        // category: preCheckResult.category,  // 不设置，避免与 llm_stage1_category 混淆
        reason: preCheckResult.reasoning,
        stage: 0,
        scenario: 0,
        entities: {},
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        success: true,
        error: null,
        // 额外添加预检查元数据
        preCheckCategory: preCheckResult.category,
        preCheckTriggered: true
      };

      // 准备预检查数据用于保存（与 analyze() 方法保持一致）
      const preCheckDataToSave = {
        category: preCheckResult.category,
        reason: preCheckResult.preCheckReason,
        result: preCheckResult
      };

      await this._saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, preCheckData, url_extraction_result, data_fetch_results, null, preCheckDataToSave);
      return preCheckData;
    }

    // 5. 检查是否有有效数据
    const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, classifiedUrls };
    const hasAnyData = this._hasValidDataForAnalysis(fetchResults);

    if (!hasAnyData) {
      logger.warn('Stage1', '没有有效数据');
      const noDataResult = {
        pass: false,
        category: 'unrated',
        reason: '没有可用的数据进行分析',
        stage: 0,
        scenario: 0,
        entities: {},
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        success: true,
        error: null
      };
      await this._saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, noDataResult, url_extraction_result, data_fetch_results);
      return noDataResult;
    }

    // 6. Stage 1 LLM 检测
    logger.debug('Stage1', '执行 LLM 低质量检测');
    const stage1Prompt = PromptBuilder.buildStage1(tokenData, fetchResults);
    const stage1CallResult = await this._callLLMAPI(stage1Prompt);

    if (!stage1CallResult.success) {
      throw new Error(`Stage 1 LLM调用失败: ${stage1CallResult.error}`);
    }

    const stage1Data = this._parseStage1Response(stage1CallResult.content);

    const stage1Result = {
      pass: stage1Data.pass,
      category: stage1Data.pass ? 'pass' : (stage1Data.category || 'low'),
      reason: stage1Data.reason || '',
      stage: stage1Data.stage || 0,
      scenario: stage1Data.scenario || 0,
      entities: stage1Data.entities || {},
      started_at: stage1CallResult.startedAt,
      finished_at: stage1CallResult.finishedAt,
      success: stage1CallResult.success,
      error: stage1CallResult.error || null
    };

    logger.info('Stage1', '完成', {
      pass: stage1Result.pass,
      category: stage1Result.category,
      reason: stage1Result.reason
    });

    // 7. 保存 Stage 1 结果
    await this._saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, stage1Result, url_extraction_result, data_fetch_results, {
      category: stage1CallResult.model ? (stage1Data.pass ? 'pass' : (stage1Data.category || 'low')) : null,
      model: stage1CallResult.model,
      prompt: stage1Prompt,
      raw_output: stage1CallResult.content,
      parsed_output: stage1Data,
      started_at: stage1CallResult.startedAt,
      finished_at: stage1CallResult.finishedAt,
      success: stage1CallResult.success,
      error: stage1CallResult.error
    });

    return stage1Result;
  }

  /**
   * 执行 Stage 2：详细评分
   * 用于独立的叙事分析引擎，Stage 1 通过后执行
   * @param {string} address - 代币地址
   * @param {Object} options - 选项
   * @param {string} options.experimentId - 实验ID
   * @returns {Promise<Object>} Stage 2 结果 { category, total_score, reasoning, scores, started_at, finished_at, success, error }
   */
  static async analyzeStage2(address, options = {}) {
    const { experimentId = null } = options;
    const normalizedAddress = address.toLowerCase();

    logger.info('Stage2', '分析开始', { address: normalizedAddress, experimentId });

    // 1. 获取代币数据（复用已有的数据，或重新获取）
    const tokenData = await this.fetchTokenData(normalizedAddress);
    if (!tokenData) {
      throw new Error('代币不存在');
    }

    const extractedInfo = this.extractInfo(tokenData);

    // 2. 获取数据（可以考虑复用 Stage 1 已保存的数据，避免重复请求）
    console.log('[NarrativeAnalyzer] Stage 2: 开始获取数据...');
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
      classifiedUrls
    } = await this._fetchAllDataViaClassifier(tokenData, extractedInfo);

    logger.debug('Stage2', '数据获取完成');

    const fetchResults = {
      twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo,
      youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, classifiedUrls
    };

    // 3. 检查是否有有效数据
    const hasAnyData = this._hasValidDataForAnalysis(fetchResults);
    if (!hasAnyData) {
      logger.warn('Stage2', '没有有效数据');
      const noDataResult = {
        category: 'unrated',
        reasoning: '没有可用的数据进行分析',
        scores: null,
        total_score: null,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        success: true,
        error: null
      };
      await this._saveStage2Data(normalizedAddress, experimentId, noDataResult);
      return noDataResult;
    }

    // 4. Stage 2 LLM 评分
    logger.debug('Stage2', '执行 LLM 详细评分');
    const stage2Prompt = PromptBuilder.buildStage2(tokenData, fetchResults);
    const stage2CallResult = await LLMClient.analyzeWithMetadata(stage2Prompt);

    // 准备Stage2数据（无论成功还是失败）
    const stage2Result = {
      category: stage2CallResult.parsed?.category || null,
      total_score: stage2CallResult.parsed?.total_score || null,
      reasoning: stage2CallResult.parsed?.reasoning || '',
      scores: stage2CallResult.parsed?.scores || {},
      started_at: stage2CallResult.startedAt,
      finished_at: stage2CallResult.finishedAt,
      success: stage2CallResult.success,
      error: stage2CallResult.error || null
    };

    if (!stage2CallResult.success) {
      // Stage2失败，记录警告并返回失败结果
      logger.warn('Stage2', `LLM调用失败: ${stage2CallResult.error}`);
      // 仍然保存失败的结果
      await this._saveStage2Data(normalizedAddress, experimentId, stage2Result, {
        category: null,
        model: stage2CallResult.model,
        prompt: stage2Prompt,
        raw_output: stage2CallResult.raw?.raw || null,
        parsed_output: null,
        started_at: stage2CallResult.startedAt,
        finished_at: stage2CallResult.finishedAt,
        success: stage2CallResult.success,
        error: stage2CallResult.error
      });
      return stage2Result;
    }

    logger.info('Stage2', '完成', {
      category: stage2Result.category,
      totalScore: stage2Result.total_score
    });

    // 5. 保存 Stage 2 结果（传递完整的调用结果，包含 raw 数据）
    await this._saveStage2Data(normalizedAddress, experimentId, stage2Result, {
      category: stage2CallResult.parsed.category,
      model: stage2CallResult.model,
      prompt: stage2Prompt,
      raw_output: stage2CallResult.raw.raw,
      parsed_output: stage2CallResult.parsed,
      started_at: stage2CallResult.startedAt,
      finished_at: stage2CallResult.finishedAt,
      success: stage2CallResult.success,
      error: stage2CallResult.error
    });

    return stage2Result;
  }

  /**
   * 保存 Stage 1 数据到数据库
   * @private
   * @param {string} normalizedAddress - 代币地址
   * @param {Object} tokenData - 代币数据
   * @param {Object} extractedInfo - 提取的信息
   * @param {Object} twitterInfo - Twitter信息
   * @param {Object} classifiedUrls - 分类URLs
   * @param {string} experimentId - 实验ID
   * @param {Object} stage1Result - Stage 1 结果（简化版，用于返回）
   * @param {Object} urlExtractionResult - URL提取结果
   * @param {Object} dataFetchResults - 数据获取结果
   * @param {Object} stage1DataToSave - Stage 1 完整数据（包含 model, raw_output 等）
   * @param {Object} preCheckDataToSave - 预检查数据（包含 category, reason, result）
   */
  static async _saveStage1Data(normalizedAddress, tokenData, extractedInfo, twitterInfo, classifiedUrls, experimentId, stage1Result, urlExtractionResult, dataFetchResults, stage1DataToSave = null, preCheckDataToSave = null) {
    const cleanedTwitterInfo = this._cleanDataForDB(twitterInfo);

    const saveData = {
      token_address: normalizedAddress,
      token_symbol: tokenData.symbol,
      raw_api_data: tokenData.raw_api_data,
      extracted_info: extractedInfo,
      twitter_info: cleanedTwitterInfo,
      classified_urls: classifiedUrls,
      analyzed_at: new Date().toISOString(),
      experiment_id: experimentId,
      url_extraction_result: urlExtractionResult,
      data_fetch_results: dataFetchResults,

      // === 预检查字段（3个）===
      pre_check_category: preCheckDataToSave?.category || null,
      pre_check_reason: preCheckDataToSave?.reason || null,
      pre_check_result: preCheckDataToSave?.result || null
    };

    // 如果提供了完整的 Stage 1 数据，保存所有字段
    if (stage1DataToSave) {
      saveData.llm_stage1_category = stage1DataToSave.category;
      saveData.llm_stage1_model = stage1DataToSave.model;
      saveData.llm_stage1_prompt = stage1DataToSave.prompt;
      saveData.llm_stage1_raw_output = stage1DataToSave.raw_output;
      saveData.llm_stage1_parsed_output = stage1DataToSave.parsed_output;
      saveData.llm_stage1_started_at = stage1DataToSave.started_at;
      saveData.llm_stage1_finished_at = stage1DataToSave.finished_at;
      saveData.llm_stage1_success = stage1DataToSave.success;
      saveData.llm_stage1_error = stage1DataToSave.error;
    } else {
      // 兼容旧逻辑：只保存 stage1Result 中的字段
      saveData.llm_stage1_category = stage1Result.category;
      saveData.llm_stage1_started_at = stage1Result.started_at;
      saveData.llm_stage1_finished_at = stage1Result.finished_at;
      saveData.llm_stage1_success = stage1Result.success;
      saveData.llm_stage1_error = stage1Result.error;
    }

    await NarrativeRepository.save(saveData);
  }

  /**
   * 保存 Stage 2 数据到数据库
   * @private
   * @param {string} normalizedAddress - 代币地址
   * @param {string} experimentId - 实验ID
   * @param {Object} stage2Result - Stage 2 结果（简化版，用于返回）
   * @param {Object} stage2DataToSave - Stage 2 完整数据（包含 model, raw_output 等）
   */
  static async _saveStage2Data(normalizedAddress, experimentId, stage2Result, stage2DataToSave = null) {
    const saveData = {
      token_address: normalizedAddress,
      experiment_id: experimentId,
      analyzed_at: new Date().toISOString()
    };

    // 如果提供了完整的 Stage 2 数据，保存所有字段
    if (stage2DataToSave) {
      saveData.llm_stage2_category = stage2DataToSave.category;
      saveData.llm_stage2_model = stage2DataToSave.model;
      saveData.llm_stage2_prompt = stage2DataToSave.prompt;
      saveData.llm_stage2_raw_output = stage2DataToSave.raw_output;
      saveData.llm_stage2_parsed_output = stage2DataToSave.parsed_output;
      saveData.llm_stage2_started_at = stage2DataToSave.started_at;
      saveData.llm_stage2_finished_at = stage2DataToSave.finished_at;
      saveData.llm_stage2_success = stage2DataToSave.success;
      saveData.llm_stage2_error = stage2DataToSave.error;
    } else {
      // 兼容旧逻辑：只保存 stage2Result 中的字段
      saveData.llm_stage2_category = stage2Result.category;
      saveData.llm_stage2_started_at = stage2Result.started_at;
      saveData.llm_stage2_finished_at = stage2Result.finished_at;
      saveData.llm_stage2_success = stage2Result.success;
      saveData.llm_stage2_error = stage2Result.error;
    }

    await NarrativeRepository.save(saveData);
  }

  /**
   * 为高影响力账号的推文图片进行分析
   * @private
   * @param {Array} images - 图片列表 [{url, width, height, media_key}]
   * @param {Object} tokenData - 代币数据
   * @returns {Promise<Object|null>} 图片分析结果
   */
  static async _analyzeImagesForHighInfluenceAccount(images, tokenData) {
    const tokenSymbol = tokenData.symbol || '';
    const tokenName = tokenData.raw_api_data?.name || tokenData.name || '';
    const tokenIntro = tokenData.raw_api_data?.intro_en || tokenData.raw_api_data?.intro_cn || '';
    const tokenAddress = tokenData.address || '';

    // 最多分析3张图片
    const maxImages = Math.min(images.length, 3);
    const analysisResults = [];
    const startTime = Date.now();

    console.log(`[NarrativeAnalyzer] 开始分析 ${maxImages}/${images.length} 张图片（代币: ${tokenSymbol}）`);

    for (let i = 0; i < maxImages; i++) {
      const imageUrl = images[i].url;
      const imageStartTime = Date.now();

      console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 下载图片: ${imageUrl}`);

      try {
        // 下载图片
        const imageData = await ImageDownloader.downloadAsBase64(imageUrl, {
          maxSize: 5 * 1024 * 1024,  // 5MB
          timeout: 15000  // 15秒下载超时
        });

        if (!imageData) {
          console.warn(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 图片下载失败: ${imageUrl}`);
          continue;
        }

        const downloadTime = Date.now() - imageStartTime;
        console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 下载完成 (${downloadTime}ms, ${imageData.size}字节)`);

        // 构建分析 prompt
        const prompt = `你是代币叙事分析专家。请分析这张图片与代币"${tokenSymbol}"的关系。

【代币信息】
- Symbol: ${tokenSymbol}
${tokenName ? `- Name: ${tokenName}` : ''}
${tokenIntro ? `- 简介: ${tokenIntro}` : ''}
- 地址: ${tokenAddress.substring(0, 8)}...

【分析任务】
1. **图片内容描述**：详细描述图片中的主体、人物、动物、文字、符号等
2. **代币关联度评估**：图片内容与代币名称/Symbol是否有关联？说明关联方式
3. **meme/梗图识别**：是否是流行meme图？指出名称和含义
4. **营销信号**：图片是否呈现明显的营销设计风格？

【输出格式】（JSON）
{
  "description": "图片内容详细描述",
  "token_relevance": {
    "is_related": true/false,
    "reason": "关联/无关联的原因",
    "match_type": "symbol|name|concept|visual|none"
  },
  "meme_info": {
    "is_meme": true/false,
    "name": "meme名称（如果是）"
  },
  "marketing_signals": ["信号1", "信号2"]
}`;

        // 调用视觉模型分析图片
        const analysisStartTime = Date.now();
        const result = await LLMClient.analyzeImage(imageData.dataUrl, prompt, {
          model: 'Qwen/Qwen3-Omni-30B-A3B-Captioner',  // 使用快速模型 (约5秒)
          timeout: 20000,  // 20秒超时
          maxTokens: 2000
        });

        const analysisTime = Date.now() - analysisStartTime;

        // 解析结果
        let jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            analysisResults.push({
              image_url: imageUrl,
              analysis: parsed,
              timing: {
                download: downloadTime,
                analysis: analysisTime,
                total: downloadTime + analysisTime
              }
            });
            console.log(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 分析成功 (${analysisTime}ms): ${parsed.description?.substring(0, 40)}...`);
          } catch (e) {
            console.warn(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] JSON解析失败: ${e.message}`);
            // 尝试使用原始内容
            analysisResults.push({
              image_url: imageUrl,
              analysis: {
                description: result.content.substring(0, 200),
                token_relevance: { is_related: false, reason: '解析失败' }
              },
              timing: {
                download: downloadTime,
                analysis: analysisTime,
                total: downloadTime + analysisTime
              }
            });
          }
        }

      } catch (error) {
        const errorTime = Date.now() - imageStartTime;
        console.error(`[NarrativeAnalyzer] [${i + 1}/${maxImages}] 分析失败 (${errorTime}ms): ${error.message}`);
      }
    }

    const totalTime = Date.now() - startTime;

    if (analysisResults.length === 0) {
      console.log(`[NarrativeAnalyzer] 所有图片分析失败（总耗时: ${totalTime}ms）`);
      return null;
    }

    console.log(`[NarrativeAnalyzer] 图片分析完成: 成功 ${analysisResults.length}/${maxImages}张，总耗时 ${totalTime}ms`);

    return {
      images_analyzed: analysisResults.length,
      total_time_ms: totalTime,
      results: analysisResults
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
