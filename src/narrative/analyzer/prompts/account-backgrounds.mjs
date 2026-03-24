/**
 * 重要账号背景信息配置
 * 当推文中提到这些账号时，将其背景信息添加到Prompt中
 */

export const ACCOUNT_BACKGROUNDS = {
  // 币安核心人物
  'cz_binance': 'CZ（币安创始人）',
  'heyibinance': 'Yi He（币安联合创始人、首席客户支持）',
  '_RichardTeng': 'Richard Teng（币安CEO）',

  // 币安/BNB Chain官方账号
  'BNBCHAIN': 'BNB Chain官方账号',
  'BNBCHAINZH': 'BNB Chain华语官方账号',
  'BinanceWallet': 'Binance Wallet官方账号',
  'BinanceAcademy': 'Binance Academy（币安学院）',
  'BinanceResearch': 'Binance Research（币安研究）',

  // BSC生态
  'bsc_daily': 'BSCDaily（BSC链资讯平台）',
  'BSCPad': 'BSCPad（BSC链项目发射平台）',
  'aster_dex': 'Aster（币安旗下第一去中心化合约交易平台，有较大影响力）',

  // 币安相关
  'nina_rong': '币安Executive Director of Growth（增长执行总监）',
  'GiggleAcademy': 'Giggle Academy（CZ创始的儿童教育平台）',
  'YZiLabs': 'YZi Labs（币安基金）',

  // FourMeme平台
  'Four_FORM_': 'FourMeme平台官方账号（BSC链发币平台）',

  // 知名项目创建者
  'Darkfarms1': 'Darkfarms（Pepe创建者，币圈极具影响力）',
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
  for (const screenName of screenNames) {
    for (const [key, background] of Object.entries(ACCOUNT_BACKGROUNDS)) {
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

  // 检测Aster相关关键词
  if (tweetText.includes('aster') || quotedText.includes('aster')) {
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
