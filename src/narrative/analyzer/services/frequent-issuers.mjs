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
 * 2026-10-16 扩编（C76）：562,494 行全量重扫（scan-frequent-issuers.cjs，
 *   twitterUrl 作者频次 + creator_address 聚合甄别被蹭 IP），人工分拣后收录
 *   ≥30 次高频段 52 个；事件源（媒体/官方/名人）剔除；低频段观察期后再补
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
  // === 2026-10-15 追加（猪五花案 0x7603c74b…7777，pumpfun 找角度号 SOL 拷贝盘嫌疑） ===
  'gampsito',                // 英文找角度体「Imma redeploy it」；4642 粉落分类器 [2000,5000) 盲区

  // === 2026-10-16 扩编（C76，用户裁定「收集找角度博主加快分桶判定」，只收 ≥30 次高频段） ===
  // 扫描：scripts/scan-frequent-issuers.cjs（562,494 行 experiment_tokens 全量，
  //   raw_api_data.twitterUrl 作者频次 + creator_address 聚合甄别：creator 集中=自营
  //   发币号 / creator 极分散=被蹭 IP 自动排除 cz_binance/elonmusk 等 1644 个）
  // 人工分拣裁定（C74 语义：事件源享受 direct_tweet 新闻豁免不收；无名作业号/
  //   共享角度源收录）：明确剔除 10 个事件源——whitehouse/pmarca/cnbc/
  //   blockbeatsasia(媒体,某 dev 固定蹭快讯致 creator 集中 0.74 仍剔)/jessepollak
  //   (Base 创始人)/bnbchainzh/aster_dex/flaps_launchpad(平台官方)+
  //   fourdotmemezh/bnbveil(疑似生态官方，用户裁定剔除)
  // 低频段（8-29 次 1194 个 + 自营批量号 15 个）本轮不收，观察期后可重跑脚本降阈值补
  'shanyizk9',               // 428 次；锦绣山河/比硬币还薄——共享作业源（167 creator）
  'burbering1',              // 200 次；多多/BIBIO/罐头
  'bobod9vv',                // 172 次；卡鲁阿/AI赌狗×3
  'a789hao',                 // 172 次；躺平负鼠/LORE×2
  'www1114235',              // 169 次；无为人生/牛逼牛/剧本人生
  'bscluffy_',               // 159 次；瓦牛弟/哈基米/拉屎之道
  'forlinjg',                // 135 次；米莱/虫小绿/波比
  'cehood123',               // 115 次；谛听/飞猪/绿牛
  '0xassa',                  // 114 次；钻针/尤栗/堂哥
  'mizx_deskada',            // 98 次；娜娜/扎啤奶蛋鼠/깨댕이
  'spigg1115',               // 94 次；金色赵财猫/招财猫
  'liangdongbo3',            // 90 次；富贵羊×2/共创人生
  'llyjunjun',               // 89 次；拜佛狗/二埋汰/打劫喵
  'saulmonte1405',           // 84 次；好朋狗/萝卜头/精子侠
  'juny0uli',                // 78 次；CASHINU/逃课/呵呵人生
  'bopa6666888',             // 67 次；千问GO/阿尔法
  'fuxiubn',                 // 64 次；王与也行/熊猫狗
  '0xdev86',                 // 62 次；道吉道吉/黑猫警长
  'bscbncto',                // 56 次；Web3人生/共创人生×2
  'galxyforever',            // 50 次；币安长子×2/币安小妈（蹭币安梗作业号非官方）
  'bscsolrh',                // 50 次；熊大卫×2/芒果
  'pstephenson7992',         // 46 次；商人的孩子×2/累瘫牛牛
  'bnb6688',                 // 45 次；NUVI/호랑이×2
  'am2zyc3csn2872',          // 45 次；熊熊币/来福
  'bnbflap128140',           // 44 次；币安银行×4
  'boardofbinance',          // 44 次；BOB×4（蹭名 parody 非官方）
  'jingouriji',              // 42 次；金狗日记/CHASEHIGH×2
  'crystal_bsc',             // 42 次；蝴蝶村镇×2/flapvillage
  'liangxizjdq',             // 42 次；凉兮股/奋斗×2
  'saccc_c',                 // 41 次；小王子×3
  'acecay_og',               // 40 次；库比×3
  'burnfloor_',              // 40 次；上等羊×2/八仙共建×2
  'thiagoagusrgcc',          // 39 次；77元/77枚硬币×2
  'ryanmyher',               // 38 次；6666/SZ×2/swole
  'terminusbsc',             // 38 次；Bsc Token/DARKCREWTOKEN
  'burneth888',              // 38 次；BURNETH×4
  'lujain35316065',          // 37 次；芭比公主/量子末日
  'nexussonchain',           // 37 次；抖音/BI/SIB
  'rlthbh',                  // 37 次；DOTMEOW/健力宝/咒寿师
  'star_okx',                // 36 次；岳不群/TSVD×2（蹭 OKX 名非官方）
  'luffyx100x',              // 36 次；无私币×3
  'lcnovax',                 // 36 次；豆豆/烧心×2
  'a09816776870',            // 35 次；金CA/JB/GM
  'kanzakien',               // 35 次；大水时代/YOLO×2
  'shelaasarii',             // 35 次；机器狗/다크서울×2
  'haze0x',                  // 34 次；铁公鸡开马丁/假装不会播（creator top1=0.71 自营）
  'mascotdexhq',             // 32 次；VIEWS×3（creator top1=0.66）
  'ruyexjx',                 // 32 次；咕噜咕噜猫×2/化缘狗
  'larson_kim96764',         // 32 次；无法寻×3
  'neroarmore91252',         // 32 次；肺鼠疫×4
  'moonlightriseup',         // 32 次；Yeti×2/避孕套
  'mayilong0',               // 32 次；中国版马斯克×3
  'fcmao_bsc',               // 30 次；发财猫×3

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
