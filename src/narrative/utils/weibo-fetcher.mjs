/**
 * 微博获取工具
 * 使用 RapidAPI 的 Weibo All API
 */

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';

const RAPIDAPI_KEY = 'b2d183d4cbmshe79b303f1de4b64p18e56ejsna95529b3f9ef';
const RAPIDAPI_HOST = 'weibo-all-api.p.rapidapi.com';

/**
 * 微博URL工具类
 */
export class WeiboExtractor {

  /**
   * 从微博URL中提取微博ID
   * @param {string} url - 微博URL
   * @returns {string|null} 微博ID
   */
  static extractWeiboId(url) {
    if (!url) return null;

    // 匹配 weibo.com/uid/weiboid 格式
    const match = url.match(/weibo\.com\/\d+\/([a-zA-Z0-9]+)/);
    if (match) {
      return match[1];
    }

    // 匹配 m.weibo.cn/detail/xxx 格式
    const mobileMatch = url.match(/m\.weibo\.cn\/detail\/([a-zA-Z0-9]+)/);
    if (mobileMatch) {
      return mobileMatch[1];
    }

    return null;
  }

  /**
   * 从微博URL中提取用户ID
   * @param {string} url - 微博URL
   * @returns {string|null} 用户ID
   */
  static extractUserId(url) {
    if (!url) return null;

    // 匹配 weibo.com/uid/weiboid 或 weibo.com/u/uid 格式
    const match = url.match(/weibo\.com\/(\d+)/);
    if (match) {
      return match[1];
    }

    const uMatch = url.match(/weibo\.com\/u\/(\d+)/);
    if (uMatch) {
      return uMatch[1];
    }

    return null;
  }

  /**
   * 判断是否是有效的微博URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidWeiboUrl(url) {
    if (!url) return false;

    return /weibo\.com/.test(url) && /\/[a-zA-Z0-9]+$/.test(url);
  }
}

/**
 * 微博获取器
 */
export class WeiboFetcher {

  /**
   * 从微博URL获取微博内容
   * @param {string} weiboUrl - 微博URL
   * @returns {Promise<Object|null>} 微博信息
   */
  static async fetchFromUrl(weiboUrl) {
    return CachedFetcher.fetchWithCache(
      weiboUrl,
      'weibo',
      async (url) => {
        return this._fetchWeiboContent(url);
      },
      { maxAge: 7 * 24 * 60 * 60, ttl: 30 * 24 * 60 * 60 } // 缓存7天，保存30天
    );
  }

  /**
   * 实际获取微博内容
   * @param {string} weiboUrl - 微博URL
   * @returns {Promise<Object|null>}
   * @private
   */
  static async _fetchWeiboContent(weiboUrl) {
    if (!weiboUrl) {
      return null;
    }

    try {
      // 提取微博ID
      const weiboId = WeiboExtractor.extractWeiboId(weiboUrl);
      if (!weiboId) {
        console.warn('[WeiboFetcher] 无法提取微博ID:', weiboUrl);
        return null;
      }

      console.log(`[WeiboFetcher] 获取微博内容: ${weiboId}`);

      // 调用 RapidAPI
      const apiUrl = `https://${RAPIDAPI_HOST}/api/weibo/get-weibo-detail/v1?id=${encodeURIComponent(weiboId)}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // 检查返回状态
      if (data.code !== 0) {
        console.warn('[WeiboFetcher] API返回错误:', data.message);
        return null;
      }

      if (!data.data || !data.data.status) {
        console.warn('[WeiboFetcher] 微博数据为空');
        return null;
      }

      const status = data.data.status;

      // 格式化返回结果
      const result = {
        type: 'weibo',
        weibo_id: status.id || status.mid,
        bid: status.bid, // 短链接ID
        text: this._cleanHtml(status.text),
        author_name: status.user?.screen_name,
        author_user_id: status.user?.id?.toString(),
        author_avatar: status.user?.profile_image_url,
        author_description: status.user?.description,
        author_followers_count: parseInt(status.user?.followers_count) || 0,
        author_verified: status.user?.verified || false,
        author_verified_reason: status.user?.verified_reason,
        created_at: status.created_at,
        weibo_url: weiboUrl,
        metrics: {
          reposts_count: status.reposts_count || 0,
          comments_count: status.comments_count || 0,
          attitudes_count: status.attitudes_count || 0
        },
        raw: status // 保留原始数据
      };

      console.log(`[WeiboFetcher] 成功获取微博: ${result.author_name} - ${result.text.substring(0, 50)}...`);
      return result;

    } catch (error) {
      console.error('[WeiboFetcher] 获取微博失败:', error.message);
      throw error;
    }
  }

  /**
   * 清理HTML标签
   * @param {string} html - HTML字符串
   * @returns {string} 纯文本
   * @private
   */
  static _cleanHtml(html) {
    if (!html) return '';

    // 移除HTML标签但保留文本内容
    let text = html
      .replace(/<a[^>]*>/gi, '')
      .replace(/<\/a>/gi, '')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<img[^>]*>/gi, '[图片]')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');

    // 移除多余的空格和换行
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * 从微博URL获取用户信息
   * @param {string} weiboUrl - 微博URL
   * @returns {Promise<Object|null>} 用户信息
   */
  static async fetchAccountInfo(weiboUrl) {
    return CachedFetcher.fetchWithCache(
      weiboUrl,
      'weibo_user',
      async (url) => {
        return this._fetchUserInfo(url);
      },
      { maxAge: 7 * 24 * 60 * 60, ttl: 30 * 24 * 60 * 60 }
    );
  }

  /**
   * 实际获取用户信息
   * @param {string} weiboUrl - 微博URL
   * @returns {Promise<Object|null>}
   * @private
   */
  static async _fetchUserInfo(weiboUrl) {
    if (!weiboUrl) {
      return null;
    }

    try {
      // 提取用户ID
      const userId = WeiboExtractor.extractUserId(weiboUrl);
      if (!userId) {
        console.warn('[WeiboFetcher] 无法提取用户ID:', weiboUrl);
        return null;
      }

      console.log(`[WeiboFetcher] 获取用户信息: ${userId}`);

      // 调用 RapidAPI
      const apiUrl = `https://${RAPIDAPI_HOST}/api/weibo/get-user-detail/v3?uid=${encodeURIComponent(userId)}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // 检查返回状态
      if (data.code !== 0) {
        console.warn('[WeiboFetcher] API返回错误:', data.message);
        return null;
      }

      if (!data.data) {
        console.warn('[WeiboFetcher] 用户数据为空');
        return null;
      }

      const userInfo = data.data;

      // 格式化返回结果
      const result = {
        type: 'weibo_account',
        user_id: userInfo.id?.toString(),
        screen_name: userInfo.screen_name,
        name: userInfo.name,
        description: userInfo.description,
        profile_image_url: userInfo.profile_image_url,
        cover_image: userInfo.cover_image_phone,
        followers_count: parseInt(userInfo.followers_count) || 0,
        follow_count: userInfo.follow_count || 0,
        statuses_count: userInfo.statuses_count || 0,
        verified: userInfo.verified || false,
        verified_reason: userInfo.verified_reason,
        verified_type: userInfo.verified_type,
        gender: userInfo.gender === 'm' ? 'male' : userInfo.gender === 'f' ? 'female' : 'unknown',
        location: userInfo.location,
        url: userInfo.url,
        raw: userInfo
      };

      console.log(`[WeiboFetcher] 成功获取用户: ${result.screen_name} (${result.followers_count} 粉丝)`);
      return result;

    } catch (error) {
      console.error('[WeiboFetcher] 获取用户信息失败:', error.message);
      throw error;
    }
  }
}
