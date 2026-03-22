/**
 * 推文获取工具
 */

import twitterValidationModule from '../../utils/twitter-validation/index.js';
const { getTweetDetail, getUserByScreenName } = twitterValidationModule;

/**
 * 叙事分析Twitter用户黑名单
 * 这些用户专门制造虚假叙事糊弄人，应该过滤
 */
const NARRATIVE_TWITTER_BLACKLIST = [
  'Cortaviousloma1',  // 制造虚假叙事
];

/**
 * 检查用户是否在黑名单中
 */
function isUserBlacklisted(username) {
  if (!username) return false;
  return NARRATIVE_TWITTER_BLACKLIST.includes(username);
}

export class TwitterFetcher {

  /**
   * 从推特URL获取推文内容
   */
  static async fetchFromUrl(twitterUrl) {
    if (!twitterUrl) {
      return null;
    }

    try {
      // 提取tweet_id
      const tweetId = TwitterExtractor.extractTweetId(twitterUrl);
      if (!tweetId) {
        console.warn('[TwitterFetcher] 无法提取tweet_id:', twitterUrl);
        return null;
      }

      // 使用getTweetDetail获取推文详情
      const tweetData = await getTweetDetail(tweetId);

      if (!tweetData || !tweetData.text) {
        console.warn('[TwitterFetcher] 推文数据为空:', tweetData);
        return null;
      }

      // 检查推文作者是否在黑名单中
      const authorScreenName = tweetData.user?.screen_name || tweetData.author_screen_name;
      if (isUserBlacklisted(authorScreenName)) {
        console.warn(`[TwitterFetcher] 推文作者 @${authorScreenName} 在叙事分析黑名单中，已跳过`);
        return null;
      }

      return {
        type: 'tweet',
        text: tweetData.text,
        author_name: tweetData.user?.name || tweetData.author_name || null,
        author_screen_name: tweetData.user?.screen_name || tweetData.author_screen_name || null,
        created_at: tweetData.created_at || tweetData.createdTimeStamp || null,
        tweet_id: tweetId,
        twitter_url: twitterUrl,
        metrics: {
          favorite_count: tweetData.favorite_count || tweetData.likeCount || 0,
          retweet_count: tweetData.retweet_count || tweetData.retweetCount || 0
        }
      };
    } catch (error) {
      console.error('[TwitterFetcher] 获取推文失败:', error.message);
      return null;
    }
  }

  /**
   * 从推特账号链接获取账号信息
   * @param {string} username - Twitter用户名（不含@）
   * @returns {Promise<Object>} 账号信息
   */
  static async fetchAccountInfo(username) {
    if (!username) {
      return null;
    }

    try {
      console.log(`[TwitterFetcher] 获取账号信息: @${username}`);

      const userInfo = await getUserByScreenName(username);

      if (!userInfo) {
        console.warn('[TwitterFetcher] 账号信息为空');
        return null;
      }

      // 检查账号是否在黑名单中
      if (isUserBlacklisted(userInfo.screen_name)) {
        console.warn(`[TwitterFetcher] 账号 @${userInfo.screen_name} 在叙事分析黑名单中，已跳过`);
        return null;
      }

      return {
        type: 'account',
        screen_name: userInfo.screen_name || '',
        name: userInfo.name || '',
        description: userInfo.description || '',
        followers_count: userInfo.followers_count || 0,
        verified: userInfo.verified || false,
        is_blue_verified: userInfo.is_blue_verified || false,
        statuses_count: userInfo.statuses_count || 0,
        created_at: userInfo.created_at || '',
        location: userInfo.location || '',
        url: userInfo.url || ''
      };
    } catch (error) {
      console.error('[TwitterFetcher] 获取账号信息失败:', error.message);
      return null;
    }
  }

  /**
   * 从多个URL尝试获取推文（备用方案）
   */
  static async fetchFromUrls(twitterUrl, websiteUrl) {
    // 优先尝试 twitterUrl 作为推文
    let result = await this.fetchFromUrl(twitterUrl);
    if (result) {
      return result;
    }

    // 如果 twitterUrl 是账号链接，尝试获取账号信息
    const urlType = TwitterExtractor.getTwitterUrlType(twitterUrl);
    if (urlType === 'account') {
      const username = TwitterExtractor.extractUsername(twitterUrl);
      if (username) {
        result = await this.fetchAccountInfo(username);
        if (result) {
          console.log(`[TwitterFetcher] 成功获取账号信息: @${username}`);
          return result;
        }
      }
    }

    // 如果 websiteUrl 也是推特链接，尝试获取
    if (websiteUrl && websiteUrl.includes('x.com') && websiteUrl.includes('status')) {
      result = await this.fetchFromUrl(websiteUrl);
      if (result) {
        return result;
      }
    }

    // 如果 websiteUrl 是账号链接，尝试获取账号信息
    if (websiteUrl) {
      const websiteUrlType = TwitterExtractor.getTwitterUrlType(websiteUrl);
      if (websiteUrlType === 'account') {
        const username = TwitterExtractor.extractUsername(websiteUrl);
        if (username) {
          result = await this.fetchAccountInfo(username);
          if (result) {
            console.log(`[TwitterFetcher] 从 websiteUrl 成功获取账号信息: @${username}`);
            return result;
          }
        }
      }
    }

    return result;
  }
}

/**
 * 推特URL工具类
 */
export class TwitterExtractor {

  /**
   * 从推特URL中提取tweet_id
   */
  static extractTweetId(url) {
    if (!url) return null;

    const patterns = [
      /status\/(\d+)/,
      /statuses\/(\d+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 从推特账号链接中提取用户名
   * @param {string} url - 推特URL
   * @returns {string|null} 用户名（不含@）
   */
  static extractUsername(url) {
    if (!url) return null;

    // 匹配 x.com/username 或 twitter.com/username 格式
    // 排除包含 status 的推文链接
    const patterns = [
      /x\.com\/([\w-]+)$/,
      /twitter\.com\/([\w-]+)$/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && !url.includes('/status')) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 判断推特URL的类型
   * @param {string} url - 推特URL
   * @returns {string|null} 'tweet' | 'account' | null
   */
  static getTwitterUrlType(url) {
    if (!url) return null;

    // 推文链接：包含 status
    if (/status\/\d+/.test(url)) {
      return 'tweet';
    }

    // 账号链接：x.com/username 或 twitter.com/username
    if (/^https?:\/\/(x\.com|twitter\.com)\/[\w-]+$/.test(url)) {
      return 'account';
    }

    return null;
  }

  /**
   * 判断是否是有效的推特URL
   */
  static isValidTwitterUrl(url) {
    if (!url) return false;

    const patterns = [
      /^https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/,
      /^https?:\/\/(x\.com|twitter\.com)\/i\/status\/\d+/
    ];

    return patterns.some(pattern => pattern.test(url));
  }
}
