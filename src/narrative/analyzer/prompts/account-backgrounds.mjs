/**
 * 重要账号背景信息配置
 * 当推文中提到这些账号时，将其背景信息添加到Prompt中
 */

/**
 * 高影响力账号列表
 * 这些账号的推文如果带有媒体，直接返回unrated（无法解析媒体内容）
 * 用于保护可能的好叙事，避免因无法识别图片/视频而误判
 */
export const HIGH_INFLUENCE_ACCOUNTS = {
  // 世界级人物
  'elonmusk': 'Elon Musk（特斯拉CEO、X平台 owner，世界顶级影响力）',
  'realDonaldTrump': 'Donald Trump（美国前总统，世界顶级影响力）',
  'TrumpWarRoom': 'TrumpWarRoom（特朗普官方账号，世界顶级影响力）',
  'realDonaldTrump2': 'Donald Trump备份账号',
  'Trump': 'Trump官方账号',
  'DonaldTrump': 'Donald Trump官方账号',
  'BarackObama': 'Barack Obama（美国前总统）',
  'VP': '美国副总统官方账号',
  'POTUS': '美国总统官方账号',
  'WhiteHouse': '白宫官方账号',

  // 加密货币世界级人物
  'cz_binance': 'CZ（币安创始人，加密货币世界级影响力）',
  'heyibinance': 'Yi He（币安联合创始人、首席客户支持）',
  '_RichardTeng': 'Richard Teng（币安CEO）',
  'binance': 'Binance官方账号',
  'binancecom': 'Binance.com官方账号',
  'BinanceAnnounce': 'Binance官方公告账号',
  'VitalikButerin': 'Vitalik Buterin（以太坊创始人）',
  'saylor': 'Michael Saylor（MicroStrategy CEO，比特币最大持有者之一）',
  'APompliano': 'Anthony Pompliano（Morgan Creek Digital联合创始人，比特币影响力人物）',
  'michael_saylor': 'Michael Saylor',

  // 知名项目/平台
  'BNBCHAIN': 'BNB Chain官方账号',
  'BNBCHAINZH': 'BNB Chain华语官方账号',
  'BinanceWallet': 'Binance Wallet官方账号',
  'BinanceAcademy': 'Binance Academy（币安学院）',
  'BinanceResearch': 'Binance Research（币安研究）',

  // 顶级交易平台
  'pumpfun': 'Pump.fun官方账号（Solana最大meme币发行平台，64万+粉丝，极高影响力）',
  'pump.fun': 'Pump.fun官方账号（Solana最大meme币发行平台）',
  'moonshot': 'Moonshot（顶级meme交易平台，Jupiter旗下移动端App）',
  'Four_FORM_': 'FourMeme平台官方账号（BSC链发币平台）',

  // 知名项目创建者
  'Darkfarms1': 'Darkfarms（Pepe创建者，币圈极具影响力）',

  // 世界级品牌/机构
  'Tesla': 'Tesla官方账号',
  'SpaceX': 'SpaceX官方账号',
  'Apple': 'Apple官方账号',
  'Microsoft': 'Microsoft官方账号',
  'Google': 'Google官方账号',
  'NASA': 'NASA官方账号',
  'NASAWallops': 'NASA Wallops（美国宇航局沃洛普斯飞行设施）',
};

/**
 * 检查账号是否是高影响力账号
 * @param {string} screenName - 账号名
 * @returns {boolean}
 */
export function isHighInfluenceAccount(screenName) {
  if (!screenName) return false;
  const normalized = screenName.toLowerCase().replace('@', '');

  // 大小写不敏感查找
  const lowerCaseKeys = Object.keys(HIGH_INFLUENCE_ACCOUNTS).reduce((acc, key) => {
    acc[key.toLowerCase()] = HIGH_INFLUENCE_ACCOUNTS[key];
    return acc;
  }, {});

  return normalized in lowerCaseKeys;
}

/**
 * 获取高影响力账号的背景信息
 * @param {string} screenName - 账号名
 * @returns {string|null}
 */
export function getHighInfluenceAccountBackground(screenName) {
  if (!screenName) return null;
  const normalized = screenName.toLowerCase().replace('@', '');

  // 大小写不敏感查找
  const lowerCaseKeys = Object.keys(HIGH_INFLUENCE_ACCOUNTS).reduce((acc, key) => {
    acc[key.toLowerCase()] = HIGH_INFLUENCE_ACCOUNTS[key];
    return acc;
  }, {});

  return lowerCaseKeys[normalized] || null;
}

export const ACCOUNT_BACKGROUNDS = {
  // 以下账号已移至HIGH_INFLUENCE_ACCOUNTS，这里保留一些有影响力但不算顶级的账号
  // 用于Prompt中显示账号背景

  // BSC生态
  'bsc_daily': 'BSCDaily（BSC链资讯平台）',
  'BSCPad': 'BSCPad（BSC链项目发射平台）',
  'aster_dex': 'Aster（币安旗下第一去中心化合约交易平台，有较大影响力）',

  // Solana生态
  'worldlibertyfi': 'World Liberty（特朗普旗下顶级金融平台）',

  // 币安相关
  'nina_rong': '币安Executive Director of Growth（增长执行总监）',
  'GiggleAcademy': 'Giggle Academy（CZ创始的儿童教育平台）',
  'YZiLabs': 'YZi Labs（币安基金）',
};

/**
 * 检查推文信息中是否包含已知账号，返回匹配的账号背景信息
 * @param {Object} twitterInfo - 推文信息
 * @returns {Array} 匹配的账号背景信息列表
 */
export function getMatchedAccountBackgrounds(twitterInfo) {
  if (!twitterInfo) return [];

  const matches = [];
  const screenNames = [];

  // 检查推文作者
  if (twitterInfo.author_screen_name) {
    screenNames.push(twitterInfo.author_screen_name.toLowerCase());
  }

  // 检查Website推文作者（如果website指向另一个推文）
  if (twitterInfo.website_tweet?.author_screen_name) {
    screenNames.push(twitterInfo.website_tweet.author_screen_name.toLowerCase());
  }

  // 检查引用推文作者
  if (twitterInfo.quoted_status?.author_screen_name) {
    screenNames.push(twitterInfo.quoted_status.author_screen_name.toLowerCase());
  }

  // 检查回复推文作者
  if (twitterInfo.in_reply_to?.author_screen_name) {
    screenNames.push(twitterInfo.in_reply_to.author_screen_name.toLowerCase());
  }

  // 检查提及的用户
  if (twitterInfo.mentions_user?.screen_name) {
    screenNames.push(twitterInfo.mentions_user.screen_name.toLowerCase());
  }

  // 查找匹配（大小写不敏感）
  // 合并两个列表
  const allAccounts = { ...HIGH_INFLUENCE_ACCOUNTS, ...ACCOUNT_BACKGROUNDS };

  for (const screenName of screenNames) {
    for (const [key, background] of Object.entries(allAccounts)) {
      if (key.toLowerCase() === screenName) {
        matches.push({
          screen_name: key,
          background: background
        });
        break;
      }
    }
  }

  // 检查推文内容中是否提到重要关键词
  const tweetText = (twitterInfo.text || '').toLowerCase();
  const quotedText = (twitterInfo.quoted_status?.text || '').toLowerCase();
  const websiteTweetText = (twitterInfo.website_tweet?.text || '').toLowerCase();

  // 检测Aster相关关键词
  if (tweetText.includes('aster') || quotedText.includes('aster') || websiteTweetText.includes('aster')) {
    // 查找Aster相关的账户背景
    const asterKey = Object.keys(ACCOUNT_BACKGROUNDS).find(key =>
      key.toLowerCase().includes('aster')
    );
    if (asterKey && !matches.find(m => m.screen_name.toLowerCase() === asterKey.toLowerCase())) {
      matches.push({
        screen_name: asterKey,
        background: ACCOUNT_BACKGROUNDS[asterKey]
      });
    }
  }

  // 检测Moonshot相关关键词
  if (tweetText.includes('moonshot') || quotedText.includes('moonshot') || websiteTweetText.includes('moonshot')) {
    const moonshotKey = Object.keys(ACCOUNT_BACKGROUNDS).find(key =>
      key.toLowerCase().includes('moonshot')
    );
    if (moonshotKey && !matches.find(m => m.screen_name.toLowerCase() === moonshotKey.toLowerCase())) {
      matches.push({
        screen_name: moonshotKey,
        background: ACCOUNT_BACKGROUNDS[moonshotKey]
      });
    }
  }

  // 检测World Liberty相关关键词
  if (tweetText.includes('world liberty') || tweetText.includes('worldliberty') ||
      quotedText.includes('world liberty') || quotedText.includes('worldliberty') ||
      websiteTweetText.includes('world liberty') || websiteTweetText.includes('worldliberty')) {
    const worldLibertyKey = Object.keys(ACCOUNT_BACKGROUNDS).find(key =>
      key.toLowerCase().includes('worldliberty')
    );
    if (worldLibertyKey && !matches.find(m => m.screen_name.toLowerCase() === worldLibertyKey.toLowerCase())) {
      matches.push({
        screen_name: worldLibertyKey,
        background: ACCOUNT_BACKGROUNDS[worldLibertyKey]
      });
    }
  }

  return matches;
}

/**
 * 生成账号背景信息的Prompt文本
 * @param {Object} twitterInfo - 推文信息
 * @returns {string} Prompt文本
 */
export function generateAccountBackgroundsPrompt(twitterInfo) {
  const matches = getMatchedAccountBackgrounds(twitterInfo);

  if (matches.length === 0) {
    return '';
  }

  const lines = ['【重要账号背景信息】'];
  for (const match of matches) {
    lines.push(`- @${match.screen_name}: ${match.background}`);
  }
  lines.push('');

  return lines.join('\n');
}
