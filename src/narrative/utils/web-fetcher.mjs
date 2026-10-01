/**
 * 网页内容获取工具
 * 用于获取网站正文内容，供叙事分析使用
 */

import { safeSubstring } from '../analyzer/utils/data-cleaner.mjs';
import { CachedFetcher } from '../db/ExternalResourceCache.mjs';
import { getCacheTTL } from '../db/cache-ttl-config.mjs';

/**
 * 获取网页内容（带缓存）
 * @param {string} url - 网站URL
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 网页内容
 */
export async function fetchWebsiteContent(url, options = {}) {
  if (!url) return null;

  return CachedFetcher.fetchWithCache(
    url,
    'website',
    async () => _fetchWebsiteContentInternal(url, options),
    getCacheTTL('website')
  );
}

/**
 * 获取网页内容（实际HTTP请求）
 *
 * C41（2026-10-01 用户裁定 A，RedCoin 案 0xe2881a7a…7777）：主抓失败
 * （403/Cloudflare JS 挑战/超时/内容提取失败）时回退 r.jina.ai 代理一次——
 * 免 key GET，返回 markdown 正文，实测直通 Cloudflare 站点（SCMP 等）。
 * 与「语料物理删除」（fail-closed 正确拦）不同，本案是「源活着但管道被
 * 反爬挡」（C39 币安广场 WAF 同族）。回退成功 ExternalResourceCache 照常
 * 缓存（website TTL），失败缓存 null——量在免费限流（~20 req/min）内可控。
 */
export async function _fetchWebsiteContentInternal(url, options = {}) {
  const direct = await _fetchDirect(url, options);
  if (direct) return direct;
  return _fetchViaJinaReader(url, options);
}

/**
 * 直接抓取原 URL（原 _fetchWebsiteContentInternal 主体，无改动）
 */
async function _fetchDirect(url, options = {}) {
  const { maxLength = 5000, timeout = 15000 } = options;

  if (!url) {
    return null;
  }

  console.log(`[WebFetcher] 获取网页内容: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[WebFetcher] HTTP错误: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // 提取正文内容
    const content = extractMainContent(html, url);

    if (!content || content.length < 50) {
      console.warn('[WebFetcher] 未能提取到有效内容');
      return null;
    }

    // 截取内容
    const truncatedContent = safeSubstring(content, maxLength);

    console.log(`[WebFetcher] 成功获取内容，长度: ${content.length} 字符`);

    return {
      type: 'website',
      url: url,
      content: truncatedContent,
      original_length: content.length,
      rawHtml: safeSubstring(html, 10000, '')
    };

  } catch (error) {
    console.error(`[WebFetcher] 获取网页失败: ${error.message}`);
    return null;
  }
}

/** r.jina.ai Reader 代理地址（免 key，GET 原URL 直拼路径） */
const JINA_READER_BASE = 'https://r.jina.ai/';

/**
 * r.jina.ai 回退抓取（仅主抓失败时调用一次）
 * 返回形状与 _fetchDirect 同构（下游 websiteInfo/hasValidDataForAnalysis 零改动），
 * 附 fetchedVia 审计字段；Published Time 解析出来时仿 twitter-section 模式
 * 拼进 content 头部（Jev timing 题有时间信息可判，C39 同款做法）
 */
async function _fetchViaJinaReader(url, options = {}) {
  const { maxLength = 5000, timeout = 20000 } = options;

  if (!url) {
    return null;
  }

  console.log(`[WebFetcher] 主抓失败，回退 r.jina.ai 代理: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(JINA_READER_BASE + url, {
      signal: controller.signal,
      // ⚠️ 不带浏览器 UA：r.jina.ai 对伪装 Chrome UA 的请求 403（反滥用），
      // curl 默认 UA / 无 UA 放行（实测对拍 200 vs 403）
      headers: {
        'User-Agent': 'richer-js-narrative/1.0'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[WebFetcher] r.jina.ai 回退 HTTP错误: ${response.status}`);
      return null;
    }

    const text = await response.text();
    const parsed = parseJinaReaderOutput(text);

    // 挑战页穿透检测（jina 偶尔拿到 Cloudflare 挑战页而非正文）
    const challengeHit = parsed && /just a moment|checking your browser|enable javascript and cookies/i.test(parsed.content);

    if (!parsed || parsed.content.length < 50 || challengeHit) {
      console.warn('[WebFetcher] r.jina.ai 回退未能提取到有效内容');
      return null;
    }

    const contentWithTime = parsed.publishedTime
      ? `[发布时间: ${parsed.publishedTime}]\n${parsed.content}`
      : parsed.content;
    const truncatedContent = safeSubstring(contentWithTime, maxLength);

    console.log(`[WebFetcher] r.jina.ai 回退成功，长度: ${parsed.content.length} 字符${parsed.publishedTime ? `，发布时间: ${parsed.publishedTime}` : ''}`);

    return {
      type: 'website',
      url: url,
      content: truncatedContent,
      original_length: contentWithTime.length,
      rawHtml: safeSubstring(text, 10000, ''),
      fetchedVia: 'r.jina.ai',
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.publishedTime ? { publishedTime: parsed.publishedTime } : {}),
    };

  } catch (error) {
    console.warn(`[WebFetcher] r.jina.ai 回退失败: ${error.message}`);
    return null;
  }
}

/**
 * 解析 r.jina.ai Reader 输出（导出供单测）
 * 格式（实测）：
 *   Title: <标题>
 *   URL Source: <原URL>
 *   Published Time: <ISO8601，可选>
 *   Markdown Content:
 *   <markdown 正文>
 * 无标准头（部分站点直接吐内容）时整体当正文
 * @param {string} text - r.jina.ai 响应全文
 * @returns {{title: string|null, urlSource: string|null, publishedTime: string|null, content: string}|null}
 */
export function parseJinaReaderOutput(text) {
  if (!text) return null;
  const lines = text.split('\n');
  let title = null;
  let urlSource = null;
  let publishedTime = null;
  let contentStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (title === null && /^Title: /.test(line)) { title = line.slice('Title: '.length).trim(); continue; }
    if (urlSource === null && /^URL Source: /.test(line)) { urlSource = line.slice('URL Source: '.length).trim(); continue; }
    if (publishedTime === null && /^Published Time: /.test(line)) { publishedTime = line.slice('Published Time: '.length).trim(); continue; }
    if (line.trim() === 'Markdown Content:') { contentStartIdx = i + 1; break; }
  }
  if (contentStartIdx === -1) {
    const raw = text.trim();
    return raw ? { title: null, urlSource: null, publishedTime: null, content: raw } : null;
  }
  const content = lines.slice(contentStartIdx).join('\n').trim();
  return { title: title || null, urlSource: urlSource || null, publishedTime: publishedTime || null, content };
}

/**
 * 检测是否是错误页面（如JavaScript disabled、页面错误等）
 * @param {string} content - 提取的文本内容
 * @returns {boolean} 是否是错误页面
 */
function isErrorPage(content) {
  if (!content || content.length < 50) {
    return false;
  }

  const lowerContent = content.toLowerCase();

  // 错误页面的特征关键词组合
  const errorPatterns = [
    // JavaScript is not available 相关
    'javascript is not available',
    'javascript is disabled',
    "we've detected that javascript",
    'detected that javascript',

    // 页面错误相关
    "something went wrong",
    "but don't fret",
    "let's give it another shot",
    'try again',

    // 隐私/扩展相关错误提示
    'some privacy related extensions',
    'may cause issues',
    'please disable',

    // X.com/Twitter特定错误
    'supported browsers',
    'help center',
    'terms of service',
    'privacy policy',
    'cookie policy',
    'imprint',
    'ads info',
    '© 2026 x corp'
  ];

  // 检查是否包含多个错误特征（避免误判正常页面）
  let matchCount = 0;
  for (const pattern of errorPatterns) {
    if (lowerContent.includes(pattern)) {
      matchCount++;
      if (matchCount >= 2) {
        return true; // 至少匹配2个特征才认为是错误页面
      }
    }
  }

  // 特殊情况：如果内容很短且包含"javascript is not available"，直接判定为错误页面
  if (content.length < 500 && lowerContent.includes('javascript is not available')) {
    return true;
  }

  return false;
}

/**
 * 从HTML中提取正文内容
 * @param {string} html - HTML内容
 * @param {string} url - 原始URL（用于判断）
 * @returns {string} 提取的正文内容
 */
function extractMainContent(html, url) {
  // 简单的HTML标签清理和内容提取
  let content = html;

  // 移除script和style标签
  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 移除所有HTML标签
  content = content.replace(/<[^>]+>/g, '');

  // 解码HTML实体
  content = content
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  // 清理多余的空白字符
  content = content
    .replace(/\s+/g, ' ')
    .trim();

  // 检测是否是"JavaScript is not available"等错误页面
  if (isErrorPage(content)) {
    console.warn('[WebFetcher] 检测到错误页面（JavaScript disabled/页面错误），视为未获取到内容');
    return '';
  }

  return content;
}

/**
 * 判断URL是否可以获取内容
 * @param {string} url - URL
 * @returns {boolean} 是否可获取
 */
export function isFetchableUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // 排除一些不需要获取的URL
  const excludedPatterns = [
    /^https?:\/\/(www\.)?twitter\.com\/[^\/]+$/,     // Twitter主页链接（排除）
    /^https?:\/\/(www\.)?x\.com\/[^\/]+$/,            // X主页链接（排除）
    /^https?:\/\/t\.co/,                              // Twitter短链接
    /^https?:\/\/(www\.)?youtube\.com/,           // 视频网站
    /^https?:\/\/(www\.)?tiktok\.com/,            // 视频网站
    /^https?:\/\/(www\.)?douyin\.com/,            // 视频网站
    /^https?:\/\/(www\.)?bilibili\.com/,          // 视频网站
    /^https?:\/\/(www\.)?b23\.tv/,                // B站短链接
    /^https?:\/\/mp\.weixin\.qq\.com/,            // 微信公众号文章（有专门fetcher）
    // DEX（去中心化交易所）交易页面
    /^https?:\/\/(www\.)?pancakeswap\.finance/,   // PancakeSwap
    /^https?:\/\/(www\.)?pancakeswap\.com/,       // PancakeSwap
    /^https?:\/\/(www\.)?uniswap\.org/,           // Uniswap
    /^https?:\/\/(www\.)?sushiswap\.com/,         // SushiSwap
    /^https?:\/\/(www\.)?curve\.fi/,              // Curve
    /^https?:\/\/(www\.)?1inch\.io/,              // 1inch
    /^https?:\/\/(www\.)?raydium\.io/,            // Raydium (Solana)
    /^https?:\/\/(www\.)?jupiter\.ag/,            // Jupiter (Solana)
    /^https?:\/\/(www\.)?orca\.so/,               // Orca (Solana)
    /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i,       // 图片文件
    /\.(mp4|mov|avi|mkv|webm|flv)$/i,             // 视频文件
    /\.(mp3|wav|ogg|flac|aac)$/i,                  // 音频文件
    /^data:/,                                      // data URI
    /^(javascript|mailto|tel):/                     // 非http协议
  ];

  return !excludedPatterns.some(pattern => pattern.test(url));
}

/**
 * 检测URL是否是Twitter/X推文链接
 * @param {string} url - URL
 * @returns {boolean} 是否是推文链接
 */
export function isTwitterTweetUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // 匹配 Twitter/X 推文链接格式：
  // https://x.com/username/status/123456
  // https://twitter.com/username/status/123456
  const tweetUrlPattern = /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w-]+\/status\/\d+/;
  return tweetUrlPattern.test(url);
}
