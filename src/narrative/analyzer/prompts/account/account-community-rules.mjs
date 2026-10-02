/**
 * 账号/社区代币规则验证
 * 使用规则（而非LLM）进行代币地址验证和名称匹配
 */

import {
  getUserByScreenName,
  getUserTweets,
  fetchCommunityTweets
} from '../../../../utils/twitter-validation/index.js';
// C48：fetchCommunityById 直接从 communities-api.js 导入（index.js 未 re-export 它；
// CJS shorthand module.exports 的 named import 实测可静态分析）
import { fetchCommunityById } from '../../../../utils/twitter-validation/communities-api.js';
import { ExternalResourceCache } from '../../../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../../../db/cache-ttl-config.mjs';

/**
 * 清理字符串用于匹配
 * - 转小写
 * - 去除空格、下划线、横线、@符号
 * @param {string} str - 原始字符串
 * @returns {string} 清理后的字符串
 */
function normalizeForMatch(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[\s_\-@]/g, '')
    .trim();
}

/**
 * 验证代币地址是否在账号/社区数据中出现
 * @param {string} tokenAddress - 代币地址
 * @param {Object} accountOrCommunityData - 账号或社区数据（含完整推文）
 * @returns {Object} 验证结果 { found: boolean, locations: string[] }
 */
export function verifyTokenAddress(tokenAddress, accountOrCommunityData) {
  if (!tokenAddress) {
    return { found: false, locations: [], reason: '代币地址为空' };
  }

  const locations = [];
  const type = accountOrCommunityData.type;

  // 将地址转为小写用于不区分大小写匹配
  // 去除0x前缀，增加匹配容错性
  const addressLower = tokenAddress.toLowerCase().replace(/^0x/, '');
  const addressWith0x = '0x' + addressLower;

  // 检查函数
  const checkText = (text) => {
    if (!text) return false;
    const textLower = text.toLowerCase();
    // 尝试匹配：带0x和不带0x
    return textLower.includes(addressWith0x) || textLower.includes(addressLower);
  };

  // 检查账号简介
  if (type === 'account' && accountOrCommunityData.description) {
    if (checkText(accountOrCommunityData.description)) {
      locations.push('账号简介');
    }
  }

  // 检查社区简介
  if (type === 'community' && accountOrCommunityData.description) {
    if (checkText(accountOrCommunityData.description)) {
      locations.push('社区简介');
    }
  }

  // 检查所有推文（完整内容，不截断）
  if (accountOrCommunityData.tweets && Array.isArray(accountOrCommunityData.tweets)) {
    accountOrCommunityData.tweets.forEach((tweet, index) => {
      if (checkText(tweet.text)) {
        locations.push(`推文${index + 1}`);
      }
    });
  }

  return {
    found: locations.length > 0,
    locations,
    reason: locations.length > 0 ? null : `未在${type === 'account' ? '账号简介或推文' : '社区简介或推文'}中找到完整代币地址`
  };
}

/**
 * 验证代币名称是否与账号/社区名称匹配
 * @param {string} tokenSymbol - 代币Symbol
 * @param {string} tokenName - 代币Name
 * @param {Object} accountOrCommunityData - 账号或社区数据
 * @returns {Object} 匹配结果 { matched: boolean, matchType: string, matchDetails: string }
 */
export function verifyTokenName(tokenSymbol, tokenName, accountOrCommunityData) {
  const type = accountOrCommunityData.type;

  // 获取账号/社区的名称
  let screenName = '';
  let displayName = '';

  if (type === 'account') {
    screenName = accountOrCommunityData.screen_name || '';
    displayName = accountOrCommunityData.name || '';
  } else if (type === 'community') {
    screenName = accountOrCommunityData.name || ''; // 社区名作为screenName
    displayName = accountOrCommunityData.name || ''; // 社区没有display name
  }

  // 清理所有名称用于匹配
  const tokenSymbolNorm = normalizeForMatch(tokenSymbol);
  const tokenNameNorm = normalizeForMatch(tokenName);
  const screenNameNorm = normalizeForMatch(screenName);
  const displayNameNorm = normalizeForMatch(displayName);

  // 如果代币没有symbol或name，无法匹配
  if (!tokenSymbolNorm && !tokenNameNorm) {
    return {
      matched: false,
      matchType: 'none',
      matchDetails: '代币symbol和name都为空'
    };
  }

  // 匹配规则
  const matchRules = [
    {
      type: 'symbol-exact-screenName',
      check: () => tokenSymbolNorm && tokenSymbolNorm === screenNameNorm,
      detail: () => `代币Symbol "${tokenSymbol}" 与${type === 'account' ? '账号名' : '社区名'} "${screenName}" 精确匹配`
    },
    {
      type: 'symbol-exact-displayName',
      check: () => tokenSymbolNorm && tokenSymbolNorm === displayNameNorm,
      detail: () => `代币Symbol "${tokenSymbol}" 与显示名 "${displayName}" 精确匹配`
    },
    {
      type: 'name-exact-screenName',
      check: () => tokenNameNorm && tokenNameNorm === screenNameNorm,
      detail: () => `代币Name "${tokenName}" 与${type === 'account' ? '账号名' : '社区名'} "${screenName}" 精确匹配`
    },
    {
      type: 'name-exact-displayName',
      check: () => tokenNameNorm && tokenNameNorm === displayNameNorm,
      detail: () => `代币Name "${tokenName}" 与显示名 "${displayName}" 精确匹配`
    },
    {
      type: 'symbol-in-screenName',
      check: () => tokenSymbolNorm && screenNameNorm.includes(tokenSymbolNorm),
      detail: () => `代币Symbol "${tokenSymbol}" 包含在${type === 'account' ? '账号名' : '社区名'} "${screenName}" 中`
    },
    {
      type: 'symbol-in-displayName',
      check: () => tokenSymbolNorm && displayNameNorm.includes(tokenSymbolNorm),
      detail: () => `代币Symbol "${tokenSymbol}" 包含在显示名 "${displayName}" 中`
    },
    {
      type: 'name-in-screenName',
      check: () => tokenNameNorm && screenNameNorm.includes(tokenNameNorm),
      detail: () => `代币Name "${tokenName}" 包含在${type === 'account' ? '账号名' : '社区名'} "${screenName}" 中`
    },
    {
      type: 'name-in-displayName',
      check: () => tokenNameNorm && displayNameNorm.includes(tokenNameNorm),
      detail: () => `代币Name "${tokenName}" 包含在显示名 "${displayName}" 中`
    },
    {
      type: 'screenName-in-symbol',
      check: () => screenNameNorm && tokenSymbolNorm && tokenSymbolNorm.includes(screenNameNorm),
      detail: () => `${type === 'account' ? '账号名' : '社区名'} "${screenName}" 包含在代币Symbol "${tokenSymbol}" 中`
    },
    {
      type: 'screenName-in-name',
      check: () => screenNameNorm && tokenNameNorm && tokenNameNorm.includes(screenNameNorm),
      detail: () => `${type === 'account' ? '账号名' : '社区名'} "${screenName}" 包含在代币Name "${tokenName}" 中`
    }
  ];

  // 执行匹配规则（按优先级）
  for (const rule of matchRules) {
    if (rule.check()) {
      return {
        matched: true,
        matchType: rule.type,
        matchDetails: rule.detail()
      };
    }
  }

  return {
    matched: false,
    matchType: 'none',
    matchDetails: `代币名称（${tokenSymbol || tokenName}）与${type === 'account' ? '账号' : '社区'}名称（${screenName || displayName}）不匹配`
  };
}

/**
 * 推文时间戳解析（毫秒）：createdTimeStamp 优先，回退 Date.parse(created_at)，失败 null
 * ——与 getUserTweets 窗口分支同款口径
 */
function tweetTimeMs(t) {
  if (typeof t?.createdTimeStamp === 'number' && t.createdTimeStamp > 0) return t.createdTimeStamp;
  const p = Date.parse(t?.created_at);
  return Number.isFinite(p) ? p : null;
}

/**
 * 全量缓存条目的覆盖深度（秒）：跳过第 0 条（置顶推或最新推文）后最老推文时间。
 * 跳过头部：翻满列表头部若是置顶推（可能远早于时间线覆盖段），计入会把 oldestSec
 * 拉低、高估覆盖深度 → 复用判据偏松 → 漏窗口内推文；若无置顶，第 0 条是最新推文，
 * 跳过它不影响 min。全部解析失败返回 null（调用方按覆盖不足处理，fail-closed 重拉）。
 */
function computeTweetsOldestSec(tweets) {
  let oldestMs = null;
  for (let i = 1; i < tweets.length; i++) {
    const ms = tweetTimeMs(tweets[i]);
    if (ms != null && (oldestMs == null || ms < oldestMs)) oldestMs = ms;
  }
  return oldestMs == null ? null : Math.floor(oldestMs / 1000);
}

/**
 * 全量缓存列表按请求窗口截断复用：第 0 条恒保留（直拉行为置顶推恒 unshift 头部、
 * 窗口过滤不适用于置顶——BENNY/MarsCoin 案 CA 就在置顶；无置顶时第 0 条是最新推文
 * 恒在窗口内），其余按时间过滤；时间解析失败保守保留（与直拉一致）。
 */
function truncateTweetsForWindow(tweets, untilSec) {
  const untilMs = untilSec * 1000;
  return tweets.filter((t, i) => {
    if (i === 0) return true;
    const ms = tweetTimeMs(t);
    return ms == null || ms >= untilMs;
  });
}

/**
 * 账号数据两层缓存 key 构造（纯函数，单测锁定形状）
 * - 层1 userInfo：handle 级（小写归一）——跨 token 复用，消除同作者连环发币重复拉取
 * - 层2 tweets（2026-10-02 再升级，用户三点方案）：
 *   · 全量 key `twitter_user_tweets:<userId>`——只存翻满窗口的完整列表（条目
 *     { tweets, oldestSec }），跨 token 共享，复用时按请求窗口截断（离散窗口 key
 *     w<untilSec> 的根因：untilSec 由各 token 创建锚推导，同作者不同 token 锚不同
 *     → key 不同 → 跨 token 永不命中；B2 回测实测 651 次真拉 / 259 唯一作者）
 *   · CA 专属 key `twitter_user_tweets:<userId>:ca:<address小写>`——只存本 token
 *     CA 早停命中的截断列表，同 token 三调用点共享（collectAllAccountsWithFullInfo →
 *     detectIssuerByCaTimeline → prestage 规则验证）；跨 token 不共享：早停截断的
 *     覆盖深度只对本 token 的 CA 语义有效，共享会漏其它 token 更深处的 CA 推文
 */
export function buildAccountCacheKeys(screenName, tweetCount = 50, options = {}) {
  const handle = String(screenName || '').toLowerCase().trim();
  const userKey = `twitter_user_info:${handle}`;
  const tweetsKey = options.userId ? `twitter_user_tweets:${options.userId}` : null;
  const caKey = (options.userId && options.tokenAddress)
    ? `twitter_user_tweets:${options.userId}:ca:${String(options.tokenAddress).toLowerCase()}`
    : null;
  return { handle, userKey, tweetsKey, caKey };
}

/**
 * 获取账号信息（含完整推文，用于规则验证）
 *
 * 两层 ExternalResourceCache（2026-10-02 d46b1b6c 叙事耗时案）：账号收集是叙事
 * 分析外部 IO 大头（回测实测「获取用户信息」985 次调用 vs 302 唯一 handle ≈3.3 倍
 * 冗余；高频账号翻页凑满 100 条 = 一次调用多次 API）。缓存命中后同作者后续
 * token / 同分析后续调用点零网络。刻意手工 get/set 而非 CachedFetcher.fetchWithCache：
 * 后者失败写 1h 冷却行，会静默灭掉宣告竞态重试（PrecheckFailRetryService 300s 窗
 * 内的重试会全被冷却挡掉）——这里失败不落任何痕迹，重试语义与无缓存时一致。
 * 只缓存成功结果（userInfo 需带 screen_name 防空 stub 毒缓存——C53 教训，apidance
 * 对不存在账号返回 code:0 空骨架；tweets 需 Array.isArray）。
 *
 * @param {string} screenName - Twitter用户名
 * @param {number} tweetCount - 获取推文数量
 * @param {Object} [options]
 * @param {number} [options.untilSec] - 推文时间窗下界（unix 秒，通常 = token 创建时间-24h）：
 *   有窗口时不再凑满 100 条，翻到窗口下界即停（发币 CA 公告在创建后几分钟内，必在窗口内）
 * @param {string} [options.tokenAddress] - 目标代币合约地址（CA 惰性早停，2026-10-02 用户
 *   三点方案）：传入时真拉走 getUserTweets matchAddress 每页匹配命中即停；命中截断列表
 *   落 CA 专属 key，翻满全量列表落 userId 级 key。项目方 CA 公告通常在最新几条/置顶
 *   → 项目票通常 1 页即停；非项目票翻满窗口与原行为一致（早停点恒 ≤ 原停点，零覆盖损失）
 * @returns {Promise<Object>} 账号信息
 */
export async function getAccountWithFullTweets(screenName, tweetCount = 50, options = {}) {
  try {
    // ── 层1：userInfo（handle 级）──
    const { userKey } = buildAccountCacheKeys(screenName, tweetCount, options);
    const userTTL = getCacheTTL('twitter_user_info');
    let userInfo = await ExternalResourceCache.get(userKey, 'twitter_user_info', { maxAge: userTTL.maxAge });
    if (!userInfo) {
      userInfo = await getUserByScreenName(screenName);
      if (userInfo && userInfo.screen_name) {  // 空 stub 不落缓存（C53）；getUserByScreenName 内部已对空骨架 throw，此处双保险
        await ExternalResourceCache.set(userKey, 'twitter_user_info', userInfo, { ttl: userTTL.ttl });
      }
    }

    // ── 层2：tweets（userId 级全量 + CA 专属双 key）──
    const { tweetsKey, caKey } = buildAccountCacheKeys(screenName, tweetCount, { ...options, userId: userInfo.id });
    const tweetsTTL = getCacheTTL('twitter_user_tweets');

    let tweets = null;
    // ① CA 专属 key：本 token 早停结果（截断列表含 CA）——同 token 重析/后续调用点直接复用
    if (caKey) {
      const cachedCa = await ExternalResourceCache.get(caKey, 'twitter_user_tweets', { maxAge: tweetsTTL.maxAge });
      if (Array.isArray(cachedCa)) tweets = cachedCa;
    }
    // ② userId 级全量 key：翻满窗口的完整列表——覆盖深度足够时按本请求窗口截断复用；
    //    覆盖不足（oldestSec > untilSec，缓存窗口比本 token 浅）或凑数口径条数不够 → 重拉
    if (!tweets) {
      const entry = await ExternalResourceCache.get(tweetsKey, 'twitter_user_tweets', { maxAge: tweetsTTL.maxAge });
      if (entry && Array.isArray(entry.tweets)) {
        if (options.untilSec) {
          if (entry.oldestSec != null && entry.oldestSec <= options.untilSec) {
            tweets = truncateTweetsForWindow(entry.tweets, options.untilSec);
          }
        } else {
          const actualCount = Math.max(tweetCount, 100);
          if (entry.tweets.length >= actualCount) tweets = entry.tweets.slice(0, actualCount);
        }
      }
    }
    // ③ 真拉：miss / 覆盖不足 / CA key 未命中。带 tokenAddress → 每页 CA 匹配命中即停
    if (!tweets) {
      if (options.untilSec) {
        // 时间窗驱动（2026-09-25 裁定）：只取发币前后阶段的推文，不凑数
        tweets = await getUserTweets(userInfo.id, { count: String(tweetCount), untilSec: options.untilSec, matchAddress: options.tokenAddress });
      } else {
        // 获取更多推文，避免遗漏包含地址的推文（getUserTweets 已按 cursor 翻页凑满；
        // 100 条对高频账号可覆盖到 token 创建时刻附近——发币 CA 公告通常在创建后几分钟内发出）
        const actualCount = Math.max(tweetCount, 100);
        tweets = await getUserTweets(userInfo.id, { count: String(actualCount), matchAddress: options.tokenAddress });
      }
      if (Array.isArray(tweets)) {
        const caMatched = tweets.addressMatched === true;
        if (caMatched && caKey) {
          // 早停命中：截断列表只对本 token 的 CA 语义有效 → 落 CA 专属 key
          // （不落全量 key：截断覆盖深度对其它 token 无效，写入会让复用判据漏推文）
          await ExternalResourceCache.set(caKey, 'twitter_user_tweets', tweets, { ttl: tweetsTTL.ttl });
        } else if (!caMatched) {
          // 翻满（CA 未命中 / 未传地址）：完整列表落 userId 级全量 key 供跨 token 复用
          await ExternalResourceCache.set(tweetsKey, 'twitter_user_tweets', {
            tweets,
            oldestSec: computeTweetsOldestSec(tweets),
          }, { ttl: tweetsTTL.ttl });
        }
      }
    }

    return {
      type: 'account',
      screen_name: userInfo.screen_name,
      name: userInfo.name,
      description: userInfo.description,
      followers_count: userInfo.followers_count,
      verified: userInfo.verified,
      is_blue_verified: userInfo.is_blue_verified,
      statuses_count: userInfo.statuses_count,
      created_at: userInfo.created_at || null, // 账号注册时间（P1.3 信用降档年龄锚点）
      tweets: tweets.map(t => ({
        tweet_id: t.tweet_id,
        text: t.text,  // 完整文本，不截断
        created_at: t.created_at
      }))
    };
  } catch (error) {
    console.error(`获取账号信息失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取社区信息（含完整推文，用于规则验证）
 * @param {string} communityId - 社区ID
 * @param {number} tweetCount - 获取推文数量
 * @returns {Promise<Object>} 社区信息
 */
export async function getCommunityWithFullTweets(communityId, tweetCount = 50) {
  try {
    // C48 修复（2026-10-01 CREPE 案）：原为动态 import '../../…/../../../utils/…'（三级，
    // 解析到不存在的 src/narrative/utils/twitter-validation/）→ getCommunityWithFullTweets
    // 恒 null → 社区票 prestage 路径全部 data_fetch_failed low；改为顶部静态 import
    // （与本文件既有三级函数同源，模块加载即验证）
    const communityInfo = await fetchCommunityById(communityId);
    if (!communityInfo) {
      return null;
    }

    // 获取更多推文，避免遗漏包含地址的推文
    const actualCount = Math.max(tweetCount, 50);
    const tweets = await fetchCommunityTweets(communityId, { count: actualCount });

    return {
      type: 'community',
      id: communityInfo.id,
      name: communityInfo.name,
      description: communityInfo.description,
      members_count: communityInfo.members_count,
      moderators_count: communityInfo.moderators_count,
      timeline_tweet_count: communityInfo.timeline?.tweet_count || 0,
      tweets: tweets.map(t => ({
        tweet_id: t.tweet_id,
        text: t.text,  // 完整文本，不截断
        created_at: t.created_at,
        user: {
          screen_name: t.user?.screen_name,
          name: t.user?.name
        }
      }))
    };
  } catch (error) {
    console.error(`获取社区信息失败: ${error.message}`);
    return null;
  }
}

/**
 * 执行完整的规则验证（地址 + 名称）
 * @param {string} tokenAddress - 代币地址
 * @param {string} tokenSymbol - 代币Symbol
 * @param {string} tokenName - 代币Name
 * @param {Object} accountOrCommunityData - 账号或社区数据
 * @returns {Object} 验证结果
 */
export function performRulesValidation(tokenAddress, tokenSymbol, tokenName, accountOrCommunityData, options = {}) {
  // ═══════════════════════════════════════════════════════════════════════════
  // 账号质量检查（优先级最高）
  // 质量达标时仍执行地址验证：公示了代币地址（强绑定证据）→ addressVerified=true
  // 走 token_type 二分；未公示才降级为 abm 两条件路径（交给下游LLM判断）
  // 原因：质量达标不该丢弃"账号自己贴了地址"这个最强归属证据
  // ═══════════════════════════════════════════════════════════════════════════

  const type = accountOrCommunityData.type;
  let accountQuality = null;

  if (type === 'account') {
    const followersCount = accountOrCommunityData.followers_count || 0;
    const statusesCount = accountOrCommunityData.statuses_count || 0;
    const verified = accountOrCommunityData.verified || false;
    const isBlueVerified = accountOrCommunityData.is_blue_verified || false;

    accountQuality = {
      followersCount,
      statusesCount,
      verified,
      isBlueVerified,
      meetsThreshold: false
    };

    // 账号质量阈值设定（满足任一条件即可传递到下游）：
    // 条件1：粉丝数 >= 500 + 发推数 >= 20 → 说明账号有一定影响力和基本活动
    // 条件2：粉丝数 >= 1000 + 有认证（蓝V或官方认证）→ 高影响力认证账号
    // 条件3：粉丝数 >= 3000 → 即使没有认证，粉丝数足够高说明有一定影响力
    const FOLLOWERS_THRESHOLD = 500;
    const STATUSES_THRESHOLD = 20;
    const FOLLOWERS_HIGH_THRESHOLD = 1000;
    const FOLLOWERS_VERY_HIGH_THRESHOLD = 3000;

    const meetsCondition1 = followersCount >= FOLLOWERS_THRESHOLD && statusesCount >= STATUSES_THRESHOLD;
    const meetsCondition2 = followersCount >= FOLLOWERS_HIGH_THRESHOLD && (verified || isBlueVerified);
    const meetsCondition3 = followersCount >= FOLLOWERS_VERY_HIGH_THRESHOLD;

    if (meetsCondition1 || meetsCondition2 || meetsCondition3) {
      accountQuality.meetsThreshold = true;

      const matchedConditions = [];
      if (meetsCondition1) matchedConditions.push(`条件1(粉丝≥${FOLLOWERS_THRESHOLD}且发推≥${STATUSES_THRESHOLD})`);
      if (meetsCondition2) matchedConditions.push(`条件2(粉丝≥${FOLLOWERS_HIGH_THRESHOLD}且有认证)`);
      if (meetsCondition3) matchedConditions.push(`条件3(粉丝≥${FOLLOWERS_VERY_HIGH_THRESHOLD})`);

      // 质量达标后仍验证地址：账号公示了地址 → 已验证归属（与项目币先例一致，名称只记录不拒）
      const addressResult = verifyTokenAddress(tokenAddress, accountOrCommunityData);

      if (addressResult.found) {
        const nameResult = verifyTokenName(tokenSymbol, tokenName, accountOrCommunityData);

        console.log(`[AccountCommunityRules] 账号质量达标且地址命中（${addressResult.locations.join('、')}），按已验证归属传递到Prestage LLM判断`, {
          screenName: accountOrCommunityData.screen_name,
          followersCount,
          statusesCount,
          verified,
          isBlueVerified,
          matchedConditions,
          addressLocations: addressResult.locations
        });

        return {
          passed: true,
          stage: 'account_quality_address_found',
          addressVerified: true,
          nameMatch: nameResult.matched,
          reason: `账号质量达标（${matchedConditions.join(' + ')}）且${addressResult.locations.join('、')}中找到代币合约地址，确认为官方代币，传递到Prestage LLM判断`,
          details: {
            accountQuality: {
              followersCount,
              statusesCount,
              verified,
              isBlueVerified,
              matchedConditions
            },
            addressLocations: addressResult.locations,
            nameMatchType: nameResult.matchType
          }
        };
      }

      console.log(`[AccountCommunityRules] 账号质量检查通过，地址未命中但账号质量达标，传递到Prestage LLM判断`, {
        screenName: accountOrCommunityData.screen_name,
        followersCount,
        statusesCount,
        verified,
        isBlueVerified,
        matchedConditions
      });

      // 返回特殊标记：账号质量检查通过，但地址未验证
      // 这种情况需要传递到Prestage LLM，让LLM判断是否是"以账号为背景的meme币"
      return {
        passed: true,
        stage: 'account_quality_no_address',
        addressVerified: false,  // 地址未验证
        nameMatch: null,          // 名称未检查（交给Prestage LLM判断）
        reason: `账号质量达到阈值（粉丝${followersCount}，发推${statusesCount}，认证：${verified || isBlueVerified ? '是' : '否'}），匹配${matchedConditions.join(' + ')}，地址未命中但账号质量达标，传递到Prestage LLM判断`,
        details: {
          accountQuality: {
            followersCount,
            statusesCount,
            verified,
            isBlueVerified,
            matchedConditions
          },
          addressLocations: [],
          skipReason: 'account_quality_meets_threshold_no_address'
        }
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 项目币跳过地址验证（已通过网站内容验证地址）
  // ═══════════════════════════════════════════════════════════════════════════
  if (options.skipAddressValidation) {
    console.log(`[AccountCommunityRules] 项目币跳过地址验证（网站已验证地址）`, {
      screenName: accountOrCommunityData.screen_name
    });

    // 仍然做名称匹配检查
    const nameResult = verifyTokenName(tokenSymbol, tokenName, accountOrCommunityData);

    return {
      passed: true,
      stage: 'project_coin_website_verified',
      addressVerified: true,
      nameMatch: nameResult.matched,
      reason: nameResult.matched
        ? `项目币：网站内容中包含代币合约地址，已验证项目归属（${nameResult.matchDetails}）`
        : '项目币：网站内容中包含代币合约地址，已验证项目归属',
      details: {
        addressLocations: ['website_content'],
        accountQuality,
        skipReason: 'project_coin_website_verified',
        nameMatchType: nameResult.matchType
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 地址验证（账号质量未达标时为强制门槛：找不到地址直接拒）
  // ═══════════════════════════════════════════════════════════════════════════

  const addressResult = verifyTokenAddress(tokenAddress, accountOrCommunityData);

  if (!addressResult.found) {
    return {
      passed: false,
      stage: 'address',
      addressVerified: false,
      nameMatch: null,
      reason: addressResult.reason,
      details: {
        addressLocations: [],
        accountQuality  // 包含账号质量信息，便于调试
      }
    };
  }

  // 2. 名称匹配
  const nameResult = verifyTokenName(tokenSymbol, tokenName, accountOrCommunityData);

  if (!nameResult.matched) {
    // C50（2026-10-01 CZ 案用户裁定）：社区票名称匹配不作拒因——字面匹配（精确/
    // 包含）对缩写/谐音/双关叙事结构性失明（CZ = Crypto for Gen Z 首尾缩写双关，
    // 2.2 万粉 KOL 宣告帖定义叙事）；社区含合约地址（最强归属绑定）+ 成员达数百人
    // = 社区阵地确凿，名称关联与叙事价值交 prestage Jev（P1.2 名字关联题本就是它判）
    const COMMUNITY_NAME_EXEMPT_MIN_MEMBERS = 200;
    if (type === 'community'
        && addressResult.found
        && (accountOrCommunityData.members_count || 0) >= COMMUNITY_NAME_EXEMPT_MIN_MEMBERS) {
      console.log(`[AccountCommunityRules] 社区票名称豁免（地址验证过+成员${accountOrCommunityData.members_count}≥${COMMUNITY_NAME_EXEMPT_MIN_MEMBERS}），交 Prestage LLM 判断`, {
        community: accountOrCommunityData.name,
        nameMatchType: nameResult.matchType
      });
      return {
        passed: true,
        stage: 'community_address_members_pass',
        addressVerified: true,
        nameMatch: false, // 字面不匹配如实记录，关联判断交 Prestage LLM
        reason: `社区简介/推文中找到代币合约地址且成员数 ${accountOrCommunityData.members_count} 人（社区阵地确凿），名称字面不匹配，名称关联与叙事判断交 Prestage LLM`,
        details: {
          addressLocations: addressResult.locations,
          nameMatchType: nameResult.matchType,
          communityMembers: accountOrCommunityData.members_count,
          nameExempt: 'community_address_members'
        }
      };
    }

    return {
      passed: false,
      stage: 'name',
      addressVerified: true,
      nameMatch: false,
      reason: nameResult.matchDetails,
      details: {
        addressLocations: addressResult.locations,
        nameMatchType: 'none'
      }
    };
  }

  // 3. 全部通过
  return {
    passed: true,
    stage: 'passed',
    addressVerified: true,
    nameMatch: true,
    reason: '规则验证通过',
    details: {
      addressLocations: addressResult.locations,
      nameMatchType: nameResult.matchType
    }
  };
}
