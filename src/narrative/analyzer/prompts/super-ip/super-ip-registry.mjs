/**
 * 超大IP注册表
 * C83 起用于：注册表命中信息注入标准 Jev 路径 state（认证事实行）+
 * tweet-type-classifier 回复目标判定 + C51 GMGN 补源并入判据。
 * （C83 前为快车道预评分源——tier 分值/时效预分已随通道删除）
 *
 * 注册表包含：
 * - screen_name → IP信息（名称、类型、级别、描述）
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
  // C137（MEMES 案，2026-10-21 用户裁定「BSC 链 meme 币场景影响力极高，注册」）：
  // flap 平台 dev。粉丝 4.6 万但场景内是双发射平台之一的开发核心——注册表
  // 消费臂（J1.58 表态豁免/C117 强制标准路径/J1.56 作者原话票）均不看 tier，
  // tier 仅入 state 认证行，按 haze0x（GMGN 创始人）同级 A，不给 S（4.6 万粉
  // 与 S 档世界级认证行矛盾）
  'eth_cedric':      { name: 'Cedric',              type: 'person',  tier: 'A', desc: 'Flap平台dev' },

  // ═══ 机构类（D类：机构言论/动作）═══
  'binance':          { name: '币安官方',         type: 'institution', tier: 'S', desc: '全球最大加密交易所' },
  'binancezh':        { name: '币安中文',          type: 'institution', tier: 'S', desc: '币安中文官方' },
  'binanceus':        { name: '币安美国',          type: 'institution', tier: 'A', desc: '币安美国站' },
  // binanceangels 已移出（2026-10-22 用户裁定）：@BinanceAngels 是币安社区大使/
  // 志愿者运营号，不是投资机构（原 desc「币安天使投资」系误登记）。消费臂只看在册、
  // 不看 tier——在册即与 CZ/币安官方同权（C117 强制标准路径 / C139 著名免形象 /
  // J1.58 空洞豁免 / J1.56 作者原话票），社区运营号不配这套权重。
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
