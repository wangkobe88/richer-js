/**
 * Account Analysis Service - 账号/社区分析服务
 * 处理账号和社区相关的分析逻辑
 *
 * P3（2026-09-21）：前置判定 LLM 段迁移 Jev（原 account-community-analysis.mjs V2.0
 * + account-community-unverified.mjs V1.0 两条生成式 prompt 合并为一次 Jev 调用，
 * 评级数学下沉 jev-prestage-mapper.mjs）。meme 分流已删除——实证死代码：
 * V2.0/V1.0 prompt 从不允许输出 tokenType='meme'，12873 行历史数据 0 行触发。
 */

import logger from '../../core/logger.mjs';
import { hasIndependentWebsite, shouldUseAccountCommunityAnalysis, isAutoTokenPageUrl } from '../utils/narrative-utils.mjs';
import { JevClient } from '../llm/JevClient.mjs';
import { buildPrestageQuestions } from '../llm/jev-prestage-questions.mjs';
import { buildPrestageState } from '../llm/jev-state-builder.mjs';
import { mapPrestageAnswers } from '../llm/jev-prestage-mapper.mjs';
import { getConfig } from '../../engine/config.mjs';
import { fetchWebsiteContent } from '../../utils/web-fetcher.mjs';
import { getKnowledgeConfig } from '../knowledge/knowledge-config.mjs';
import { getKnowledgeBase } from '../knowledge/knowledge-loader.mjs';
import { matchKnowledge } from '../knowledge/knowledge-matcher.mjs';

/**
 * 收集所有相关账号的完整信息
 * 当检测到独立网站时，收集所有相关账号（主账号、原始作者等）的完整信息
 * @param {Object} twitterInfo - Twitter信息
 * @param {Object} [options]
 * @param {number} [options.untilSec] - 推文时间窗下界（unix 秒，token 创建时间-24h；
 *   有窗口时账号收集只取发币前后阶段推文，不再翻页凑 100 条）
 * @returns {Promise<Array>} 账号信息列表
 */
export async function collectAllAccountsWithFullInfo(twitterInfo, options = {}) {
  const accounts = [];
  const screenNames = new Set(); // 用于去重

  // 1. 主账号（根据类型获取）
  let primaryScreenName = null;
  if (twitterInfo.type === 'account' && twitterInfo.screen_name) {
    primaryScreenName = twitterInfo.screen_name;
  } else if (twitterInfo.type === 'tweet' || twitterInfo.type === 'community') {
    // 对于推文类型，从 author_screen_name 获取主账号
    if (twitterInfo.author_screen_name) {
      primaryScreenName = twitterInfo.author_screen_name;
    }
  }

  // 2. 原始作者账号（in_reply_to）——与主账号并发拉取（2e，2026-10-13 叙事提速
  // 第二批：回复票冷路径省 1-3s）。两个名字都来自 twitterInfo 同步输入，去重判定
  // 静态化（同名 → 只拉主账号，与原「拉完 primary 再查 Set 跳过」等价）；
  // getFullAccountInfo 内部 catch 返回 null 不 throw，Promise.all 安全
  const originalAuthor = twitterInfo.in_reply_to?.author_screen_name || null;
  const pullOriginal = !!originalAuthor && originalAuthor !== primaryScreenName;

  const [primaryAccount, originalAccount] = await Promise.all([
    primaryScreenName ? getFullAccountInfo(primaryScreenName, options) : Promise.resolve(null),
    pullOriginal ? getFullAccountInfo(originalAuthor, options) : Promise.resolve(null),
  ]);

  if (primaryAccount) {
    accounts.push({ ...primaryAccount, role: 'primary' });
    screenNames.add(primaryScreenName);
  }
  if (originalAccount) {
    accounts.push({ ...originalAccount, role: 'original_author' });
    screenNames.add(originalAuthor);
  }

  // 3. 未来可以添加更多账号类型（如 retweeted_status 等）

  logger.info('NarrativeAnalyzer', `账号信息收集完成，共${accounts.length}个账号`, {
    accounts: accounts.map(a => ({ screen_name: a.screen_name, role: a.role }))
  });

  return accounts;
}

/**
 * 获取单个账号的完整信息（含推文历史）
 * @param {string} screenName - Twitter用户名
 * @param {Object} [options] - 透传 untilSec（推文时间窗下界）给 getAccountWithFullTweets
 * @returns {Promise<Object|null>} 账号完整信息
 */
export async function getFullAccountInfo(screenName, options = {}) {
  try {
    const { getAccountWithFullTweets } = await import('../prompts/account/account-community-rules.mjs');
    const accountInfo = await getAccountWithFullTweets(screenName, 20, options); // 获取20条推文
    if (accountInfo) {
      return accountInfo;
    } else {
      logger.warn('NarrativeAnalyzer', `获取账号信息失败: @${screenName}（返回null）`);
      return null;
    }
  } catch (error) {
    logger.error('NarrativeAnalyzer', `获取账号信息异常: @${screenName}`, { error: error.message });
    return null;
  }
}

/**
 * 发行方 CA 宣告检测（issuer self-launch 路由补充链路，2026-09-27 蝴蝶轮回/GMGNPaid 案）
 *
 * 拉挂链推文作者的时间线，任一推文含该代币合约地址 → 判为发行方自发币。
 * 覆盖字面法（品牌同一性+宣告指纹）失灵的两类真实形态：币名与作者身份无关
 * （蝴蝶轮回↔熔炉）、同名但挂链推文是纯短链无品牌词（GMGNPaid）。
 *
 * 失败语义 fail-open：账号拉取失败返回 null（不改道，按现状走标准路径 W 数学）——
 * 与 gmgn 因子同取向（宁漏拦不误杀）。宣告竞态（分析时 CA 推文尚未发出）同理 miss，
 * 维持标准路径结果。
 *
 * @param {string} tokenAddress - 代币合约地址
 * @param {Object} twitterInfo - 挂链推文信息（需 type==='tweet' 且有 author_screen_name）
 * @param {Object} [options] - 透传 untilSec 给 getFullAccountInfo（时间窗下界=
 *   token 创建时间-24h；CA 公告在创建后几分钟内，必在窗口内）；tokenAddress 由本函数
 *   并入透传（2026-10-02 用户三点方案）→ 真拉走 CA 惰性早停，拉到含 CA 推文即停
 * @param {Function} [options.fetchAccount] - 账号拉取函数注入（单测打桩；缺省 getFullAccountInfo）
 * @returns {Promise<Object|null>} 命中返回
 *   { screenName, method:'ca_timeline', tweetId, account }，未命中/前置不满足返回 null
 */
export async function detectIssuerByCaTimeline(tokenAddress, twitterInfo, options = {}) {
  if (!twitterInfo || twitterInfo.type !== 'tweet' || !twitterInfo.author_screen_name) return null;

  const fetchAccount = options.fetchAccount || getFullAccountInfo;
  let account = null;
  try {
    // tokenAddress 并入透传（2026-10-02 用户三点方案）：getAccountWithFullTweets 真拉走
    // CA 惰性早停——本函数的目的就是找含 CA 的推文，拉到 CA 即停与语义天然同构
    account = await fetchAccount(twitterInfo.author_screen_name, { ...options, tokenAddress });
  } catch (error) {
    logger.error('NarrativeAnalyzer', `CA 宣告检测拉取作者时间线异常: @${twitterInfo.author_screen_name}`, { error: error.message });
    return null;
  }
  if (!account) return null;

  const { findCaTweetInAccount } = await import('../utils/narrative-utils.mjs');
  const hit = findCaTweetInAccount(tokenAddress, account);
  if (!hit) return null;

  logger.info('NarrativeAnalyzer', `CA 宣告命中: @${account.screen_name} 时间线含合约地址`, {
    tweetId: hit.tweetId,
  });
  return {
    screenName: account.screen_name,
    method: 'ca_timeline',
    tweetId: hit.tweetId,
    account,
  };
}

/**
 * P1.14/C164 项目币官网核验——抓取状态解析（代码端事实层）
 *
 * 用户裁定（2026-10-22，一次性专号 rug 家族案 FOURGE 0xf9de0ca2…ffff / SL
 * 0x5841…ffff：模板 pitch+买粉新号即 mid 过门，官网从未被看过一眼且事后已死链）：
 * 原生项目币必须看网站+检查叙事，没问题才能给过。本函数只做代码可判定的事实：
 * 有没有站（websites 桶剔聚合器自动页，C99 红线）/ 抓没抓到；内容判定（空壳 vs
 * 支撑、基础设施宣称）由 prestage_website_check 题 Jev 答案承载（mapper 门消费）。
 *
 * 状态语义（state PRECOMPUTED 行与 mapper 门对齐）：
 * - reachable：抓取成功 → 附【网页内容】段，Jev 判内容与宣告叙事一致性
 * - unreachable：有站 URL 但抓取失败 → 拦（配套裁定「抓不到=拦」fail-closed；
 *   fetchWebsiteContent 失败缓存 null sticky——同 token 重析同形状照拦，方向一致）
 * - none：无有效官网 → Jev 判基础设施宣称臂（配套裁定：仅基础设施/平台类宣称拦）
 * - 返回 null = 功能关（config 显式 false）→ state 无 website_check 行 → Jev 按
 *   instructions 默认 no_website_non_infra → 门惯性放行（关=不拦）
 *
 * @param {Object} fetchResults - 语料抓取结果（classifiedUrls.websites 桶 + websiteInfo）
 * @param {Object} [options]
 * @param {Function} [options.fetchWebsite] - 抓站函数注入（单测打桩；缺省 fetchWebsiteContent）
 * @returns {Promise<Object|null>} {status:'reachable',url,info} | {status:'unreachable',url} | {status:'none'} | null
 */
export async function resolveWebsiteCheck(fetchResults, options = {}) {
  const cfg = getConfig().prestageWebsiteCheck || {};
  if (cfg.enabled === false) return null; // 默认开：删段=开，显式 false 才关

  // 官网候选：websites 桶首个非聚合器自动页（token 页 = 自动生成页面，不算项目方官网）
  const candidates = (fetchResults?.classifiedUrls?.websites || [])
    .map(w => w?.url)
    .filter(Boolean);
  const url = candidates.find(u => !isAutoTokenPageUrl(u)) || null;
  if (!url) return { status: 'none' };

  // skipAddressValidation 路径（isProjectCoin）：语料阶段已抓过该站并验过 CA → 直接
  // 复用不重复抓（与旧 buildPrestageState websiteInfo 注入同内容，state bit 一致）
  const existing = fetchResults?.websiteInfo;
  if (existing?.url === url && existing?.content) {
    return { status: 'reachable', url, info: existing };
  }

  const timeout = cfg.fetchTimeoutMs || 10000;
  const fetchWebsite = options.fetchWebsite
    || ((u) => fetchWebsiteContent(u, { maxLength: 5000, timeout }));
  let info = null;
  try {
    info = await fetchWebsite(url);
  } catch (error) {
    logger.warn('AccountCommunityAnalysis', `官网核验抓取异常: ${url}`, { error: error.message });
  }
  return info ? { status: 'reachable', url, info } : { status: 'unreachable', url };
}

/**
 * 执行账号/社区代币前置判定（Jev 单次调用）
 *
 * 流程：纯规则验证先行（账号质量/地址验证/名称匹配，account-community-rules.mjs）
 * → 通过后一次 JevClient.ask（4 题问题集，代码端按 addressVerified 分支采信）
 * → 三路分流返回：account_based_meme / web3_native_ip_early / project
 *
 * @param {Object} tokenData - 代币数据
 * @param {Object} fetchResults - 获取的数据结果
 * @param {Object} [options]
 * @param {boolean} [options.skipAddressValidation] - 项目币跳过地址验证（网站已验证）
 * @param {boolean} [options.invalidateAccountCorpus] - C70「重取数重析」：失效账号
 *   语料缓存（twitter_user_info/tweets 三键）后重拉——形状门在 NarrativeAnalyzer
 *   侧算好才透传，此处直接并入规则验证的 tweetsOptions
 * @param {Function} [options.fetchWebsite] - P1.14 官网核验抓站函数注入（单测打桩；
 *   缺省 fetchWebsiteContent，timeout 10s 直抓+jina 两段）
 * @returns {Promise<Object>} 分析结果
 *   成功：{ rating, category, reasoning, scores:null, total_score:null, promptType,
 *           prestageData, [baselineMet], [preCheckData 规则失败时], [addressVerified/nameMatch] }
 *   Jev 调用失败直接抛错（analysisFailed → 引擎 maxRetries，不做兼容吞错）
 */
export async function analyzeAccountCommunityToken(tokenData, fetchResults, options = {}) {
  const {
    getAccountWithFullTweets,
    getCommunityWithFullTweets,
    performRulesValidation
  } = await import('../prompts/account/account-community-rules.mjs');

  const twitterInfo = fetchResults.twitterInfo;
  const relatedAccounts = fetchResults.relatedAccounts || [];

  // 如果有多个账号，选择主要账号进行分析
  let accountOrCommunityRef;
  if (relatedAccounts.length > 0) {
    // 优先选择 original_author（通常是项目官方账号）
    const originalAuthorAccount = relatedAccounts.find(a => a.role === 'original_author');
    if (originalAuthorAccount) {
      accountOrCommunityRef = { type: 'account', screen_name: originalAuthorAccount.screen_name };
      logger.info('AccountCommunityAnalysis', `使用原始作者账号进行分析: @${originalAuthorAccount.screen_name}`);
    } else {
      // 其次选择 primary（主推文作者）
      const primaryAccount = relatedAccounts.find(a => a.role === 'primary');
      if (primaryAccount) {
        accountOrCommunityRef = { type: 'account', screen_name: primaryAccount.screen_name };
        logger.info('AccountCommunityAnalysis', `使用主账号进行分析: @${primaryAccount.screen_name}`);
      } else {
        // 使用第一个账号
        accountOrCommunityRef = { type: 'account', screen_name: relatedAccounts[0].screen_name };
        logger.info('AccountCommunityAnalysis', `使用第一个账号进行分析: @${relatedAccounts[0].screen_name}`);
      }
    }
  } else {
    // 原有逻辑：使用 twitterInfo 中的账号
    accountOrCommunityRef = twitterInfo.type === 'account'
      ? { type: 'account', screen_name: twitterInfo.screen_name }
      : { type: 'community', community_id: twitterInfo.id };
  }

  logger.info('AccountCommunityAnalysis', `开始${accountOrCommunityRef.type === 'account' ? '账号' : '社区'}代币分析`, {
    type: accountOrCommunityRef.type,
    identifier: accountOrCommunityRef.type === 'account' ? accountOrCommunityRef.screen_name : accountOrCommunityRef.id,
    relatedAccountsCount: relatedAccounts.length
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 第一步：规则验证（地址验证 + 名称匹配）- 不使用LLM
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info('AccountCommunityAnalysis', '执行规则验证（地址 + 名称）');

  // 获取完整的账号/社区数据（含完整推文，用于规则验证）
  // 推文时间窗下界 = token 创建时间-24h（2026-09-25 裁定：只取发币前后阶段，不凑 100 条；
  // 发币 CA 公告在创建后几分钟内必在窗口内；创建时间缺失则不设窗口回退凑数口径）
  // token 创建时间：wss_events 回退补全后的统一源（flap 盘原先缺失）
  // tokenAddress（2026-10-02 用户三点方案）：透传给 getAccountWithFullTweets 走 CA 惰性早停
  const tokenCreatedAtSec = tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at;
  const tweetWindowUntilSec = tokenCreatedAtSec ? tokenCreatedAtSec - 24 * 3600 : null;
  const tweetsOptions = { tokenAddress: tokenData.address || null };
  if (tweetWindowUntilSec) tweetsOptions.untilSec = tweetWindowUntilSec;
  if (options.invalidateAccountCorpus) tweetsOptions.invalidateCache = true;
  const fullAccountOrCommunityData = accountOrCommunityRef.type === 'account'
    ? await getAccountWithFullTweets(accountOrCommunityRef.screen_name, 20, tweetsOptions)
    : await getCommunityWithFullTweets(accountOrCommunityRef.community_id, 20);

  if (!fullAccountOrCommunityData) {
    return {
      rating: 'low',
      category: 'data_fetch_failed',
      reasoning: '无法获取账号/社区完整数据（用于规则验证）',
      scores: null,
      total_score: null,
      // 2026-10-02 C53：此前该早退无任何落库载体（preCheckData/prestageData 皆无），
      // 消费侧 else 分支 prestageDataToSave=undefined → 六 stage 字段全空 → rating=null
      // 行 is_valid=true 缓存固化（18 行实证）。补 preCheckData 与 rules_validation 分支
      // 同构 → 消费侧走 precheck 分支落 pre_check_result → resolveFinalRating 出 low。
      // addressVerified/nameMatch 用 null（验证未执行，不冒充「验证失败 false」）
      preCheckData: {
        rating: 'low',
        reason: '无法获取账号/社区完整数据（用于规则验证）',
        result: {
          addressVerified: null,
          nameMatch: null,
          details: { category: 'data_fetch_failed' },
          validationStage: 'data_fetch_failed'
        }
      }
    };
  }

  // 执行规则验证
  const tokenAddress = tokenData.address;
  const tokenSymbol = tokenData.symbol || '';
  const tokenName = tokenData.name || tokenData.raw_api_data?.name || '';

  // 项目币已通过网站验证地址，跳过地址验证
  const skipAddressValidation = options.skipAddressValidation || false;

  const rulesResult = performRulesValidation(
    tokenAddress,
    tokenSymbol,
    tokenName,
    fullAccountOrCommunityData,
    { skipAddressValidation }
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
      rating: 'low',
      category: 'rules_validation',
      reasoning: rulesResult.reason,
      scores: null,
      total_score: null,
      addressVerified: rulesResult.addressVerified,
      nameMatch: rulesResult.nameMatch,
      details: rulesResult.details,
      rulesValidation: true, // 标记这是规则验证的结果
      // 规则验证失败返回preCheckData，在"预检查"卡片展示
      preCheckData: {
        rating: 'low',
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
  // 第二步：Jev 前置判定（一次调用；代码端按 addressVerified 分支采信答案）
  // 未命中 → abm 两条件判定；命中 → token_type 二分 + project 评级（代码端数学）
  // ═══════════════════════════════════════════════════════════════════════════
  // P1.14/C164 官网核验事实层（addressVerified=true 才抓——project 分支消费；abm/
  // web3ip 题恒带但不消费）。null=功能关。tokenType 调用前不可知，故 web3ip 票也照
  // 抓：浪费上界=一次抓取（直抓+jina ≤20s，结果进 website 缓存跨 token 复用）
  const websiteCheck = rulesResult.addressVerified
    ? await resolveWebsiteCheck(fetchResults, options)
    : null;

  // C164 知识库 prestage 二次匹配：analyzer 已按 token 侧输入（symbol/name/address/
  // 主推语料）匹配一轮；prestage 手里有更肥的账号语料（bio+窗口内推文全文），补一轮
  // corpus_contains/concept_keyword 级命中，按 entryId 去重合并（analyzer 侧命中保留
  // 其原规则）。includePrestage 配置门（用户裁定双路径注入）。匹配异常 warn 旁路，
  // 绝不让知识层问题打断 prestage。
  let prestageKnowledgeMatches = options.knowledgeMatches || null;
  try {
    const knowledgeConfig = getKnowledgeConfig();
    const knowledgeBase = knowledgeConfig ? await getKnowledgeBase() : null;
    if (knowledgeConfig?.match?.includePrestage !== false && knowledgeBase) {
      const accountCorpusText = [
        fullAccountOrCommunityData.description,
        fullAccountOrCommunityData.name,
        ...(Array.isArray(fullAccountOrCommunityData.tweets)
          ? fullAccountOrCommunityData.tweets.map((t) => t?.text) : []),
      ].filter(Boolean).join(' ');
      const secondPass = matchKnowledge({
        symbol: tokenSymbol,
        name: tokenName,
        address: tokenAddress,
        twitterHandle: fullAccountOrCommunityData.screen_name || null,
        corpusText: accountCorpusText,
      }, knowledgeBase.index, knowledgeConfig.match);
      if (secondPass.matches.length > 0) {
        const byEntryId = new Map((options.knowledgeMatches?.matches || [])
          .map((m) => [m.entryId, m]));
        for (const m of secondPass.matches) {
          if (!byEntryId.has(m.entryId)) byEntryId.set(m.entryId, m);
        }
        const merged = [...byEntryId.values()]
          .sort((a, b) => a.entryId.localeCompare(b.entryId));
        prestageKnowledgeMatches = {
          matches: merged,
          truncated: options.knowledgeMatches?.truncated || secondPass.truncated,
          scannedEntries: secondPass.scannedEntries,
        };
        logger.info('AccountCommunityAnalysis', '知识库 prestage 二次匹配命中', {
          token: tokenSymbol || tokenAddress,
          entries: merged.map((m) => `${m.kind}:${m.entry?.name}(${m.rule})`),
        });
      }
    }
  } catch (e) {
    logger.warn('AccountCommunityAnalysis', `知识库 prestage 二次匹配异常（旁路）| ${e.message}`);
    prestageKnowledgeMatches = options.knowledgeMatches || null;
  }

  const startedAt = new Date().toISOString();
  // 时效基准 = 代币创建时间（与 pre-check 规则2 同裁定：发币时语料是否新鲜，与何时分析无关）
  // tokenCreatedAtSec 已在上方推文时间窗处声明
  const { state, stats } = buildPrestageState(tokenData, fullAccountOrCommunityData, {
    addressVerified: rulesResult.addressVerified,
    rulesResult,
    websiteCheck,
    websiteInfo: skipAddressValidation ? fetchResults.websiteInfo : null,
    // C164：prestage 二次匹配合并结果（null/空命中 → 段为空，state bit-parity）
    knowledgeMatches: prestageKnowledgeMatches,
    ...(tokenCreatedAtSec ? { now: tokenCreatedAtSec * 1000 } : {}),
  });
  const questions = buildPrestageQuestions();
  const result = await JevClient.ask(state, questions, {
    label: `jev-prestage:${tokenSymbol || (tokenAddress || '').slice(0, 8)}`,
  });
  const finishedAt = new Date().toISOString();

  const mapped = mapPrestageAnswers(result.answers, {
    fullAccountOrCommunityData,
    addressVerified: rulesResult.addressVerified,
    rulesResult,
    // C101：语料 URL 形状（'tweet' 时 mapper 不采信 web3ip——「web3_native_ip_early
    // 仅限于账号」，OK❌ 案找角度推文宣告不得按 web3ip 定档）
    corpusType: twitterInfo?.type || null,
    callInfo: {
      model: result.model, questions, state, stateStats: stats,
      usage: result.usage, startedAt, finishedAt,
    },
  });

  logger.info('AccountCommunityAnalysis', 'Jev 前置判定完成', {
    tokenType: mapped.tokenType,
    rating: mapped.rating,
    addressVerified: rulesResult.addressVerified,
    stateChars: stats.totalChars,
    reason: mapped.reasoning,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 第三步：分流返回（旧四路分流中的 meme 分流已删除——死代码，见文件头注释）
  // ═══════════════════════════════════════════════════════════════════════════

  if (mapped.tokenType === 'account_based_meme') {
    return {
      rating: mapped.rating,
      category: 'account_based_meme',
      reasoning: mapped.reasoning,
      scores: null,
      total_score: null,
      promptType: mapped.promptType,
      prestageData: mapped.prestageDataToSave,
    };
  }

  if (mapped.tokenType === 'web3_native_ip_early') {
    // P1.4（2026-09-27 裁定）：不再 unrated"等社区成长"——mapper 端已按账号基本面
    // （rateProject 粉丝带 + P1.3 降档）给出 low/mid/high 结论，直接透传
    return {
      rating: mapped.rating,
      category: 'web3_native_ip_early',
      reasoning: mapped.reasoning,
      scores: null,
      total_score: null,
      baselineMet: mapped.baselineMet,
      promptType: mapped.promptType,
      prestageData: mapped.prestageDataToSave,
    };
  }

  // 项目币：直接返回评级结果（评级数学已在 mapper 代码端完成）
  return {
    rating: mapped.rating,
    category: 'project',
    reasoning: mapped.reasoning,
    scores: null,
    total_score: null,
    baselineMet: mapped.baselineMet,
    promptType: mapped.promptType,
    prestageData: mapped.prestageDataToSave,
  };
}

// 重新导出 utils 中的函数，保持向后兼容
export { hasIndependentWebsite, shouldUseAccountCommunityAnalysis };
