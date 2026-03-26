/**
 * 抖音视频信息获取工具
 * 使用 JustOneAPI 获取视频详细信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/douyin/get-video-detail/v2';

/**
 * 抖音视频信息提取器
 */
export class DouyinFetcher {

  /**
   * 从抖音 URL 中提取视频 ID
   * 支持格式：
   * - douyin.com/video/ID
   * - v.douyin.com/ID (分享链接，需解析)
   * - www.iesdouyin.com/share/video/ID
   * @param {string} url - 抖音 URL
   * @returns {Promise<string|null>} 视频 ID
   */
  static async extractVideoId(url) {
    if (!url) return null;

    // 检查是否是短链接（v.douyin.com）
    if (url.includes('v.douyin.com') || url.includes('v.douyin.com')) {
      try {
        // 跟随重定向获取真实URL
        console.log('[DouyinFetcher] 检测到短链接，尝试解析...');
        const response = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        // 获取重定向后的真实URL
        const realUrl = response.url || response.redirected ? response.url : url;
        console.log('[DouyinFetcher] 短链接解析为:', realUrl);

        // 从真实URL中提取视频ID
        const modalIdMatch = realUrl.match(/modal_id=([^&]+)/);
        if (modalIdMatch) {
          console.log('[DouyinFetcher] 提取到modal_id:', modalIdMatch[1]);
          return modalIdMatch[1];
        }

        // 尝试其他模式
        const videoIdMatch = realUrl.match(/\/video\/(\d+)/);
        if (videoIdMatch) {
          console.log('[DouyinFetcher] 提取到video_id:', videoIdMatch[1]);
          return videoIdMatch[1];
        }
      } catch (error) {
        console.warn('[DouyinFetcher] 短链接解析失败，使用原始ID:', error.message);
      }
    }

    // 常规模式（非短链接或短链接解析失败时）
    const patterns = [
      /douyin\.com\/video\/(\d+)/,
      /douyin\.com\/.*\/modal_id=([^&]+)/,
      /iesdouyin\.com\/share\/video\/([^/?]+)/,
      /v\.douyin\.com\/([^/?]+)/  // 最后尝试直接提取短链接中的ID
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
   * 判断是否是有效的抖音 URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidDouyinUrl(url) {
    if (!url) return false;
    return /douyin\.com|v\.douyin\.com|iesdouyin\.com/.test(url);
  }

  /**
   * 使用 JustOneAPI 获取视频详细信息
   * @param {string} videoId - 抖音视频 ID
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
        console.warn('[DouyinFetcher] JustOneAPI 请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[DouyinFetcher] API 返回错误:', data.message);
        return null;
      }

      if (!data.data || !data.data.aweme_detail) {
        console.warn('[DouyinFetcher] 视频数据为空');
        return null;
      }

      const awemeDetail = data.data.aweme_detail;
      const statistics = awemeDetail.statistics || {};
      const author = awemeDetail.author || {};

      return {
        video_id: awemeDetail.aweme_id || videoId,
        title: awemeDetail.desc || awemeDetail.title || '',
        description: awemeDetail.desc || '',
        // 作者信息
        author_id: author.uid || '',
        author_nickname: author.nickname || '',
        author_avatar: author.avatar_thumb?.url_list?.[0] || '',
        author_follower_count: author.follower_count || 0,
        author_verified: author.is_verified || false,
        // 统计信息
        view_count: statistics.play_count || 0,
        like_count: statistics.digg_count || 0,
        comment_count: statistics.comment_count || 0,
        share_count: statistics.share_count || 0,
        collect_count: statistics.collect_count || 0,
        // 视频信息
        duration: awemeDetail.duration ? Math.floor(awemeDetail.duration / 1000) : 0,
        create_time: awemeDetail.create_time ? new Date(awemeDetail.create_time * 1000).toISOString() : '',
        share_url: awemeDetail.share_url || '',
        thumbnail: awemeDetail.video?.cover?.url_list?.[0] || '',
        fetched_via: 'justoneapi'
      };

    } catch (error) {
      console.error('[DouyinFetcher] JustOneAPI 获取失败:', error.message);
      return null;
    }
  }

  /**
   * 获取抖音视频信息
   * @param {string} url - 抖音 URL
   * @returns {Promise<Object|null>} 视频信息
   */
  static async fetchVideoInfo(url) {
    if (!url) {
      return null;
    }

    const videoId = await this.extractVideoId(url);
    if (!videoId) {
      console.warn('[DouyinFetcher] 无法提取视频 ID:', url);
      return null;
    }

    console.log(`[DouyinFetcher] 获取视频信息: ${videoId}`);

    // 使用 JustOneAPI 获取视频信息
    const result = await this.fetchViaJustOneAPI(videoId);

    if (result) {
      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);
      console.log(`[DouyinFetcher] 成功获取: "${result.title}" (${result.view_count} 观看)`);
    }

    return result;
  }

  /**
   * 获取抖音视频影响力等级
   * @param {Object} videoInfo - 视频信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(videoInfo) {
    if (!videoInfo) {
      return 'unknown';
    }

    // 抖音 API 的 play_count 可能被隐藏为 0，使用分享数作为替代指标
    // 分享数是传播力的重要指标
    const views = videoInfo.view_count || 0;
    const likes = videoInfo.like_count || 0;
    const shares = videoInfo.share_count || 0;

    // 综合评估：分享数权重最高，其次是点赞数和观看数
    // 分享数 × 10（因为分享比点赞更有传播价值）
    const metric = Math.max(views, likes, shares * 10);

    if (metric >= 100000000) return 'world_class';        // 1亿+ 世界级
    if (metric >= 10000000) return 'viral';               // 1000万+ 病毒传播
    if (metric >= 1000000) return 'mega_viral';           // 100万+ 超级病毒
    if (metric >= 100000) return 'super_viral';           // 10万+ 高度病毒
    if (metric >= 10000) return 'popular';                // 1万+ 热门
    if (metric >= 1000) return 'community_level';         // 1000+ 社区级
    return 'niche_level';                                // 1000以下 小众级
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（1亿+观看）',
      'viral': '病毒传播级影响力（1000万+观看）',
      'mega_viral': '超级病毒传播级（100万+观看）',
      'super_viral': '高度病毒传播级（10万+观看）',
      'popular': '热门级影响力（1万+观看）',
      'community_level': '社区级影响力（1000+观看）',
      'niche_level': '小众级影响力（1000以下观看）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }
}
