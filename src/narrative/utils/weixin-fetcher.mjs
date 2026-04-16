/**
 * 微信公众号文章信息获取工具
 * 使用 JustOneAPI 获取文章详细信息和反馈数据
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const ARTICLE_DETAIL_URL = 'https://api.justoneapi.com/api/weixin/get-article-detail/v1';
const ARTICLE_FEEDBACK_URL = 'https://api.justoneapi.com/api/weixin/get-article-feedback/v1';

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * 微信文章信息提取器
 */
export class WeixinFetcher {

  /**
   * 判断是否是有效的微信文章 URL
   * 支持官方域名和常见镜像域名
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidWeixinUrl(url) {
    if (!url) return false;
    // 支持官方域名和镜像域名（wx.开头的域名）
    return /mp\.weixin\.qq\.com|wx\./i.test(url);
  }

  /**
   * 从微信文章 URL 中提取文章标识
   * @param {string} url - 微信文章 URL
   * @returns {string} 文章URL
   */
  static extractArticleUrl(url) {
    if (!url) return null;

    // 标准化URL：确保是完整URL
    if (url.startsWith('http')) {
      return url;
    }

    // 如果是相对路径，补充协议
    if (url.startsWith('mp.')) {
      return `https://${url}`;
    }

    return url;
  }

  /**
   * 获取微信文章信息（带缓存）
   * @param {string} url - 微信文章 URL
   * @returns {Promise<Object|null>} 文章信息
   */
  static async fetchArticleInfo(url) {
    if (!url) return null;

    return CachedFetcher.fetchWithCache(
      url, 'weixin',
      async () => this._fetchArticleInfoInternal(url),
      getCacheTTL('weixin')
    );
  }

  /**
   * 获取微信文章信息（实际API调用，顺序请求避免并发限流）
   */
  static async _fetchArticleInfoInternal(url) {

    if (!this.isValidWeixinUrl(url)) {
      console.warn('[WeixinFetcher] 不是有效的微信文章URL:', url);
      return null;
    }

    const articleUrl = this.extractArticleUrl(url);
    if (!articleUrl) {
      console.warn('[WeixinFetcher] 无法提取文章URL:', url);
      return null;
    }

    console.log(`[WeixinFetcher] 获取微信文章信息: ${articleUrl}`);

    // 先获取文章详情
    const detailData = await this.fetchArticleDetail(articleUrl);

    // 再获取反馈数据
    const feedbackData = await this.fetchArticleFeedback(articleUrl);

    if (!detailData && !feedbackData) {
      console.warn('[WeixinFetcher] 文章详情和反馈数据均为空');
      return null;
    }

    // 合并数据
    const userInfo = detailData?.user_info || {};
    const result = {
      article_url: articleUrl,
      title: detailData?.title || '',
      content: detailData?.content || '',
      digest: detailData?.digest || detailData?.desc || '',
      publish_time: detailData?.publish_time || '',
      // 作者信息
      author: userInfo.author || '',
      nickname: userInfo.nickname || userInfo.name || '',
      // 反馈数据（阅读数、点赞等）- 兼容多种字段名
      read_num: feedbackData?.read_num ?? feedbackData?.readNum ?? feedbackData?.watch_num ?? 0,
      like_num: feedbackData?.like_num ?? feedbackData?.likeNum ?? 0,
      comment_num: feedbackData?.comment_num ?? feedbackData?.commentNum ?? feedbackData?.comment_count ?? 0,
      reward_num: feedbackData?.reward_num ?? feedbackData?.rewardNum ?? 0,
      share_num: feedbackData?.share_num ?? feedbackData?.shareNum ?? 0,
      // 封面图
      cover_url: detailData?.cover || detailData?.cover_url || '',
      // 来源标记
      fetched_via: 'justoneapi'
    };

    // 计算影响力等级
    result.influence_level = this.getInfluenceLevel(result);
    result.influence_description = this.getInfluenceDescription(result.influence_level);

    console.log(`[WeixinFetcher] 成功获取: "${result.title}" (${result.read_num} 阅读, ${result.like_num} 点赞)`);

    return result;
  }

  /**
   * 使用 JustOneAPI 获取文章详细信息
   * @param {string} articleUrl - 微信文章 URL
   * @returns {Promise<Object|null>} 文章详情
   */
  static async fetchArticleDetail(articleUrl) {
    const url = `${ARTICLE_DETAIL_URL}?token=${JUSTONEAPI_KEY}&articleUrl=${encodeURIComponent(articleUrl)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[WeixinFetcher] 文章详情API请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[WeixinFetcher] 文章详情API返回错误:', data.msg || data.message || '未知错误', 'code:', data.code);
        return null;
      }

      return data.data;

    } catch (error) {
      console.error('[WeixinFetcher] 文章详情API获取失败:', error.message);
      return null;
    }
  }

  /**
   * 使用 JustOneAPI 获取文章反馈数据（阅读数、点赞等）
   * @param {string} articleUrl - 微信文章 URL
   * @returns {Promise<Object|null>} 反馈数据
   */
  static async fetchArticleFeedback(articleUrl) {
    const url = `${ARTICLE_FEEDBACK_URL}?token=${JUSTONEAPI_KEY}&articleUrl=${encodeURIComponent(articleUrl)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('[WeixinFetcher] 文章反馈API请求失败:', response.status);
        return null;
      }

      const data = await response.json();

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[WeixinFetcher] 文章反馈API返回错误:', data.msg || data.message || '未知错误', 'code:', data.code);
        return null;
      }

      return data.data;

    } catch (error) {
      console.error('[WeixinFetcher] 文章反馈API获取失败:', error.message);
      return null;
    }
  }

  /**
   * 获取微信文章影响力等级
   * @param {Object} articleInfo - 文章信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(articleInfo) {
    if (!articleInfo) {
      return 'unknown';
    }

    const reads = articleInfo.read_num || 0;
    const likes = articleInfo.like_num || 0;
    const comments = articleInfo.comment_num || 0;

    // 综合评估：阅读数权重最高，其次是点赞数和评论数
    // 点赞数 × 10（点赞代表强烈认可）
    // 评论数 × 50（评论代表深度互动）
    const metric = Math.max(reads, likes * 10, comments * 50);

    if (metric >= 10000000) return 'world_class';         // 1000万+ 世界级
    if (metric >= 1000000) return 'viral';                // 100万+ 病毒传播
    if (metric >= 100000) return 'mega_viral';            // 10万+ 超级病毒
    if (metric >= 10000) return 'super_viral';            // 1万+ 高度病毒
    if (metric >= 1000) return 'popular';                 // 1000+ 热门
    return 'community_level';                             // 1000以下 社区级
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（1000万+阅读）',
      'viral': '病毒传播级影响力（100万+阅读）',
      'mega_viral': '超级病毒传播级（10万+阅读）',
      'super_viral': '高度病毒传播级（1万+阅读）',
      'popular': '热门级影响力（1000+阅读）',
      'community_level': '社区级影响力（1000以下阅读）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }
}
