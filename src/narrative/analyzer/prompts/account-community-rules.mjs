/**
 * 账号/社区代币规则验证
 * 使用规则（而非LLM）进行代币地址验证和名称匹配
 */

import {
  getUserByScreenName,
  getUserTweets,
  fetchCommunityTweets
} from '../../../utils/twitter-validation/index.js';

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
 * 获取账号信息（含完整推文，用于规则验证）
 * @param {string} screenName - Twitter用户名
 * @param {number} tweetCount - 获取推文数量
 * @returns {Promise<Object>} 账号信息
 */
export async function getAccountWithFullTweets(screenName, tweetCount = 50) {
  try {
    const userInfo = await getUserByScreenName(screenName);
    // 获取更多推文，避免遗漏包含地址的推文
    const actualCount = Math.max(tweetCount, 50);
    const tweets = await getUserTweets(userInfo.id, { count: String(actualCount) });

    return {
      type: 'account',
      screen_name: userInfo.screen_name,
      name: userInfo.name,
      description: userInfo.description,
      followers_count: userInfo.followers_count,
      verified: userInfo.verified,
      is_blue_verified: userInfo.is_blue_verified,
      statuses_count: userInfo.statuses_count,
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
    const { fetchCommunityById } = await import('../../../utils/twitter-validation/communities-api.js');
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
export function performRulesValidation(tokenAddress, tokenSymbol, tokenName, accountOrCommunityData) {
  // ═══════════════════════════════════════════════════════════════════════════
  // 账号质量检查（优先级最高）
  // 如果账号数据质量达到阈值，跳过地址验证，传递到下游LLM分析
  // 原因：这可能是meme币的背景性说明（类似一篇推文），账号本身可能是一个IP形象
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
  // 1. 地址验证（账号质量未达标时执行）
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
