/**
 * YouTube 视频信息获取工具
 * 使用 JustOneAPI 获取视频详细信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/youtube/get-video-detail/v1';

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
}
