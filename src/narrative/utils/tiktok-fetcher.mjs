/**
 * TikTok信息获取工具
 * 使用 JustOneAPI 的TikTok接口
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/tiktok/get-post-detail/v1';
const TIKTOK_USER_PROFILE_URL = 'https://api.justoneapi.com/api/tiktok/get-user-detail/v1';

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * 从TikTok URL中提取视频ID
 * 支持格式：
 * - https://www.tiktok.com/@username/video/1234567890
 * - https://tiktok.com/@username/video/1234567890
 * - https://vm.tiktok.com/CODE (短链接，需解析)
 * @param {string} url - TikTok URL
 * @returns {Promise<string|null>} 视频ID
 */
async function extractTikTokVideoId(url) {
  if (!url) return null;

  // 检查是否是短链接（vm.tiktok.com）
  if (url.includes('vm.tiktok.com')) {
    try {
      console.log('[TikTokFetcher] 检测到短链接，尝试解析...');
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // 获取重定向后的真实URL
      const realUrl = response.url || url;
      console.log('[TikTokFetcher] 短链接解析为:', realUrl);

      // 从真实URL中提取视频ID（递归调用）
      return await extractTikTokVideoId(realUrl);
    } catch (error) {
      console.warn('[TikTokFetcher] 短链接解析失败:', error.message);
      return null;
    }
  }

  // 标准格式：/@username/video/1234567890
  const standardMatch = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  if (standardMatch) {
    return standardMatch[1];
  }

  return null;
}

/**
 * 使用 JustOneAPI 获取TikTok视频详细信息
 * @param {string} videoId - TikTok视频ID
 * @returns {Promise<Object>} 视频信息
 */
async function fetchViaJustOneAPI(videoId) {
  const url = `${JUSTONEAPI_URL}?token=${JUSTONEAPI_KEY}&postId=${videoId}`;

  const response = await fetch(url);

  if (!response.ok) {
    console.warn('[TikTokFetcher] JustOneAPI 请求失败:', response.status);
    return null;
  }

  const data = await response.json();

  if (!data || data.code !== 0 || !data.data) {
    console.warn('[TikTokFetcher] JustOneAPI 返回错误:', data?.msg || '未知错误', 'code:', data?.code);
    return null;
  }

  return data.data;
}

/**
 * 获取TikTok视频信息
 * @param {string} url - TikTok视频URL
 * @returns {Promise<Object>} 视频信息
 */
export async function fetchTikTokVideoInfo(url) {
  return CachedFetcher.fetchWithCache(url, 'tiktok', async () => _fetchTikTokVideoInfoInternal(url), getCacheTTL('tiktok'));
}

/**
 * fetchTikTokVideoInfo 的内部实现
 */
async function _fetchTikTokVideoInfoInternal(url) {
  if (!url) {
    return null;
  }

  console.log(`[TikTokFetcher] 获取TikTok视频信息: ${url}`);

  try {
    // 提取视频ID
    const videoId = await extractTikTokVideoId(url);

    if (!videoId) {
      console.warn('[TikTokFetcher] 无法提取视频ID:', url);
      return null;
    }

    // 使用 JustOneAPI 获取视频信息
    const data = await fetchViaJustOneAPI(videoId);

    if (!data) {
      return null;
    }

    // 解析返回的数据 - JustOneAPI 返回结构: data.itemInfo.itemStruct
    const itemStruct = data.itemInfo?.itemStruct || {};
    const author = itemStruct.author || {};
    const stats = itemStruct.stats || {};

    const result = {
      type: 'tiktok',
      url: url,
      video_id: videoId,
      description: itemStruct.desc || '',
      author_name: author.nickname || author.name || '',
      author_username: author.uniqueId || author.username || '',
      // 统计信息 - API使用camelCase
      view_count: stats.playCount || 0,
      like_count: stats.diggCount || 0,
      comment_count: stats.commentCount || 0,
      share_count: stats.shareCount || 0,
      // 作者粉丝数
      author_followers: itemStruct.authorStats?.followerCount || 0,
      // 音乐信息
      music_title: itemStruct.music?.title || '',
      music_author: itemStruct.music?.author || '',
      // 缩略图
      cover_url: itemStruct.video?.cover || itemStruct.cover || '',
      // 来源标记
      fetched_via: 'justoneapi'
    };

    console.log(`[TikTokFetcher] 成功获取TikTok视频信息: @${result.author_username} - ${result.description.substring(0, 50)}...`);
    console.log(`   播放: ${result.view_count}, 点赞: ${result.like_count}, 评论: ${result.comment_count}`);

    return result;

  } catch (error) {
    console.error(`[TikTokFetcher] 获取失败: ${error.message}`);
    return null;
  }
}

/**
 * 判断是否是TikTok URL
 * @param {string} url - URL
 * @returns {boolean} 是否是TikTok URL
 */
export function isTikTokUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  return /tiktok\.com/i.test(url);
}

// ========== 用户主页方法 ==========

/**
 * 从 TikTok 用户主页 URL 中提取用户名
 * 支持格式：tiktok.com/@username
 * @param {string} url - TikTok 用户主页 URL
 * @returns {string|null} 用户名（不含@）
 */
export function extractTikTokUsername(url) {
  if (!url) return null;
  const match = url.match(/tiktok\.com\/@([\w.-]+)/);
  return match ? match[1] : null;
}

/**
 * 判断是否是 TikTok 用户主页 URL
 * 区别于视频链接：tiktok.com/@username（无 /video/ 路径）
 * @param {string} url - URL
 * @returns {boolean}
 */
export function isTikTokUserProfileUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // 匹配 tiktok.com/@username 但不含 /video/
  return /tiktok\.com\/@[\w.-]+\/?$/i.test(url) && !/\/video\//i.test(url);
}

/**
 * 获取 TikTok 用户主页信息
 * @param {string} url - TikTok 用户主页 URL
 * @returns {Promise<Object|null>} 用户信息
 */
export async function fetchTikTokUserProfile(url) {
  return CachedFetcher.fetchWithCache(url, 'tiktok_user', async () => _fetchTikTokUserProfileInternal(url), getCacheTTL('tiktok_user'));
}

/**
 * fetchTikTokUserProfile 的内部实现
 */
async function _fetchTikTokUserProfileInternal(url) {
  const uniqueId = extractTikTokUsername(url);
  if (!uniqueId) {
    console.warn('[TikTokFetcher] 无法提取用户名:', url);
    return null;
  }

  console.log(`[TikTokFetcher] 获取TikTok用户主页: @${uniqueId}`);

  try {
    const apiUrl = `${TIKTOK_USER_PROFILE_URL}?token=${JUSTONEAPI_KEY}&uniqueId=${encodeURIComponent(uniqueId)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(apiUrl, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[TikTokFetcher] 用户主页API请求失败:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.code !== 0) {
      console.warn('[TikTokFetcher] 用户主页API返回错误:', data.message || data.msg);
      return null;
    }

    const userInfo = data.data?.userInfo;
    if (!userInfo) {
      console.warn('[TikTokFetcher] 用户主页数据为空');
      return null;
    }

    const user = userInfo.user || {};
    const stats = userInfo.stats || {};

    return {
      type: 'user_profile',
      nickname: user.nickname || '',
      unique_id: user.uniqueId || uniqueId,
      signature: user.signature || '',
      follower_count: stats.followerCount || 0,
      following_count: stats.followingCount || 0,
      heart_count: stats.heartCount || 0,
      video_count: stats.videoCount || 0,
      verified: user.verified || false,
      avatar_url: user.avatarMedium || user.avatarThumb || '',
      fetched_via: 'justoneapi'
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[TikTokFetcher] 用户主页请求超时（30秒）');
    } else {
      console.error('[TikTokFetcher] 用户主页获取失败:', error.message);
    }
    return null;
  }
}
