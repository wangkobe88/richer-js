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
import { createSegmentTimer } from '../utils/segment-timer.mjs';
import { cleanDataForDB } from './utils/data-cleaner.mjs';
import { formatResult, buildLLMAnalysis } from './parsers/response-parser.mjs';
import { performPreCheck } from './services/pre-check-service.mjs';
import { analyzeTweetImage } from './services/image-analysis-service.mjs';
import { runVisionGate, shouldAskVisionGate } from './services/vision-gate-service.mjs';
import { fetchAllDataViaClassifier } from './services/data-fetch-service.mjs';
import { fetchGmgnSocialLinks } from '../utils/gmgn-social-fetcher.mjs';
import { fetchTokenData, extractInfo } from './services/token-info-service.mjs';
import { collectAllAccountsWithFullInfo, getFullAccountInfo, analyzeAccountCommunityToken, detectIssuerByCaTimeline } from './services/account-analysis-service.mjs';
import { detectSuperIP } from './prompts/super-ip/super-ip-registry.mjs';
import { deriveSuperIpLabels } from '../../core/narrative/superip-labels.js';
import { collectSearchEvidence, meetsBypassThreshold, getSearchFallbackConfig } from './services/twitter-search-fallback.mjs';

// Jev 判定（主路径 + prestage 前置判定；superIP 注册表命中注入 state，C83 起快车道删除）
import { JevClient } from './llm/JevClient.mjs';
import { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } from './llm/jev-questions.mjs';
import { JEV_PRESTAGE_QUESTIONS_VERSION } from './llm/jev-prestage-questions.mjs';
import { buildJevState } from './llm/jev-state-builder.mjs';
import { mapStandardAnswers } from './llm/jev-result-mapper.mjs';
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
 *   （C83 起快车道删除不再产生；分支保留防御旧行重放）
 * - 标准路径：stage1 事件类别 → 'event:<A~W>'
 * - precheck fail / no_data：未走到分类环节 → null
 *
 * @param {Object} prestageDataToSave - prestage 阶段数据（含 __clear 标记形态）
 * @param {Object} stage1DataToSave - 标准路径 stage1 数据
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
// 旧「过期推文分钟窗」config 键已随 C74（2026-10-16）规则 2.1 分桶废止删除：
// 时效硬拦迁入 pre-check-service NON_EXEMPT_TWEET_FRESH_SEC（非豁免桶 300s /
// direct_tweet 豁免跳过），本文件不再消费该键
const NARRATIVE_CONFIG = config.narrative || {
  enableImageAnalysis: false,
  enableVideoAnalysis: false,
  twitterBlacklist: []
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
   * @param {Map|null} options.rowCache - 预载行缓存（回测叙事预载 2026-10-12）：
   *   小写地址 → token_narrative 行快照（仅含「命中路径无网络调用」的行——
   *   is_valid && 非 no_public_info 穿透域 && gmgn_info 已写，见 preloadCache）。
   *   命中 → 跳过 findByAddress DB 往返；无键/未预载 → 现场 DB 查原路径。
   *   真析 upsert 的新行只会发生在非预载行上（预载行命中路径不重析），无快照
   *   覆盖竞态
   * @param {boolean} options.invalidateAccountCorpus - 失效账号语料缓存重取（C70
   *   bunker 案，2026-10-15「重取数重析」）：仅账号型语料票（twitter 桶非空且全部
   *   type==='account'，形状门在本函数内）生效——把 invalidateCache 并入账号链
   *   tweetsWindowOptions 与 prestage 规则验证的 tweetsOptions，getAccountWithFullTweets
   *   层 0 失效三键后重拉。推文型/website 型语料静态无重取价值，传了也零失效
   */
  static async analyze(address, options = {}) {
    const { ignoreCache = false, ignoreExpired = false, enrichSocialByGmgn = false, rowCache = null, skipIntermediateSave = false, invalidateAccountCorpus = false } = options;

    // 分段计时（N1 探针，2026-10-13 叙事提速案）：options._timing 为调用方持有的
    // 收集数组 → 各段 push { seg, ms }；缺省旁路模式（不计时，零行为变化）
    const timing = createSegmentTimer(options._timing);

    // 标准化地址
    const normalizedAddress = address.toLowerCase();

    // 1. 检查缓存（查询最新的记录，任何实验的都可以）——预载行优先（回测装载时
    //    批量拉的快照）；miss/未预载 → 现场 DB 查原路径
    const cached = (rowCache && rowCache.get(normalizedAddress))
      || await timing.wrap('cacheLookup', () => NarrativeRepository.findByAddress(normalizedAddress));

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
        twitter: await timing.wrap('reassemble', () => ExternalResourceCache.reassembleTwitterInfo(cached.classified_urls?.twitter)),
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
    const tokenData = await timing.wrap('tokenData', () => fetchTokenData(normalizedAddress));
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
    } = await fetchAllDataViaClassifier(tokenData, extractedInfo, { enrichSocialByGmgn, timing });

    //（泳道 0 vision 预启动已随 dataPrefetch/visionPrefetch 退役删除，C84 2026-10-17：
    // 分析提前到叙事发起条件触发时刻，图分析预启动失去意义——analyzeTweetImage
    // 自带三层幂等，调用时序回到 pre-check 后原路径）

    // 保存URL提取和数据获取结果
    urlExtractionResult = url_extraction_result;
    dataFetchResults = data_fetch_results;

    // 立即保存URL提取结果到数据库，供前端轮询使用
    // 直调语境跳过（N2 叙事提速案 2026-10-13）：无前端轮询，字段由最终 save /
    // fallback 早退的补 save 落库，库内终态一致，省一次 DB 往返
    if (!skipIntermediateSave) {
      await timing.wrap('dbSave.intermediate', () => NarrativeRepository.save({
        token_address: tokenData.address,
        url_extraction_result: url_extraction_result,
        classified_urls: classifiedUrls
      }));
    }

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

    // ── 语料形状门（C70，用户裁定 2026-10-15：「重取数重析」机制仅限依托推特
    // 账号类的代币，其它不需要）──：invalidateAccountCorpus 只在 twitter 桶非空
    // 且全部 type==='account'（账号型语料=动态时间线，重取有意义）时并入。
    // 判据与引擎侧 isAccountOnlySource 同构（narrative 侧自建，勿跨 ESM/CJS
    // import）；推文型/website 型语料静态无重取价值，传了 option 也零失效零重取
    const shouldInvalidateAccountCorpus = invalidateAccountCorpus
      && (classifiedUrls?.twitter?.length || 0) > 0
      && classifiedUrls.twitter.every(tw => tw.type === 'account');
    if (shouldInvalidateAccountCorpus) tweetsWindowOptions.invalidateCache = true;

    // ── 泳道 4：空语料推特搜索兜底（C76，2026-10-16 特斯拉飞行汽车案 C73 提案①）──
    // 空语料（classifiedUrls 各桶全空 + twitterInfo null）→ 按 token 全名搜推特拿
    // 「事件量级证据」（no_public_info 秒拒票分析器根本不知道事件存在）。与三泳道
    // 并发零墙钟损失；collectSearchEvidence 永不 throw（失败 null 维持原拒
    // bit-identical），无需悬空 catch。config 驱动（narrative-engine.json
    // searchFallback 段，段缺失=静默关；enabled 残缺 throw fail-loud 只在 enabled 时发生）
    const searchCfg = getSearchFallbackConfig();
    const isEmptyCorpus = twitterInfo === null
      && classifiedUrls && Object.values(classifiedUrls).every(bucket => !bucket || bucket.length === 0);
    const shouldLaunchSearch = isEmptyCorpus && !!searchCfg;
    const searchPromise = shouldLaunchSearch
      ? timing.wrap('search.twitter', () => collectSearchEvidence(tokenData, { config: searchCfg }))
      : null;

    // ── 三泳道并发（2026-10-13 叙事提速第二批）──
    // 值层面互不消费已核验：performPreCheck 入参不含 relatedAccounts；issuerCa 的
    // push 判定只读 relatedAccounts.length → 移 join 后。唯一强耦合在缓存层：账号
    // 链与 issuerCa 都对同一推文作者调 getAccountWithFullTweets（无 inflight 去重、
    // 双 key：全量 userId 级 vs `:ca:` 专属）——盲并行 = 同作者双真拉（N1 实测
    // 28/38 issuerCa 缓存命中正来自今天串行 handoff）。解法 = issuerCa 按
    // chainPullsAuthor 同步预判分派：链会拉作者 → 排链后吃全量 key 缓存 handoff
    // （= 今天顺序）；链不拉 → 立即发起与 precheck 并行。

    // 同步预判（isProjectCoin / detectIssuerSelfLaunch 均纯同步函数，判定语义与
    // 原串行判定点一致，只把「值」提前算出供泳道分派）
    // 项目币检测（代币地址出现在推文/网站/账号内容中 → 项目方自己发的币）
    const isProjectCoinResult = isProjectCoin(normalizedAddress, { twitterInfo, websiteInfo, classifiedUrls });
    if (isProjectCoinResult) {
      logger.info('NarrativeAnalyzer', '检测到项目币（地址出现在内容中）');
    }
    // 发行方自发币检测（路径二，方案 A，2026-09-24）：推文作者与代币品牌同一且
    // 作者自己宣告了该品牌 → 转账号判定（不要求当前影响力；截词借势盘不满足
    // 品牌同一性，仍走标准路径 W 数学）
    const issuerSelfLaunch = detectIssuerSelfLaunch(tokenData, { twitterInfo });
    if (issuerSelfLaunch) {
      logger.info('NarrativeAnalyzer', '检测到发行方自发宣告（品牌同一性+宣告指纹）→ 转账号判定路径', issuerSelfLaunch);
    }

    // 泳道 1：账号链（内部三调用点顺序与判定 = 原串行顺序，抓取内容 bit 一致；
    // 相关 fetch 段计时 accountCollect 键名不变）
    const accountChainPromise = (async () => {
      const accounts = [];
      if (shouldCollectAccounts) {
        logger.info('NarrativeAnalyzer', '检测到独立网站，开始收集所有账号信息', {
          twitterType: twitterInfo.type,
          twitterScreenName: twitterInfo.screen_name,
          hasInReplyTo: !!twitterInfo.in_reply_to
        });
        accounts.push(...await timing.wrap('accountCollect', () => collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions)));
        logger.info('NarrativeAnalyzer', '账号信息收集完成', { count: accounts.length });
      }

      // 如果是项目币但还没收集过账号，尝试收集
      if (isProjectCoinResult && accounts.length === 0) {
        if (twitterInfo) {
          // 有twitterInfo，从推文作者收集
          logger.info('NarrativeAnalyzer', '项目币补充收集账号信息（通过twitterInfo）');
          accounts.push(...await timing.wrap('accountCollect', () => collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions)));
        } else if (classifiedUrls?.twitter?.length > 0) {
          // 推文被删/获取失败，但URL中有screen_name，直接获取账号信息
          for (const tw of classifiedUrls.twitter) {
            const screenName = extractScreenNameFromTwitterUrl(tw.url);
            if (screenName) {
              logger.info('NarrativeAnalyzer', '项目币补充收集账号信息（通过URL提取）', { screenName });
              const accountInfo = await timing.wrap('accountCollect', () => getFullAccountInfo(screenName, tweetsWindowOptions));
              if (accountInfo) {
                accounts.push({ ...accountInfo, role: 'primary' });
              }
              break; // 只需取第一个有效的
            }
          }
        }
        logger.info('NarrativeAnalyzer', '项目币账号信息收集完成', { count: accounts.length });
      }

      // 发行方自发币路径（issuerSelfLaunch）：账号判定需要作者账号——独立网站/
      // 项目币路径未收集时补收（推文作者 → primary）
      if (issuerSelfLaunch && accounts.length === 0) {
        accounts.push(...await timing.wrap('accountCollect', () => collectAllAccountsWithFullInfo(twitterInfo, tweetsWindowOptions)));
        logger.info('NarrativeAnalyzer', '自发币路径补充收集作者账号', { count: accounts.length });
      }
      return accounts;
    })();

    // chainPullsAuthor 宽判：账号链是否可能真拉推文作者（覆盖链内全部四个调用点：
    // 主路径 collect / 项目币-twitterInfo collect / 项目币-URL getFullAccountInfo /
    // issuerSelfLaunch collect）。宽判 = 宁排链后损失并行度，不立发双真拉
    const chainPullsAuthor = shouldCollectAccounts
      || (isProjectCoinResult && (twitterInfo || (classifiedUrls?.twitter?.length || 0) > 0))
      || !!issuerSelfLaunch;

    // 泳道 2：precheck 立即发起（入参全在数据抓取后就绪，不消费链产物）
    const precheckPromise = timing.wrap('precheck', () => performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls, { youtubeInfo, douyinInfo, tiktokInfo, bilibiliInfo, weixinInfo, amazonInfo, xiaohongshuInfo, instagramInfo, binanceSquareInfo }, githubInfo, backgroundInfo, { ignoreExpired }));

    // 泳道 3：issuerCa 条件分派（发行方 CA 宣告检测，2026-09-27 蝴蝶轮回/GMGNPaid
    // 案：字面法未命中时拉作者时间线找含合约地址的宣告推文——地址在铸币时刻才
    // 存在，出现在谁的时间线里谁就是发行方。覆盖字面法两臂失灵形态（币名与作者
    // 身份无关 / 同名但挂链推文纯短链无品牌词）；fail-open：拉取失败/宣告竞态未发
    // → 不改道，维持标准路径 W 数学）
    const runIssuerCa = () => timing.wrap('issuerCa', () => detectIssuerByCaTimeline(normalizedAddress, twitterInfo, tweetsWindowOptions));
    const issuerCaPromise = (!issuerSelfLaunch && twitterInfo?.type === 'tweet')
      ? (chainPullsAuthor ? accountChainPromise.then(() => runIssuerCa()) : runIssuerCa())
      : null;

    // join（null 成员 Promise.all 直接透过；链 reject 时 issuerCa 的 .then 链传播
    // 同因，precheck/issuerCa 的 rejection 均被 Promise.all 内部 handler 观察，
    // 无 unhandled rejection 面；searchPromise 同 issuerCa 形状条件发起 null 透传，
    // 且 collectSearchEvidence 永不 reject）
    let [chainAccounts, preCheckResult, issuerCaTimeline, searchEvidence] = await Promise.all([
      accountChainPromise, precheckPromise, issuerCaPromise, searchPromise,
    ]);
    relatedAccounts = chainAccounts;

    if (issuerCaTimeline) {
      logger.info('NarrativeAnalyzer', '检测到发行方 CA 宣告（作者时间线含合约地址）→ 转账号判定路径', {
        screenName: issuerCaTimeline.screenName, tweetId: issuerCaTimeline.tweetId,
      });
      // 检测拉到的完整账号直接作 primary 复用（prestage 账号选择用；推文内部会按同窗口重拉）
      if (relatedAccounts.length === 0 && issuerCaTimeline.account) {
        relatedAccounts.push({ ...issuerCaTimeline.account, role: 'primary' });
      }
    }
    // ── 搜索证据旁路判定（C76）── 三场景：
    //   达阈值 → preCheckResult=null 走 Jev（事件量级判定）。★必须置 null 而非保留
    //     low 形状：resolveFinalRating 阶段优先级会让 low 形状 pre_check_result 遮蔽
    //     Jev 结论（旁路白做）+ 直调 enrichSocialByGmgn 对该行每次穿透重析（烧配额）
    //     + preloadCache 永久排除（回测退化），三重反证。Jev 结论终态不再进
    //     PrecheckFailRetryService 重试域（classifyFailShape 读 null → 不重试）
    //   未达阈值/零结果 → ruleName 不动保 1800s 重试域（重析再搜，晚到的推文能翻案），
    //     additive 记 details.searchEvidence 摘要供观测「为什么搜索没救它」
    //   搜索失败（evidence=null）→ 零触碰，与关闭功能 bit-identical
    const searchEvidenceReady = !!(searchEvidence && meetsBypassThreshold(searchEvidence, searchCfg));
    const bypassedBySearch = preCheckResult?.details?.ruleName === 'no_public_info' && searchEvidenceReady;
    if (bypassedBySearch) {
      logger.info('NarrativeAnalyzer', '搜索证据达阈值，旁路 no_public_info 走 Jev（事件量级判定）', {
        query: searchEvidence.query.rawQuery, uniqueTweets: searchEvidence.uniqueTweets,
        maxEngagement: searchEvidence.maxEngagement,
      });
      preCheckResult = null;
      // 证据挂 tokenData：state 构建（buildJevState 读 raw_api_data.search_evidence）与
      // 最终 save（:885 raw_api_data 整体替换语义）共用这一次浅拷贝
      tokenData.raw_api_data = { ...tokenData.raw_api_data, search_evidence: searchEvidence };
    } else if (preCheckResult?.details?.ruleName === 'no_public_info' && searchEvidence) {
      preCheckResult = {
        ...preCheckResult,
        details: {
          ...preCheckResult.details,
          searchEvidence: {
            query: searchEvidence.query.rawQuery,
            tweets: searchEvidence.uniqueTweets,
            maxEngagement: searchEvidence.maxEngagement,
            bypass: false,
          },
        },
      };
    }
    const issuerDetected = issuerSelfLaunch || issuerCaTimeline;
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

        // ── vision 前置 Jev 预判门（C72，2026-10-15 用户裁定）──
        // 主推文有首图且未挂 image_analysis 时，先 1 题 Choice 预判「文字语料是否已
        // 足够确认叙事」，sufficient 且概率 ≥ minSufficientProb 则整段跳过 vision——
        // 本票无图语义（state 无图块 / J1.30 不问 / C59/J1.30 豁免不触发 = 偏拦
        // fail-safe，与无配图票/vision 失败票同语义）。已挂载（缓存命中/预取完成
        // 零耗时）/ 门关 / need_image / Jev 失败 → 原行为。预取链完全不动（门只挡
        // 这次 await，预取照常写缓存）。跳过时 timing 只余 vision.gate 段（无 vision
        // 段，跳过占比高时不污染 vision 延迟统计）。
        let visionSkipped = false;
        if (shouldAskVisionGate(twitterInfo)) {
          const gate = await timing.wrap('vision.gate', () => runVisionGate(tokenData, fetchResults, { now: jevNowMs }));
          visionSkipped = gate.skipped === true;
        }

        // 推文配图视觉分析（2026-10-07 现金猫案 0x56dc26bd…7777 裁定开启，智谱 glm-5.3）：
        // 主推文首图 → twitterInfo.image_analysis（twitter-section 既有渲染块进 Jev state；
        // 同图 90 天缓存 + 进程内并发去重，分析 token 无关可跨 token 复用）。挂在 pre-check
        // 之后——预检拦截票不烧视觉调用；下载/API 失败在服务内降级为无图证据
        //（= 开启前行为），配置残缺 throw fail-loud。C72 门跳过时整个 await 不执行；
        // 预启动 join 点已随 visionPrefetch 退役删除（C84 2026-10-17）
        if (!visionSkipped) {
          await timing.wrap('vision', () => analyzeTweetImage(twitterInfo));
        }

        // 竞态屏蔽拷贝（C72）：跳过时后台预取仍可能在
        // 跑完并原地挂 twitterInfo.image_analysis——下游 state 构建/条件题/豁免统一走
        // 本拷贝（image_analysis 剥除），保证门跳过 = 本票确定性无图语义；浅拷贝不动
        // 原对象（后台挂载/预取写缓存/DB 快照不受影响，下次重析 reassemble 复原后
        // 幂等门直接放行用图 = 重析时图免费）
        const jevFetchResults = visionSkipped && twitterInfo
          ? { ...fetchResults, twitterInfo: { ...twitterInfo, image_analysis: undefined } }
          : fetchResults;

        // 检查是否有任何有效数据供分析（C76：搜索旁路票同条件放行——否则旁路后死在
        // 这道 no_data 兜底；hasValidDataForAnalysis 本体不动，被 pre-check 规则 4-B 共用）
        const hasAnyData = hasValidDataForAnalysis(fetchResults) || bypassedBySearch;
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
            const analysisResult = await timing.wrap('jev.prestage', () => analyzeAccountCommunityToken(tokenData, fetchResults, {
              // CA 实锤与项目币网站验证同级：地址已被作者时间线宣告，prestage 规则走
              // 项目币通道（名称只记录不拦截——蝴蝶轮回↔熔炉 名称不匹配不能拦 project 评级）
              skipAddressValidation: isProjectCoinResult || !!issuerCaTimeline,
              // C70「重取数重析」：prestage 规则验证的账号拉取同样失效重取
              //（形状门已在上方算出，此处只透传布尔）
              ...(shouldInvalidateAccountCorpus ? { invalidateAccountCorpus: true } : {})
            }));

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
          // 主路径：Jev 单次 speculative fan-out 判定（原 3 阶段串行 LLM 的替代）
          // 一次调用问完分类/量级/时效/阻断/W类/关联/质量全部原子问题，
          // 聚合/阈值/截断在 jev-result-mapper 代码端完成。
          // superIP 注册表命中的语料（C83）：不再走已删除的快车道，统一本路径
          // 全量 18 题；注册表命中事实行注入 state（jev-state-builder PRECOMPUTED）
          // ═══════════════════════════════════════════════════════════════════════════
          if (!shouldUseAccountCommunity) {
            logger.info('NarrativeAnalyzer', '使用 Jev 单次判定（原3阶段架构的替代）');

            // Jev 单次 speculative fan-out：全部原子问题一次问完，代码端聚合
            const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';
            const includeBrandHijack = shouldIncludeBrandHijackCheck(tokenData.symbol, tokenName);
            // superIP 注册表命中（C83）：命中事实行进 state PRECOMPUTED（认证标注 +
            // 反混淆提示），量级/关联/主体资格全归 Jev 按题集判定——非 superIP 票
            // superIPInfo=null，builder guard 跳过注入，state 与旧版逐字节一致
            const { state, stats } = buildJevState(tokenData, jevFetchResults, { superIPInfo, now: jevNowMs });
            // J1.30 条件题 name_image_consistency：主推配图分析成功挂载才问
            // （无图不问防幻觉作答；与 mapper imageEvidence 同源）
            const questions = buildStandardQuestions({
              includeBrandHijack,
              imageConsistency: !visionSkipped && !!twitterInfo?.image_analysis,
            });
            const startedAt = new Date().toISOString();
            const result = await timing.wrap('jev.standard', () => JevClient.ask(state, questions, { label: `jev:${tokenData.symbol}` }));
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
              // J1.30 名图一致豁免条件①（C64 巴巴鸡案）：配图视觉证据存在
              // （analyzeTweetImage 已在上方正常流程分支挂载 image_analysis）；
              // C72 门跳过时恒 false
              imageEvidence: !visionSkipped && !!twitterInfo?.image_analysis,
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
      // skip 中段 save 的等价搬运（N2 叙事提速案）：此路径不经过最终 save，
      // 现状靠中段 save 落 url_extraction_result/classified_urls——直调语境在
      // 此补一次同形状 save，字段落库语义 bit 一致（仅时点从分析前移到失败后）
      if (skipIntermediateSave) {
        await timing.wrap('dbSave.intermediate', () => NarrativeRepository.save({
          token_address: tokenData.address,
          url_extraction_result: url_extraction_result,
          classified_urls: classifiedUrls
        }));
      }
      return {
        ...formatResult(cached),
        // GMGN 风险字段：本次已拿到优先（fetchAllDataViaClassifier 成功过），否则读行内
        gmgnRisk: gmgnRisk ?? cached.gmgn_info?.risk ?? null,
        classifiedUrls: cached.classified_urls || null,
        twitter: await timing.wrap('reassemble', () => ExternalResourceCache.reassembleTwitterInfo(cached.classified_urls?.twitter)),
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
    // C88 超级IP两标签：内存 stage1DataToSave/stage2DataToSave 推导（形状与落库值
    // 同构，superip-labels 单实现共享）；save 回读瘦列无 stage 列，return 显式覆盖
    const superIpLabels = deriveSuperIpLabels(stage1DataToSave, stage2DataToSave);

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

    const saveResult = await timing.wrap('dbSave.final', () => NarrativeRepository.save({
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
    }, {
      // 3b（2026-10-13 叙事提速第二批）：入口 cacheLookup/rowCache 已持有的行快照
      // 直传——非 null 行跳过 save 内 pre-select 肥行往返；null 传 falsy 仍走现查
      existing: cached
    }));

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
      // 新鲜路显式覆盖：save 回读瘦列（SAVE_RETURN_COLS 闭集）不含 token_category，
      // 用 :855 在手变量透出本票分类（与缓存/fallback 路三路同形）
      tokenCategory: tokenCategory ?? null,
      // C88 超级IP两标签新鲜路显式覆盖（与 tokenCategory 同款：formatResult(saveResult)
      // 瘦列回读推不出，用内存值透出，扁平键与缓存路 formatResult spread 同形；
      // prestage 路径 stage1DataToSave=null → 两键 null）
      ...superIpLabels,
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
        promptType: promptType,
        // C76 搜索旁路标记（关/未触发时缺键，meta 形状 bit-parity）
        ...(bypassedBySearch ? { searchBypassed: true } : {})
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
   * 回测叙事预载（2026-10-12 回测性能案）：按 token 集合批量预拉叙事缓存行，
   * 消除回放中每次直调的 2 次 DB 往返（token_narrative 行 + reassembleTwitterInfo
   * 的 external_resource_cache 推文行；e50 实测 4007 次命中 × 34ms = 137s 串行）。
   *
   * 返回的 rowCache 直接透传给 analyze({rowCache})——组装代码零改动，只把数据源
   * 从现场 DB 查换成内存行快照，行为 bit-identical。
   *
   * 可预载行判定与 analyze 缓存命中分支的「无网络调用」条件逐条对齐（缺一即排除，
   * 排除行回放时现场查 DB 走原路径）：
   * - is_valid=false → 命中分支不进 → 重析（排除）
   * - no_public_info 拦截行（enrichSocialByGmgn 直调语境）→ 穿透重析（排除）
   * - gmgn_info 缺行 → 命中分支补调 GMGN 网络（排除；补写后下次 fire 现场查即命中）
   *
   * @param {string[]} tokenAddresses - 回测窗口 token 集合（大小写任意）
   * @returns {Promise<{rowCache: Map, tweetRows: number}>}
   *   rowCache: 小写地址 → token_narrative 最新过票行（两段式：轻列扫描内存判
   *   胜负后按 id 批拉全列，2026-10-12 起；胜负口径与 findByAddress 的 desc
   *   nullsLast 取最新一致）
   */
  static async preloadCache(tokenAddresses) {
    // 回测预载语境开启 external_resource_cache miss 负缓存（回测 = 装载时点快照
    // 口径，与 token_narrative 预载同族）：预载集合外的 miss URL 不再每次直调
    // 重打一次 DB miss（perf5 实测 2994 次 × ~25ms ≈ 75s 纯浪费）。实时链路
    // 不走 preloadCache，开关恒关行为零变化
    ExternalResourceCache.setNegativeCacheEnabled(true);

    const tokenSet = new Set((tokenAddresses || []).map(a => String(a).toLowerCase()));
    if (!tokenSet.size) return { rowCache: new Map(), tweetRows: 0 };

    // 两段式（2026-10-12 statement timeout 修复，查询形状见 NarrativeRepository）：
    // ① 轻列键集全表扫（is_valid/gmgn 非空 DB 层已过）→ 客户端复刻余下过滤
    // （tokenSet 交集 + no_public_info）决出每地址最新过票行；② 仅有票行按 id
    // 批拉全列。与原「analyzed_at 升序全量遍历 Map.set 覆盖」等价性的两个关键点：
    //  - 胜负 = analyzed_at 最新（null 视最早）的「过票」行（前身未过票行不覆盖
    //    已置条目，即留的是最新过票行而非最新行）；平局 id 大者胜（后写）
    //  - 语料推文键从全部过票行收集（含已被更新行覆盖的旧行——前身逐行收集不撤销）
    const lightRows = await NarrativeRepository.fetchPreloadLightRows();
    const winnerByAddr = new Map(); // 小写地址 → {id, ts}
    const tweetKeys = [];
    for (const row of lightRows) {
      const addr = String(row.token_address || '').toLowerCase();
      if (!tokenSet.has(addr)) continue;
      if (row.pre_check_result?.details?.ruleName === 'no_public_info') continue;
      const ts = row.analyzed_at ? new Date(row.analyzed_at).getTime() : -Infinity;
      const prev = winnerByAddr.get(addr);
      if (!prev || ts > prev.ts || (ts === prev.ts && row.id > prev.id)) {
        winnerByAddr.set(addr, { id: row.id, ts });
      }
      // 语料推文行键（reassembleTwitterInfo 同款 resourceType 映射：community →
      // twitter_community，其余一律 tweet；主推/次推都在 twitter 桶内）
      for (const t of (row.classified_urls?.twitter || [])) {
        if (!t?.url) continue;
        tweetKeys.push([t.type === 'community' ? 'twitter_community' : 'tweet', t.url]);
      }
    }
    const fullRows = await NarrativeRepository.fetchRowsByIds(
      [...winnerByAddr.values()].map(w => w.id));
    const rowCache = new Map();
    for (const row of fullRows) {
      rowCache.set(String(row.token_address).toLowerCase(), row);
    }
    const tweetRows = await ExternalResourceCache.preloadByKeys(tweetKeys);
    return { rowCache, tweetRows };
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
