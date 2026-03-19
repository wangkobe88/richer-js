/**
 * 推文获取工具
 */

import twitterValidationModule from '../../utils/twitter-validation/index.js';
const { getTweetDetail } = twitterValidationModule;

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

      return {
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
   * 从多个URL尝试获取推文（备用方案）
   */
  static async fetchFromUrls(twitterUrl, websiteUrl) {
    // 优先尝试 twitterUrl
    let result = await this.fetchFromUrl(twitterUrl);
    if (result) {
      return result;
    }

    // 如果 websiteUrl 也是推特链接，尝试获取
    if (websiteUrl && websiteUrl.includes('x.com') && websiteUrl.includes('status')) {
      result = await this.fetchFromUrl(websiteUrl);
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
