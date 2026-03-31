/**
 * URL分类器
 * 统一提取、分类、选择URL
 */

/**
 * 从任意数据中提取所有URL
 * @param {*} data - 任意数据（对象、字符串、数组等）
 * @returns {Array<string>} URL列表
 */
export function extractAllUrls(data) {
  const urls = new Set();
  let stringCount = 0;
  let objectCount = 0;

  const traverse = (obj, depth = 0) => {
    // 限制递归深度，防止无限循环
    if (depth > 20) return;

    if (typeof obj === 'string') {
      stringCount++;
      // 查找URL模式
      const urlPattern = /https?:\/\/[^\s<>"]+/gi;
      const found = obj.match(urlPattern);
      if (found) {
        found.forEach(url => {
          // 清理URL末尾的标点
          const cleaned = url.replace(/[.,;:!?)>]+$/, '');
          urls.add(cleaned);
        });
      }
    } else if (Array.isArray(obj)) {
      objectCount++;
      obj.forEach(item => traverse(item, depth + 1));
    } else if (obj && typeof obj === 'object') {
      objectCount++;
      Object.values(obj).forEach(value => traverse(value, depth + 1));
    }
  };

  traverse(data);
  console.log(`[UrlClassifier] extractAllUrls: 扫描了${stringCount}个字符串、${objectCount}个对象/数组，提取到${urls.size}个URL`);
  return Array.from(urls);
}

/**
 * 识别单个URL的类型
 * @param {string} url
 * @returns {Object} { type, platform, priority, url }
 */
export function classifyUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // 过滤图片链接（代币logo等）
  if (_isImageUrl(url)) {
    console.log(`[UrlClassifier] URL被识别为图片，跳过: ${url}`);
    return null; // 图片链接不计入任何分类
  }

  // 验证必须是有效的URL格式（必须以 http:// 或 https:// 开头）
  if (!/^https?:\/\//i.test(url)) {
    console.log(`[UrlClassifier] URL格式无效（非http/https）: ${url}`);
    return null; // 非URL格式（如 "pancake"）不作为网站处理
  }

  const normalizedUrl = url.toLowerCase();

  // Twitter/X (推文) - 优先级最高
  if (_isTwitterTweetUrl(url)) {
    console.log(`[UrlClassifier] URL识别为Twitter推文: ${url}`);
    return { type: 'tweet', platform: 'twitter', priority: 1, url };
  }

  // Twitter/X (账号)
  if (_isTwitterAccountUrl(url)) {
    console.log(`[UrlClassifier] URL识别为Twitter账号: ${url}`);
    return { type: 'account', platform: 'twitter', priority: 2, url };
  }

  // 微博
  if (_isWeiboUrl(url)) {
    return { type: 'post', platform: 'weibo', priority: 1, url };
  }

  // YouTube
  if (_isYouTubeUrl(url)) {
    return { type: 'video', platform: 'youtube', priority: 1, url };
  }

  // TikTok
  if (_isTikTokUrl(url)) {
    return { type: 'video', platform: 'tiktok', priority: 1, url };
  }

  // 抖音
  if (_isDouyinUrl(url)) {
    return { type: 'video', platform: 'douyin', priority: 1, url };
  }

  // Bilibili
  if (_isBilibiliUrl(url)) {
    return { type: 'video', platform: 'bilibili', priority: 1, url };
  }

  // 微信公众号文章
  if (_isWeixinUrl(url)) {
    return { type: 'article', platform: 'weixin', priority: 1, url };
  }

  // GitHub
  if (_isGitHubUrl(url)) {
    return { type: 'repository', platform: 'github', priority: 1, url };
  }

  // Amazon产品页面
  if (_isAmazonProductUrl(url)) {
    return { type: 'product', platform: 'amazon', priority: 1, url };
  }

  // Telegram
  if (_isTelegramUrl(url)) {
    console.log(`[UrlClassifier] URL识别为Telegram: ${url}`);
    return { type: 'channel', platform: 'telegram', priority: 2, url };
  }

  // Discord
  if (_isDiscordUrl(url)) {
    console.log(`[UrlClassifier] URL识别为Discord: ${url}`);
    return { type: 'server', platform: 'discord', priority: 2, url };
  }

  // PancakeSwap 交易页面（DEX链接，不需要作为网站内容获取）
  if (_isDexUrl(url)) {
    console.log(`[UrlClassifier] URL被识别为DEX链接，跳过: ${url}`);
    return null; // 过滤掉DEX交易链接
  }

  // 默认为普通网站
  console.log(`[UrlClassifier] URL识别为普通网站: ${url}`);
  return { type: 'website', platform: 'web', priority: 3, url };
}

/**
 * 分类所有URL
 * @param {Array<string>} urls
 * @returns {Object} 按平台分组
 */
export function classifyAllUrls(urls) {
  const result = {
    twitter: [],      // 包含tweet和account
    weibo: [],
    youtube: [],
    tiktok: [],
    douyin: [],
    bilibili: [],
    weixin: [],       // 微信公众号文章
    github: [],
    amazon: [],
    telegram: [],     // 新增：Telegram频道/群组
    discord: [],      // 新增：Discord服务器
    websites: []
  };

  if (!urls || urls.length === 0) {
    return result;
  }

  urls.forEach(url => {
    const info = classifyUrl(url);
    if (!info) return;

    switch (info.platform) {
      case 'twitter':
        result.twitter.push(info);
        break;
      case 'weibo':
        result.weibo.push(info);
        break;
      case 'youtube':
        result.youtube.push(info);
        break;
      case 'tiktok':
        result.tiktok.push(info);
        break;
      case 'douyin':
        result.douyin.push(info);
        break;
      case 'bilibili':
        result.bilibili.push(info);
        break;
      case 'weixin':
        result.weixin.push(info);
        break;
      case 'github':
        result.github.push(info);
        break;
      case 'amazon':
        result.amazon.push(info);
        break;
      case 'telegram':
        result.telegram.push(info);
        break;
      case 'discord':
        result.discord.push(info);
        break;
      default:
        result.websites.push(info);
    }
  });

  return result;
}

/**
 * 选择每种平台的最佳URL
 * @param {Object} classifiedUrls
 * @returns {Object} 最佳URL配置
 */
export function selectBestUrls(classifiedUrls) {
  if (!classifiedUrls) {
    return {
      twitter: null,
      weibo: null,
      youtube: null,
      tiktok: null,
      douyin: null,
      bilibili: null,
      weixin: null,
      github: null,
      amazon: null,
      telegram: null,
      discord: null,
      website: null
    };
  }

  return {
    twitter: _selectBestUrlForPlatform(classifiedUrls.twitter, 'tweet'),
    weibo: classifiedUrls.weibo[0] || null,
    youtube: classifiedUrls.youtube[0] || null,
    tiktok: classifiedUrls.tiktok[0] || null,
    douyin: classifiedUrls.douyin[0] || null,
    bilibili: classifiedUrls.bilibili[0] || null,
    weixin: classifiedUrls.weixin[0] || null,
    github: classifiedUrls.github[0] || null,
    amazon: classifiedUrls.amazon[0] || null,
    telegram: classifiedUrls.telegram[0] || null,
    discord: classifiedUrls.discord[0] || null,
    website: classifiedUrls.websites[0] || null
  };
}

// ========== 私有方法：URL识别 ==========

function _isTwitterTweetUrl(url) {
  // 匹配 twitter.com or x.com 的推文链接
  // 支持两种格式：
  // 1. https://x.com/username/status/123456 (标准格式)
  // 2. https://x.com/i/web/status/123456 (i/web格式)
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/(i\/web\/|[\w-]+\/)status\/\d+/.test(url);
}

function _isTwitterAccountUrl(url) {
  // 匹配 twitter.com or x.com 的账号链接（不含/status/）
  // 先移除查询参数和哈希，再进行匹配
  try {
    const urlObj = new URL(url);
    const pathOnly = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    return /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w-]+\/?$/.test(pathOnly);
  } catch {
    return false;
  }
}

function _isWeiboUrl(url) {
  // 匹配 weibo.com, vveibo.com, vveib0.com 等微博变体域名
  // vveib[o0].com 匹配 vveibo.com 和 vveib0.com
  // vveibo\d*.com 匹配 vveibo0.com, vveibo1.com 等
  return /weibo\.com|vveib[o0]\.com|vveibo\d*\.com/i.test(url);
}

function _isYouTubeUrl(url) {
  // 匹配 youtube.com 或 youtu.be
  return /youtube\.com|youtu\.be/i.test(url);
}

function _isTikTokUrl(url) {
  // 匹配 tiktok.com
  return /tiktok\.com/i.test(url);
}

function _isDouyinUrl(url) {
  // 匹配 douyin.com
  return /douyin\.com/i.test(url);
}

function _isBilibiliUrl(url) {
  // 匹配 bilibili.com 或 b23.tv
  return /bilibili\.com|b23\.tv/i.test(url);
}

function _isWeixinUrl(url) {
  // 匹配微信公众号文章 mp.weixin.qq.com
  return /mp\.weixin\.qq\.com/i.test(url);
}

function _isGitHubUrl(url) {
  // 匹配 github.com
  return /github\.com/i.test(url);
}

function _isAmazonProductUrl(url) {
  // 匹配 Amazon 产品页面（包含 /dp/ 或 /gp/product/）
  const amazonDomains = [
    'amazon.com',
    'www.amazon.com',
    'smile.amazon.com'
  ];

  try {
    const urlObj = new URL(url);
    return amazonDomains.includes(urlObj.hostname) &&
           (urlObj.pathname.includes('/dp/') || urlObj.pathname.includes('/gp/product/'));
  } catch {
    return false;
  }
}

function _isTelegramUrl(url) {
  // 匹配 t.me 或 telegram.org
  return /t\.me|telegram\.org/i.test(url);
}

function _isDiscordUrl(url) {
  // 匹配 discord.com 或 discord.gg
  return /discord\.com|discord\.gg/i.test(url);
}

function _isPancakeSwapUrl(url) {
  // 匹配 PancakeSwap 交易页面
  return /pancakeswap\.finance|pancakeswap\.com/i.test(url);
}

function _isDexUrl(url) {
  // 匹配常见DEX（去中心化交易所）交易页面
  // 这些链接不需要作为网站内容获取，只是交易入口
  return /pancakeswap\.finance|pancakeswap\.com|uniswap\.org|sushiswap\.com|curve\.fi|1inch\.io|raydium\.io|jupiter\.ag|orca\.so/i.test(url);
}

function _selectBestUrlForPlatform(urls, preferType) {
  if (!urls || urls.length === 0) return null;

  // 优先选择指定类型（如tweet）
  const preferred = urls.find(u => u.type === preferType);
  if (preferred) return preferred;

  // 否则返回第一个
  return urls[0];
}

function _isImageUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const lowerUrl = url.toLowerCase();

  // 检查URL路径是否以图片扩展名结尾
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
  if (imageExtensions.some(ext => lowerUrl.endsWith(ext))) {
    return true;
  }

  // 检查URL路径中是否包含图片扩展名后跟查询参数
  // 例如: image.jpg?v=123, photo.png?size=large
  const imageWithQueryPattern = /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)\?/;
  if (imageWithQueryPattern.test(lowerUrl)) {
    return true;
  }

  // 检查明确的图片路径
  const imagePathPatterns = [
    '/images/',    // 专门的图片目录
    '/img/',       // 专门的图片目录
    '/photos/',    // 专门的照片目录
    '/avatars/',   // 专门的头像目录
    '/icons/',     // 专门的图标目录
    'static.four.meme'  // four.meme的静态资源
  ];

  return imagePathPatterns.some(pattern => lowerUrl.includes(pattern));
}
