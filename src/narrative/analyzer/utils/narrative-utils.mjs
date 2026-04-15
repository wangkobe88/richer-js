/**
 * Narrative Analyzer - 工具方法
 * 包含各种辅助方法，如符号清洗、长度计算、数据验证等
 */

/**
 * 清洗代币名称，去除不可见字符和组合字符
 * @param {string} symbol - 原始代币名称
 * @returns {string} 清洗后的代币名称
 */
export function cleanSymbol(symbol) {
  if (!symbol) return symbol;
  // 去除组合字符（U+0300-U+036F）和其他不可见字符
  // 使用normalize('NFC')然后过滤组合字符
  return symbol
    .normalize('NFC')
    .replace(/[\u0300-\u036f\u200b-\u200d\ufeff\u034f]/g, '')
    .trim();
}

/**
 * 计算字符串的"视觉长度"
 * 中文字符（CJK）按2个单位计算，英文/数字/符号按1个单位计算
 * 这样可以更准确地反映字符串在显示时的实际占用空间
 * @param {string} str - 要计算的字符串
 * @returns {number} 视觉长度
 */
export function getVisualLength(str) {
  if (!str) return 0;
  let length = 0;
  for (const char of str) {
    // 判断是否为中日韩（CJK）统一表意文字
    // 范围包括：基本区、扩展A区、扩展B区、扩展C区、扩展D区、扩展E区、扩展F区
    const code = char.codePointAt(0);
    const isCJK = (
      (code >= 0x4E00 && code <= 0x9FFF) ||     // 基本区
      (code >= 0x3400 && code <= 0x4DBF) ||     // 扩展A区
      (code >= 0x20000 && code <= 0x2A6DF) ||   // 扩展B区
      (code >= 0x2A700 && code <= 0x2B73F) ||   // 扩展C区
      (code >= 0x2B740 && code <= 0x2B81F) ||   // 扩展D区
      (code >= 0x2B820 && code <= 0x2CEAF) ||   // 扩展E区
      (code >= 0x2CEB0 && code <= 0x2EBEF) ||   // 扩展F区
      (code >= 0xF900 && code <= 0xFAFF) ||     // 兼容汉字
      (code >= 0x2F800 && code <= 0x2FA1F)      // 兼容汉字补充
    );
    // CJK字符算2个单位，其他算1个单位
    length += isCJK ? 2 : 1;
  }
  return length;
}

/**
 * 检查是否有有效数据供分析
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {boolean} 是否有有效数据
 */
export function hasValidDataForAnalysis(fetchResults) {
  const {
    twitterInfo,
    websiteInfo,
    extractedInfo,
    backgroundInfo,
    githubInfo,
    youtubeInfo,
    douyinInfo,
    tiktokInfo,
    bilibiliInfo,
    weixinInfo,
    amazonInfo,
    xiaohongshuInfo,
    instagramInfo,
    binanceSquareInfo
  } = fetchResults;

  // 检查推文数据
  if (twitterInfo) {
    if (twitterInfo.text && twitterInfo.text.trim().length > 0) {
      return true; // 有推文内容
    }
    // 检查账号信息（只要有账号信息就算有效数据，让 LLM 来判断质量）
    if (twitterInfo.type === 'account') {
      // 只要是账号类型就算有效数据（账号名、粉丝数、发帖数都是信息）
      return true;
    }
    // 检查社区信息（社区数据也算有效数据）
    if (twitterInfo.type === 'community') {
      // 社区名称、成员数、描述都是信息
      return true;
    }
  }

  // 检查背景信息（微博等）
  if (backgroundInfo) {
    // 微博数据检查
    if (backgroundInfo.source === 'weibo') {
      if (backgroundInfo.text && backgroundInfo.text.trim().length > 0) {
        return true; // 有微博内容
      }
      if (backgroundInfo.title || backgroundInfo.author_name || backgroundInfo.screen_name) {
        return true; // 有微博基本信息（账号名等）
      }
    }
    // 其他背景信息（视频平台账号、网站抓取等）
    if (backgroundInfo.content || backgroundInfo.description || backgroundInfo.title) {
      return true;
    }
  }

  // 检查网站内容
  if (websiteInfo && websiteInfo.content && websiteInfo.content.trim().length > 50) {
    return true; // 有足够的网站内容
  }

  // 检查介绍
  if (extractedInfo) {
    const intro = extractedInfo.intro_en || extractedInfo.intro_cn || '';
    if (intro.trim().length >= 20) {
      return true; // 有足够的介绍
    }
  }

  // 检查其他数据源

  // GitHub: 检查是否有仓库信息（readme、name、description等）
  if (githubInfo) {
    if (githubInfo.readme) return true;
    if (githubInfo.name || githubInfo.description || githubInfo.topics) {
      return true; // 有基本仓库信息就算有效数据
    }
  }

  // 微信文章: 检查是否有实际内容（title、content等）
  if (weixinInfo) {
    if (weixinInfo.title && weixinInfo.title.trim().length > 0) {
      return true; // 有微信文章内容
    }
  }

  // 视频平台: 检查是否有实际内容（title、description、view_count等）
  const videoPlatforms = [
    { info: youtubeInfo, name: 'YouTube' },
    { info: douyinInfo, name: '抖音' },
    { info: tiktokInfo, name: 'TikTok' },
    { info: bilibiliInfo, name: 'Bilibili' }
  ];

  for (const platform of videoPlatforms) {
    if (platform.info) {
      // 检查是否有视频标题或描述（至少有一个非空）
      const hasContent = (platform.info.title && platform.info.title.trim().length > 0) ||
                        (platform.info.description && platform.info.description.trim().length > 0);
      if (hasContent) {
        return true; // 有视频内容
      }
    }
  }

  // 小红书: 检查用户主页或笔记数据
  if (xiaohongshuInfo) {
    if (xiaohongshuInfo.type === 'user_profile') {
      if (xiaohongshuInfo.nickname || xiaohongshuInfo.fans !== undefined) {
        return true; // 有用户主页数据
      }
    }
    if (xiaohongshuInfo.title || xiaohongshuInfo.desc) {
      return true; // 有笔记数据
    }
  }

  // Instagram: 检查帖子或用户数据
  if (instagramInfo) {
    if (instagramInfo.type === 'user_profile') {
      if (instagramInfo.username || instagramInfo.follower_count !== undefined) {
        return true; // 有用户主页数据
      }
    }
    if (instagramInfo.caption || instagramInfo.metrics) {
      return true; // 有帖子数据
    }
  }

  // Amazon: 检查是否有商品信息（title、price等）
  if (amazonInfo) {
    if (amazonInfo.title || amazonInfo.price || amazonInfo.features) {
      return true; // 有商品信息
    }
  }

  // 币安广场: 有文章内容算有效，或者仅有postId也算有效（WAF拦截时无法获取内容，但URL本身是有效公开信息）
  if (binanceSquareInfo) {
    if (binanceSquareInfo.title || binanceSquareInfo.content || binanceSquareInfo.postId) {
      return true;
    }
  }

  // 其他背景信息文本
  if (backgroundInfo?.text && backgroundInfo.text.trim().length > 0) {
    return true;
  }

  return false; // 没有任何有效数据
}

/**
 * 检测是否有独立网站（非第三方平台域名）
 * @param {Object} classifiedUrls - 分类后的URL列表
 * @returns {boolean} 是否有独立网站
 */
export function hasIndependentWebsite(classifiedUrls) {
  if (!classifiedUrls || !classifiedUrls.websites) {
    return false;
  }

  // 第三方平台域名列表（不算独立网站）
  const thirdPartyDomains = [
    'medium.xyz', 'linktr.ee', 'linktree.co', 'linkz.st',
    'about.me', 'mikit.io', 'carrd.co', 'trello.me',
    'notion.site', 'notion.so', 'forms.office.com',
    'typeform.com', 'google.com', 'docs.google.com',
    // 可以添加更多
  ];

  return classifiedUrls.websites.some(website => {
    try {
      const url = new URL(website.url);
      const domain = url.hostname.toLowerCase();

      // 检查是否在第三方域名列表中
      const isThirdParty = thirdPartyDomains.some(d =>
        domain === d || domain.endsWith(`.${d}`)
      );

      // 有网站且不是第三方平台 → 算独立网站
      return !isThirdParty;
    } catch {
      return false;
    }
  });
}

/**
 * 检查是否应该使用账号/社区分析流程
 * 条件：
 * 1. 有账号/社区信息且无推文（原有逻辑）
 * 2. 或者有独立网站且成功获取了账号信息（新增）
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {boolean} 是否应该使用账号/社区分析
 */
export function shouldUseAccountCommunityAnalysis(fetchResults) {
  const {
    twitterInfo,
    classifiedUrls
  } = fetchResults;

  // 必须有账号或社区类型的twitterInfo
  if (!twitterInfo || (twitterInfo.type !== 'account' && twitterInfo.type !== 'community')) {
    // 回退检查：如果twitterInfo是推文但内容为空，且存在社区URL → 使用社区路径
    if (twitterInfo?.type === 'tweet' && (!twitterInfo.text || !twitterInfo.text.trim())) {
      const hasCommunityUrl = classifiedUrls?.twitter?.some(u => u.type === 'community');
      if (hasCommunityUrl) {
        return true;
      }
    }
    return false;
  }

  // 原有逻辑：有推文内容 → 走正常流程
  if (twitterInfo.text && twitterInfo.text.trim().length > 0) {
    return false;
  }

  // 有账号/社区信息且无推文 → 使用账号/社区分析流程
  // 注意：网站、电报、Discord都不阻断，只要有账号/社区且无推文就走账号分析
  return true;
}

/**
 * 从Twitter URL中提取screen_name
 * 支持格式：
 * - https://x.com/username/status/123456 → username
 * - https://x.com/username → username
 * @param {string} url - Twitter URL
 * @returns {string|null} screen_name 或 null
 */
export function extractScreenNameFromTwitterUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    if (!hostname.includes('x.com') && !hostname.includes('twitter.com')) return null;
    // 提取路径第一段作为screen_name
    const match = urlObj.pathname.match(/^\/([\w.]+)(?:\/|$)/);
    if (match && match[1] !== 'i' && match[1] !== 'status') {
      return match[1];
    }
  } catch {
    // URL解析失败
  }
  return null;
}

/**
 * 检测是否为项目币（代币自身的合约地址出现在推文/网站/账号信息中）
 * 如果地址出现在内容中，说明是项目方自己发的币，不是蹭项目的meme币
 * @param {string} tokenAddress - 代币地址（小写）
 * @param {Object} fetchResults - 获取的数据结果
 * @returns {boolean} 是否为项目币
 */
export function isProjectCoin(tokenAddress, fetchResults) {
  const address = tokenAddress.toLowerCase();
  const { twitterInfo, websiteInfo, classifiedUrls } = fetchResults;

  // 检查推文文本
  if (twitterInfo?.text && twitterInfo.text.toLowerCase().includes(address)) {
    return true;
  }

  // 检查回复推文
  if (twitterInfo?.in_reply_to?.text && twitterInfo.in_reply_to.text.toLowerCase().includes(address)) {
    return true;
  }

  // 检查引用推文
  if (twitterInfo?.quoted_tweet?.text && twitterInfo.quoted_tweet.text.toLowerCase().includes(address)) {
    return true;
  }

  // 检查Website推文（第二个推文）
  if (twitterInfo?.website_tweet?.text && twitterInfo.website_tweet.text.toLowerCase().includes(address)) {
    return true;
  }

  // 检查网站内容
  if (websiteInfo?.content && websiteInfo.content.toLowerCase().includes(address)) {
    return true;
  }

  // 检查账号简介（account类型）
  if (twitterInfo?.description && twitterInfo.description.toLowerCase().includes(address)) {
    return true;
  }

  // 检查网站原始HTML中是否包含地址（extractMainContent会去掉标签属性中的地址）
  if (websiteInfo?.rawHtml && websiteInfo.rawHtml.toLowerCase().includes(address)) {
    return true;
  }

  // 检查classifiedUrls中所有URL是否包含地址（项目币网站链接中常包含合约地址）
  if (classifiedUrls) {
    const allUrls = Object.values(classifiedUrls).flat().map(u => u?.url).filter(Boolean);
    if (allUrls.some(url => url.toLowerCase().includes(address))) {
      return true;
    }
  }

  return false;
}
