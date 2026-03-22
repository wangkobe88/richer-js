/**
 * 推文获取工具
 */

import twitterValidationModule from '../../utils/twitter-validation/index.js';
const { getTweetDetail, getTweetDetailGraphQL, getUserByScreenName } = twitterValidationModule;
import { fetchWebsiteContent, isFetchableUrl } from './web-fetcher.mjs';

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

      // 检查是否是 Article URL，如果是使用 GraphQL API
      const isArticleUrl = twitterUrl.includes('/article/') || twitterUrl.includes('/i/article/');

      // 使用 GraphQL API 获取推文详情（支持 Article）
      const tweetData = await getTweetDetailGraphQL(tweetId);

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

      const result = {
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

      // 处理 Article 数据
      if (tweetData.article) {
        result.article = {
          id: tweetData.article.id,
          title: tweetData.article.title,
          preview_text: tweetData.article.preview_text,
          cover_image_url: tweetData.article.cover_image_url
        };
        console.log(`[TwitterFetcher] 检测到 Twitter Article: "${tweetData.article.title}"`);
      }

      // 检查是否包含 Article 链接（作为备用）
      const articleUrl = (tweetData.urls || []).find(url =>
        url.includes('/x.com/i/article/') || url.includes('/twitter.com/i/article/')
      );
      if (articleUrl && !result.article) {
        result.article_url = articleUrl;
        console.log(`[TwitterFetcher] 检测到 Twitter Article 链接: ${articleUrl}`);
      }

      // 如果是回复推文，获取原始推文
      if (tweetData.is_reply && tweetData.reply_to_tweet_id) {
        console.log(`[TwitterFetcher] 这是回复推文，尝试获取原始推文: ${tweetData.reply_to_tweet_id}`);
        try {
          const originalTweet = await getTweetDetailGraphQL(tweetData.reply_to_tweet_id);
          if (originalTweet && originalTweet.text) {
            console.log(`[TwitterFetcher] 成功获取原始推文`);
            result.in_reply_to = {
              text: originalTweet.text,
              author_name: originalTweet.user?.name || null,
              author_screen_name: originalTweet.user?.screen_name || null,
              created_at: originalTweet.created_at || null,
              tweet_id: tweetData.reply_to_tweet_id,
              article: originalTweet.article || null
            };
          }
        } catch (err) {
          console.warn(`[TwitterFetcher] 获取原始推文失败: ${err.message}`);
        }
      }

      return result;
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

  /**
   * 从推文中提取并获取链接内容
   * @param {Object} tweetInfo - 推文信息（包含text字段）
   * @returns {Promise<Object>} 链接内容信息
   */
  static async fetchTweetLinks(tweetInfo) {
    if (!tweetInfo || !tweetInfo.text) {
      return null;
    }

    // 从推文中提取所有URL
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = tweetInfo.text.match(urlRegex);

    if (!urls || urls.length === 0) {
      return null;
    }

    console.log(`[TwitterFetcher] 推文中发现 ${urls.length} 个链接`);

    // 只获取第一个有效的URL内容（避免耗时过长）
    for (const url of urls) {
      // 跳过Twitter/X自身的链接（包括Article，因为需要JS渲染）
      if (url.includes('x.com') || url.includes('twitter.com') || url.includes('t.co/')) {
        continue;
      }

      // 检查是否是可以获取的URL
      if (!isFetchableUrl(url)) {
        console.log(`[TwitterFetcher] 跳过不可获取的URL: ${url}`);
        continue;
      }

      console.log(`[TwitterFetcher] 尝试获取推文链接内容: ${url}`);
      const linkContent = await fetchWebsiteContent(url, { maxLength: 3000, timeout: 10000 });

      if (linkContent && linkContent.content) {
        console.log(`[TwitterFetcher] 成功获取链接内容，长度: ${linkContent.content.length} 字符`);
        return linkContent;
      }
    }

    console.log('[TwitterFetcher] 未能获取任何有效的链接内容');
    return null;
  }

  /**
   * 增强推文信息，包含链接内容
   * @param {Object} tweetInfo - 原始推文信息
   * @returns {Promise<Object>} 增强后的推文信息
   */
  static async enrichWithLinkContent(tweetInfo) {
    if (!tweetInfo) {
      return tweetInfo;
    }

    const linkContent = await this.fetchTweetLinks(tweetInfo);

    return {
      ...tweetInfo,
      link_content: linkContent
    };
  }
}

/**
 * 推特URL工具类
 */
export class TwitterExtractor {

  /**
   * 从推特URL中提取tweet_id
   * 支持格式：
   * - x.com/username/status/123456
   * - x.com/i/article/123456
   * - x.com/article/123456 (部分格式)
   */
  static extractTweetId(url) {
    if (!url) return null;

    const patterns = [
      /status\/(\d+)/,
      /statuses\/(\d+)/,
      /article\/(\d+)/,      // 支持 /article/ 格式
      /\/i\/article\/(\d+)/  // 支持 /i/article/ 格式
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
   * 支持推文、Article等格式
   */
  static isValidTwitterUrl(url) {
    if (!url) return false;

    const patterns = [
      /^https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/,
      /^https?:\/\/(x\.com|twitter\.com)\/i\/status\/\d+/,
      /^https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/article\/\d+/,  // Article格式
      /^https?:\/\/(x\.com|twitter\.com)\/i\/article\/\d+/,      // /i/article/格式
      /^https?:\/\/(x\.com|twitter\.com)\/article\/\d+/          // /article/格式
    ];

    return patterns.some(pattern => pattern.test(url));
  }
}
