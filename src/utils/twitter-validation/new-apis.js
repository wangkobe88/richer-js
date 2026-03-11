/**
 * 新增Twitter API功能
 * 提供用户信息获取、用户推文获取、推文详情获取功能
 */

const API_CONFIG = {
  apiKey: 'llfo2ip8ghxvivzo77tugorx3dz7xf',
  baseUrl: 'https://api.apidance.pro',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 2000
};

// 新增API端点
const NEW_ENDPOINTS = {
  userByScreenName: `${API_CONFIG.baseUrl}/graphql/UserByScreenName`,
  userTweets: `${API_CONFIG.baseUrl}/sapi/UserTweets`,
  tweetDetail: `${API_CONFIG.baseUrl}/sapi/TweetDetail`
};

/**
 * HTTP请求工具函数 (复用现有逻辑)
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
 * 获取用户信息
 * @param {string} screenName - Twitter用户名 (不包含@符号)
 * @returns {Promise<Object>} 用户信息
 */
async function getUserByScreenName(screenName) {
  console.log(`🔍 获取用户信息: @${screenName}`);

  try {
    const variables = {
      screen_name: screenName,
      withSafetyModeUserFields: true,
      withHighlightedLabel: true
    };

    const params = new URLSearchParams({
      variables: JSON.stringify(variables)
    });

    const response = await makeRequest(`${NEW_ENDPOINTS.userByScreenName}?${params}`);

    const userResult = response?.data?.user?.result;
    if (!userResult) {
      throw new Error('用户信息获取失败');
    }

    const legacy = userResult.legacy || {};
    const core = userResult.core || {};
    const verification = userResult.verification || {};
    const avatar = userResult.avatar || {};
    const location = userResult.location || {};

    const userInfo = {
      // 基本信息
      id: userResult.rest_id || '',
      screen_name: core.screen_name || '',
      name: core.name || '',
      description: legacy.description || '',
      verified: verification.verified || false,
      is_blue_verified: userResult.is_blue_verified || false,
      created_at: core.created_at || '',

      // 统计信息
      followers_count: legacy.followers_count || 0,
      friends_count: legacy.friends_count || 0,
      statuses_count: legacy.statuses_count || 0,
      media_count: legacy.media_count || 0,
      favourites_count: legacy.favourites_count || 0,

      // 其他信息
      location: location.location || '',
      url: legacy.url || '',
      avatar_url: avatar.image_url || '',
      profile_banner_url: userResult.profile_banner_url || ''
    };

    console.log(`✅ 成功获取用户信息: ${userInfo.name} (@${userInfo.screen_name})`);
    console.log(`   粉丝数: ${userInfo.followers_count.toLocaleString()}`);
    console.log(`   推文数: ${userInfo.statuses_count.toLocaleString()}`);

    return userInfo;

  } catch (error) {
    console.error(`❌ 获取用户信息失败 (@${screenName}):`, error.message);
    throw error;
  }
}

/**
 * 获取用户推文列表
 * @param {string} userId - Twitter用户ID (不是用户名)
 * @param {Object} options - 选项
 * @returns {Promise<Array>} 推文列表
 */
async function getUserTweets(userId, options = {}) {
  console.log(`📝 获取用户推文列表: userId=${userId}`);

  try {
    const params = new URLSearchParams({
      user_id: userId,
      count: options.count || '10',
      ...options
    });

    const response = await makeRequest(`${NEW_ENDPOINTS.userTweets}?${params}`);

    const tweets = response?.tweets || [];

    console.log(`✅ 成功获取 ${tweets.length} 条推文`);

    return tweets;

  } catch (error) {
    console.error(`❌ 获取用户推文失败 (userId=${userId}):`, error.message);
    throw error;
  }
}

/**
 * 获取推文详情
 * @param {string} tweetId - 推文ID
 * @returns {Promise<Object>} 推文详情
 */
async function getTweetDetail(tweetId) {
  console.log(`📄 获取推文详情: ${tweetId}`);

  try {
    const params = new URLSearchParams({
      tweet_id: tweetId
    });

    const response = await makeRequest(`${NEW_ENDPOINTS.tweetDetail}?${params}`);

    const pinnedTweet = response.pinned_tweet;
    const tweets = response.tweets || [];

    // 如果有置顶推文，将其合并到结果中
    if (pinnedTweet) {
      tweets.unshift(pinnedTweet);
    }

    if (tweets.length === 0) {
      throw new Error('推文详情获取失败');
    }

    // 查找与请求ID匹配的推文
    let tweetDetail = tweets.find(tweet => tweet.tweet_id === tweetId);

    // 如果没有找到完全匹配的，尝试查找相关推文
    if (!tweetDetail) {
      // 查找回复推文（related_tweet_id 匹配）
      tweetDetail = tweets.find(tweet => tweet.related_tweet_id === tweetId);

      if (!tweetDetail) {
        // 如果还是没找到，查找包含该ID的推文文本或相关字段
        tweetDetail = tweets.find(tweet =>
          tweet.text?.includes(tweetId) ||
          tweet.related_tweet_id === tweetId ||
          tweet.reply_to_tweet_id === tweetId
        );
      }
    }

    // 如果仍然没找到，取第一条并记录警告
    if (!tweetDetail) {
      console.warn(`⚠️ 未找到匹配的推文ID ${tweetId}，返回第一条推文`);
      tweetDetail = tweets[0];

      // 记录实际返回的推文ID
      if (tweetDetail.tweet_id !== tweetId) {
        console.warn(`⚠️ 返回的推文ID (${tweetDetail.tweet_id}) 与请求的ID (${tweetId}) 不匹配`);
      }
    }

    console.log(`✅ 成功获取推文详情: ID=${tweetDetail.tweet_id}, ${tweetDetail.text?.substring(0, 50)}...`);

    return tweetDetail;

  } catch (error) {
    console.error(`❌ 获取推文详情失败 (${tweetId}):`, error.message);
    throw error;
  }
}

module.exports = {
  getUserByScreenName,
  getUserTweets,
  getTweetDetail
};