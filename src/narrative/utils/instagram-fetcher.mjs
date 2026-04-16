/**
 * Instagram 信息获取工具
 * 使用 JustOneAPI 获取帖子和用户信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_POST_URL = 'https://api.justoneapi.com/api/instagram/post-details/v1';
const JUSTONEAPI_USER_URL = 'https://api.justoneapi.com/api/instagram/user-profile/v1';

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * Instagram 信息提取器
 */
export class InstagramFetcher {

  /**
   * 从 Instagram URL 中提取帖子 shortcode
   * 支持格式：
   * - instagram.com/p/{shortcode}/
   * - instagram.com/reel/{shortcode}/
   * - instagram.com/reels/{shortcode}/
   * - instagr.am/p/{shortcode}/
   * @param {string} url - Instagram URL
   * @returns {string|null} shortcode
   */
  static extractShortcode(url) {
    if (!url) return null;
    const match = url.match(/(?:instagram\.com|instagr\.am)\/(?:p|reel|reels)\/([\w-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * 从 Instagram URL 中提取用户名
   * 支持格式：instagram.com/{username}/
   * 排除系统路径
   * @param {string} url - Instagram URL
   * @returns {string|null} username
   */
  static extractUsername(url) {
    if (!url) return null;
    const match = url.match(/instagram\.com\/([\w.]+)\/?$/i);
    if (!match) return null;

    const username = match[1];
    // 排除系统路径
    const systemPaths = [
      'explore', 'accounts', 'direct', 'stories', 'reels', 'p',
      'reel', 'login', 'signup', 'legal', 'about', 'developer',
      'help', 'api', 'static', 'cdn', 'graphql', 'query'
    ];
    if (systemPaths.includes(username.toLowerCase())) return null;
    return username;
  }

  /**
   * 判断是否是有效的 Instagram URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidInstagramUrl(url) {
    if (!url) return false;
    return /instagram\.com|instagr\.am/i.test(url);
  }

  /**
   * 使用 JustOneAPI Post Details V1 获取帖子详细信息
   * @param {string} shortcode - Instagram 帖子 shortcode
   * @returns {Promise<Object|null>} 帖子信息
   */
  static async fetchPostDetails(shortcode) {
    const url = `${JUSTONEAPI_POST_URL}?token=${JUSTONEAPI_KEY}&code=${shortcode}`;
    const REQUEST_TIMEOUT = 30000;

    try {
      console.log(`[InstagramFetcher] 请求帖子API: shortcode=${shortcode}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[InstagramFetcher] 帖子API HTTP错误:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('[InstagramFetcher] 帖子API响应:', JSON.stringify({ code: data.code, message: data.message, hasData: !!data.data }));

      if (data.code !== 0) {
        console.warn('[InstagramFetcher] 帖子API返回错误:', data.code, data.message);
        return null;
      }

      if (!data.data) {
        console.warn('[InstagramFetcher] 帖子数据为空');
        return null;
      }

      const item = data.data;
      const mediaType = item.media_type || 1; // 1=图片, 2=视频
      const isReel = item.media_name === 'reel' || mediaType === 2;

      // 互动数据
      const metrics = item.metrics || {};
      const likeCount = metrics.like_count || 0;
      const commentCount = metrics.comment_count || 0;
      const playCount = metrics.play_count || metrics.ig_play_count || 0;
      const shareCount = metrics.share_count || 0;

      // 用户信息
      const user = item.user || {};

      // 时间
      const takenAt = item.taken_at
        ? (typeof item.taken_at === 'number'
          ? new Date(item.taken_at * 1000).toISOString()
          : item.taken_at)
        : '';

      // 标签和提及
      const caption = item.caption || {};
      const hashtags = caption.hashtags || [];
      const mentions = caption.mentions || [];

      const result = {
        type: isReel ? 'reel' : 'post',
        shortcode: shortcode,
        caption: caption.text || '',
        media_type: mediaType,
        media_name: item.media_name || '',
        user: {
          username: user.username || '',
          full_name: user.full_name || '',
          is_verified: user.is_verified || false
        },
        metrics: {
          like_count: likeCount,
          comment_count: commentCount,
          play_count: playCount,
          share_count: shareCount
        },
        taken_at: takenAt,
        thumbnail_url: item.thumbnail_url || '',
        hashtags: hashtags,
        mentions: mentions,
        fetched_via: 'justoneapi'
      };

      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);

      console.log(`[InstagramFetcher] 成功获取${isReel ? ' Reel' : '帖子'}: @${result.user.username} (${likeCount}赞, ${commentCount}评论)`);
      return result;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[InstagramFetcher] 帖子API请求超时（30秒）');
      } else {
        console.error('[InstagramFetcher] 帖子API获取失败:', error.message);
      }
      return null;
    }
  }

  /**
   * 使用 JustOneAPI User Profile V1 获取用户主页信息
   * @param {string} username - Instagram 用户名
   * @returns {Promise<Object|null>} 用户信息
   */
  static async fetchUserProfile(username) {
    const url = `${JUSTONEAPI_USER_URL}?token=${JUSTONEAPI_KEY}&username=${encodeURIComponent(username)}`;
    const REQUEST_TIMEOUT = 30000;

    try {
      console.log(`[InstagramFetcher] 请求用户API: username=${username}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[InstagramFetcher] 用户API HTTP错误:', response.status);
        return null;
      }

      const data = await response.json();
      console.log('[InstagramFetcher] 用户API响应:', JSON.stringify({ code: data.code, message: data.message, hasData: !!data.data }));

      if (data.code !== 0) {
        console.warn('[InstagramFetcher] 用户API返回错误:', data.code, data.message);
        return null;
      }

      if (!data.data) {
        console.warn('[InstagramFetcher] 用户数据为空');
        return null;
      }

      const userData = data.data;
      const about = userData.about || {};

      const result = {
        type: 'user_profile',
        username: userData.username || username,
        full_name: userData.full_name || '',
        biography: userData.biography || '',
        follower_count: userData.follower_count || 0,
        following_count: userData.following_count || 0,
        media_count: userData.media_count || 0,
        is_verified: userData.is_verified || about.is_verified || false,
        profile_pic_url_hd: userData.profile_pic_url_hd || '',
        external_url: userData.external_url || '',
        bio_links: userData.bio_links || [],
        date_joined: about.date_joined || '',
        date_joined_timestamp: about.date_joined_as_timestamp || null,
        fetched_via: 'justoneapi'
      };

      console.log(`[InstagramFetcher] 成功获取用户: @${result.username} (粉丝${result.follower_count}, 帖子${result.media_count})`);
      return result;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[InstagramFetcher] 用户API请求超时（30秒）');
      } else {
        console.error('[InstagramFetcher] 用户API获取失败:', error.message);
      }
      return null;
    }
  }

  /**
   * 获取 Instagram 帖子信息（带缓存）
   * @param {string} url - Instagram 帖子 URL
   * @returns {Promise<Object|null>} 帖子信息
   */
  static async fetchPostInfo(url) {
    if (!url) return null;

    return CachedFetcher.fetchWithCache(
      url, 'instagram',
      async () => this._fetchPostInfoInternal(url),
      getCacheTTL('instagram')
    );
  }

  /**
   * 获取 Instagram 帖子信息（实际API调用）
   */
  static async _fetchPostInfoInternal(url) {
    const shortcode = this.extractShortcode(url);
    if (!shortcode) {
      console.warn('[InstagramFetcher] 无法从URL中提取shortcode:', url);
      return null;
    }

    console.log(`[InstagramFetcher] 获取帖子信息: ${shortcode}`);
    return await this.fetchPostDetails(shortcode);
  }

  /**
   * 获取 Instagram 用户信息（带缓存）
   * @param {string} url - Instagram 用户主页 URL
   * @returns {Promise<Object|null>} 用户信息
   */
  static async fetchProfileInfo(url) {
    if (!url) return null;

    return CachedFetcher.fetchWithCache(
      url, 'instagram_user',
      async () => this._fetchProfileInfoInternal(url),
      getCacheTTL('instagram_user')
    );
  }

  /**
   * 获取 Instagram 用户信息（实际API调用）
   */
  static async _fetchProfileInfoInternal(url) {
    const username = this.extractUsername(url);
    if (!username) {
      console.warn('[InstagramFetcher] 无法从URL中提取username:', url);
      return null;
    }

    console.log(`[InstagramFetcher] 获取用户信息: @${username}`);
    return await this.fetchUserProfile(username);
  }

  /**
   * 获取帖子影响力等级
   * @param {Object} postInfo - 帖子信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(postInfo) {
    if (!postInfo) return 'unknown';

    const likes = postInfo.metrics?.like_count || 0;
    const comments = postInfo.metrics?.comment_count || 0;
    const plays = postInfo.metrics?.play_count || 0;

    const metric = Math.max(plays, likes * 5, comments * 50);

    if (metric >= 10000000) return 'world_class';   // 1000万+
    if (metric >= 1000000) return 'viral';            // 100万+
    if (metric >= 100000) return 'mega_viral';        // 10万+
    if (metric >= 10000) return 'super_viral';        // 1万+
    if (metric >= 1000) return 'popular';             // 1000+
    if (metric >= 100) return 'community_level';      // 100+
    return 'niche_level';                             // 100以下
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（1000万+互动）',
      'viral': '病毒传播级影响力（100万+互动）',
      'mega_viral': '超级病毒传播级（10万+互动）',
      'super_viral': '高度病毒传播级（1万+互动）',
      'popular': '热门级影响力（1000+互动）',
      'community_level': '社区级影响力（100+互动）',
      'niche_level': '小众级影响力（100以下互动）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }
}
