/**
 * 频繁发币者名单
 * 这些账号频繁借助外部热点事件发币（找角度推文），推文互动通常很低
 *
 * 维护方式：手动维护，定期从 experiment_tokens 数据分析更新
 * 更新流程：
 * 1. 查询 experiment_tokens 表的 raw_api_data 中的 twitter URL
 * 2. 提取 screen_name 统计出现频率
 * 3. 通过 Twitter API 获取账号信息，人工审核分类
 * 4. 仅保留经审核确认的"发币者"账号
 *
 * 数据来源：36285 条 experiment_tokens 记录 → 审计后确认 94 个发币者
 * 最后更新：2026-04-17（基于人工审核分类结果）
 */

// 频繁发币者 screen_name 列表（小写）
export const FREQUENT_ISSUERS = new Set([
  // === 超高频（>= 100次） ===
  'angle754445',             // 446次
  'notickernolife',          // 262次
  'mgga_bsc',                // 236次
  'levenleven80398',         // 194次
  '404bsc',                  // 186次
  'pblonde98247',            // 178次
  'six1xxx',                 // 164次
  'zuozhu_dev',              // 164次
  'misssheridan09',          // 156次
  'aryonserwin',             // 126次
  'king1883560',             // 122次
  'quyin535731',             // 114次
  '100x666888',              // 112次
  'caodan_cao123',           // 102次

  // === 高频（50-99次） ===
  'niaoshen988',             // 84次
  'purevess3l',              // 84次
  'mapalubnb',               // 82次
  'vukgz',                   // 76次
  'axopq74224',              // 60次
  'audrey33520',             // 60次
  'vvvvv493587',             // 60次
  'jadedev888',              // 58次
  'afengdev',                // 54次
  'kim62688986',             // 54次
  'xxxxhold',                // 50次

  // === 中频（30-49次） ===
  'jirachi0x19',             // 46次
  'yuanshenbnb',             // 46次
  'shidizai0202',            // 44次
  'jadedev666',              // 42次
  'arutyun_1993',            // 40次
  'archie33390',             // 40次
  'tmdxushi',                // 40次
  'asshole_sol1',            // 38次
  'naveeng34105645',         // 38次
  'elsharnoub4370',          // 36次
  'zhuzaia',                 // 36次
  'thewaterdeploy',          // 34次
  'we_love_gg_snsd',         // 34次
  'sourceunifi2dy',          // 34次
  'quantisthememe',          // 32次
  'amitmalhotra82',          // 30次
  'crystalc67622',           // 30次

  // === 低频（20-29次） ===
  'thedevrrrrrrr',           // 28次
  'sichuanzhishu',           // 28次
  'darthmiaul',              // 26次 [Pump]
  'ayushquantt',             // 26次 [Pump]
  'mabman338',               // 26次
  '0xxx_bscdev',             // 26次
  '0xmmo0f4qg196xu',         // 26次
  'sheepsheepjia',           // 24次
  'trenchsiu',               // 24次
  'hendadejiaodu',           // 24次
  'thomassandly',            // 24次
  'sunkanmialabi',           // 24次
  'minixkx7tpv',             // 24次
  'yyq7h6',                  // 24次
  'muccadevx',               // 24次
  'ditto_bnb',               // 24次
  'robertc08391086',         // 24次
  'youaredegen',             // 22次
  'lovelygana5',             // 22次
  'devooring',               // 22次
  'llavonna69671',           // 22次
  'zeeko_sol',               // 20次 [Pump]
  'thememedealer_',          // 20次 [Pump]
  'bamdevver',               // 20次
  'sichuan6900',             // 20次
  'gaowancat',               // 20次
  'alanjohnbgi',             // 20次
  'jiaodu6688',              // 20次

  // === 边缘（10-19次） ===
  '9766xd',                  // 18次 [Pump]
  'esee06257',               // 16次 [Pump]
  'taotheblessing1',         // 16次 [Pump]
  '0xpainter_dev',           // 16次
  'vusimuzindaba2',          // 16次
  'sandeep96721678',         // 16次
  'hty1363276',              // 16次
  'scott1284',               // 16次
  'gonzalogonzal71',         // 14次
  'dagouzhuanjia',           // 14次
  'shabi666woc',             // 14次
  'bnb6900_x',               // 14次
  'qbb167311',               // 14次
  'huhu721313',              // 14次
  'kevinb330',               // 14次
  'lookfirst_leep',          // 14次
  'myfarmerbsc',             // 14次
  'xxlb888',                 // 14次
  'devyehudi',               // 12次
  'ak_pony33319',            // 12次
  'changocoinbnb',           // 12次
  'angle7544455',            // 12次
  '0xjiaodu',                // 12次
  'aliaydn718195',           // 12次

]);

/**
 * 检查账号是否为频繁发币者
 * @param {string} screenName - Twitter screen_name
 * @returns {boolean}
 */
export function isFrequentIssuer(screenName) {
  if (!screenName) return false;
  return FREQUENT_ISSUERS.has(screenName.toLowerCase());
}
