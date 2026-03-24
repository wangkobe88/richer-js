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
  tweetDetail: `${API_CONFIG.baseUrl}/sapi/TweetDetail`,
  tweetDetailGraphQL: `${API_CONFIG.baseUrl}/graphql/TweetDetail`
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
      tweet_id: tweetId,
      fieldToggles: JSON.stringify({
        withArticleRichContentState: true,
        withArticlePlainText: true
      })
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

/**
 * 通过 GraphQL API 获取推文详情（支持 Article 内容）
 * @param {string} tweetId - 推文ID
 * @returns {Promise<Object>} 推文详情（包含 article 字段）
 */
async function getTweetDetailGraphQL(tweetId) {
  console.log(`📄 获取推文详情 (GraphQL): ${tweetId}`);

  try {
    const variables = {
      focalTweetId: tweetId,
      referrer: 'profile',
      with_rux_injections: false,
      includePromotedContent: false,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withV2Timeline: true,
      fieldToggles: {
        withArticleRichContentState: true,
        withArticlePlainText: true
      }
    };

    const params = new URLSearchParams({
      variables: JSON.stringify(variables)
    });

    const response = await makeRequest(`${NEW_ENDPOINTS.tweetDetailGraphQL}?${params}`);

    const instructions = response?.data?.threaded_conversation_with_injections_v2?.instructions || [];

    // 查找目标推文
    let tweetResult = null;
    for (const inst of instructions) {
      if (inst.entries) {
        for (const entry of inst.entries) {
          const result = entry?.content?.itemContent?.tweet_results?.result;
          if (result) {
            const restId = result.rest_id;
            // 检查是否是请求的推文
            if (restId === tweetId || !tweetResult) {
              tweetResult = result;
            }
          }
        }
      }
    }

    if (!tweetResult) {
      throw new Error('推文详情获取失败');
    }

    // 调试：检查是否有转发/引用信息
    if (tweetResult.legacy?.retweeted_status || tweetResult.retweeted_status_result) {
      console.log('[GraphQL] 检测到转发推文');
    }
    if (tweetResult.quoted_status_result || tweetResult.legacy?.quoted_status_id) {
      console.log('[GraphQL] 检测到引用推文');
    }

    // 解析推文数据
    const legacy = tweetResult.legacy || {};
    const core = tweetResult.core || {};
    const userResult = core?.user_results?.result;
    const userLegacy = userResult?.legacy || {};
    const userCore = userResult?.core || {};

    // 检查是否有 Note Tweet（长推文）
    const noteTweetResult = tweetResult.note_tweet?.note_tweet_results?.result;
    const noteTweetText = noteTweetResult?.text || '';

    // 推文内容：优先使用 Note Tweet，其次 full_text，最后 text
    const tweetText = noteTweetText || legacy.full_text || legacy.text || '';

    // 检查是否有 Article
    const articleResult = tweetResult.article?.article_results?.result;

    // 检查是否有媒体（图片、视频等）
    const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
    const images = [];
    const videos = [];

    for (const media of mediaEntities) {
      if (media.type === 'photo') {
        images.push({
          url: media.media_url_https,
          media_key: media.media_key,
          width: media.original_info?.width || 0,
          height: media.original_info?.height || 0,
          display_url: media.display_url,
          expanded_url: media.expanded_url
        });
      } else if (media.type === 'video' || media.type === 'animated_gif') {
        // 视频信息（暂不处理）
        videos.push({
          type: media.type,
          media_key: media.media_key
        });
      }
    }

    const tweetDetail = {
      tweet_id: tweetResult.rest_id,
      text: tweetText,
      created_at: legacy.created_at,
      createdTimeStamp: legacy.created_at ? new Date(legacy.created_at).getTime() : null,

      // 用户信息
      user: {
        id: userResult?.rest_id,
        name: userCore?.name || userLegacy?.name,
        screen_name: userCore?.screen_name || userLegacy?.screen_name,
        description: userLegacy?.description,
        followers_count: userLegacy?.followers_count,
        verified: userLegacy?.verified || false,
        is_blue_verified: userResult?.is_blue_verified || false
      },

      // 互动数据
      likeCount: legacy.favorite_count || 0,
      retweetCount: legacy.retweet_count || 0,
      replyCount: legacy.reply_count || 0,
      quoteCount: legacy.quote_count || 0,
      viewCount: legacy.view_count || 0,

      // URL
      urls: legacy.entities?.urls?.map(u => u.expanded_url || u.url) || [],

      // 媒体信息
      media: {
        images: images,
        videos: videos,
        has_media: images.length > 0 || videos.length > 0
      },

      // 回复/转发信息
      is_reply: !!legacy.in_reply_to_status_id,
      reply_to_tweet_id: legacy.in_reply_to_status_id || null,
      related_tweet_id: legacy.conversation_id || null,

      // Article 数据（如果有）
      article: articleResult ? {
        id: articleResult.rest_id,
        title: articleResult.title,
        preview_text: articleResult.preview_text,
        cover_image_url: articleResult.cover_media?.media_info?.original_img_url,
        // Article富文本内容（如果有）
        rich_content_state: articleResult.rich_content_state || null,
        // Article纯文本内容（如果有）
        plain_text: articleResult.plain_text || null
      } : null,

      // 引用推文数据（如果有）
      quoted_status: tweetResult.quoted_status_result ? _parseQuotedTweet(tweetResult.quoted_status_result.result || tweetResult.quoted_status_result) : null
    };

    console.log(`✅ 成功获取推文详情 (GraphQL): ID=${tweetDetail.tweet_id}`);
    if (tweetDetail.article) {
      console.log(`   📰 Article: "${tweetDetail.article.title}"`);
    }
    if (tweetDetail.media.has_media) {
      console.log(`   📷 媒体: ${tweetDetail.media.images.length} 张图片, ${tweetDetail.media.videos.length} 个视频`);
    }
    if (tweetDetail.quoted_status) {
      console.log(`   💬 引用推文: @${tweetDetail.quoted_status.user.screen_name} - ${tweetDetail.quoted_status.text.substring(0, 50)}...`);
    }

    return tweetDetail;

  } catch (error) {
    console.error(`❌ 获取推文详情失败 (GraphQL, ${tweetId}):`, error.message);
    throw error;
  }
}

/**
 * 解析引用推文数据
 * @param {Object} quotedResult - GraphQL返回的引用推文数据
 * @returns {Object} 解析后的引用推文
 */
function _parseQuotedTweet(quotedResult) {
  const legacy = quotedResult.legacy || {};
  const core = quotedResult.core || {};
  const userResult = core?.user_results?.result;
  const userLegacy = userResult?.legacy || {};
  const userCore = userResult?.core || {};

  // 解析媒体
  const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
  const images = [];
  for (const media of mediaEntities) {
    if (media.type === 'photo') {
      images.push({
        url: media.media_url_https,
        media_key: media.media_key,
        width: media.original_info?.width || 0,
        height: media.original_info?.height || 0
      });
    }
  }

  return {
    tweet_id: quotedResult.rest_id,
    text: legacy.full_text || legacy.text || '',
    created_at: legacy.created_at,
    createdTimeStamp: legacy.created_at ? new Date(legacy.created_at).getTime() : null,
    user: {
      id: userResult?.rest_id,
      name: userCore?.name || userLegacy?.name,
      screen_name: userCore?.screen_name || userLegacy?.screen_name,
      followers_count: userLegacy?.followers_count,
      verified: userLegacy?.verified || false,
      is_blue_verified: userResult?.is_blue_verified || false
    },
    likeCount: legacy.favorite_count || 0,
    retweetCount: legacy.retweet_count || 0,
    replyCount: legacy.reply_count || 0,
    quoteCount: legacy.quote_count || 0,
    viewCount: legacy.view_count || 0,
    urls: legacy.entities?.urls?.map(u => u.expanded_url || u.url) || [],
    media: {
      images: images,
      has_media: images.length > 0
    }
  };
}

module.exports = {
  getUserByScreenName,
  getUserTweets,
  getTweetDetail,
  getTweetDetailGraphQL
};