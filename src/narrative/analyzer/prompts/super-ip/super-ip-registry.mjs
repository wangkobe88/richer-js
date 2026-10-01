/**
 * 超大IP注册表
 * 用于快速通道：识别超大IP账号后，跳过3阶段分析，单次LLM完成评估
 *
 * 注册表包含：
 * - screen_name → IP信息（名称、类型、级别、描述）
 * - 维度一分值映射
 * - 检测函数
 */

/**
 * 超大IP注册表
 * key: Twitter screen_name（小写）
 * value: { name, type, tier, desc }
 *   - type: 'person'(人物) → C类, 'institution'(机构) → D类
 *   - tier: 'S'(世界级), 'A'(知名)
 */
export const SUPER_IP_REGISTRY = {
  // ═══ 人物类（C类：人物言论/动作）═══
  'cz_binance':      { name: 'CZ（赵长鹏）',    type: 'person',  tier: 'S', desc: '币安创始人' },
  'heyibinance':     { name: '何一',             type: 'person',  tier: 'S', desc: '币安联合创始人' },
  'heyi1f':          { name: '何一(小号)',        type: 'person',  tier: 'S', desc: '币安联合创始人小号' },
  '_richardteng':    { name: 'Richard Teng',    type: 'person',  tier: 'A', desc: '币安CEO' },
  'binance_intern':  { name: '币安实习生',       type: 'person',  tier: 'A', desc: '币安官方运营人设' },
  'elonmusk':        { name: 'Elon Musk',        type: 'person',  tier: 'S', desc: 'Tesla/X CEO' },
  'realdonaldtrump': { name: 'Donald Trump',    type: 'person',  tier: 'S', desc: '美国总统' },
  'donaldjtrumpjr':  { name: 'Trump Jr',         type: 'person',  tier: 'A', desc: 'Trump长子' },
  'potus':           { name: '美国总统官方',      type: 'person',  tier: 'S', desc: '美国总统官方账号' },
  'justinsuntron':   { name: '孙宇晨',           type: 'person',  tier: 'A', desc: 'TRON创始人' },
  'saylor':          { name: 'Michael Saylor',   type: 'person',  tier: 'A', desc: 'MicroStrategy CEO' },
  'michael_saylor':  { name: 'Michael Saylor',   type: 'person',  tier: 'A', desc: 'MicroStrategy CEO' },
  'vitalikbuterin':  { name: 'Vitalik Buterin',  type: 'person',  tier: 'S', desc: '以太坊创始人' },
  'star_okx':        { name: 'Star Xu',          type: 'person',  tier: 'A', desc: 'OKX创始人徐明星' },
  'darkfarms1':      { name: 'Darkfarms',         type: 'person',  tier: 'A', desc: 'Pepe创建者' },
  'jackyi_ld':       { name: '易理华',             type: 'person',  tier: 'A', desc: 'Web3知名KOL/投资人' },
  'marionawfal':     { name: 'Mariwan Nawfal',     type: 'person',  tier: 'A', desc: 'Web3知名KOL' },
  'bitcoin':         { name: 'Bitcoin',            type: 'institution', tier: 'A', desc: 'Bitcoin官方' },
  'earthcurated':    { name: 'Earth Curated',      type: 'person',  tier: 'A', desc: 'Web3知名KOL' },
  'haze0x':          { name: 'haze0x',              type: 'person',  tier: 'A', desc: 'GMGN创始人' },

  // ═══ 机构类（D类：机构言论/动作）═══
  'binance':          { name: '币安官方',         type: 'institution', tier: 'S', desc: '全球最大加密交易所' },
  'binancezh':        { name: '币安中文',          type: 'institution', tier: 'S', desc: '币安中文官方' },
  'binanceus':        { name: '币安美国',          type: 'institution', tier: 'A', desc: '币安美国站' },
  'binanceangels':    { name: '币安天使',          type: 'institution', tier: 'A', desc: '币安天使投资' },
  'bnbchain':         { name: 'BNB Chain',         type: 'institution', tier: 'S', desc: 'BNB Chain官方' },
  'bnbchainzh':       { name: 'BNB Chain中文',     type: 'institution', tier: 'A', desc: 'BNB Chain华语官方' },
  'whitehouse':       { name: '白宫',              type: 'institution', tier: 'S', desc: '美国白宫官方' },
  'worldlibertyfi':   { name: 'WLFI',              type: 'institution', tier: 'A', desc: 'Trump家族DeFi平台' },
  'binanceannounce':  { name: '币安公告',          type: 'institution', tier: 'S', desc: '币安官方公告' },
  'okx':              { name: 'OKX',               type: 'institution', tier: 'S', desc: '全球顶级交易所' },
  'pumpfun':          { name: 'Pump.fun',          type: 'institution', tier: 'A', desc: 'Solana最大meme平台' },
  'four_meme_fora':   { name: 'FourMeme',          type: 'institution', tier: 'A', desc: 'BSC链发币平台' },
};

/**
 * 维度一分值映射（与C类/D类Stage2 prompt一致）
 */
export const TIER_SCORES = { S: 40, A: 32, B: 24, C: 12 };

/**
 * 计算时效性加分（与Stage2 prompt一致）
 * @param {string|number} tweetCreatedAt - 推文创建时间
 * @param {number} [nowMs] - 时间基准毫秒时间戳（默认当前时刻）；
 *   传代币创建时间使时效与何时分析无关（补跑/回测幂等，与 pre-check 规则2 同裁定）
 * @returns {number} 时效性加分 (0/10/15)
 */
export function calculateTimeliness(tweetCreatedAt, nowMs) {
  if (!tweetCreatedAt) return 0;
  try {
    const createdDate = new Date(tweetCreatedAt);
    if (isNaN(createdDate.getTime())) return 0;
    const age = (nowMs ?? Date.now()) - createdDate.getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days <= 7) return 15;
    if (days <= 30) return 10;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 从Twitter URL提取screen_name
 * @param {string} url - Twitter/X URL
 * @returns {string|null} screen_name（小写）或 null
 */
export function extractScreenNameFromUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    if (!hostname.includes('x.com') && !hostname.includes('twitter.com')) return null;
    const match = urlObj.pathname.match(/^\/([\w.]+)(?:\/|$)/);
    if (!match) return null;
    const first = match[1].toLowerCase();
    // 排除系统路径
    const systemPaths = ['i', 'home', 'explore', 'search', 'hashtag', 'status', 'settings', 'notifications', 'messages'];
    if (systemPaths.includes(first)) return null;
    return first;
  } catch {
    return null;
  }
}

/**
 * 检测是否为超大IP账号
 * @param {string} twitterUrl - appendix中的Twitter URL
 * @param {Object} twitterInfo - 已获取的推文信息（可选，提供author_screen_name作为备选）
 * @returns {Object|null} 注册表信息或null
 */
export function detectSuperIP(twitterUrl, twitterInfo) {
  let screenName = extractScreenNameFromUrl(twitterUrl);

  // 备选：从twitterInfo中获取
  if (!screenName && twitterInfo?.author_screen_name) {
    screenName = twitterInfo.author_screen_name.toLowerCase();
  }

  if (!screenName) return null;
  return SUPER_IP_REGISTRY[screenName] || null;
}

/**
 * 判定 URL 是否为「超级IP账号的推文链接」（C51 龙虾案，2026-10-01 用户裁定
 * 「GMGN 补源返回的 twitterUrl 是推文 URL——如果是超级IP再并入」）
 *
 * 背景：GMGN link.twitter_username 字段可能带完整推文路径（龙虾案实测
 * "binancezh/status/2027304629890072818"——GMGN 手里有 token 自挂马甲号之外的
 * 真实叙事源推文），但 data-fetch 补源条件「已有 twitter 链接就不并入」（C10）
 * 使其被自挂的马甲号/垃圾链接挡住。例外口径：仅推文级 URL（含 /status/）且
 * 作者在超级IP注册表（如币安官方号 Day 559 梗帖）才突破——superIP 推文是
 * 强叙事锚，普通推文 URL 仍守 C10 语义（有语料不补，省配额/不覆盖有效语料）。
 * @param {string} url - 候选 twitter URL
 * @returns {Object|null} 注册表信息（{name,type,tier,desc}）或 null
 */
export function isSuperIpTweetUrl(url) {
  if (!url || !/\/status\/\d+/.test(url)) return null;
  return detectSuperIP(url);
}

/**
 * 计算预评分（规则确定的部分，无需LLM）
 * @param {Object} ipInfo - 注册表中的IP信息
 * @param {string|number} tweetCreatedAt - 推文创建时间
 * @param {number} [nowMs] - 时间基准毫秒时间戳（透传给 calculateTimeliness）
 * @returns {Object} 预评分 { tierScore, timeliness, baseEventScore }
 */
export function calculatePreScores(ipInfo, tweetCreatedAt, nowMs) {
  const tierScore = TIER_SCORES[ipInfo.tier] || 0;
  const timeliness = calculateTimeliness(tweetCreatedAt, nowMs);
  const baseEventScore = tierScore + timeliness;
  return { tierScore, timeliness, baseEventScore };
}
