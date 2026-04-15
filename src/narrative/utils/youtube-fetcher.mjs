/**
 * YouTube 视频信息获取工具
 * 使用 JustOneAPI 获取视频详细信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/youtube/get-video-detail/v1';
const YOUTUBE_CHANNEL_VIDEOS_URL = 'https://api.justoneapi.com/api/youtube/get-channel-videos/v1';

/**
 * YouTube 视频信息提取器
 */
export class YoutubeFetcher {

  /**
   * 从 YouTube URL 中提取视频 ID
   * 支持格式：
   * - youtube.com/watch?v=ID
   * - youtu.be/ID
   * - youtube.com/embed/ID
   * @param {string} url - YouTube URL
   * @returns {string|null} 视频 ID
   */
  static extractVideoId(url) {
    if (!url) return null;

    const patterns = [
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?]+)/,
      /youtube\.com\/embed\/([^?]+)/,
      /youtube\.com\/v\/([^?]+)/
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
   * 判断是否是有效的 YouTube URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidYoutubeUrl(url) {
    if (!url) return false;
    return /youtu\.be\/|youtube\.com\/(watch|embed|v)/.test(url);
  }

  /**
   * 使用 JustOneAPI 获取视频详细信息
   * @param {string} videoId - YouTube 视频 ID
   * @returns {Promise<Object|null>} 视频信息
   */
  static async fetchViaJustOneAPI(videoId) {
    const url = `${JUSTONEAPI_URL}?token=${JUSTONEAPI_KEY}&videoId=${videoId}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[YoutubeFetcher] JustOneAPI 请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[YoutubeFetcher] API 返回错误:', data.message);
        return null;
      }

      if (!data.data || !data.data.videoDetails) {
        console.warn('[YoutubeFetcher] 视频数据为空');
        return null;
      }

      const videoDetails = data.data.videoDetails;

      return {
        video_id: videoId,
        title: videoDetails.title,
        description: videoDetails.shortDescription,
        channel_id: videoDetails.channelId,
        channel_title: videoDetails.author,
        view_count: parseInt(videoDetails.viewCount) || 0,
        like_count: parseInt(videoDetails.likeCount) || 0,
        comment_count: parseInt(videoDetails.commentCount) || 0,
        duration: videoDetails.lengthSeconds,
        thumbnail: videoDetails.thumbnail?.thumbnails?.[0]?.url,
        fetched_via: 'justoneapi'
      };

    } catch (error) {
      console.error('[YoutubeFetcher] JustOneAPI 获取失败:', error.message);
      return null;
    }
  }

  /**
   * 获取 YouTube 视频信息
   * @param {string} url - YouTube URL
   * @returns {Promise<Object|null>} 视频信息
   */
  static async fetchVideoInfo(url) {
    if (!url) {
      return null;
    }

    const videoId = this.extractVideoId(url);
    if (!videoId) {
      console.warn('[YoutubeFetcher] 无法提取视频 ID:', url);
      return null;
    }

    console.log(`[YoutubeFetcher] 获取视频信息: ${videoId}`);

    // 使用 JustOneAPI 获取视频信息
    const result = await this.fetchViaJustOneAPI(videoId);

    if (result) {
      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);
      console.log(`[YoutubeFetcher] 成功获取: "${result.title}" (${result.view_count} 观看)`);
    }

    return result;
  }

  /**
   * 获取 YouTube 视频影响力等级
   * @param {Object} videoInfo - 视频信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(videoInfo) {
    if (!videoInfo) {
      return 'unknown';
    }

    // 根据观看数判断
    if (videoInfo.view_count) {
      const views = videoInfo.view_count;
      if (views >= 1000000000) return 'world_class';     // 10亿+ 世界级
      if (views >= 100000000) return 'viral';            // 1亿+ 病毒传播
      if (views >= 10000000) return 'mega_viral';        // 1000万+ 超级病毒
      if (views >= 1000000) return 'super_viral';       // 100万+ 高度病毒
      if (views >= 100000) return 'popular';            // 10万+ 热门
      if (views >= 10000) return 'community_level';     // 1万+ 社区级
      if (views >= 1000) return 'niche_level';          // 1000+ 小众级
      return 'unknown';
    }

    return 'unknown';
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（10亿+观看）',
      'viral': '病毒传播级影响力（1亿+观看）',
      'mega_viral': '超级病毒传播级（1000万+观看）',
      'super_viral': '高度病毒传播级（100万+观看）',
      'popular': '热门级影响力（10万+观看）',
      'community_level': '社区级影响力（1万+观看）',
      'niche_level': '小众级影响力（1000+观看）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }

  // ========== 频道方法 ==========

  /**
   * 从 YouTube 频道 URL 中提取 channelId
   * 支持格式：youtube.com/channel/UCxxxxx
   * @param {string} url - YouTube 频道 URL
   * @returns {string|null} channelId
   */
  static extractChannelId(url) {
    if (!url) return null;
    const match = url.match(/youtube\.com\/channel\/(UC[\w-]+)/);
    return match ? match[1] : null;
  }

  /**
   * 从 YouTube 频道 URL 中提取 handle
   * 支持格式：youtube.com/@handle
   * @param {string} url - YouTube 频道 URL
   * @returns {string|null} handle（不含@）
   */
  static extractHandle(url) {
    if (!url) return null;
    const match = url.match(/youtube\.com\/@([\w.-]+)/);
    return match ? match[1] : null;
  }

  /**
   * 判断是否是 YouTube 频道 URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isYouTubeChannelUrl(url) {
    if (!url) return false;
    return /youtube\.com\/(channel\/UC|@)/i.test(url);
  }

  /**
   * 获取 YouTube 频道信息（通过频道视频列表接口）
   * @param {string} url - YouTube 频道 URL
   * @returns {Promise<Object|null>} 频道信息
   */
  static async fetchChannelInfo(url) {
    // 提取 channelId 或 handle
    const channelId = this.extractChannelId(url);
    const handle = this.extractHandle(url);

    if (!channelId && !handle) {
      console.warn('[YoutubeFetcher] 无法提取 channelId 或 handle:', url);
      return null;
    }

    const identifier = channelId || `@${handle}`;
    console.log(`[YoutubeFetcher] 获取YouTube频道: ${identifier}`);

    try {
      let apiUrl = `${YOUTUBE_CHANNEL_VIDEOS_URL}?token=${JUSTONEAPI_KEY}`;
      if (channelId) {
        apiUrl += `&channelId=${encodeURIComponent(channelId)}`;
      } else {
        // handle 格式需要先解析，API 可能不直接支持 handle
        // 尝试使用 handle 作为参数
        apiUrl += `&channelId=${encodeURIComponent(handle)}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[YoutubeFetcher] 频道API请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      if (data.code !== 0) {
        console.warn('[YoutubeFetcher] 频道API返回错误:', data.message);
        return null;
      }

      // 解析频道视频列表
      const videos = data.data?.videos || data.data?.data || [];
      if (!videos.length && !data.data) {
        console.warn('[YoutubeFetcher] 频道数据为空');
        return null;
      }

      // 从视频列表中提取频道信息
      const firstVideo = videos[0] || {};
      const channelTitle = firstVideo.channel_title || firstVideo.author_name ||
                           data.data?.channel?.title || '';

      // 构建最近视频列表
      const recentVideos = videos.slice(0, 5).map(v => ({
        title: v.title || '',
        view_count: parseInt(v.view_count) || parseInt(v.viewCount) || 0,
        published_at: v.published_at || v.publishedAt || '',
        video_id: v.video_id || v.videoId || ''
      }));

      return {
        type: 'channel',
        channel_id: channelId || '',
        channel_title: channelTitle,
        handle: handle || '',
        description: data.data?.channel?.description || '',
        video_count: videos.length,
        recent_videos: recentVideos,
        fetched_via: 'justoneapi'
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[YoutubeFetcher] 频道请求超时（30秒）');
      } else {
        console.error('[YoutubeFetcher] 频道获取失败:', error.message);
      }
      return null;
    }
  }
}
