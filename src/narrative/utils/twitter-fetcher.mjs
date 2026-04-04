/**
 * 推文获取工具
 */

import twitterValidationModule from '../../utils/twitter-validation/index.js';
const { getTweetDetail, getTweetDetailGraphQL, getUserByScreenName } = twitterValidationModule;
import { fetchWebsiteContent, isFetchableUrl } from './web-fetcher.mjs';
import { TwitterMediaExtractor } from './twitter-media-extractor.mjs';

/**
 * 叙事分析Twitter用户黑名单
 * 这些用户专门制造虚假叙事糊弄人，应该过滤
 */
const NARRATIVE_TWITTER_BLACKLIST = [
  'Cortaviousloma1',  // 制造虚假叙事
  'goxpv32196782',    // 制造虚假叙事
  'Rajeeva_K',        // 制造虚假叙事
  'wagjp75362222',    // 制造虚假叙事
];

/**
 * 检查用户是否在黑名单中
 */
function isUserBlacklisted(username) {
  if (!username) return false;
  return NARRATIVE_TWITTER_BLACKLIST.includes(username);
}

/**
 * 格式化Twitter时间戳为易读格式
 * 输入: "Wed Dec 10 19:26:28 +0000 2025"
 * 输出: "2025年12月10日 19:26 (UTC)"
 */
function formatTwitterTime(timeStr) {
  if (!timeStr) return null;

  try {
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return timeStr;

    // 使用UTC时间，避免本地时区转换
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');

    return `${year}年${month}月${day}日 ${hours}:${minutes} (UTC)`;
  } catch (e) {
    return timeStr;
  }
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

      // 检查是否是 Article URL（直接的Article链接）
      const isDirectArticleUrl = twitterUrl.includes('/article/') || twitterUrl.includes('/i/article/');

      let tweetData;
      if (isDirectArticleUrl) {
        // 直接的 Article URL 使用 GraphQL API（获取 Article 详细内容）
        console.log('[TwitterFetcher] 检测到 Article URL，使用 GraphQL API');
        tweetData = await getTweetDetailGraphQL(tweetId);
      } else {
        // 普通推文使用 TweetDetail API（支持获取 related_tweet_id）
        tweetData = await getTweetDetail(tweetId);

        // 检查是否是 Article 推文（有 article_url 但无 article 内容）
        // Article 推文的特征：推文urls中包含 /i/article/ 链接
        const hasArticleUrl = (tweetData.urls || []).some(url =>
          url.includes('/x.com/i/article/') || url.includes('/twitter.com/i/article/')
        );

        if (tweetData && hasArticleUrl && !tweetData.article) {
          console.log('[TwitterFetcher] 检测到 Article 推文（URLs中有article链接但无article内容），使用 GraphQL API 获取完整内容');
          try {
            const graphqlData = await getTweetDetailGraphQL(tweetId);
            if (graphqlData && graphqlData.article) {
              // 将 GraphQL 返回的 article 内容合并到 tweetData
              tweetData.article = graphqlData.article;
              console.log(`[TwitterFetcher] 成功获取 Article 内容: "${graphqlData.article.title}"`);
            }
          } catch (err) {
            console.warn(`[TwitterFetcher] 获取 Article 内容失败，保留基本数据: ${err.message}`);
            // 继续使用已有的基本数据，不抛出错误
          }
        }
      }

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

      const rawCreatedAt = tweetData.created_at || tweetData.createdTimeStamp || null;

      // 统一处理媒体数据格式
      const normalizedMedia = TwitterFetcher.normalizeMediaData(tweetData);

      const result = {
        type: 'tweet',
        text: tweetData.text,
        author_name: tweetData.user?.name || tweetData.author_name || null,
        author_screen_name: tweetData.user?.screen_name || tweetData.author_screen_name || null,
        author_followers_count: tweetData.user?.followers_count || null,
        author_verified: tweetData.user?.verified || tweetData.user?.is_blue_verified || false,
        created_at: rawCreatedAt,
        formatted_created_at: formatTwitterTime(rawCreatedAt),
        tweet_id: tweetId,
        twitter_url: twitterUrl,
        metrics: {
          favorite_count: tweetData.favorite_count || tweetData.likeCount || 0,
          retweet_count: tweetData.retweet_count || tweetData.retweetCount || 0
        },
        // 媒体信息（统一格式）
        media: normalizedMedia,
        // Community数据（保留原始格式用于后续分析）
        community_results: tweetData.community_results || null
      };

      // 处理 Article 数据
      if (tweetData.article) {
        result.article = {
          id: tweetData.article.id,
          title: tweetData.article.title,
          preview_text: tweetData.article.preview_text,
          cover_image_url: tweetData.article.cover_image_url,
          // Article富文本内容（如果有）
          rich_content_state: tweetData.article.rich_content_state || null,
          // Article纯文本内容（如果有）
          plain_text: tweetData.article.plain_text || null
        };
        console.log(`[TwitterFetcher] 检测到 Twitter Article: "${tweetData.article.title}"`);
        if (tweetData.article.plain_text) {
          console.log(`[TwitterFetcher] Article 纯文本内容长度: ${tweetData.article.plain_text.length} 字符`);
        }
      }

      // 处理引用推文数据
      if (tweetData.quoted_status) {
        const quoted = tweetData.quoted_status;
        const rawCreatedAt = quoted.created_at || quoted.createdTimeStamp || null;
        const quotedMedia = TwitterFetcher.normalizeMediaData(quoted);
        result.quoted_status = {
          text: quoted.text,
          author_name: quoted.user?.name || null,
          author_screen_name: quoted.user?.screen_name || null,
          author_followers_count: quoted.user?.followers_count || null,
          author_verified: quoted.user?.verified || quoted.user?.is_blue_verified || false,
          created_at: rawCreatedAt,
          formatted_created_at: formatTwitterTime(rawCreatedAt),
          tweet_id: quoted.tweet_id,
          metrics: {
            favorite_count: quoted.likeCount || 0,
            retweet_count: quoted.retweetCount || 0
          },
          media: quotedMedia
        };
        console.log(`[TwitterFetcher] 检测到引用推文: @${result.quoted_status.author_screen_name} - ${result.quoted_status.text.substring(0, 50)}...`);
      }

      // 处理转发推文数据
      if (tweetData.retweeted_status) {
        const retweeted = tweetData.retweeted_status;
        const rawCreatedAt = retweeted.created_at || retweeted.createdTimeStamp || null;
        const retweetedMedia = TwitterFetcher.normalizeMediaData(retweeted);
        result.retweeted_status = {
          text: retweeted.text,
          author_name: retweeted.user?.name || null,
          author_screen_name: retweeted.user?.screen_name || null,
          author_followers_count: retweeted.user?.followers_count || null,
          author_verified: retweeted.user?.verified || retweeted.user?.is_blue_verified || false,
          created_at: rawCreatedAt,
          formatted_created_at: formatTwitterTime(rawCreatedAt),
          tweet_id: retweeted.tweet_id,
          metrics: {
            favorite_count: retweeted.likeCount || 0,
            retweet_count: retweeted.retweetCount || 0
          },
          media: retweetedMedia
        };
        console.log(`[TwitterFetcher] 检测到转发推文: @${result.retweeted_status.author_screen_name} - ${result.retweeted_status.text.substring(0, 50)}...`);
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
      // getTweetDetail API 使用 related_tweet_id（conversation_id）
      // getTweetDetailGraphQL API 使用 reply_to_tweet_id
      // 注意：即使 is_reply=false，只要有 related_tweet_id 就尝试获取
      // 这是因为API有时返回 is_reply=false 但实际有 conversation 关系
      const replyToTweetId = tweetData.related_tweet_id || tweetData.reply_to_tweet_id;
      if (replyToTweetId && replyToTweetId !== tweetId) {
        console.log(`[TwitterFetcher] 检测到相关推文，尝试获取: ${replyToTweetId}`);
        try {
          // 使用 getTweetDetail 获取被回复的推文（即使原推文来自 GraphQL API）
          const originalTweet = await getTweetDetail(replyToTweetId);
          if (originalTweet && originalTweet.text) {
            console.log(`[TwitterFetcher] 成功获取原始推文: ${originalTweet.text.substring(0, 50)}...`);
            const rawCreatedAt = originalTweet.created_at || null;
            const originalMedia = TwitterFetcher.normalizeMediaData(originalTweet);
            result.in_reply_to = {
              text: originalTweet.text,
              author_name: originalTweet.user?.name || null,
              author_screen_name: originalTweet.user?.screen_name || null,
              author_followers_count: originalTweet.user?.followers_count || null,
              created_at: rawCreatedAt,
              formatted_created_at: formatTwitterTime(rawCreatedAt),
              tweet_id: replyToTweetId,
              media: originalMedia
            };
          }
        } catch (err) {
          console.warn(`[TwitterFetcher] 获取原始推文失败: ${err.message}`);
        }
      }

      // 检测"提及推文"关系：推文以@某人开头
      // 简化逻辑：默认与被@的用户有关系
      const mentionMatch = tweetData.text?.match(/^@(\w{1,15})/);
      if (mentionMatch && !result.in_reply_to && !result.quoted_status) {
        const mentionedScreenName = mentionMatch[1];
        // 只有当被提及的用户不是当前作者时才建立关系
        if (mentionedScreenName !== tweetData.user?.screen_name) {
          console.log(`[TwitterFetcher] 推文@了@${mentionedScreenName}，建立提及关系`);
          result.mentions_user = {
            screen_name: mentionedScreenName,
            // 注意：这里假设有关系，但不获取具体推文内容
            // 评估时应该关注发布者和被@者的影响力
          };
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

      const rawCreatedAt = userInfo.created_at || '';
      return {
        type: 'account',
        id: userInfo.id || '',
        screen_name: userInfo.screen_name || '',
        name: userInfo.name || '',
        description: userInfo.description || '',
        followers_count: userInfo.followers_count || 0,
        verified: userInfo.verified || false,
        is_blue_verified: userInfo.is_blue_verified || false,
        statuses_count: userInfo.statuses_count || 0,
        created_at: rawCreatedAt,
        formatted_created_at: formatTwitterTime(rawCreatedAt),
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
      // 跳过Twitter/X自身的链接（但需要展开t.co短链接）
      if (url.includes('x.com') || url.includes('twitter.com')) {
        continue;
      }
      // 对于t.co短链接，展开后再判断
      if (url.includes('t.co/')) {
        try {
          console.log(`[TwitterFetcher] 展开t.co短链接: ${url}`);
          const expandedUrl = await this.expandShortUrl(url);
          if (expandedUrl) {
            console.log(`[TwitterFetcher] 短链接展开为: ${expandedUrl}`);
            // 将展开后的URL添加到推文文本中（用于实体提取）
            if (!tweetInfo.expanded_urls) {
              tweetInfo.expanded_urls = [];
            }
            tweetInfo.expanded_urls.push({ short: url, expanded: expandedUrl });

            // 如果展开后的URL是另一个推文，标记它以便后续获取
            if (expandedUrl.includes('x.com') || expandedUrl.includes('twitter.com')) {
              const tweetIdMatch = expandedUrl.match(/status\/(\d+)/);
              if (tweetIdMatch) {
                tweetInfo.expanded_tweet_url = expandedUrl;
                console.log(`[TwitterFetcher] 短链接展开为推文，标记待获取: ${expandedUrl}`);
                // 不要continue，让后续逻辑处理这个推文链接
              }
            }
          }
        } catch (e) {
          console.log(`[TwitterFetcher] 展开短链接失败: ${e.message}`);
        }
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
   * 展开短链接（t.co等）
   * @param {string} shortUrl - 短链接
   * @returns {Promise<string>} 展开后的URL
   */
  static async expandShortUrl(shortUrl) {
    try {
      const response = await fetch(shortUrl, {
        method: 'HEAD',
        redirect: 'manual', // 手动处理重定向
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // 获取重定向后的URL
      const location = response.headers.get('location');
      if (location) {
        return location;
      }

      // 如果HEAD请求没有返回location，尝试GET请求
      const getResponse = await fetch(shortUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      return getResponse.headers.get('location') || shortUrl;
    } catch (error) {
      console.log(`[TwitterFetcher] 展开短链接失败: ${error.message}`);
      return null;
    }
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

    // 返回增强后的推文信息，包括链接内容和展开的URL
    return {
      ...tweetInfo,
      link_content: linkContent,
      expanded_urls: tweetInfo.expanded_urls || null
    };
  }

  /**
   * 统一处理媒体数据格式
   * getTweetDetail 返回 medias (字符串数组)
   * getTweetDetailGraphQL 返回 media (对象，包含images/videos/has_media)
   *
   * @param {Object} tweetData - 原始推文数据
   * @returns {Object|null} 统一格式的媒体对象
   */
  static normalizeMediaData(tweetData) {
    if (!tweetData) return null;

    // 情况1: GraphQL API 返回的 media 对象（已有正确格式）
    if (tweetData.media && typeof tweetData.media === 'object') {
      return tweetData.media;
    }

    // 情况2: getTweetDetail 返回的 medias 数组（字符串数组）
    if (tweetData.medias && Array.isArray(tweetData.medias) && tweetData.medias.length > 0) {
      const images = tweetData.medias
        .filter(url => typeof url === 'string' && url.length > 0)
        .map(url => ({ url }));

      return {
        images: images,
        videos: [],
        has_media: images.length > 0
      };
    }

    // 没有媒体
    return null;
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

    // 先移除查询参数，只保留路径部分
    let pathOnly = url;
    try {
      const urlObj = new URL(url);
      pathOnly = urlObj.pathname; // 只获取路径部分，如 /username
    } catch {
      // URL解析失败，使用原URL
    }

    // 排除包含 status 的推文链接
    if (url.includes('/status')) {
      return null;
    }

    // 匹配 x.com/username 或 twitter.com/username 格式
    const patterns = [
      /\/([\w-]+)$/,  // 匹配路径末尾的用户名
    ];

    for (const pattern of patterns) {
      const match = pathOnly.match(pattern);
      if (match) {
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
    // 先移除查询参数再判断
    try {
      const urlObj = new URL(url);
      const pathOnly = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
      if (/^https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/?$/.test(pathOnly)) {
        return 'account';
      }
    } catch {
      // URL解析失败，继续
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
