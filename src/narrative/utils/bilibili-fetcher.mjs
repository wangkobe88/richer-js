/**
 * Bilibili 视频信息获取工具
 * 使用 JustOneAPI 获取视频详细信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/bilibili/get-video-detail/v2';

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * Bilibili 视频信息提取器
 */
export class BilibiliFetcher {

  /**
   * 从 Bilibili URL 中提取视频 ID
   * 支持格式：
   * - bilibili.com/video/BVID (bvid)
   * - bilibili.com/video/avID (aid)
   * - b23.tv/ID (短链接，需解析)
   * @param {string} url - Bilibili URL
   * @returns {Promise<Object|null>} { bvid: string, aid: string } 或 null
   */
  static async extractVideoId(url) {
    if (!url) return null;

    // 检查是否是短链接（b23.tv）
    if (url.includes('b23.tv')) {
      try {
        console.log('[BilibiliFetcher] 检测到短链接，尝试解析...');
        const response = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        // 获取重定向后的真实URL
        const realUrl = response.url || url;
        console.log('[BilibiliFetcher] 短链接解析为:', realUrl);

        // 从真实URL中提取视频ID（递归调用）
        return await this.extractVideoId(realUrl);
      } catch (error) {
        console.warn('[BilibiliFetcher] 短链接解析失败:', error.message);
        return null;
      }
    }

    // BV 号格式: BVxxxxxx
    const bvMatch = url.match(/bilibili\.com\/video\/(BV[\w]+)/);
    if (bvMatch) {
      return { bvid: bvMatch[1], aid: null };
    }

    // AV 号格式: avxxxxx
    const avMatch = url.match(/bilibili\.com\/video\/av(\d+)/);
    if (avMatch) {
      return { bvid: null, aid: avMatch[1] };
    }

    return null;
  }

  /**
   * 判断是否是有效的 Bilibili URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidBilibiliUrl(url) {
    if (!url) return false;
    return /bilibili\.com|b23\.tv/.test(url);
  }

  /**
   * 使用 JustOneAPI 获取视频详细信息
   * @param {string} bvid - Bilibili BV 号
   * @param {string} aid - Bilibili AV 号（可选）
   * @returns {Promise<Object|null>} 视频信息
   */
  static async fetchViaJustOneAPI(bvid, aid = null) {
    let url = `${JUSTONEAPI_URL}?token=${JUSTONEAPI_KEY}`;

    if (bvid) {
      url += `&bvid=${bvid}`;
    } else if (aid) {
      url += `&aid=${aid}`;
    } else {
      console.warn('[BilibiliFetcher] 缺少视频 ID');
      return null;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[BilibiliFetcher] JustOneAPI 请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[BilibiliFetcher] API 返回错误:', data.message);
        return null;
      }

      if (!data.data) {
        console.warn('[BilibiliFetcher] 视频数据为空');
        return null;
      }

      // JustOneAPI 返回结构：data.data 包含页面数据，视频信息在 videoData 中
      const videoData = data.data.videoData || {};
      const stat = videoData.stat || {};
      const owner = videoData.owner || {};
      const pic = videoData.pic || '';

      return {
        bvid: videoData.bvid || bvid,
        aid: videoData.aid || aid,
        title: videoData.title || '',
        description: videoData.desc || '',
        // 作者信息
        mid: owner.mid || '',
        author_name: owner.name || '',
        author_face: owner.face || '',
        // 统计信息
        view_count: stat.view || 0,
        like_count: stat.like || 0,
        coin_count: stat.coin || 0,
        favorite_count: stat.favorite || 0,
        share_count: stat.share || 0,
        comment_count: stat.reply || 0,
        // 视频信息
        duration: videoData.duration ? Math.floor(videoData.duration) : 0,
        publish_date: videoData.pubdate ? new Date(videoData.pubdate * 1000).toISOString() : '',
        thumbnail: pic,
        // 来源标记
        fetched_via: 'justoneapi'
      };

    } catch (error) {
      console.error('[BilibiliFetcher] JustOneAPI 获取失败:', error.message);
      return null;
    }
  }

  /**
   * 获取 Bilibili 视频信息
   * @param {string} url - Bilibili URL
   * @returns {Promise<Object|null>} 视频信息
   */
  static async fetchVideoInfo(url) {
    return CachedFetcher.fetchWithCache(url, 'bilibili', async () => this._fetchVideoInfoInternal(url), getCacheTTL('bilibili'));
  }

  /**
   * fetchVideoInfo 的内部实现
   */
  static async _fetchVideoInfoInternal(url) {
    if (!url) {
      return null;
    }

    const videoId = await this.extractVideoId(url);
    if (!videoId) {
      console.warn('[BilibiliFetcher] 无法提取视频 ID:', url);
      return null;
    }

    console.log(`[BilibiliFetcher] 获取视频信息: ${videoId.bvid || videoId.aid}`);

    // 使用 JustOneAPI 获取视频信息
    const result = await this.fetchViaJustOneAPI(videoId.bvid, videoId.aid);

    if (result) {
      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);
      console.log(`[BilibiliFetcher] 成功获取: "${result.title}" (${result.view_count} 观看)`);
    }

    return result;
  }

  /**
   * 获取 Bilibili 视频影响力等级
   * @param {Object} videoInfo - 视频信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(videoInfo) {
    if (!videoInfo) {
      return 'unknown';
    }

    // Bilibili 的观看数通常比 YouTube 低，使用更适合的标准
    // 综合观看、点赞、硬币、收藏
    const views = videoInfo.view_count || 0;
    const likes = videoInfo.like_count || 0;
    const coins = videoInfo.coin_count || 0;
    const favorites = videoInfo.favorite_count || 0;

    // 综合评分：观看数 + 点赞×10 + 硬币×20 + 收藏×15
    // 硬币和收藏代表更高的用户参与度
    const metric = views + (likes * 10) + (coins * 20) + (favorites * 15);

    if (metric >= 50000000) return 'world_class';       // 5000万+ 世界级
    if (metric >= 10000000) return 'viral';              // 1000万+ 病毒传播
    if (metric >= 1000000) return 'mega_viral';          // 100万+ 超级病毒
    if (metric >= 100000) return 'super_viral';          // 10万+ 高度病毒
    if (metric >= 10000) return 'popular';               // 1万+ 热门
    if (metric >= 1000) return 'community_level';        // 1000+ 社区级
    return 'niche_level';                                // 1000以下 小众级
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（5000万+综合）',
      'viral': '病毒传播级影响力（1000万+综合）',
      'mega_viral': '超级病毒传播级（100万+综合）',
      'super_viral': '高度病毒传播级（10万+综合）',
      'popular': '热门级影响力（1万+综合）',
      'community_level': '社区级影响力（1000+综合）',
      'niche_level': '小众级影响力（1000以下综合）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }
}
