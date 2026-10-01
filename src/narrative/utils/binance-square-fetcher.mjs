/**
 * 币安广场（Binance Square）内容获取工具
 *
 * 获取策略（纯服务端，两层降级）：
 * 1. JustOneAPI web/html/v1 → 获取完整 HTML → 解析 JSON-LD / meta 标签
 * 2. 最小元数据提取（仅 URL 中的 post ID）
 *
 * JustOneAPI 能绕过币安的 WAF 保护，返回完整页面 HTML。
 * 同时可用于验证 URL 有效性：真实帖子 code=0，虚假帖子 code=301。
 */

const JUSTONEAPI_KEY = 'UkWus4GxT7fqEnC1';
const JUSTONEAPI_HTML_URL = 'https://api.justoneapi.com/api/web/html/v1';

import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

const FETCH_TIMEOUT = 30000; // JustOneAPI 可能较慢，给 30 秒

/**
 * 币安广场内容获取器
 */
export class BinanceSquareFetcher {

  /**
   * 获取币安广场文章信息
   * @param {string} url - 币安广场文章 URL
   * @returns {Promise<Object|null>} 文章信息，获取失败时返回最小元数据
   */
  static async fetchPostInfo(url) {
    return CachedFetcher.fetchWithCache(url, 'binance_square', async () => this._fetchPostInfoInternal(url), getCacheTTL('binance_square'));
  }

  /**
   * fetchPostInfo 的内部实现
   */
  static async _fetchPostInfoInternal(url) {
    if (!url) return null;

    const postId = this._extractPostId(url);

    try {
      console.log(`[BinanceSquareFetcher] 开始获取: ${url}`);
      // bapi 直连优先（2026-10-01，C39 BI 案）：帖子页 WAF 202 空体 + JustOneAPI key
      // 长期占位符（your-j***）致整链降级 minimal 全空——实测 www.binance.com 的
      // content/detail bapi 裸 curl 即通（免 key/免登录/免渲染），title/作者+官方
      // 认证类型/互动统计/发布时间结构化可得；正文 body 需登录态（已知边界，标题
      // 通常已含事件核心）。bapi 成功即返回（省 JustOneAPI 配额），失败降级旧链。
      const bapiInfo = await this._fetchViaBapi(postId);
      if (bapiInfo) {
        console.log(`[BinanceSquareFetcher] 获取成功: "${bapiInfo.title || '无标题'}" (via ${bapiInfo.fetchMethod}${bapiInfo.authorVerified ? ', 官方认证' : ''})`);
        return bapiInfo;
      }

      const info = await this._fetchViaJustOneAPI(url);

      if (info) {
        console.log(`[BinanceSquareFetcher] 获取成功: "${info.title || '无标题'}" (via ${info.fetchMethod})`);
        return info;
      }

      // API 返回成功但无法解析出内容，降级到最小元数据
      console.log('[BinanceSquareFetcher] API 返回数据但无法解析有效内容，降级到最小元数据');
      return this._buildMinimalMetadata(url, postId);

    } catch (error) {
      console.warn(`[BinanceSquareFetcher] 获取失败: ${error.message}`);
      return this._buildMinimalMetadata(url, postId);
    }
  }

  /**
   * 币安自家 bapi 直连获取帖子元数据（2026-10-01，C39）
   * GET /bapi/composite/v3/friendly/pgc/special/content/detail/{postId}?lang=zh-CN
   * 实测免 key/免登录/免渲染可通（浏览器 UA 即可），返回 title/作者+认证类型/
   * 互动统计/发布时间；正文 body/bodyTextOnly 需登录态恒空（已知边界）。
   * @param {string} postId - 帖子 ID（URL 提取）
   * @returns {Promise<Object|null>} 与 JustOneAPI 输出同构的文章信息
   */
  static async _fetchViaBapi(postId) {
    if (!postId) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const apiUrl = `https://www.binance.com/bapi/composite/v3/friendly/pgc/special/content/detail/${postId}?lang=zh-CN`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'clienttype': 'web',
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[BinanceSquareFetcher] bapi HTTP状态码: ${response.status}`);
        return null;
      }
      const data = await response.json();
      if (data.code !== '000000' || !data.data?.title) {
        console.warn(`[BinanceSquareFetcher] bapi 返回无效: code=${data.code}`);
        return null;
      }
      const d = data.data;
      const content = this._cleanText(d.bodyTextOnly || '', 3000) || null;
      const authorParts = [d.displayName, d.username ? `@${d.username}` : null].filter(Boolean);
      return {
        title: this._cleanText(d.title, 500),
        content,
        author: authorParts.join(' ') || null,
        authorId: d.username || null,
        postId: String(d.id || postId),
        likeCount: d.likeCount || 0,
        commentCount: d.commentCount || 0,
        shareCount: d.shareCount || 0,
        followerCount: d.totalFollowerCount || 0,
        publishedAt: d.firstReleaseTime ? new Date(d.firstReleaseTime).toISOString() : null,
        tags: (Array.isArray(d.hashtagList) ? d.hashtagList : [])
          .map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
        fetchMethod: 'bapi',
        // 官方认证（authorVerificationType>0）与浏览量：叙事强信号，section 消费
        authorVerified: (d.authorVerificationType || 0) > 0,
        viewCount: d.viewCount || 0,
      };

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.warn('[BinanceSquareFetcher] bapi 请求超时');
      } else {
        console.warn(`[BinanceSquareFetcher] bapi 请求异常: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * 通过 JustOneAPI web/html/v1 获取文章内容
   * JustOneAPI 能绕过币安 WAF，返回完整页面 HTML
   * @param {string} url - 币安广场文章 URL
   * @returns {Promise<Object|null>} 解析后的文章信息
   */
  static async _fetchViaJustOneAPI(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const apiUrl = `${JUSTONEAPI_HTML_URL}?token=${JUSTONEAPI_KEY}&url=${encodeURIComponent(url)}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[BinanceSquareFetcher] JustOneAPI HTTP状态码: ${response.status}`);
        return null;
      }

      const data = await response.json();

      // code=0 表示成功，code=301 表示 URL 无效/页面不存在
      if (data.code !== 0) {
        console.warn(`[BinanceSquareFetcher] JustOneAPI 返回错误: code=${data.code}, message=${data.message || ''}`);
        // code=301 说明 URL 对应的页面不存在，不需要降级到最小元数据
        // 直接返回 null，让上层构建 minimal metadata（含 postId）
        return null;
      }

      if (!data.data?.data) {
        console.warn('[BinanceSquareFetcher] JustOneAPI 返回数据为空');
        return null;
      }

      const html = data.data.data;
      if (html.length < 500) {
        console.warn('[BinanceSquareFetcher] 返回 HTML 过短，可能不是有效页面');
        return null;
      }

      // 解析 HTML 提取文章内容
      return this._parseHtml(html, url);

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.warn('[BinanceSquareFetcher] JustOneAPI 请求超时');
      } else {
        console.warn(`[BinanceSquareFetcher] JustOneAPI 请求异常: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * 解析 HTML 提取文章内容
   * 优先级：JSON-LD 结构化数据 → meta 标签
   * @param {string} html - 页面 HTML
   * @param {string} url - 原始 URL
   * @returns {Object|null} 解析后的文章信息
   */
  static _parseHtml(html, url) {
    // 策略 1：提取 JSON-LD（币安广场使用 DiscussionForumPosting 结构）
    const jsonLdInfo = this._extractFromJsonLd(html, url);
    if (jsonLdInfo && (jsonLdInfo.title || jsonLdInfo.content)) {
      return jsonLdInfo;
    }

    // 策略 2：提取 meta 标签（og:title, og:description, twitter:title 等）
    const metaInfo = this._extractFromMetaTags(html);
    if (metaInfo && (metaInfo.title || metaInfo.content)) {
      return metaInfo;
    }

    console.warn('[BinanceSquareFetcher] 所有解析策略均未提取到有效内容');
    return null;
  }

  /**
   * 从 JSON-LD 提取文章信息
   * 币安广场使用 DiscussionForumPosting 结构，包含：
   * - headline: 标题
   * - text: 正文内容
   * - author: 作者信息（name, url, agentInteractionStatistic.userInteractionCount 粉丝数）
   * - interactionStatistic: 点赞数（LikeAction）
   * - datePublished: 发布时间
   * @param {string} html - 页面 HTML
   * @param {string} url - 原始 URL
   * @returns {Object|null}
   */
  static _extractFromJsonLd(html, url) {
    const jsonLdPattern = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);

        // 币安广场使用 DiscussionForumPosting 类型
        const post = Array.isArray(data)
          ? data.find(d => d['@type'] === 'DiscussionForumPosting' || d['@type'] === 'Article')
          : data;

        if (!post) continue;

        const title = post.headline || post.name || null;
        const content = post.text || post.articleBody || post.description || null;
        const authorName = post.author?.name || null;
        const authorUrl = post.author?.url || null;
        // 从 author URL 提取 authorId（如 /square/profile/binancecn）
        const authorId = authorUrl
          ? (authorUrl.match(/\/square\/profile\/([\w-]+)/i)?.[1] || null)
          : null;
        // 粉丝数
        const followerCount = post.author?.agentInteractionStatistic?.userInteractionCount || 0;
        // 点赞数
        const likeCount = post.interactionStatistic?.userInteractionCount || 0;
        const publishedAt = post.datePublished || null;

        // 从正文提取 tags（#标签）
        const tags = [];
        if (content) {
          const hashtagRegex = /#(\S+)/g;
          let tagMatch;
          while ((tagMatch = hashtagRegex.exec(content)) !== null) {
            const tag = tagMatch[1];
            if (tag.length <= 30 && !tags.includes(tag)) {
              tags.push(tag);
            }
          }
        }

        return {
          title: this._cleanText(title),
          content: this._cleanText(content, 3000),
          author: authorName,
          authorId,
          postId: this._extractPostId(url),
          likeCount: Number(likeCount) || 0,
          commentCount: 0,
          shareCount: 0,
          followerCount: Number(followerCount) || 0,
          publishedAt: this._formatDate(publishedAt),
          tags: tags.slice(0, 10),
          fetchMethod: 'justoneapi'
        };
      } catch {
        // 跳过无效的 JSON-LD
      }
    }
    return null;
  }

  /**
   * 从 meta 标签提取文章信息
   * @param {string} html
   * @returns {Object|null}
   */
  static _extractFromMetaTags(html) {
    const getMeta = (property) => {
      const patterns = [
        new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, 'i'),
        new RegExp(`<meta\\s+content="([^"]*)"\\s+property="${property}"`, 'i'),
        new RegExp(`<meta\\s+name="${property}"\\s+content="([^"]*)"`, 'i'),
        new RegExp(`<meta\\s+content="([^"]*)"\\s+name="${property}"`, 'i')
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return this._decodeHtmlEntities(match[1]);
      }
      return null;
    };

    const title = getMeta('og:title') || getMeta('twitter:title');
    const description = getMeta('og:description') || getMeta('twitter:description');

    if (!title && !description) return null;

    return {
      title: this._cleanText(title),
      content: this._cleanText(description, 3000),
      author: null,
      authorId: null,
      postId: null,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      followerCount: 0,
      publishedAt: null,
      tags: [],
      fetchMethod: 'justoneapi'
    };
  }

  /**
   * 构建最小元数据（获取失败时的降级方案）
   * 仅有 postId，无实际内容
   * @param {string} url
   * @param {string} postId
   * @returns {Object}
   */
  static _buildMinimalMetadata(url, postId) {
    return {
      title: null,
      content: null,
      author: null,
      authorId: null,
      postId,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      followerCount: 0,
      publishedAt: null,
      tags: [],
      fetchMethod: 'minimal'
    };
  }

  /**
   * 从 URL 提取 post ID
   * @param {string} url
   * @returns {string|null}
   */
  static _extractPostId(url) {
    if (!url) return null;
    const match = url.match(/\/square\/post\/(\d+)/i);
    return match ? match[1] : null;
  }

  /**
   * 获取影响力等级
   * @param {Object} info - 文章信息
   * @returns {string} 影响力等级
   */
  static getInfluenceLevel(info) {
    const likeCount = info?.likeCount || 0;

    if (likeCount >= 5000) return 'world';
    if (likeCount >= 500) return 'platform';
    if (likeCount >= 50) return 'community';
    return 'niche';
  }

  /**
   * 获取影响力描述
   * @param {string} level - 影响力等级
   * @returns {string} 描述
   */
  static getInfluenceDescription(level) {
    const descriptions = {
      'world': '世界级影响力（5000+点赞）',
      'platform': '平台级影响力（500+点赞）',
      'community': '社区级影响力（50+点赞）',
      'niche': '小众影响力（50以下点赞）'
    };
    return descriptions[level] || '未知影响力';
  }

  /**
   * 清理文本（去除 HTML 标签，截断长度）
   * @param {string} text
   * @param {number} maxLength
   * @returns {string|null}
   */
  static _cleanText(text, maxLength = 0) {
    if (!text || typeof text !== 'string') return null;

    let cleaned = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\\n/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();

    if (maxLength > 0 && cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '...';
    }

    return cleaned || null;
  }

  /**
   * 解码 HTML 实体
   * @param {string} text
   * @returns {string}
   */
  static _decodeHtmlEntities(text) {
    if (!text) return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'");
  }

  /**
   * 格式化日期
   * @param {string|number} dateInput
   * @returns {string|null}
   */
  static _formatDate(dateInput) {
    if (!dateInput) return null;
    try {
      let timestamp = dateInput;
      if (typeof timestamp === 'number') {
        if (timestamp < 1e12) timestamp *= 1000;
      } else if (typeof timestamp === 'string') {
        const num = Number(timestamp);
        if (!isNaN(num) && num > 0) {
          timestamp = num < 1e12 ? num * 1000 : num;
        }
      }
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return typeof dateInput === 'string' ? dateInput : null;
      return date.toISOString();
    } catch {
      return typeof dateInput === 'string' ? dateInput : null;
    }
  }
}
