/**
 * 叙事分析器
 * 核心服务：协调各组件完成叙事分析
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { NarrativeRepository } from '../db/NarrativeRepository.mjs';
import { ExternalResourceCache } from '../db/ExternalResourceCache.mjs';
import { PromptBuilder } from './prompt-builder.mjs';
import { getLogger } from '../core/logger.mjs';

// 新增：从拆分的模块导入
import { hasValidDataForAnalysis, hasIndependentWebsite, shouldUseAccountCommunityAnalysis, isProjectCoin, extractScreenNameFromTwitterUrl, detectIssuerSelfLaunch } from './utils/narrative-utils.mjs';
import { cleanDataForDB } from './utils/data-cleaner.mjs';
import { formatResult, buildLLMAnalysis } from './parsers/response-parser.mjs';
import { performPreCheck } from './services/pre-check-service.mjs';
import { fetchAllDataViaClassifier } from './services/data-fetch-service.mjs';
import { fetchGmgnSocialLinks } from '../utils/gmgn-social-fetcher.mjs';
import { fetchTokenData, extractInfo } from './services/token-info-service.mjs';
import { collectAllAccountsWithFullInfo, getFullAccountInfo, analyzeAccountCommunityToken, detectIssuerByCaTimeline } from './services/account-analysis-service.mjs';
import { detectSuperIP, calculatePreScores } from './prompts/super-ip/super-ip-registry.mjs';

// Jev 判定（主路径 + 超大IP快速通道 + prestage 前置判定）
import { JevClient } from './llm/JevClient.mjs';
import { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } from './llm/jev-questions.mjs';
import { JEV_PRESTAGE_QUESTIONS_VERSION } from './llm/jev-prestage-questions.mjs';
import { buildJevState } from './llm/jev-state-builder.mjs';
import { mapStandardAnswers, mapSuperIPAnswers } from './llm/jev-result-mapper.mjs';
import { classifyTweetType } from './services/tweet-type-classifier.mjs';

// 获取supabase客户端
const getSupabase = () => NarrativeRepository.getSupabase();

// 获取日志实例
const logger = getLogger();

/**
 * 检查URL是否使用免费托管平台（无自定义域名）
 * 只有Web3项目类（W类）需要此项检查
 */
const FREE_HOSTING_DOMAINS = [
  'github.io',     // GitHub Pages
  'glitch.me',     // Glitch
  'repl.co',       // Replit
  'onrender.com',  // Render
  'surge.sh',      // Surge
  '000webhostapp.com', // 000webhost
];

function _isFreeHostingUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return FREE_HOSTING_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

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
    rating: overrides.rating ?? stageData.rating ?? null,
    pass: overrides.pass ?? stageData.pass ?? po?.pass ?? po?.raw?.pass ?? null,
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
 * 代币分类提取（2026-09-27 用户裁定：分类作为叙事分析的输出，落库 token_category）
 *
 * 分类来源（三路互斥）：
 * - prestage 路径（账号/社区/项目币/发行方自发）：prestageDataToSave.category = tokenType
 *   （project / account_based_meme / web3_native_ip_early）
 * - superIP 快速通道：同一 prestage 位承载 category='super_ip_fast'（jev-result-mapper）
 * - 标准路径：stage1 事件类别 → 'event:<A~W>'
 * - precheck fail / no_data：未走到分类环节 → null
 *
 * @param {Object} prestageDataToSave - prestage 阶段数据（含 __clear 标记形态）
 * @param {Object} stage1DataToSave - 标准/superIP 路径 stage1 数据
 * @returns {string|null} 分类值
 */
export function deriveTokenCategory(prestageDataToSave, stage1DataToSave) {
  if (prestageDataToSave && prestageDataToSave.__clear !== true && prestageDataToSave.category) {
    return prestageDataToSave.category;
  }
  const eventCategory = (!stage1DataToSave || stage1DataToSave.__clear === true)
    ? null
    : stage1DataToSave.parsed_output?.eventClassification?.primaryCategory;
  return eventCategory ? `event:${eventCategory}` : null;
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
  // 过期推文窗（分钟）：语料推文距 mint > 窗口 → low 硬拦「叙事价值耗尽」。
  // 2026-10-01 用户裁定 10min → 6h：10min 比 Jev timing 题自己的「当前」档
  // （within_7d）严 4 个数量级，代码预拦抢了叙事新鲜度判断；6h 内放行进 Jev，
  // 由 timing 题分档（族五形状 B：TRUMAN 32min / 9 3.9h 放行实证）
  expiredTweetMinutesThreshold: 360
};

export class NarrativeAnalyzer {

  /**
   * 分析代币叙事（带缓存）
   * 叙事结果为代币级全局缓存（token_address 唯一，不挂实验名下）：
   * 同一代币任何实验/任何调用方共享一份，命中有效缓存即复用，不重复分析
   * @param {string} address - 代币地址
   * @param {Object} options - 选项
   * @param {boolean} options.ignoreCache - 是否忽略缓存，强制重新分析
   * @param {boolean} options.ignoreExpired - 是否忽略过期时间限制
   * @param {boolean} options.enrichSocialByGmgn - GMGN 社媒补源（BRF 案，仅叙事
   *   直调传 true）：元数据无社交链接时调 GMGN 补语料入口；且 no_public_info
   *   拦截的缓存行视为失真，穿透重析（见缓存命中分支）
   */
  static async analyze(address, options = {}) {
    const { ignoreCache = false, ignoreExpired = false, enrichSocialByGmgn = false } = options;

    // 标准化地址
    const normalizedAddress = address.toLowerCase();

    // 1. 检查缓存（查询最新的记录，任何实验的都可以）
    const cached = await NarrativeRepository.findByAddress(normalizedAddress);

    // 2. 判断是否可以使用缓存（代币级全局：命中有效缓存即复用，ignoreCache=true 才强制重分析）
    // GMGN 补源链路例外（BRF 案）：no_public_info 拦截行的根因是语料缺失（元数据+
    // IPFS 都无社媒链接），narrative engine 队列先写入的这类行在补源语境下已失真——
    // 直调穿透重析（带补源），新结果 upsert 覆盖旧行；其他行（Jev 评过/其他规则拦）照常复用
    const isNoPublicInfoBlock = cached?.pre_check_result?.details?.ruleName === 'no_public_info';
    if (cached && cached.is_valid && !ignoreCache && !(enrichSocialByGmgn && isNoPublicInfoBlock)) {
      // x-0 案（2026-09-27）：直调语境下行内无 GMGN 风险字段（engine 队列先写的行 /
      // 存量旧行）→ 补调 GMGN（1d 缓存兜底）并 updateGmgnInfo 回写，不重析 Jev——
      // 与 no_public_info 穿透重析同构但更轻（只补数据不重判定）。GMGN 拿不到 /
      // 失败 → risk null 放行（gmgnRiskCovered=0，宁漏拦不误杀）
      let gmgnRisk = cached.gmgn_info?.risk ?? null;
      if (enrichSocialByGmgn && !cached.gmgn_info) {
        try {
          const socials = await fetchGmgnSocialLinks('bsc', normalizedAddress);
          gmgnRisk = socials?.risk ?? null;
          if (gmgnRisk) {
            await NarrativeRepository.updateGmgnInfo(normalizedAddress, {
              risk: gmgnRisk,
              fetchedAt: new Date().toISOString()
            });
            logger.info('NarrativeAnalyzer', '缓存行补写 GMGN 风险字段', {
              address: normalizedAddress,
              issuerTokenCount: gmgnRisk.issuerTokenCount,
              bundler: gmgnRisk.bundlerWallets
            });
          }
        } catch (e) {
          console.warn(`[NarrativeAnalyzer] GMGN 风险补调失败（risk=null 放行）: ${e.message}`);
        }
      }
      // 检查是否是预检查触发的结果
      const isCachedPreCheck = !!cached.pre_check_result;
      const llmAnalysis = buildLLMAnalysis(cached);
      return {
        ...formatResult(cached),
        llmAnalysis: llmAnalysis,  // 添加 llmAnalysis 字段
        gmgnRisk,
        classifiedUrls: cached.classified_urls || null,
        twitter: await ExternalResourceCache.reassembleTwitterInfo(cached.classified_urls?.twitter),
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
          analyzedAt: cached.analyzed_at
        }
      };
    }

    // 3. 执行叙事分析（缓存未命中 或 ignoreCache=true 强制重新分析）
    // 结果按 token_address 全局 upsert，供所有调用方复用

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
      xiaohongshuInfo,
      instagramInfo,
      classifiedUrls,
      fetchErrors,  // 获取数据收集的错误信息
      url_extraction_result,  // URL提取结果
      data_fetch_results,  // 数据获取结果
      binanceSquareInfo,
      gmgnRisk  // GMGN dev 风险字段（x-0 案：发币史/捆绑钱包，直调语境才有值）
    } = await fetchAllDataViaClassifier(tokenData, extractedInfo, { enrichSocialByGmgn });

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

    // 超大IP快速检测（在数据获取后检测，因为appendix可能把twitter URL放在website字段）
    const superIPInfo = detectSuperIP(
      extractedInfo.twitterUrl || classifiedUrls?.twitter?.[0]?.url,
      twitterInfo
    );
    if (superIPInfo) {
      logger.info('NarrativeAnalyzer', '检测到超大IP账号', { name: superIPInfo.name, tier: superIPInfo.tier, type: superIPInfo.type });
    }

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

    // 账号收集推文时间窗下界 = token 创建时间-24h（2026-09-25 裁定：只取发币前后阶段
    // 推文，不再翻页凑 100 条；创建时间缺失不设窗口，回退凑数口径）
    // token 创建时间：raw_api_data.created_at（four.meme）→ wss_events token_create
    // 回退（flap，token-info-service 补全）——flap 盘原先缺失回退墙钟，现锚定真实创建时间
    const tokenCreatedAtSec = tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at;
    const tweetWindowUntilSec = tokenCreatedAtSec ? tokenCreatedAtSec - 24 * 3600 : null;
    // tokenAddress 透传（2026-10-02 用户三点方案）：账号收集真拉走 CA 惰性早停——
    // 项目方 CA 公告通常在最新几条/置顶，拉到即停；全量缓存 userId 级跨 token 复用
    const tweetsWindowOptions = tweetWindowUntilSec
      ? { untilSec: tweetWindowUntilSec, tokenAddress: normalizedAddress }
      : { tokenAddress: normalizedAddress };

    if (shouldCollectAccounts) {
      logger.info('NarrativeAnalyzer', '检测到独立网站，开始收集所有账号信息', {
        twitterType: twitterInfo.type,
        twitterScreenName: twitterInfo.screen_name,
        hasInReplyTo: !!twitterInfo.in_reply_to
      });
      relatedAccounts = await collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions);
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
        relatedAccounts = await collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions);
      } else if (classifiedUrls?.twitter?.length > 0) {
        // 推文被删/获取失败，但URL中有screen_name，直接获取账号信息
        for (const tw of classifiedUrls.twitter) {
          const screenName = extractScreenNameFromTwitterUrl(tw.url);
          if (screenName) {
            logger.info('NarrativeAnalyzer', '项目币补充收集账号信息（通过URL提取）', { screenName });
            const accountInfo = await getFullAccountInfo(screenName, tweetsWindowOptions);
            if (accountInfo) {
              relatedAccounts.push({ ...accountInfo, role: 'primary' });
            }
            break; // 只需取第一个有效的
          }
        }
      }
      logger.info('NarrativeAnalyzer', '项目币账号信息收集完成', { count: relatedAccounts.length });
    }

    // 发行方自发币检测（路径二，方案 A，2026-09-24）：推文作者与代币品牌同一且
    // 作者自己宣告了该品牌 → 转账号判定（不要求当前影响力；截词借势盘不满足
    // 品牌同一性，仍走标准路径 W 数学）
    const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, { twitterInfo });
    if (issuerSelfLaunch) {
      logger.info('NarrativeAnalyzer', '检测到发行方自发宣告（品牌同一性+宣告指纹）→ 转账号判定路径', issuerSelfLaunch);
      // 账号判定需要作者账号：独立网站/项目币路径未收集时补收（推文作者 → primary）
      if (relatedAccounts.length === 0) {
        relatedAccounts = await collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions);
        logger.info('NarrativeAnalyzer', '自发币路径补充收集作者账号', { count: relatedAccounts.length });
      }
    }

    // 发行方 CA 宣告检测（2026-09-27 蝴蝶轮回/GMGNPaid 案）：字面法未命中时拉作者
    // 时间线找含合约地址的宣告推文——地址在铸币时刻才存在，出现在谁的时间线里谁就是
    // 发行方。覆盖字面法两臂失灵形态（币名与作者身份无关 / 同名但挂链推文纯短链无
    // 品牌词）；fail-open：拉取失败/宣告竞态未发 → 不改道，维持标准路径 W 数学
    let issuerCaTimeline = null;
    if (!issuerSelfLaunch && twitterInfo?.type === 'tweet') {
      issuerCaTimeline = await detectIssuerByCaTimeline(normalizedAddress, twitterInfo, tweetsWindowOptions);
      if (issuerCaTimeline) {
        logger.info('NarrativeAnalyzer', '检测到发行方 CA 宣告（作者时间线含合约地址）→ 转账号判定路径', {
          screenName: issuerCaTimeline.screenName, tweetId: issuerCaTimeline.tweetId,
        });
        // 检测拉到的完整账号直接作 primary 复用（prestage 账号选择用；推文内部会按同窗口重拉）
        if (relatedAccounts.length === 0 && issuerCaTimeline.account) {
          relatedAccounts.push({ ...issuerCaTimeline.account, role: 'primary' });
        }
      }
    }
    const issuerDetected = issuerSelfLaunch || issuerCaTimeline;

    // 7. 预检查规则（不调用LLM，直接返回结果）
    const preCheckResult = await performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, xiaohongshuInfo, instagramInfo, binanceSquareInfo }, githubInfo, backgroundInfo, { ignoreExpired });
    let isPreCheckTriggered = preCheckResult !== null;

    let llmResult;
    let promptUsed = '';
    let promptType = '';
    let promptVersion = `jev-${JEV_QUESTIONS_VERSION}`; // prestage 分支覆盖为 P 系版本
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
      const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, xiaohongshuInfo, instagramInfo, binanceSquareInfo, classifiedUrls, relatedAccounts };
      promptType = PromptBuilder.getPromptTypeDesc(fetchResults);
      // 预检查时不构建Prompt（不需要）
      promptUsed = null;
    } else {
      // 8. 正常流程：两阶段分析
      try {
        // twitterInfo已包含website_tweet（如果有第二个推文）
        const fetchResults = { twitterInfo, websiteInfo, extractedInfo, backgroundInfo, githubInfo, youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, xiaohongshuInfo, instagramInfo, binanceSquareInfo, classifiedUrls, relatedAccounts };

        // Jev 时效基准 = 代币创建时间（与 pre-check 规则2 同裁定：发币时语料是否新鲜，
        // 与何时分析无关——补跑/回测/延迟分析的结果幂等；创建时间缺失时回退当前时刻）
        // tokenCreatedAtSec 已在账号收集前声明（兼作推文时间窗基准）
        const jevNowMs = tokenCreatedAtSec ? tokenCreatedAtSec * 1000 : undefined;

        // 检查是否有任何有效数据供分析
        const hasAnyData = hasValidDataForAnalysis(fetchResults);
        if (!hasAnyData) {
          // 2026-09-27 裁定：分析完成必须有结论，无语料 → low（fail-closed 不买）
          logger.warn('NarrativeAnalyzer', '没有有效数据可供分析，返回low（fail-closed）');
          llmResult = {
            rating: 'low',
            reason: '没有可用的数据进行分析（所有推文/内容获取失败），无语料不构成叙事',
            score: null,
            pass: false
          };
          promptUsed = null;
          promptType = 'no_data';
          analysisFailed = false;
          // 2026-10-02 C53：本分支此前只设内存 llmResult，无落库载体 → 六 stage 字段
          // 全空 → rating=null 行 is_valid=true 固化（与 data_fetch_failed 早退同病）。
          // 补 preCheckDataToSave（precheck 分支构造形状同构）→ resolveFinalRating 出 low
          preCheckDataToSave = {
            rating: 'low',
            pass: false,
            reason: llmResult.reason,
            category: null,
            score: null,
            details: { category: 'no_data' }
          };
        } else {
          // 检查是否应该使用账号/社区分析流程
          const shouldUseAccountCommunity = shouldUseAccountCommunityAnalysis(fetchResults)
            || (isProjectCoinResult && fetchResults.relatedAccounts?.length > 0)
            || !!issuerDetected;

          if (shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用账号/社区代币分析流程');
            const analysisResult = await analyzeAccountCommunityToken(tokenData, fetchResults, {
              // CA 实锤与项目币网站验证同级：地址已被作者时间线宣告，prestage 规则走
              // 项目币通道（名称只记录不拦截——蝴蝶轮回↔熔炉 名称不匹配不能拦 project 评级）
              skipAddressValidation: isProjectCoinResult || !!issuerCaTimeline
            });

            // 检查是否是规则验证失败（返回preCheckData）
            if (analysisResult.preCheckData) {
              // 规则验证失败，按预检查处理
              llmResult = {
                rating: analysisResult.rating,
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
                rating: pcd.rating || 'low',
                pass: false,
                reason: pcd.reason || analysisResult.reasoning,
                category: null,
                score: analysisResult.total_score || null,
                details: pcd.result || {}
              };
            } else {
              // 项目币 / Web3原生IP早期 / 以账号为背景的meme币：Jev 前置判定结果
              // （meme 两阶段分流已删除——死代码，见 account-analysis-service.mjs 文件头）
              // P1.4（2026-09-27 裁定）：prestage 判定完成即有 low/mid/high 结论，恒 pass
              llmResult = {
                rating: analysisResult.rating,
                reason: analysisResult.reasoning,
                score: analysisResult.total_score,
                pass: true
              };
              promptUsed = analysisResult.prestageData?.prompt || 'prestage_jev';
              promptType = analysisResult.promptType || 'account_community';
              promptVersion = `jev-${JEV_PRESTAGE_QUESTIONS_VERSION}`;
              analysisFailed = false;

              // 保存前置LLM数据（账号/社区分析判断币种类型）
              prestageDataToSave = analysisResult.prestageData;
            }
          }

          // ═══════════════════════════════════════════════════════════════════════════
          // 超大IP快速通道：Jev 单次调用完成所有评估
          // 条件：推文来自注册表中的超大IP账号（CZ/何一/币安官方/Elon/Trump等）
          // 与主路径共用同一问题集；tier/时效用代码预评分，W 类两题不采信
          // ═══════════════════════════════════════════════════════════════════════════
          if (superIPInfo && !shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', `使用超大IP快速通道（Jev）：${superIPInfo.name}（${superIPInfo.type}/${superIPInfo.tier}级）`);

            const preScores = calculatePreScores(superIPInfo, twitterInfo?.created_at, jevNowMs);
            logger.info('NarrativeAnalyzer', '超大IP预评分', preScores);

            const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
            const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenName);
            const { state, stats } = buildJevState(tokenData, fetchResults, { superIPInfo, preScores, now: jevNowMs });
            // J1.21：superIP 通道携带 referent_memeability 条件题（nameReferentBlock
            // 命中时的内容作品豁免评分，标准路径不问）
            const questions = buildStandardQuestions({ includeBrandHijack, referentMemeability: true });
            const startedAt = new Date().toISOString();
            const result = await JevClient.ask(state, questions, { label: `jev-superip:${tokenData.symbol}` });
            const finishedAt = new Date().toISOString();

            const mapped = mapSuperIPAnswers(result.answers, {
              superIPInfo,
              preScores,
              symbol: tokenData.symbol,
              includeBrandHijack,
              callInfo: {
                model: result.model, questions, state, stateStats: stats,
                usage: result.usage, startedAt, finishedAt,
              },
            });

            prestageDataToSave = mapped.prestageDataToSave;
            stage1DataToSave = mapped.stage1DataToSave;
            stage2DataToSave = mapped.stage2DataToSave;
            stage3DataToSave = mapped.stage3DataToSave;
            stageFinalData = mapped.stageFinalData;
            llmResult = mapped.llmResult;
            promptType = mapped.promptType;

            logger.info('NarrativeAnalyzer', '超大IP快速通道评分（Jev）', {
              rating: mapped.llmResult.rating,
              score: mapped.llmResult.score,
              reason: mapped.llmResult.reason,
            });

          // ═══════════════════════════════════════════════════════════════════════════
          // 主路径：Jev 单次 speculative fan-out 判定（原 3 阶段串行 LLM 的替代）
          // 一次调用问完分类/量级/时效/阻断/W类/关联/质量全部原子问题，
          // 聚合/阈值/截断在 jev-result-mapper 代码端完成
          // ═══════════════════════════════════════════════════════════════════════════
          } else if (!shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用 Jev 单次判定（原3阶段架构的替代）');

            // Jev 单次 speculative fan-out：全部原子问题一次问完，代码端聚合
            const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
            const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenName);
            const { state, stats } = buildJevState(tokenData, fetchResults, { now: jevNowMs });
            const questions = buildStandardQuestions({ includeBrandHijack });
            const startedAt = new Date().toISOString();
            const result = await JevClient.ask(state, questions, { label: `jev:${tokenData.symbol}` });
            const finishedAt = new Date().toISOString();

            const mapped = mapStandardAnswers(result.answers, {
              tokenData,
              includeBrandHijack,
              // J1.24 戏谑关联豁免（C40 BI Inu 案）的可信事件源锚：superIP 语料锚 /
              // 发行方自发宣告 / 广场官方认证源 任一——事件真实性有背书时「当前热门
              // 新鲜事」才立得住，纯小道消息语料不解锁豁免
              credibleEventAnchor: !!(superIPInfo || issuerDetected || binanceSquareInfo?.authorVerified),
              // C44（2026-10-01 土豪猫猫案，用户裁定「如果引用了Instagram的链接，
              // 就认为影响力达标」）：IG 是封闭平台传播数据常不可得，证据缺失≠零
              // 影响力——链接存在但数据未抓到时，mapper A 类 dim2 兜底锚 18
              // （J1.23 风格契合带下限）。instagramInfo 非空 = 真数据已进 state
              // （buildInstagramSection），Jev 按真证据判分不兜底
              instagramLinked: !!(classifiedUrls?.instagram?.length > 0),
              instagramInfoFetched: instagramInfo != null,
              tweetClassification: classifyTweetType(twitterInfo),
              twitterInfo, // J1.17 cashtag 改道判据（detectCorpusCashtag）用
              callInfo: {
                model: result.model, questions, state, stateStats: stats,
                usage: result.usage, startedAt, finishedAt,
              },
            });

            stage1DataToSave = mapped.stage1DataToSave;
            stage2DataToSave = mapped.stage2DataToSave;
            stage3DataToSave = mapped.stage3DataToSave;
            stageFinalData = mapped.stageFinalData;
            llmResult = mapped.llmResult;
            promptType = mapped.promptType;

            // ========== W类 + 免费托管网站检查（原样保留，代码端规则） ==========
            // Web3项目声称自己是平台/产品，但主站用免费托管（github.io等），说明项目不可信
            if (stage1DataToSave?.parsed_output?.eventClassification?.primaryCategory === 'W' && llmResult.pass) {
              const websiteUrl = classifiedUrls?.websites?.[0]?.url;
              if (websiteUrl && _isFreeHostingUrl(websiteUrl)) {
                const reason = `Web3项目主站使用免费托管平台（${websiteUrl}），连域名都不买，项目不可信`;
                logger.info('NarrativeAnalyzer', `W类免费托管检查触发: ${reason}`);

                stage2DataToSave.parsed_output = {
                  ...stage2DataToSave.parsed_output,
                  pass: false,
                  blockReason: reason,
                };
                stage2DataToSave.category = 'low';
                stage3DataToSave = { __clear: true };
                stageFinalData = {
                  ...stageFinalData,
                  category: 'low',
                  totalScore: null,
                  blockReason: reason,
                };
                llmResult = {
                  rating: 'low',
                  reason,
                  score: stage2DataToSave.parsed_output.scoringResult?.totalScore || null,
                  pass: false,
                  analysis_stage: 2,
                };
                promptType = `jev(W类-免费托管阻断)`;
                logger.info('NarrativeAnalyzer', 'W类免费托管阻断');
              }
            }

            logger.info('NarrativeAnalyzer', 'Jev 判定完成', {
              rating: llmResult.rating,
              score: llmResult.score,
              category: stage1DataToSave?.parsed_output?.eventClassification?.primaryCategory,
              stateChars: stats.totalChars,
              reason: llmResult.reason,
            });
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
      console.log(`分析失败，使用已有缓存作为fallback | address=${normalizedAddress}`);
      return {
        ...formatResult(cached),
        // GMGN 风险字段：本次已拿到优先（fetchAllDataViaClassifier 成功过），否则读行内
        gmgnRisk: gmgnRisk ?? cached.gmgn_info?.risk ?? null,
        classifiedUrls: cached.classified_urls || null,
        twitter: await ExternalResourceCache.reassembleTwitterInfo(cached.classified_urls?.twitter),
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
          analyzedAt: cached.analyzed_at
        }
      };
    }

    // 9. 保存结果 - 只有在分析成功时才保存（结果为代币级全局缓存，不挂实验名下）
    // 注意：只保存 twitter_info，微博等背景信息不保存（已缓存到 external_resource_cache）

    // 清理数据中的空字符和控制字符（PostgreSQL不支持）
    const cleanedTwitterInfo = cleanDataForDB(twitterInfo);

    // 构建各阶段的新格式保存数据
    const prestageSaveData = buildStageSaveData('prestage', prestageDataToSave);
    const stage1SaveData = buildStageSaveData('stage1', stage1DataToSave);
    const stage2SaveData = buildStageSaveData('stage2', stage2DataToSave);
    const stage3SaveData = buildStageSaveData('stage3', stage3DataToSave);

    // 代币分类（fPay/FOMOPAY 宣告竞态案裁定 2026-09-27）：null 不带键——
    // repository 侧保留旧值（重析 precheck fail 不清掉已落库的分类）
    const tokenCategory = deriveTokenCategory(prestageDataToSave, stage1DataToSave);

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
      is_valid: true,
      prompt_version: promptVersion,
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
      data_fetch_results: dataFetchResults || null,

      // === GMGN 风险字段（x-0 案）===：直调语境拿到才写（repository 侧 ?? existing
      // 保旧行——重析时 GMGN 失败不清掉已积累的风险数据）
      gmgn_info: gmgnRisk ? { risk: gmgnRisk, fetchedAt: new Date().toISOString() } : undefined,

      // === 代币分类（2026-09-27 裁定）===：prestage tokenType / super_ip_fast / event:X
      ...(tokenCategory ? { token_category: tokenCategory } : {})
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
      gmgnRisk,  // GMGN dev 风险字段（直调语境透传给 NarrativeDirectCaller）
      twitter: twitterInfo,  // 添加 twitter 字段供前端使用
      backgroundInfo: backgroundInfo, // 返回背景信息供调试使用
      classifiedUrls: classifiedUrls, // 返回分类后的URL供前端展示
      fetchErrors: fetchErrors, // 添加数据获取错误信息（来自_fetchDataSequentially）
      meta: {
        fromCache: false,
        preCheckTriggered: isPreCheckTriggered,
        preCheckReason: isPreCheckTriggered ? preCheckDataToSave?.details?.ruleName : null,
        analyzedAt: saveResult.analyzed_at,
        promptVersion: promptVersion,
        promptType: promptType
      },
      debugInfo: {
        promptUsed: promptUsed,
        promptVersion: promptVersion,
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
