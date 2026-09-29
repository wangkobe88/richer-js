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
      // 微博用户主页
      if (backgroundInfo.type === 'user_profile') {
        if (backgroundInfo.screen_name || backgroundInfo.followers_count !== undefined) {
          return true; // 有微博用户主页数据
        }
      }
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
      // 用户主页/频道类型
      if (platform.info.type === 'user_profile' || platform.info.type === 'channel') {
        return true;
      }
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
/**
 * 发行方自发币检测（路径二路由，纯代码规则，2026-09-24 用户裁定方案 A）
 *
 * 语义：推文语料的事件主体（作者）与代币品牌同一，且作者自己的文本宣告了该品牌
 * → 判为"项目方/账号自己发币"，转 prestage 账号判定（不要求当前影响力，按账号语义评）。
 * 反例保护：截词借势盘（C3/CONVICTION 类——词取自推文但与作者身份无关）不满足
 * 品牌同一性，不路由，仍走标准路径 W 数学（路径一：骑乘盘要求项目本身影响力极高）。
 *
 * 注意：语料层面无法证明钱包归属（公告先于铸币时地址尚不存在），本规则是
 * "品牌同一性"判据而非所有权证明；残余误路由窗口（骑乘盘恰以作者品牌命名且
 * 作者有 30 天 Web3 流量）已在台账 C7 记录，由 prestage 自身门槛兜底。
 *
 * @param {Object} tokenData - 代币数据（symbol/name/raw_api_data.name）
 * @param {Object} fetchResults - { twitterInfo }
 * @returns {Object|null} 命中返回 { screenName, symbol }，未命中返回 null
 */
export function detectIssuerSelfLaunch(tokenData, fetchResults) {
  const { twitterInfo } = fetchResults;
  if (!twitterInfo || twitterInfo.type !== 'tweet' || !twitterInfo.text) return null;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const symbol = norm(tokenData.symbol);
  const name = norm(tokenData.name || tokenData.raw_api_data?.name);
  const handle = norm(twitterInfo.author_screen_name || twitterInfo.screen_name);
  const authorName = norm(twitterInfo.author_name || twitterInfo.name);
  const text = norm(twitterInfo.text);

  // 条件1 品牌同一性：代币品牌 = 作者自己的品牌（与 handle/昵称任一方向包含；短串门限防误配）
  const identity = (brand, minLen) => !!brand && brand.length >= minLen && (
    (handle.length >= 3 && (handle.includes(brand) || brand.includes(handle))) ||
    (authorName.length >= 3 && (authorName.includes(brand) || brand.includes(authorName)))
  );
  if (!(identity(symbol, 3) || identity(name, 4))) return null;

  // 条件2 宣告指纹：作者自己的推文文本里出现该品牌（自发宣告，而非第三方命名）
  const mention = (symbol.length >= 3 && text.includes(symbol)) ||
                  (name.length >= 4 && text.includes(name));
  if (!mention) return null;

  return {
    screenName: twitterInfo.author_screen_name || twitterInfo.screen_name,
    symbol: tokenData.symbol,
  };
}

/**
 * 语料 cashtag 检测（W 类强制改道判据，纯代码规则，2026-09-28 用户裁定，C28 iNu案）
 *
 * 语义：语料推文（含被回复的父推）里出现与代币名相同的 $TICKER cashtag，
 * 说明推文讨论的是一个已存在的 web3 资产——代币是骑乘/蹲号该资产的名字，
 * 不是「从推文里截了个新词」的 C 类叙事，强制改道 W 类数学（要求被骑乘资产
 * 本身影响力极高）。iNu 案：@theunipcs（32.7万粉）回复 "$INU"（讨论 RH Chain
 * 上 @iNuApple 的另一个 INU 代币）14 秒后 BSC 蹲号盘出生，Jev 判 C 类 0.52
 * 压过 W 0.25 放行——机械判据不再给 Jev 概率逃逸空间。
 *
 * 判定（机械匹配，无 LLM）：
 * - 扫描 twitterInfo.text 与 twitterInfo.in_reply_to.text（两者都是该代币语料）
 * - cashtag 正则 $[A-Za-z0-9]{2,15}，归一化后与 symbol/name 全等（非包含，
 *   防 $BANANA 命中 BAN）；价格串 $100 天然不匹配非数字币名；两侧均要求 ≥2
 *   字符（1 字符名走原路径，保守方向=少改道）
 *
 * @param {Object} tokenData - 代币数据（symbol/name/raw_api_data.name）
 * @param {Object|null} twitterInfo - 语料推文信息（twitter fetch 结果）
 * @returns {Object|null} 命中返回 { cashtag, inReplyTo }，未命中返回 null
 */
export function detectCorpusCashtag(tokenData, twitterInfo) {
  if (!twitterInfo) return null;
  const texts = [
    { text: twitterInfo.text, inReplyTo: false },
    { text: twitterInfo.in_reply_to?.text, inReplyTo: true },
  ].filter(t => typeof t.text === 'string' && t.text);
  if (!texts.length) return null;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const names = [
    norm(tokenData.symbol),
    norm(tokenData.name || tokenData.raw_api_data?.name),
  ].filter(n => n.length >= 2);
  if (!names.length) return null;

  for (const { text, inReplyTo } of texts) {
    for (const m of text.matchAll(/\$([A-Za-z0-9]{2,15})/g)) {
      if (names.includes(norm(m[1]))) {
        return { cashtag: `$${m[1]}`, inReplyTo };
      }
    }
  }
  return null;
}

/**
 * J1.18 发布者指代检测（纯代码，无 LLM）——C29 Cue/Manus 案（0x5074546c，
 * 2026-09-29 用户裁定）：「骑乘第三方产品，必须满足两个条件，一个是产品本身不是
 * 简单"更新"，而是独立产品发布，或者重大升级；第二，就是产品的影响力，新产品
 * 往往由产品发布者指代，这里 Manus 是可以作为大 IP 的」。
 *
 * Jev 对发布者知名度的知识缺口由本判据确定性切分（J1.16 先例：题目措辞实证只能
 * 把概率压到贴线压不过线）：CUE 五轮实测 super_ip 0.16→0.31（<0.5）、magnitude
 * 稳定 B 档 2.83-2.93（题面「领域知名大IP→A档起」执行不下去）——发布者粉丝数、
 * 域名词根、版本指纹词全是代码可读的市场/结构事实。
 *
 * 四判据（全部满足才命中）：
 * 1. 展开链接域名首段（stem）与币名归一化全等——产品有官方独立域名且域名词根=
 *    产品名（cue.im ↔ CUE），独立新产品官宣实锤（Muse 语料只有 twitter 视频
 *    URL 无产品域名，天然不命中）；
 * 2. 语料作者（主推，回退父推）粉丝数 ≥ 10 万——领域知名发布者门槛（Manus
 *    官号 25.0 万）；
 * 3. 币名与作者 handle/昵称归一化互不包含——排除自发盘（detectIssuerSelfLaunch
 *    域）与「发布者名+版本」拼接形状；
 * 4. 语料文本（主推+父推）无版本更新指纹词（desktop/mac/mobile/version/v2/
 *    now has/更新/迭代/升级…）——排除 Muse 桌面版型（「muse for mac now has
 *    computer use」；版本更新不构成叙事事件，C8 v3 语义维持拦截）。
 *
 * 已知边界（台账 §六 跟踪）：媒体号转述带官方链接时与发布者自宣不可分（粉丝门
 * 取转述者粉丝≈发布者知名度的一次近似）；「重大升级」形状带版本字样（v2/2.0）
 * 会被判据 4 排除，一期只放行「独立新产品」形状（域名实锤），重大升级边界待
 * 案例积累。
 *
 * @param {Object} tokenData - 代币数据（symbol/name/raw_api_data.name）
 * @param {Object|null} twitterInfo - 语料推文信息（twitter fetch 结果）
 * @returns {Object|null} 命中返回 { domain, followers, symbol }，未命中返回 null
 */
const PUBLISHER_PROXY_MIN_FOLLOWERS = 100000;
const VERSION_UPDATE_FINGERPRINT = /desktop|\bmac\b|mobile|version|\bv\d+\b|update|now has|更新|迭代|升级/i;

export function detectPublisherProxy(tokenData, twitterInfo) {
  if (!twitterInfo || typeof twitterInfo !== 'object') return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const tokenNames = [
    norm(tokenData?.symbol),
    norm(tokenData?.name || tokenData?.raw_api_data?.name),
  ].filter(n => n.length >= 2);
  if (!tokenNames.length) return null;

  // ② 领域知名发布者门槛：主推作者粉丝，回退父推作者（CUE 形状主推父推同号）
  const followers = Number(twitterInfo.author_followers_count
    ?? twitterInfo.in_reply_to?.author_followers_count ?? 0);
  if (followers < PUBLISHER_PROXY_MIN_FOLLOWERS) return null;

  // ③ 币名与发布者名互不包含（排除自发盘/「发布者名+版本」形状）
  const authorNames = [
    twitterInfo.author_screen_name, twitterInfo.author_name,
    twitterInfo.in_reply_to?.author_screen_name, twitterInfo.in_reply_to?.author_name,
  ].map(norm).filter(n => n.length >= 2);
  if (authorNames.some(n => tokenNames.some(t => t.includes(n) || n.includes(t)))) return null;

  // ① 独立新产品实锤：展开链接域名 stem 与币名归一化全等（cue.im ↔ CUE）
  const urlEntries = [
    ...(Array.isArray(twitterInfo.expanded_urls) ? twitterInfo.expanded_urls : []),
    ...(Array.isArray(twitterInfo.in_reply_to?.expanded_urls) ? twitterInfo.in_reply_to.expanded_urls : []),
  ];
  let domain = null;
  for (const u of urlEntries) {
    const raw = typeof u === 'string' ? u : (u?.expanded || u?.short || '');
    let host = null;
    try { host = new URL(raw).hostname; } catch { continue; }
    const stem = norm(host.split('.')[0]);
    if (stem && tokenNames.includes(stem)) { domain = host; break; }
  }
  if (!domain) return null;

  // ④ 版本更新指纹排除（Muse 桌面版型：语料明示版本字样不满足「独立新产品」）
  const corpusText = `${twitterInfo.text || ''}\n${twitterInfo.in_reply_to?.text || ''}`;
  if (VERSION_UPDATE_FINGERPRINT.test(corpusText)) return null;

  return { domain, followers, symbol: tokenNames[0] };
}

/**
 * 在账号时间线中查找含代币合约地址（CA）的宣告推文（纯文本判定，零网络）
 *
 * 语义：合约地址在铸币时刻才存在，出现在谁的时间线里谁就是发行方——比名字
 * 匹配强得多的归属实锤（蝴蝶轮回/GMGNPaid 案：字面法两条件各失灵一臂，
 * CA 实锤双覆盖）。
 *
 * @param {string} tokenAddress - 代币合约地址（任意大小写）
 * @param {Object|null} accountData - getFullAccountInfo 返回的账号信息（含 tweets）
 * @returns {Object|null} 命中返回 { tweetId, text }, 未命中/输入无效返回 null
 */
export function findCaTweetInAccount(tokenAddress, accountData) {
  const addr = String(tokenAddress || '').toLowerCase();
  if (!addr || !accountData || !Array.isArray(accountData.tweets)) return null;
  for (const t of accountData.tweets) {
    const text = String(t?.text || '');
    if (text.toLowerCase().includes(addr)) {
      return { tweetId: t.tweet_id, text };
    }
  }
  return null;
}

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
