/**
 * Twitter代币验证模块
 * 用于验证代币在Twitter上的提及情况
 * 集成API Key和简化的接口，支持直接函数调用
 */

// API配置
const API_CONFIG = {
  apiKey: 'llfo2ip8ghxvivzo77tugorx3dz7xf',
  baseUrl: 'https://api.apidance.pro',
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 2000
};

// API端点
const ENDPOINTS = {
  search: `${API_CONFIG.baseUrl}/sapi/Search`
};

// ==================== Twitter 用户黑名单 ====================
/**
 * Twitter用户黑名单
 * 这些用户的推文将被过滤，不计入统计
 *
 * 分类说明：
 * - 推广机器人: 自动发布格式化推广内容的账号
 * - 警告机器人: 自动发布诈骗警告的账号
 * - 追踪机器人: 自动发布追踪信息的账号（"2 tracking addresses bought..."）
 * - 币圈活跃用户: 在多个代币中频繁发推的账号
 *
 * 更新日期: 2026-03-13
 */
const TWITTER_USER_BLACKLIST = [
  // ========== 推广机器人 ==========
  'BscPulseAlerts',           // 格式化推广：Quick Swap, Check Chart, Progress等
  'BscKOLScanner',            // 推广：Just Popped on BSC等
  'AutorunSOL',               // 推广机器人：🔔 New token! Check the ANALYSIS! (8个代币)
  'LeekPony',                 // 推广机器人：🔥🔥🔥...格式化推广 (8个代币)

  // ========== 警告机器人 ==========
  'LAOWAI6654088',            // 诈骗警告：大量重复的⚠️诈骗推文

  // ========== 币圈活跃用户（跨多个代币频繁发推）==========
  '0xfacairiji',              // 币圈KOL：28380粉丝，涉及4个代币 (摇钱树、皮克斯、再不吃就老了、索隆)
  'feibo03',                  // 大V：36094粉丝，涉及4个代币 (龙虾股、Epic Fury、B小将、NERO)
  'Web3_GXFC',                 // 中V：2950粉丝，涉及3个代币 (哥斯拉、万事币安、黄羊)
  'mxi46636628',              // 中V：6693粉丝，涉及3个代币 (ninebot、懂个球、币安党)

  // ========== 追踪机器人 ==========
  // 以下账号自动发布"2 tracking addresses bought this token..."格式的推文
  'devito33612',              // 追踪机器人
  'FrauMbahc',                // 追踪机器人
  'AynurJahn22666',           // 追踪机器人
  'AnneliesRua',               // 追踪机器人
  'kraushaarmz',              // 追踪机器人
  'GBudig68111',              // 追踪机器人
  'UnivprofB28462',           // 追踪机器人
  'SolveigBlo',               // 追踪机器人
  'KeudelRupp',               // 追踪机器人
  'OxanaDh',                  // 追踪机器人
  'BrankoRadium',             // 追踪机器人
  'ReinhardtHhu',             // 追踪机器人
  'JasminHpa',                // 追踪机器人
  'mike1774232',              // 追踪机器人
  'ScJozefl',                 // 追踪机器人
  'GieDoris45678',            // 追踪机器人
  'AntjeBeng',                // 追踪机器人
  'benthinjun',               // 追踪机器人
  'hartmann59676',            // 追踪机器人
  'IlonaSco',                 // 追踪机器人
  'IrmengardDsx',             // 追踪机器人
  'MetaMbao',                 // 追踪机器人
  'collins686952',            // 追踪机器人
];

/**
 * 检查用户是否在黑名单中
 * @param {string} username - Twitter用户名（不含@）
 * @returns {boolean} 是否在黑名单中
 */
function isUserBlacklisted(username) {
  return TWITTER_USER_BLACKLIST.includes(username);
}

/**
 * Twitter API客户端，使用原生fetch和重试机制
 */
class TwitterClient {
  constructor(config = API_CONFIG) {
    this.config = config;
  }

  async request(url, params = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const queryString = new URLSearchParams(params).toString();
      const requestUrl = queryString ? `${url}?${queryString}` : url;

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'apikey': this.config.apiKey,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // 处理API错误
      if (data.errors && data.errors.length > 0) {
        throw new Error(data.errors[0].message);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      return data;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('请求超时');
      }

      throw error;
    }
  }

  async get(url, params = {}) {
    return this.request(url, params);
  }

  /**
   * 带重试机制的请求
   */
  async requestWithRetry(url, params = {}) {
    let lastError;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.request(url, params);
      } catch (error) {
        lastError = error;

        // 如果是最后一次尝试，直接抛出错误
        if (attempt === this.config.maxRetries - 1) {
          throw error;
        }

        // 判断是否需要重试
        const shouldRetry = this.shouldRetry(error);
        if (!shouldRetry) {
          throw error;
        }

        // 等待后重试
        console.warn(`请求失败，第${attempt + 1}次重试 (${error.message})`);
        await this.sleep(this.config.retryDelay * (attempt + 1));
      }
    }

    throw lastError;
  }

  shouldRetry(error) {
    // 网络错误或服务器错误可以重试
    return error.message.includes('timeout') ||
           error.message.includes('fetch') ||
           error.message.includes('network') ||
           error.message.includes('HTTP错误: 5') ||
           error.message.includes('Rate limit');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 推文用户信息模型
 */
class TweetUser {
  constructor(data = {}) {
    this.idStr = data.id_str || '';
    this.name = data.name || '';
    this.screenName = data.screen_name || '';
    this.followersCount = data.followers_count || 0;
    this.verified = data.verified || false;
  }
}

/**
 * 推文信息数据模型
 */
class Tweet {
  constructor(data = {}) {
    this.tweetId = data.tweet_id || '';
    this.text = data.text || '';
    this.createdAt = data.created_at || '';
    this.favoriteCount = data.favorite_count || 0;
    this.retweetCount = data.retweet_count || 0;
    this.replyCount = data.reply_count || 0;
    this.isRetweet = data.is_retweet || false;
    this.mediaType = data.media_type || null;
    this.user = new TweetUser(data.user || {});
  }

  get totalEngagement() {
    return this.favoriteCount + this.retweetCount + this.replyCount;
  }

  get isQuality() {
    return this.totalEngagement > 4;
  }

  toJSON() {
    return {
      tweet_id: this.tweetId,
      text: this.text,
      created_at: this.createdAt,
      user: {
        screen_name: this.user.screenName,
        name: this.user.name,
        followers_count: this.user.followersCount,
        verified: this.user.verified
      },
      metrics: {
        favorite_count: this.favoriteCount,
        retweet_count: this.retweetCount,
        reply_count: this.replyCount,
        total_engagement: this.totalEngagement
      },
      is_quality: this.isQuality
    };
  }

  static fromApiResponse(data) {
    return new Tweet(data);
  }
}

/**
 * 搜索响应数据模型
 */
class SearchResponse {
  constructor(data = {}) {
    let tweetsData = data.tweets || [];
    if (!Array.isArray(tweetsData)) {
      tweetsData = [];
    }

    this.tweets = tweetsData.map(tweet => Tweet.fromApiResponse(tweet));
    this.nextCursor = data.next_cursor || null;
  }

  static fromApiResponse(data) {
    return new SearchResponse(data);
  }
}

/**
 * 推文搜索API
 */
class SearchAPI {
  constructor(client) {
    this.client = client;
  }

  async searchTweets(query, sortBy = "Latest", cursor = null) {
    const validSortOptions = ["Top", "Latest", "People", "Photos", "Videos"];
    if (!validSortOptions.includes(sortBy)) {
      throw new Error(`Invalid sort_by value. Must be one of: ${validSortOptions.join(', ')}`);
    }

    const params = {
      q: query,
      sort_by: sortBy
    };

    if (cursor) {
      params.cursor = cursor;
    }

    const response = await this.client.requestWithRetry(ENDPOINTS.search, params);
    return SearchResponse.fromApiResponse(response);
  }
}

/**
 * Twitter代币验证器
 */
class TwitterTokenValidator {
  constructor(twitterApi) {
    this.twitterApi = twitterApi;
  }

  /**
   * 验证代币地址在Twitter上的提及情况
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} minTweetCount - 最小推文数量要求
   * @returns {Promise<Object>} 验证结果
   */
  async validateTokenMentions(tokenAddress, minTweetCount = 2) {
    try {
      console.log(`🐦 验证代币 ${tokenAddress} 的Twitter提及情况`);

      // 执行搜索
      const searchResult = await this._searchTokenTweets(tokenAddress);

      if (searchResult.error) {
        return {
          has_mentions: false,
          tweet_count: 0,
          reason: searchResult.error,
          search_time: new Date()
        };
      } else {
        // 分析搜索结果
        const analysisResult = this._analyzeSearchResults(
          searchResult.tweets,
          tokenAddress,
          minTweetCount
        );

        return {
          has_mentions: analysisResult.has_mentions,
          tweet_count: analysisResult.quality_count,
          low_quality_count: analysisResult.low_quality_count,
          relevant_tweets: analysisResult.quality_tweets.slice(0, 5),
          total_search_results: searchResult.tweets.length,
          analysis_details: analysisResult,
          search_time: new Date()
        };
      }

    } catch (error) {
      console.error(`❌ Twitter验证异常: ${error.message}`);
      return {
        has_mentions: false,
        tweet_count: 0,
        reason: `验证异常: ${error.message}`,
        search_time: new Date()
      };
    }
  }

  /**
   * 搜索与代币相关的推文
   * @param {string} tokenAddress - 代币合约地址
   * @returns {Promise<Object>} 搜索结果
   */
  async _searchTokenTweets(tokenAddress) {
    try {
      const searchQueries = this._buildSearchQueries(tokenAddress);
      const allTweets = [];
      const errors = [];

      for (const query of searchQueries) {
        try {
          const response = await this.twitterApi.searchTweets(query, "Top", null);

          if (response && response.tweets.length > 0) {
            allTweets.push(...response.tweets);
            console.debug(`查询 '${query}' 返回 ${response.tweets.length} 条推文`);
          }

          // 避免API频率限制
          await this._sleep(1000);

        } catch (error) {
          const errorMsg = `查询 '${query}' 失败: ${error.message}`;
          errors.push(errorMsg);
          console.warn(errorMsg);
        }
      }

      if (errors.length > 0) {
        console.warn(`Twitter搜索部分失败: ${errors.join('; ')}`);
      }

      return {
        tweets: allTweets,
        errors: errors,
        error: allTweets.length === 0 ? "未找到相关推文" : null
      };

    } catch (error) {
      console.error(`Twitter搜索失败: ${error.message}`);
      return {
        tweets: [],
        errors: [error.message],
        error: `搜索失败: ${error.message}`
      };
    }
  }

  /**
   * 构建搜索查询列表
   * @param {string} tokenAddress - 代币合约地址
   * @returns {string[]} 搜索查询列表
   */
  _buildSearchQueries(tokenAddress) {
    return [tokenAddress];
  }

  /**
   * 分析搜索结果
   * @param {Tweet[]} tweets - 推文列表
   * @param {string} tokenAddress - 代币合约地址
   * @param {number} minTweetCount - 最小推文数量要求
   * @returns {Object} 分析结果
   */
  _analyzeSearchResults(tweets, tokenAddress, minTweetCount) {
    const qualityTweets = [];
    const lowQualityTweets = [];

    // 黑名单过滤统计
    let filteredCount = 0;
    const filteredUsers = new Set();

    for (const tweet of tweets) {
      // ==================== 黑名单过滤 ====================
      const username = tweet.user.screenName;
      if (isUserBlacklisted(username)) {
        filteredCount++;
        filteredUsers.add(username);
        continue;  // 跳过黑名单用户的推文
      }
      // =====================================================

      const favoriteCount = tweet.favoriteCount || 0;
      const retweetCount = tweet.retweetCount || 0;
      const replyCount = tweet.replyCount || 0;
      const totalEngagement = favoriteCount + retweetCount + replyCount;

      const tweetData = {
        tweet_id: tweet.tweetId,
        text: tweet.text,
        created_at: tweet.createdAt,
        user: {
          screen_name: tweet.user.screenName,
          name: tweet.user.name,
          followers_count: tweet.user.followersCount,
          verified: tweet.user.verified
        },
        metrics: {
          favorite_count: favoriteCount,
          retweet_count: retweetCount,
          reply_count: replyCount,
          total_engagement: totalEngagement
        },
        is_quality: totalEngagement > 4
      };

      if (tweetData.is_quality) {
        qualityTweets.push(tweetData);
      } else {
        lowQualityTweets.push(tweetData);
      }
    }

    // 记录过滤日志
    if (filteredCount > 0) {
      console.debug(`[Twitter黑名单] 过滤了 ${filteredCount} 条推文 (来自 ${filteredUsers.size} 个黑名单用户: ${Array.from(filteredUsers).join(', ')})`);
    }

    const stats = this._calculateTweetStatistics(qualityTweets);
    const hasMentions = qualityTweets.length >= minTweetCount;

    return {
      has_mentions: hasMentions,
      total_tweets: tweets.length,
      quality_count: qualityTweets.length,
      low_quality_count: lowQualityTweets.length,
      quality_tweets: qualityTweets.sort((a, b) => b.metrics.total_engagement - a.metrics.total_engagement),
      low_quality_tweets: lowQualityTweets,
      statistics: stats,
      filter_reason: this._getFilterReason(qualityTweets.length, minTweetCount),
      min_tweet_count: minTweetCount
    };
  }

  /**
   * 获取筛选失败原因
   */
  _getFilterReason(qualityCount, minTweetCount = 2) {
    if (qualityCount < minTweetCount) {
      return `高质量推文不足: ${qualityCount} < ${minTweetCount}`;
    }
    return "筛选通过";
  }

  /**
   * 计算推文统计信息
   * @param {Array} tweets - 推文数组（可以是高质量推文或所有推文）
   * @param {boolean} calculateUniqueVerifiedUsers - 是否去重计算认证用户（默认true）
   * @returns {Object} 统计信息
   */
  _calculateTweetStatistics(tweets, calculateUniqueVerifiedUsers = true) {
    if (!tweets.length) {
      return {
        total_engagement: 0,
        avg_engagement: 0,
        total_followers: 0,
        verified_users: 0,
        recent_tweets: 0,
        tweet_count: 0
      };
    }

    const totalEngagement = tweets.reduce(
      (sum, tweet) => sum + (tweet.metrics.favorite_count || 0) + (tweet.metrics.retweet_count || 0) + (tweet.metrics.reply_count || 0),
      0
    );

    const totalFollowers = tweets.reduce(
      (sum, tweet) => sum + (tweet.user?.followers_count || 0),
      0
    );

    let verifiedCount;
    if (calculateUniqueVerifiedUsers) {
      // 去重计算认证用户数
      const uniqueVerifiedUsers = new Set();
      tweets.forEach(tweet => {
        if (tweet.user?.verified && tweet.user?.screen_name) {
          uniqueVerifiedUsers.add(tweet.user.screen_name);
        }
      });
      verifiedCount = uniqueVerifiedUsers.size;
    } else {
      // 直接计数可能重复的认证用户
      verifiedCount = tweets.filter(tweet => tweet.user?.verified).length;
    }

    // 计算最近24小时的推文数量
    let recentCount = 0;
    try {
      const now = new Date();
      for (const tweet of tweets) {
        const tweetTime = new Date(tweet.created_at);
        const diffHours = (now - tweetTime) / (1000 * 60 * 60);
        if (diffHours < 24) {
          recentCount += 1;
        }
      }
    } catch (error) {
      // 忽略时间解析错误
      console.warn('时间解析错误:', error.message);
    }

    return {
      total_engagement: totalEngagement,
      avg_engagement: totalEngagement / tweets.length,
      total_followers: totalFollowers,
      verified_users: verifiedCount,
      recent_tweets: recentCount,
      tweet_count: tweets.length
    };
  }

  /**
   * 获取验证结果摘要
   */
  getValidationSummary(validationResult) {
    if (!validationResult.has_mentions) {
      return `❌ Twitter验证失败: ${validationResult.reason || '未知原因'}`;
    }

    const stats = validationResult.analysis_details?.statistics || {};
    const qualityCount = validationResult.tweet_count || 0;
    const totalTweets = validationResult.total_search_results || 0;

    return (
      `✅ Twitter验证通过: ` +
      `找到${qualityCount}条高质量推文(共${totalTweets}条), ` +
      `总互动${stats.total_engagement || 0}, ` +
      `认证用户${stats.verified_users || 0}个`
    );
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建Twitter代币验证器
 * @param {Object} options - 配置选项
 * @returns {TwitterTokenValidator} 验证器实例
 */
function createTwitterTokenValidator(options = {}) {
  const config = { ...API_CONFIG, ...options };

  if (!config.apiKey) {
    throw new Error('Twitter API key is required');
  }

  const client = new TwitterClient(config);
  const searchAPI = new SearchAPI(client);

  return new TwitterTokenValidator(searchAPI);
}

/**
 * 简化的验证函数，直接使用
 * @param {string} tokenAddress - 代币合约地址
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 验证结果
 */
async function validateTokenOnTwitter(tokenAddress, options = {}) {
  const { minTweetCount = 2, ...configOptions } = options;

  const validator = createTwitterTokenValidator(configOptions);
  return await validator.validateTokenMentions(tokenAddress, minTweetCount);
}

/**
 * 批量验证多个代币地址
 * @param {string[]} tokenAddresses - 代币合约地址数组
 * @param {Object} options - 配置选项
 * @returns {Promise<Object[]>} 批量验证结果数组
 */
async function batchValidateTokens(tokenAddresses, options = {}) {
  const { minTweetCount = 2, ...configOptions } = options;

  const validator = createTwitterTokenValidator(configOptions);
  const results = [];

  for (const address of tokenAddresses) {
    try {
      const result = await validator.validateTokenMentions(address, minTweetCount);
      const summary = validator.getValidationSummary(result);

      results.push({
        address,
        valid: result.has_mentions,
        summary,
        details: result
      });
    } catch (error) {
      results.push({
        address,
        valid: false,
        summary: `❌ 验证失败: ${error.message}`,
        details: {
          has_mentions: false,
          tweet_count: 0,
          reason: error.message,
          search_time: new Date()
        }
      });
    }
  }

  return results;
}

/**
 * 从验证结果中提取通过验证的代币地址
 * @param {Object[]} validationResults - 批量验证结果数组
 * @returns {string[]} 通过验证的代币地址数组
 */
function filterValidTokens(validationResults) {
  return validationResults
    .filter(result => result.valid)
    .map(result => result.address);
}

/**
 * 获取验证统计信息
 * @param {Object[]} validationResults - 批量验证结果数组
 * @returns {Object} 统计信息
 */
function getValidationStatistics(validationResults) {
  const total = validationResults.length;
  const valid = validationResults.filter(result => result.valid).length;
  const invalid = total - valid;

  const totalTweets = validationResults.reduce(
    (sum, result) => sum + (result.details.tweet_count || 0),
    0
  );

  const totalEngagement = validationResults.reduce(
    (sum, result) => sum + (result.details.analysis_details?.statistics?.total_engagement || 0),
    0
  );

  return {
    total,
    valid,
    invalid,
    valid_rate: total > 0 ? (valid / total * 100).toFixed(2) + '%' : '0%',
    total_tweets: totalTweets,
    total_engagement: totalEngagement,
    avg_tweets_per_token: total > 0 ? (totalTweets / total).toFixed(2) : 0
  };
}

/**
 * 从验证结果中提取标准化的推特特征
 * @param {Object} validationResult - Twitter验证结果
 * @returns {Object} 7个推特特征
 */
function extractTwitterFeaturesFromResult(validationResult) {
  // 获取所有推文（包括高质量和低质量）
  const allTweets = [];
  const qualityTweets = validationResult.analysis_details?.quality_tweets || [];
  const lowQualityTweets = validationResult.analysis_details?.low_quality_tweets || [];

  allTweets.push(...qualityTweets, ...lowQualityTweets);

  // 计算所有推文的统计数据
  let totalLikes = 0;
  let totalRetweets = 0;
  let totalComments = 0;
  let totalFollowers = 0;
  let verifiedUserCount = 0;
  let recentTweetCount = 0;

  // 遍历所有推文，累加真实的统计数据
  for (const tweet of allTweets) {
    const favoriteCount = tweet.metrics?.favorite_count || 0;
    const retweetCount = tweet.metrics?.retweet_count || 0;
    const replyCount = tweet.metrics?.reply_count || 0;

    totalLikes += favoriteCount;
    totalRetweets += retweetCount;
    totalComments += replyCount;

    // 计算粉丝数（所有推文的用户粉丝）
    totalFollowers += tweet.user?.followers_count || 0;

    // 统计认证用户（避免重复计算同一用户）
    if (tweet.user?.verified) {
      verifiedUserCount++;
    }

    // 计算最近24小时的推文数量
    try {
      const tweetTime = new Date(tweet.created_at);
      const now = new Date();
      const diffHours = (now - tweetTime) / (1000 * 60 * 60);
      if (diffHours < 24) {
        recentTweetCount++;
      }
    } catch (error) {
      // 忽略时间解析错误
    }
  }

  return {
    twitter_total_results: validationResult.total_search_results || 0,
    twitter_likes: totalLikes,           // 所有推文的点赞总数
    twitter_retweets: totalRetweets,      // 所有推文的转发总数
    twitter_comments: totalComments,      // 所有推文的评论总数
    twitter_followers: totalFollowers,    // 所有推文用户的粉丝总数
    twitter_verified_users: verifiedUserCount,  // 所有推文中的认证用户数
    twitter_quality_tweets: validationResult.tweet_count || 0  // 高质量推文数量
  };
}

/**
 * 获取默认推特特征（失败时使用）
 * @returns {Object} 默认特征值
 */
function getDefaultTwitterFeatures() {
  return {
    twitter_total_results: 0,
    twitter_likes: 0,
    twitter_retweets: 0,
    twitter_comments: 0,
    twitter_followers: 0,
    twitter_verified_users: 0,
    twitter_quality_tweets: 0
  };
}

/**
 * 统一的推特特征提取接口
 * @param {string} tokenAddress - 代币合约地址
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 特征提取结果
 */
async function extractTwitterFeatures(tokenAddress, options = {}) {
  const startTime = Date.now();

  try {
    console.log(`🔍 开始提取推特特征: ${tokenAddress}`);

    // 参数验证
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      throw new Error('Token address is required and must be a string');
    }

    // 使用现有的验证函数
    const validationResult = await validateTokenOnTwitter(tokenAddress, options);

    // 提取特征
    const features = extractTwitterFeaturesFromResult(validationResult);

    const duration = Date.now() - startTime;
    console.log(`✅ 推特特征提取完成，耗时: ${duration}ms`);

    return {
      status: validationResult.has_mentions ? "success" : "no_mentions",
      features,
      rawData: JSON.stringify(validationResult),
      metadata: {
        tokenAddress,
        hasMentions: validationResult.has_mentions,
        tweetCount: validationResult.tweet_count || 0,
        duration,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ 推特特征提取失败: ${error.message}`);

    return {
      status: "failed",
      features: getDefaultTwitterFeatures(),
      rawData: null,
      error: error.message,
      metadata: {
        tokenAddress,
        duration,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * 批量提取多个代币的推特特征
 * @param {Array} tokenAddresses - 代币地址数组
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 批量特征提取结果
 */
async function batchExtractTwitterFeatures(tokenAddresses, options = {}) {
  const results = [];
  const { delay = 1000 } = options; // 默认延时1秒避免API频率限制

  console.log(`📊 开始批量提取 ${tokenAddresses.length} 个代币的推特特征`);

  for (let i = 0; i < tokenAddresses.length; i++) {
    const tokenAddress = tokenAddresses[i];

    try {
      console.log(`处理代币 ${i + 1}/${tokenAddresses.length}: ${tokenAddress}`);

      const result = await extractTwitterFeatures(tokenAddress, options);
      results.push({
        tokenAddress,
        ...result
      });

      // 添加延时避免API频率限制
      if (i < tokenAddresses.length - 1 && delay > 0) {
        await sleep(delay);
      }

    } catch (error) {
      console.error(`❌ 代币 ${tokenAddress} 批量处理失败:`, error.message);

      results.push({
        tokenAddress,
        status: "failed",
        features: getDefaultTwitterFeatures(),
        rawData: null,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // 统计结果
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.length - successCount;

  console.log(`📈 批量处理完成: 成功 ${successCount}，失败 ${failedCount}`);

  return results;
}

/**
 * 延时函数
 * @param {number} ms - 延时毫秒数
 * @returns {Promise} Promise对象
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 导入新增的API功能
const { getUserByScreenName, getUserTweets, getTweetDetail, getTweetDetailGraphQL } = require('./new-apis');

// 导入 Communities API
const {
  fetchCommunityById,
  fetchCommunityForTweet,
  extractCommunityIdFromTweet,
  getCommunityInfluenceLevel,
  getCommunityInfluenceDescription,
  isValidCommunityId
} = require('./communities-api');

// 导出所有函数
module.exports = {
  // 原有功能函数
  validateTokenOnTwitter,
  batchValidateTokens,
  filterValidTokens,
  getValidationStatistics,
  createTwitterTokenValidator,

  // 新增特征提取接口
  extractTwitterFeatures,
  batchExtractTwitterFeatures,
  getDefaultTwitterFeatures,
  extractTwitterFeaturesFromResult,

  // 新增基础API功能
  getUserByScreenName,
  getUserTweets,
  getTweetDetail,
  getTweetDetailGraphQL,

  // 类（高级用法）
  TwitterTokenValidator,
  SearchAPI,
  TwitterClient,
  Tweet,
  TweetUser,
  SearchResponse,

  // 配置和常量
  API_CONFIG,
  ENDPOINTS,
  TWITTER_USER_BLACKLIST,
  isUserBlacklisted
};