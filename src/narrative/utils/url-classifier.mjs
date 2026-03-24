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

  const traverse = (obj) => {
    if (typeof obj === 'string') {
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
      obj.forEach(traverse);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(traverse);
    }
  };

  traverse(data);
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

  const normalizedUrl = url.toLowerCase();

  // Twitter/X (推文) - 优先级最高
  if (_isTwitterTweetUrl(url)) {
    return { type: 'tweet', platform: 'twitter', priority: 1, url };
  }

  // Twitter/X (账号)
  if (_isTwitterAccountUrl(url)) {
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

  // GitHub
  if (_isGitHubUrl(url)) {
    return { type: 'repository', platform: 'github', priority: 1, url };
  }

  // 默认为普通网站
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
    github: [],
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
      case 'github':
        result.github.push(info);
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
      github: null,
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
    github: classifiedUrls.github[0] || null,
    website: classifiedUrls.websites[0] || null
  };
}

// ========== 私有方法：URL识别 ==========

function _isTwitterTweetUrl(url) {
  // 匹配 twitter.com or x.com 的推文链接
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w-]+\/status\/\d+/.test(url);
}

function _isTwitterAccountUrl(url) {
  // 匹配 twitter.com or x.com 的账号链接（不含/status/）
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w-]+\/?$/.test(url);
}

function _isWeiboUrl(url) {
  // 匹配 weibo.com 的任意链接
  return /weibo\.com/i.test(url);
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

function _isGitHubUrl(url) {
  // 匹配 github.com
  return /github\.com/i.test(url);
}

function _selectBestUrlForPlatform(urls, preferType) {
  if (!urls || urls.length === 0) return null;

  // 优先选择指定类型（如tweet）
  const preferred = urls.find(u => u.type === preferType);
  if (preferred) return preferred;

  // 否则返回第一个
  return urls[0];
}
