/**
 * 小红书笔记信息获取工具
 * 使用 JustOneAPI 获取笔记详细信息
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_URL = 'https://api.justoneapi.com/api/xiaohongshu/get-note-detail/v1';

/**
 * 小红书笔记信息提取器
 */
export class XiaohongshuFetcher {

  /**
   * 从小红书 URL 中提取笔记 ID
   * 支持格式：
   * - xiaohongshu.com/explore/{noteId}
   * - xiaohongshu.com/discovery/item/{noteId}
   * - xhslink.com/{shortCode}（短链接）
   * @param {string} url - 小红书 URL
   * @returns {Promise<string|null>} 笔记 ID
   */
  static async extractNoteId(url) {
    if (!url) return null;

    // 标准URL格式，直接提取noteId
    const patterns = [
      /xiaohongshu\.com\/explore\/([a-z0-9]+)/,
      /xiaohongshu\.com\/discovery\/item\/([a-z0-9]+)/,
      /xhslink\.com\/([a-z0-9]+)/  // 短链接
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const noteId = match[1];
        // 如果是短链接，需要解析获取真实noteId
        if (url.includes('xhslink.com')) {
          console.log('[XiaohongshuFetcher] 检测到短链接，尝试解析...');
          const realNoteId = await this._resolveShortLink(url);
          return realNoteId || noteId;
        }
        return noteId;
      }
    }

    return null;
  }

  /**
   * 解析短链接获取真实noteId
   * @param {string} shortUrl - 短链接
   * @returns {Promise<string|null>} 真实noteId
   */
  static async _resolveShortLink(shortUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(shortUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // 从重定向后的URL中提取noteId
      const realUrl = response.url;
      const match = realUrl.match(/\/explore\/([a-z0-9]+)/);
      if (match) {
        console.log('[XiaohongshuFetcher] 短链接解析为:', match[1]);
        return match[1];
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('[XiaohongshuFetcher] 短链接解析超时');
      } else {
        console.warn('[XiaohongshuFetcher] 短链接解析失败:', error.message);
      }
    }
    return null;
  }

  /**
   * 判断是否是有效的小红书 URL
   * @param {string} url - URL
   * @returns {boolean}
   */
  static isValidXiaohongshuUrl(url) {
    if (!url) return false;
    return /xiaohongshu\.com|xhslink\.com/i.test(url);
  }

  /**
   * 使用 JustOneAPI 获取笔记详细信息
   * @param {string} noteId - 小红书笔记 ID
   * @returns {Promise<Object|null>} 笔记信息
   */
  static async fetchViaJustOneAPI(noteId) {
    const url = `${JUSTONEAPI_URL}?token=${JUSTONEAPI_KEY}&noteId=${noteId}`;
    const REQUEST_TIMEOUT = 30000; // 30秒超时

    try {
      console.log(`[XiaohongshuFetcher] 请求API: noteId=${noteId}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[XiaohongshuFetcher] HTTP错误:', response.status, response.statusText);
        // 尝试读取错误响应体
        try {
          const errorText = await response.text();
          console.warn('[XiaohongshuFetcher] 错误响应:', errorText.substring(0, 200));
        } catch (e) {
          // 忽略读取错误响应的失败
        }
        return null;
      }

      const data = await response.json();
      console.log('[XiaohongshuFetcher] API响应:', JSON.stringify({ code: data.code, message: data.message, hasData: !!data.data }));

      // 检查业务状态码
      if (data.code !== 0) {
        console.warn('[XiaohongshuFetcher] API返回错误:', data.code, data.message);
        return null;
      }

      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        console.warn('[XiaohongshuFetcher] 笔记数据为空或格式错误');
        return null;
      }

      // API返回的数据结构：data是数组，第一项包含user和note_list
      const firstItem = data.data[0];
      if (!firstItem.note_list || !Array.isArray(firstItem.note_list) || firstItem.note_list.length === 0) {
        console.warn('[XiaohongshuFetcher] note_list为空');
        return null;
      }

      const noteData = firstItem.note_list[0];  // 获取第一个笔记
      const user = noteData.user || firstItem.user || {};

      // 从noteData中提取互动数据
      const liked_count = noteData.liked_count || 0;
      const collected_count = noteData.collected_count || 0;
      const comments_count = noteData.comments_count || 0;
      const shared_count = noteData.shared_count || 0;
      const view_count = noteData.view_count || 0;

      return {
        note_id: noteId,
        // 笔记内容
        title: noteData.title || '',
        desc: noteData.desc || '',
        type: noteData.type === 'video' ? 'video' : 'normal',
        time: noteData.time ? new Date(noteData.time * 1000).toISOString() : '',
        ip_location: noteData.ip_location || '',

        // 用户信息
        user: {
          nickname: user.nickname || '',
          userid: user.userid || '',
          red_id: user.red_id || '',
          red_official_verified: user.red_official_verified || false,
          image: user.image || ''
        },

        // 互动数据
        liked_count: liked_count,
        collected_count: collected_count,
        comments_count: comments_count,
        shared_count: shared_count,
        view_count: view_count,

        // 媒体信息
        images: (noteData.image_list || []).map(img => ({
          url: img.url || '',
          width: img.width || 0,
          height: img.height || 0
        })),
        video: noteData.video ? {
          cover: noteData.video.cover || '',
          url: noteData.video.url || '',
          duration: noteData.video.duration || 0
        } : null,

        // 标签和提及
        topics: noteData.topics || [],
        hashtags: noteData.hash_tag || '',
        mentions: (noteData.ats || []).map(at => ({
          nickname: at.nickname || '',
          userid: at.userid || ''
        })),

        fetched_via: 'justoneapi'
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[XiaohongshuFetcher] JustOneAPI 请求超时（30秒）');
      } else {
        console.error('[XiaohongshuFetcher] JustOneAPI 获取失败:', error.message);
        console.error('[XiaohongshuFetcher] 错误堆栈:', error.stack);
      }
      return null;
    }
  }

  /**
   * 获取小红书笔记信息
   * @param {string} url - 小红书 URL
   * @returns {Promise<Object|null>} 笔记信息
   */
  static async fetchNoteInfo(url) {
    if (!url) {
      return null;
    }

    const noteId = await this.extractNoteId(url);

    if (!noteId) {
      console.warn('[XiaohongshuFetcher] 无法提取笔记 ID:', url);
      return null;
    }

    console.log(`[XiaohongshuFetcher] 获取笔记信息: ${noteId}`);

    // 使用 JustOneAPI 获取笔记信息
    const result = await this.fetchViaJustOneAPI(noteId);

    if (result) {
      // 计算影响力等级
      result.influence_level = this.getInfluenceLevel(result);
      result.influence_description = this.getInfluenceDescription(result.influence_level);
      console.log(`[XiaohongshuFetcher] 成功获取: "${result.title}" (${result.view_count}浏览, ${result.liked_count}点赞)`);
    }

    return result;
  }

  /**
   * 获取小红书笔记影响力等级
   * @param {Object} noteInfo - 笔记信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(noteInfo) {
    if (!noteInfo) {
      return 'unknown';
    }

    // 小红书的主要指标是浏览量和点赞数
    // 收藏数也是重要指标，反映内容质量
    const views = noteInfo.view_count || 0;
    const likes = noteInfo.liked_count || 0;
    const collects = noteInfo.collected_count || 0;

    // 综合评估：收藏数权重最高（反映内容价值），其次是浏览数和点赞数
    const metric = Math.max(views, likes * 10, collects * 20);

    if (metric >= 10000000) return 'world_class';        // 1000万+ 世界级
    if (metric >= 1000000) return 'viral';               // 100万+ 病毒传播
    if (metric >= 100000) return 'mega_viral';           // 10万+ 超级病毒
    if (metric >= 10000) return 'super_viral';           // 1万+ 高度病毒
    if (metric >= 1000) return 'popular';                // 1000+ 热门
    if (metric >= 100) return 'community_level';         // 100+ 社区级
    return 'niche_level';                                // 100以下 小众级
  }

  /**
   * 获取影响力等级说明
   * @param {string} level - 影响力等级
   * @returns {string} 说明
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world_class': '世界级影响力（1000万+浏览）',
      'viral': '病毒传播级影响力（100万+浏览）',
      'mega_viral': '超级病毒传播级（10万+浏览）',
      'super_viral': '高度病毒传播级（1万+浏览）',
      'popular': '热门级影响力（1000+浏览）',
      'community_level': '社区级影响力（100+浏览）',
      'niche_level': '小众级影响力（100以下浏览）',
      'unknown': '无明确影响力'
    };
    return descriptions[level] || '未知';
  }
}
