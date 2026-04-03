/**
 * Twitter Communities API
 * 使用 apidance.pro GraphQL API 获取 Twitter Community 信息
 */

// 复用 API 配置
const API_CONFIG = {
  apiKey: 'llfo2ip8ghxvivzo77tugorx3dz7xf',
  baseUrl: 'https://api.apidance.pro',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 2000
};

const COMMUNITIES_ENDPOINT = `${API_CONFIG.baseUrl}/graphql/CommunitiesFetchOneQuery`;
const COMMUNITY_TWEETS_ENDPOINT = `${API_CONFIG.baseUrl}/graphql/CommunityTweetsTimeline`;

/**
 * HTTP 请求工具函数
 * @param {string} url - 请求URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 响应数据
 */
async function makeRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'apikey': API_CONFIG.apiKey,
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 获取 Twitter Community 信息
 * @param {string} communityId - Community ID (格式: "1517189118140325888")
 * @param {Object} options - 选项
 * @param {boolean} options.withDmMuting - 是否包含 DM 静音信息，默认 false
 * @returns {Promise<Object|null>} Community 信息
 */
async function fetchCommunityById(communityId, options = {}) {
  console.log(`[CommunitiesAPI] 获取 Community 信息: ${communityId}`);

  try {
    const variables = {
      communityId: communityId,
      withDmMuting: options.withDmMuting || false
    };

    const params = new URLSearchParams({
      variables: JSON.stringify(variables)
    });

    const response = await makeRequest(`${COMMUNITIES_ENDPOINT}?${params}`);

    const communityResult = response?.data?.communityResults?.result;

    if (!communityResult) {
      console.warn('[CommunitiesAPI] Community 数据为空');
      return null;
    }

    const legacy = communityResult.legacy || {};
    const timeline = communityResult.timeline?.timeline || {};
    const core = communityResult.core || {};

    // 解析 Community 信息
    // 优先从 communityResult 直接获取字段，如果没有再从 legacy 获取
    const communityInfo = {
      // 基本信息
      id: communityResult.rest_id || communityResult.id_str || communityId,
      name: communityResult.name || legacy.name || '',
      description: communityResult.description || legacy.description || '',
      created_at: communityResult.created_at || legacy.created_at || '',

      // 管理员信息
      admins: communityResult.admins || [],
      admin_results: communityResult.admin_results || null,

      // 成员统计
      members_count: communityResult.member_count || legacy.members_count || 0,
      moderators_count: communityResult.moderator_count || legacy.moderators_count || 0,

      // 规则
      rules: communityResult.rules || legacy.rules || [],

      // 时间线信息
      timeline: {
        tweet_count: timeline.metadata?.count || 0
      },

      // 主题标签
      hashtags: communityResult.hashtags || [],
      search_tags: communityResult.search_tags || [],

      // 图片
      avatar_image_url: communityResult.avatar_image_url || legacy.avatar_image_url || '',
      banner_image_url: communityResult.banner_image_url || legacy.banner_image_url || '',

      // 自定义banner媒体
      custom_banner_media: communityResult.custom_banner_media || null,

      // 其他信息
      is_member: communityResult.is_member ?? legacy.is_member ?? false,
      is_admin: communityResult.is_admin ?? legacy.is_admin ?? false,
      can_join: communityResult.can_join ?? legacy.can_join ?? false,
      role: communityResult.role || null,
      viewer_relationship: communityResult.viewer_relationship || null
    };

    console.log(`[CommunitiesAPI] 成功获取 Community: "${communityInfo.name}"`);
    console.log(`   成员数: ${communityInfo.members_count.toLocaleString()}`);
    console.log(`   推文数: ${communityInfo.timeline.tweet_count.toLocaleString()}`);

    return communityInfo;

  } catch (error) {
    console.error(`[CommunitiesAPI] 获取 Community 失败 (${communityId}):`, error.message);
    return null;
  }
}

/**
 * 从推文中提取 Community ID
 * 推文的 community_results 字段包含 community 信息
 * @param {Object} tweetData - 推文数据（来自 getTweetDetailGraphQL）
 * @returns {string|null} Community ID
 */
function extractCommunityIdFromTweet(tweetData) {
  if (!tweetData) {
    return null;
  }

  // 检查推文中是否有 community_results 字段
  // Twitter GraphQL API 返回的推文可能包含 community 信息
  const communityResults = tweetData.community_results;
  if (communityResults) {
    const communityId = communityResults.rest_id || communityResults.id_str;
    if (communityId) {
      console.log(`[CommunitiesAPI] 从推文中提取到 Community ID: ${communityId}`);
      return communityId;
    }
  }

  // 检查是否在核心数据的其他字段中
  if (tweetData.core && tweetData.core.community_results) {
    const communityId = tweetData.core.community_results.rest_id || tweetData.core.community_results.id_str;
    if (communityId) {
      console.log(`[CommunitiesAPI] 从 core 中提取到 Community ID: ${communityId}`);
      return communityId;
    }
  }

  return null;
}

/**
 * 获取推文所属的 Community 信息
 * @param {Object} tweetData - 推文数据（来自 getTweetDetailGraphQL）
 * @returns {Promise<Object|null>} Community 信息
 */
async function fetchCommunityForTweet(tweetData) {
  const communityId = extractCommunityIdFromTweet(tweetData);

  if (!communityId) {
    console.log('[CommunitiesAPI] 推文不属于任何 Community');
    return null;
  }

  return await fetchCommunityById(communityId);
}

/**
 * 获取 Community 影响力等级
 * @param {Object} communityInfo - Community 信息
 * @returns {string} 影响力等级
 */
function getCommunityInfluenceLevel(communityInfo) {
  if (!communityInfo) {
    return 'unknown';
  }

  const members = communityInfo.members_count || 0;
  const tweets = communityInfo.timeline?.tweet_count || 0;

  // 综合评估：成员数和推文数都是重要指标
  // 成员数权重 × 1，推文数权重 × 0.01（因为推文数通常很大）
  const metric = members + (tweets * 0.01);

  if (metric >= 1000000) return 'world_class';        // 100万+ 成员，世界级
  if (metric >= 100000) return 'mega';               // 10万+ 成员，超大型
  if (metric >= 10000) return 'large';               // 1万+ 成员，大型
  if (metric >= 1000) return 'medium';               // 1000+ 成员，中型
  if (metric >= 100) return 'small';                 // 100+ 成员，小型
  return 'niche';                                    // 100以下成员，小众
}

/**
 * 获取影响力等级说明
 * @param {string} level - 影响力等级
 * @returns {string} 说明
 */
function getCommunityInfluenceDescription(level) {
  const descriptions = {
    'world_class': '世界级社区（100万+成员）',
    'mega': '超大型社区（10万+成员）',
    'large': '大型社区（1万+成员）',
    'medium': '中型社区（1000+成员）',
    'small': '小型社区（100+成员）',
    'niche': '小众社区（100以下成员）',
    'unknown': '无明确影响力'
  };
  return descriptions[level] || '未知';
}

/**
 * 判断是否是有效的 Community ID
 * @param {string} communityId - Community ID
 * @returns {boolean}
 */
function isValidCommunityId(communityId) {
  if (!communityId || typeof communityId !== 'string') {
    return false;
  }
  // Community ID 通常是数字字符串
  return /^\d{10,}$/.test(communityId.trim());
}

/**
 * 获取 Community 推文时间线
 * @param {string} communityId - Community ID
 * @param {Object} options - 选项
 * @param {number} options.count - 获取推文数量，默认20
 * @param {string} options.cursor - 分页游标
 * @returns {Promise<Array>} 推文列表
 */
async function fetchCommunityTweets(communityId, options = {}) {
  console.log(`[CommunitiesAPI] 获取 Community 推文: ${communityId}`);

  try {
    const variables = {
      communityId: communityId,
      count: options.count || 20,
      withCommunityFeaturedTweets: true
    };

    if (options.cursor) {
      variables.cursor = options.cursor;
    }

    const params = new URLSearchParams({
      variables: JSON.stringify(variables)
    });

    const response = await makeRequest(`${COMMUNITY_TWEETS_ENDPOINT}?${params}`);

    // 解析推文列表
    const instructions = response?.data?.communityResults?.result?.timeline_v2?.timeline?.instructions || [];

    const tweets = [];
    for (const inst of instructions) {
      if (inst.entries) {
        for (const entry of inst.entries) {
          const content = entry.content;
          if (content.itemContent && content.itemContent.tweet_results) {
            const tweetResult = content.itemContent.tweet_results.result;
            if (tweetResult) {
              const legacy = tweetResult.legacy || {};
              const core = tweetResult.core || {};
              const userResult = core.user_results?.result;
              const userLegacy = userResult?.legacy || {};
              const userCore = userResult?.core || {};

              tweets.push({
                tweet_id: tweetResult.rest_id,
                text: legacy.full_text || legacy.text || '',
                created_at: legacy.created_at,
                user: {
                  id: userResult?.rest_id,
                  screen_name: userCore?.screen_name || userLegacy?.screen_name,
                  name: userCore?.name || userLegacy?.name,
                  followers_count: userLegacy?.followers_count || 0
                },
                likeCount: legacy.favorite_count || 0,
                retweetCount: legacy.retweet_count || 0,
                replyCount: legacy.reply_count || 0
              });
            }
          }
        }
      }
    }

    console.log(`[CommunitiesAPI] 成功获取 ${tweets.length} 条推文`);

    return tweets;

  } catch (error) {
    console.error(`[CommunitiesAPI] 获取 Community 推文失败 (${communityId}):`, error.message);
    return [];
  }
}

module.exports = {
  fetchCommunityById,
  fetchCommunityForTweet,
  fetchCommunityTweets,
  extractCommunityIdFromTweet,
  getCommunityInfluenceLevel,
  getCommunityInfluenceDescription,
  isValidCommunityId,
  API_CONFIG
};
