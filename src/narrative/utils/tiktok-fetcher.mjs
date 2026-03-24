/**
 * TikTok信息获取工具
 * 使用 JustOneAPI 的TikTok接口
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/tiktok/get-post-detail/v1';

/**
 * 从TikTok URL中提取视频ID
 * 支持格式：
 * - https://www.tiktok.com/@username/video/1234567890
 * - https://tiktok.com/@username/video/1234567890
 * @param {string} url - TikTok URL
 * @returns {string|null} 视频ID
 */
function extractTikTokVideoId(url) {
  if (!url) return null;

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
  if (!url) {
    return null;
  }

  console.log(`[TikTokFetcher] 获取TikTok视频信息: ${url}`);

  try {
    // 提取视频ID
    const videoId = extractTikTokVideoId(url);

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
