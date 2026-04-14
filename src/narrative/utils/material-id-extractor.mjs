/**
 * 叙事表征语料ID提取器
 * 从代币的 raw_api_data 中提取唯一标识该叙事素材的 ID
 * 用于识别同一叙事素材被反复使用的"叙事复用"行为
 */

import { extractAllUrls, classifyAllUrls } from './url-classifier.mjs';

// 非独立网站域名黑名单（公共平台，不适合作为叙事语料标识）
const NON_STANDALONE_DOMAINS = [
  't.me', 'telegram.org', 'discord.gg', 'discord.com',
  'pancakeswap.finance', 'pancakeswap.com', 'uniswap.org',
  'dexscreener.com', 'dextools.io', 'geckoterminal.com',
  'ave.ai', 'birdeye.so', 'jupiter.ag', 'raydium.io',
  'google.com', 'bing.com', 'baidu.com',
  'facebook.com', 'instagram.com', 'linkedin.com',
  'tinyurl.com', 'bit.ly', 't.co', 'lnkd.in',
  'four.meme', 'pump.fun', 'moonshot.money'
];

/**
 * 从代币数据中提取叙事表征语料ID
 *
 * @param {Object} rawApiData - 代币的 raw_api_data（已解析的对象）
 * @returns {string|null} material ID，无法提取时返回 null
 *
 * 提取优先级：
 * 1. Twitter 推文 ID（如 "1891234567890123456"）
 * 2. Twitter 账号名（如 "tw:elonmusk"）
 * 3. 独立网站域名（如 "web:example.com"）
 * 4. 视频 ID（YouTube/抖音/TikTok/Bilibili，如 "video:yt:dQw4w9WgXcQ"）
 * 5. 微博/小红书/微信等（如 "wb:1234567890"）
 */
export function extractNarrativeMaterialId(rawApiData) {
  if (!rawApiData) return null;

  // 1. 提取所有 URL
  const allUrls = extractAllUrls(rawApiData);
  if (!allUrls || allUrls.length === 0) return null;

  // 2. 分类 URL
  const classified = classifyAllUrls(allUrls);

  // 3. 按优先级提取

  // 优先级1：Twitter 推文 ID
  const tweetId = _extractFromTwitterTweets(classified.twitter);
  if (tweetId) return tweetId;

  // 优先级2：Twitter 账号名
  const accountId = _extractFromTwitterAccounts(classified.twitter);
  if (accountId) return accountId;

  // 优先级3：独立网站域名
  const websiteId = _extractFromWebsites(classified.websites);
  if (websiteId) return websiteId;

  // 优先级4：视频 ID（YouTube > 抖音 > TikTok > Bilibili）
  const videoId = _extractFromVideos(classified);
  if (videoId) return videoId;

  // 优先级5：微博/小红书/微信等
  const otherId = _extractFromOtherPlatforms(classified);
  if (otherId) return otherId;

  return null;
}

/**
 * 从 Twitter 推文 URL 中提取推文 ID
 * 返回格式：纯数字字符串（如 "1891234567890123456"）
 */
function _extractFromTwitterTweets(twitterUrls) {
  if (!twitterUrls || twitterUrls.length === 0) return null;

  for (const item of twitterUrls) {
    if (item.type === 'tweet' || item.type === 'community') {
      // 推文链接：提取 status ID
      const match = item.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
      if (match) return match[1];

      // 社区链接：提取 community ID
      const communityMatch = item.url.match(/\/i\/communities\/(\d+)/i);
      if (communityMatch) return communityMatch[1];
    }
  }
  return null;
}

/**
 * 从 Twitter 账号 URL 中提取用户名
 * 返回格式："tw:username"
 */
function _extractFromTwitterAccounts(twitterUrls) {
  if (!twitterUrls || twitterUrls.length === 0) return null;

  for (const item of twitterUrls) {
    if (item.type === 'account') {
      const match = item.url.match(/(?:x\.com|twitter\.com)\/([\w-]+)\/?$/i);
      if (match) {
        const username = match[1].toLowerCase();
        // 排除系统路径
        if (!['i', 'search', 'explore', 'home', 'settings'].includes(username)) {
          return `tw:${username}`;
        }
      }
    }
  }
  return null;
}

/**
 * 从独立网站 URL 中提取域名
 * 返回格式："web:example.com"
 */
function _extractFromWebsites(websiteUrls) {
  if (!websiteUrls || websiteUrls.length === 0) return null;

  for (const item of websiteUrls) {
    try {
      const urlObj = new URL(item.url);
      let hostname = urlObj.hostname.toLowerCase();

      // 去掉 www. 前缀
      hostname = hostname.replace(/^www\./, '');

      // 排除非独立网站
      if (_isNonStandaloneDomain(hostname)) continue;

      return `web:${hostname}`;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 从视频平台 URL 中提取视频 ID
 * 返回格式："video:{platform}:{id}"
 */
function _extractFromVideos(classified) {
  // 按平台优先级遍历
  const platforms = [
    { key: 'youtube', prefix: 'yt', extractors: [
      (url) => url.match(/youtube\.com\/watch\?v=([^&]+)/),
      (url) => url.match(/youtu\.be\/([^?]+)/),
      (url) => url.match(/youtube\.com\/embed\/([^?]+)/),
      (url) => url.match(/youtube\.com\/shorts\/([^?]+)/)
    ]},
    { key: 'douyin', prefix: 'dy', extractors: [
      (url) => url.match(/douyin\.com\/video\/(\d+)/),
      (url) => url.match(/douyin\.com\/.*\/(\d+)/)
    ]},
    { key: 'tiktok', prefix: 'tt', extractors: [
      (url) => url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/),
      (url) => url.match(/tiktok\.com\/.*\/video\/(\d+)/)
    ]},
    { key: 'bilibili', prefix: 'bili', extractors: [
      (url) => url.match(/bilibili\.com\/video\/(BV[\w]+)/),
      (url) => url.match(/bilibili\.com\/video\/(av\d+)/),
      (url) => url.match(/b23\.tv\/([\w-]+)/)
    ]}
  ];

  for (const platform of platforms) {
    const urls = classified[platform.key];
    if (!urls || urls.length === 0) continue;

    for (const item of urls) {
      for (const extractor of platform.extractors) {
        const match = extractor(item.url);
        if (match) return `video:${platform.prefix}:${match[1]}`;
      }
    }
  }

  return null;
}

/**
 * 从微博/小红书/微信等平台提取内容 ID
 * 返回格式带平台前缀
 */
function _extractFromOtherPlatforms(classified) {
  // 微博
  if (classified.weibo && classified.weibo.length > 0) {
    for (const item of classified.weibo) {
      const match = item.url.match(/weibo\.com\/\d+\/(\w+)/) ||
                    item.url.match(/weibo\.com\/detail\/(\d+)/) ||
                    item.url.match(/weibo\.com\/status\/(\d+)/);
      if (match) return `wb:${match[1]}`;
    }
  }

  // 小红书
  if (classified.xiaohongshu && classified.xiaohongshu.length > 0) {
    for (const item of classified.xiaohongshu) {
      const match = item.url.match(/xiaohongshu\.com\/explore\/([\w]+)/) ||
                    item.url.match(/xiaohongshu\.com\/discovery\/item\/([\w]+)/) ||
                    item.url.match(/xhslink\.com\/([\w]+)/);
      if (match) return `xhs:${match[1]}`;
    }
  }

  // 微信
  if (classified.weixin && classified.weixin.length > 0) {
    for (const item of classified.weixin) {
      const match = item.url.match(/mp\.weixin\.qq\.com\/s\/([\w-]+)/);
      if (match) return `wx:${match[1]}`;
    }
  }

  return null;
}

/**
 * 判断域名是否为非独立网站
 */
function _isNonStandaloneDomain(hostname) {
  return NON_STANDALONE_DOMAINS.some(domain => {
    return hostname === domain || hostname.endsWith('.' + domain);
  });
}
