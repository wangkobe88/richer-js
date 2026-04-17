/**
 * 审计频繁发币者名单
 * 批量获取账号信息，保存到文档中供人工审核
 *
 * 使用方式：node scripts/audit-frequent-issuers.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getUserByScreenName } = require('../src/utils/twitter-validation/new-apis.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 frequent-issuers.mjs 中读取所有账号
// 直接硬编码名单，避免 import 复杂度
const ACCOUNTS_TO_AUDIT = [
  // === 超高频（>= 100次）===
  'angle754445',       // 446次
  'notickernolife',    // 262次
  'mgga_bsc',          // 236次
  'levenleven80398',   // 194次
  '404bsc',            // 186次
  'pblonde98247',      // 178次
  'okmetom',           // 172次
  'felix_fan',         // 166次
  'zuozhu_dev',        // 164次
  'six1xxx',           // 164次
  'misssheridan09',    // 156次
  'raxhephonh',        // 130次
  'aryonserwin',       // 126次
  'king1883560',       // 122次
  'quyin535731',       // 114次
  '100x666888',        // 112次
  'natalie_stagg07',   // 108次
  'haze0x',            // 104次
  'caodan_cao123',     // 102次

  // === 高频（50-99次）===
  'kindlamyth55346',   // 94次
  'rainbow_dev_1',     // 88次
  'in927772',          // 88次
  'steipete',          // 86次
  'niaoshen988',       // 84次
  'purevess3l',        // 84次
  'mapalubnb',         // 82次
  'deleontami',        // 76次
  'vukgz',             // 76次
  'bnbclawbiz',        // 72次
  '7buildtoken',       // 68次
  'axopq74224',        // 60次
  'audrey33520',       // 60次
  'vvvvv493587',       // 60次
  'jadedev888',        // 58次
  'dinary66',          // 54次
  'web3amirah',        // 54次
  'afengdev',          // 54次
  'zc7650934628178',   // 54次
  'kim62688986',       // 54次
  'abear888',          // 52次
  'caosishabi123',     // 52次
  'jackiebrochu1',     // 52次
  'xxxxhold',          // 50次
  'pick7778',          // 50次

  // === 中频（30-49次）===
  'em11991590',        // 48次
  '256natethegr8',     // 46次
  'jirachi0x19',       // 46次
  'mangzgw_web21',     // 46次
  'yao_bu30086',       // 46次
  'yuanshenbnb',       // 46次
  'gaoqiannanhai',     // 44次
  'shidizai0202',      // 44次
  'shyamsundartha6',   // 42次
  'chinh132hn',        // 42次
  'jadedev666',        // 42次
  'zhao_luo_chen',     // 42次
  'justaeggman',       // 40次
  'arutyun_1993',      // 40次
  'archie33390',       // 40次
  'tmdxushi',          // 40次
  'digua1992__',       // 40次
  'patricia_b31211',   // 38次
  'naveeng34105645',   // 38次
  'tiancaidev',        // 38次
  'taotheblessing2',   // 38次
  'woiibayu25zihf',    // 38次
  'cathych13419758',   // 38次
  'asshole_sol1',      // 38次
  'elsharnoub4370',    // 36次
  'web2designer09',    // 36次
  'nikolaihauckx',     // 36次
  'zhuzaia',           // 36次
  'thewaterdeploy',    // 34次
  'we_love_gg_snsd',   // 34次
  'sourceunifi2dy',    // 34次
  'quantisthememe',    // 32次
  'justaegg0',         // 32次
  'nikitabier',        // 32次
  'jncquant',          // 32次
  'xiaoyu_184cm',      // 32次
  'godc99',            // 32次
  'madhurbara',        // 32次
  'robingould16534',   // 30次
  'crystalc67622',     // 30次
  'carly_davies',      // 30次
  'amitmalhotra82',    // 30次

  // === 低频（20-29次）===
  'jdunkel',           // 28次
  'memeking168',       // 28次
  'felixreed15ljn',    // 28次
  'sichuanzhishu',     // 28次
  'jesuslvivas',       // 28次
  'earthcurated',      // 28次
  'thedevrrrrrrr',     // 28次
  'cake8869',          // 26次
  'snake_bnb',         // 26次
  '0xxx_bscdev',       // 26次
  'darthmiaul',        // 26次
  'brc20niubi',        // 26次
  'mabman338',         // 26次
  'ayushquantt',       // 26次
  'noksb83348283',     // 26次
  '0xmmo0f4qg196xu',  // 26次
  'omarsabnam',        // 26次
  'yyq7h6',            // 24次
  'muccadevx',         // 24次
  'cnnewsglobal',      // 24次
  'xfreeze',           // 24次
  'ditto_bnb',         // 24次
  'zhu_jingyang',      // 24次
  'trenchsiu',         // 24次
  'sunkanmialabi',     // 24次
  'sheepsheepjia',     // 24次
  'minixkx7tpv',       // 24次
  'tyw1984',           // 24次
  'hendadejiaodu',     // 24次
  'robertc08391086',   // 24次
  'thomassandly',      // 24次
  'youaredegen',       // 22次
  'llavonna69671',     // 22次
  'yihebirthday',      // 22次
  'marionawfal',       // 22次
  'dragonskill_',      // 22次
  'devooring',         // 22次
  'twit_terer_69er',   // 22次
  'lovelygana5',       // 22次
  'cz_skill',          // 20次
  'zeeko_sol',         // 20次
  'bnti_test',         // 20次
  'sichuan6900',       // 20次
  'gaowancat',         // 20次
  'alanjohnbgi',       // 20次
  'thememedealer_',    // 20次
  'jiaodu6688',        // 20次
  'chungpong_',        // 20次
  'bamdevver',         // 20次
  'susanhawki27329',   // 20次

  // === 边缘（10-19次）===
  'l6a5esu2ohezfpo',   // 18次
  'chakibbrk',         // 18次
  'yizhibaozz',        // 18次
  '9766xd',            // 18次
  'hubbardtra29412',   // 18次
  'brax57506037',      // 18次
  'bnb___guy',         // 18次
  'libertycappy',      // 18次
  'spigg1115',         // 18次
  'grok12_john',       // 18次
  'shizzlitto',        // 18次
  'jinzz37327611',     // 18次
  'lumaogou',          // 18次
  'scott1284',         // 16次
  'sandeep96721678',   // 16次
  'zhaoluochen168',    // 16次
  'zixuanxuesong',     // 16次
  'and_khamoo',        // 16次
  '0xpainter_dev',     // 16次
  'ze_zeircle',        // 16次
  'vusimuzindaba2',    // 16次
  '_forab',            // 16次
  'blg931223229631',   // 16次
  'hty1363276',        // 16次
  'esee06257',         // 16次
  'bitcoin',           // 16次
  '0xmoon',            // 16次
  'taotheblessing1',   // 16次
  'cardillosamuel',    // 16次
  'dagouzhuanjia',     // 14次
  'elena46659755',     // 14次
  'drawesomedoge',     // 14次
  'sisibinance',       // 14次
  'bnb6900_x',         // 14次
  'shabi666woc',       // 14次
  'heroineyihe',       // 14次
  'huhu721313',        // 14次
  'rpgva73841483',     // 14次
  'bsc_el_dev',        // 14次
  'lookfirst_leep',    // 14次
  '0xpicai',           // 14次
  'jayjayloves67',     // 14次
  'hardenwhit12613',   // 14次
  'mikeybsanders',     // 14次
  'qbb167311',         // 14次
  'dariusjlxx',        // 14次
  'myfarmerbsc',       // 14次
  'kmcrypton',         // 14次
  'gonzalogonzal71',   // 14次
  'xxlb888',           // 14次
  'venturetwins',      // 14次
  'geniusterminal',    // 14次
  'pumpventfun',       // 14次
  'kevinb330',         // 14次
  'esee0987',          // 14次
  'anndylian',         // 12次
  'chaojixiaomada',    // 12次
  'slibby42770',       // 12次
  's93curib8dp67lv',   // 12次
  'pam_swim',          // 12次
  'hana_b30',          // 12次
  '0xjiaodu',          // 12次
  'changocoinbnb',     // 12次
  'esotericpigeon',    // 12次
  '4tokendev',         // 12次
  'cryptosis9_okx',    // 12次
  'quantiye',          // 12次
  'chillmigratoor',    // 12次
  'angle7544455',      // 12次
  'freedomofbook',     // 12次
  'aliaydn718195',     // 12次
  'anzacshotta',       // 12次
  'bolttrick',         // 12次
  'ak_pony33319',      // 12次
  'crypto_cat888',     // 12次
  'devyehudi',         // 12次
  'apizt12319411',     // 12次
  'burniesendersx',    // 12次
  'cha_xun92563',      // 12次
  'woiibayu25x55s',    // 12次
  'rtk17025',          // 12次
  'spawningrunners',   // 12次
  'crypto_bn',         // 12次
  'bscbestmeme',       // 12次
  'agentz010',         // 12次
  'cady_btc',          // 12次
  'freedomdrawbsc',    // 12次
  'xxy177',            // 12次
  'fifamemesss',       // 12次
  'wallstreet0name',   // 12次
  'ryanmyher',         // 12次
  'shadowonchainn',    // 12次
  'youthfulwealth',    // 10次
  'freedomcryptocz',   // 10次
  'caneryayla1',       // 10次
  'jiamixionger',      // 10次
  'dihllua',           // 10次
  '0xxjiujiu',         // 10次
  'gloriaw18242867',   // 10次
  'bitcoinatblock',    // 10次
  'nancy5429463225',   // 10次
  'deviousbondius',    // 10次
  'georgeg43737947',   // 10次
  'vaultburnbsc',      // 10次
  'lioneldexi',        // 10次
  'solarinopaula',     // 10次
  'jakthedegen',       // 10次
  'almeidahmorenah',   // 10次
  'iraninarabic_ir',   // 10次
  '2949045502gu',      // 10次
  'jellowdevz',        // 10次
  'sejugeqepo',        // 10次
  'trumpgolfdc',       // 10次
  'kristinad80518',    // 10次
  'woiibayu25xa0c',    // 10次
  'longkai44',         // 10次
  'awf93u198f',        // 10次
  'claworldnfa',       // 10次
  'helen8938461924',   // 10次
  'bnb_faucet',        // 10次
  'chungpengzhoa',     // 10次
  'doiiares',          // 10次
  'courseyjon89682',   // 10次
  'l63yfyqxy641498',   // 10次
  'lisa57586692055',   // 10次
  'happyoysterai',     // 10次
  '4444_holder',       // 10次
  'pokerwlfi',         // 10次
  'misternarcos',      // 10次
  'wantedintel',       // 10次
  'mirror_bnb',        // 10次
  'legend_atm_op',     // 10次
  'fuck',              // 10次
  'xyztwelvee',        // 10次
  'lambs0l',           // 10次
  'martypartymusic',   // 10次
  'riverswhite10',     // 10次
  'cnm234677',         // 10次
  'dddemoono7ogy',     // 10次
  'hoaqin1111',        // 10次
  'bndsa23455',        // 10次
  'pngs359732',        // 10次
  'gap2026_a7',        // 10次
  '0xsakura666',       // 10次
  'sharmacherag',      // 10次
  'cunningfoxes',      // 10次
  'goyimpnl',          // 10次
];

// 频率映射（用于输出）
const FREQUENCY_MAP = {
  'angle754445': 446, 'notickernolife': 262, 'mgga_bsc': 236, 'levenleven80398': 194,
  '404bsc': 186, 'pblonde98247': 178, 'okmetom': 172, 'felix_fan': 166,
  'zuozhu_dev': 164, 'six1xxx': 164, 'misssheridan09': 156, 'raxhephonh': 130,
  'aryonserwin': 126, 'king1883560': 122, 'quyin535731': 114, '100x666888': 112,
  'natalie_stagg07': 108, 'haze0x': 104, 'caodan_cao123': 102,
  'kindlamyth55346': 94, 'rainbow_dev_1': 88, 'in927772': 88, 'steipete': 86,
  'niaoshen988': 84, 'purevess3l': 84, 'mapalubnb': 82, 'deleontami': 76,
  'vukgz': 76, 'bnbclawbiz': 72, '7buildtoken': 68, 'axopq74224': 60,
  'audrey33520': 60, 'vvvvv493587': 60, 'jadedev888': 58, 'dinary66': 54,
  'web3amirah': 54, 'afengdev': 54, 'zc7650934628178': 54, 'kim62688986': 54,
  'abear888': 52, 'caosishabi123': 52, 'jackiebrochu1': 52, 'xxxxhold': 50,
  'pick7778': 50,
  'em11991590': 48, '256natethegr8': 46, 'jirachi0x19': 46, 'mangzgw_web21': 46,
  'yao_bu30086': 46, 'yuanshenbnb': 46, 'gaoqiannanhai': 44, 'shidizai0202': 44,
  'shyamsundartha6': 42, 'chinh132hn': 42, 'jadedev666': 42, 'zhao_luo_chen': 42,
  'justaeggman': 40, 'arutyun_1993': 40, 'archie33390': 40, 'tmdxushi': 40,
  'digua1992__': 40, 'patricia_b31211': 38, 'naveeng34105645': 38, 'tiancaidev': 38,
  'taotheblessing2': 38, 'woiibayu25zihf': 38, 'cathych13419758': 38, 'asshole_sol1': 38,
  'elsharnoub4370': 36, 'web2designer09': 36, 'nikolaihauckx': 36, 'zhuzaia': 36,
  'thewaterdeploy': 34, 'we_love_gg_snsd': 34, 'sourceunifi2dy': 34, 'quantisthememe': 32,
  'justaegg0': 32, 'nikitabier': 32, 'jncquant': 32, 'xiaoyu_184cm': 32,
  'godc99': 32, 'madhurbara': 32, 'robingould16534': 30, 'crystalc67622': 30,
  'carly_davies': 30, 'amitmalhotra82': 30,
  'jdunkel': 28, 'memeking168': 28, 'felixreed15ljn': 28, 'sichuanzhishu': 28,
  'jesuslvivas': 28, 'earthcurated': 28, 'thedevrrrrrrr': 28, 'cake8869': 26,
  'snake_bnb': 26, '0xxx_bscdev': 26, 'darthmiaul': 26, 'brc20niubi': 26,
  'mabman338': 26, 'ayushquantt': 26, 'noksb83348283': 26, '0xmmo0f4qg196xu': 26,
  'omarsabnam': 26, 'yyq7h6': 24, 'muccadevx': 24, 'cnnewsglobal': 24,
  'xfreeze': 24, 'ditto_bnb': 24, 'zhu_jingyang': 24, 'trenchsiu': 24,
  'sunkanmialabi': 24, 'sheepsheepjia': 24, 'minixkx7tpv': 24, 'tyw1984': 24,
  'hendadejiaodu': 24, 'robertc08391086': 24, 'thomassandly': 24, 'youaredegen': 22,
  'llavonna69671': 22, 'yihebirthday': 22, 'marionawfal': 22, 'dragonskill_': 22,
  'devooring': 22, 'twit_terer_69er': 22, 'lovelygana5': 22, 'cz_skill': 20,
  'zeeko_sol': 20, 'bnti_test': 20, 'sichuan6900': 20, 'gaowancat': 20,
  'alanjohnbgi': 20, 'thememedealer_': 20, 'jiaodu6688': 20, 'chungpong_': 20,
  'bamdevver': 20, 'susanhawki27329': 20,
  'l6a5esu2ohezfpo': 18, 'chakibbrk': 18, 'yizhibaozz': 18, '9766xd': 18,
  'hubbardtra29412': 18, 'brax57506037': 18, 'bnb___guy': 18, 'libertycappy': 18,
  'spigg1115': 18, 'grok12_john': 18, 'shizzlitto': 18, 'jinzz37327611': 18,
  'lumaogou': 18, 'scott1284': 16, 'sandeep96721678': 16, 'zhaoluochen168': 16,
  'zixuanxuesong': 16, 'and_khamoo': 16, '0xpainter_dev': 16, 'ze_zeircle': 16,
  'vusimuzindaba2': 16, '_forab': 16, 'blg931223229631': 16, 'hty1363276': 16,
  'esee06257': 16, 'bitcoin': 16, '0xmoon': 16, 'taotheblessing1': 16,
  'cardillosamuel': 16, 'dagouzhuanjia': 14, 'elena46659755': 14, 'drawesomedoge': 14,
  'sisibinance': 14, 'bnb6900_x': 14, 'shabi666woc': 14, 'heroineyihe': 14,
  'huhu721313': 14, 'rpgva73841483': 14, 'bsc_el_dev': 14, 'lookfirst_leep': 14,
  '0xpicai': 14, 'jayjayloves67': 14, 'hardenwhit12613': 14, 'mikeybsanders': 14,
  'qbb167311': 14, 'dariusjlxx': 14, 'myfarmerbsc': 14, 'kmcrypton': 14,
  'gonzalogonzal71': 14, 'xxlb888': 14, 'venturetwins': 14, 'geniusterminal': 14,
  'pumpventfun': 14, 'kevinb330': 14, 'esee0987': 14, 'anndylian': 12,
  'chaojixiaomada': 12, 'slibby42770': 12, 's93curib8dp67lv': 12, 'pam_swim': 12,
  'hana_b30': 12, '0xjiaodu': 12, 'changocoinbnb': 12, 'esotericpigeon': 12,
  '4tokendev': 12, 'cryptosis9_okx': 12, 'quantiye': 12, 'chillmigratoor': 12,
  'angle7544455': 12, 'freedomofbook': 12, 'aliaydn718195': 12, 'anzacshotta': 12,
  'bolttrick': 12, 'ak_pony33319': 12, 'crypto_cat888': 12, 'devyehudi': 12,
  'apizt12319411': 12, 'burniesendersx': 12, 'cha_xun92563': 12, 'woiibayu25x55s': 12,
  'rtk17025': 12, 'spawningrunners': 12, 'crypto_bn': 12, 'bscbestmeme': 12,
  'agentz010': 12, 'cady_btc': 12, 'freedomdrawbsc': 12, 'xxy177': 12,
  'fifamemesss': 12, 'wallstreet0name': 12, 'ryanmyher': 12, 'shadowonchainn': 12,
  'youthfulwealth': 10, 'freedomcryptocz': 10, 'caneryayla1': 10, 'jiamixionger': 10,
  'dihllua': 10, '0xxjiujiu': 10, 'gloriaw18242867': 10, 'bitcoinatblock': 10,
  'nancy5429463225': 10, 'deviousbondius': 10, 'georgeg43737947': 10, 'vaultburnbsc': 10,
  'lioneldexi': 10, 'solarinopaula': 10, 'jakthedegen': 10, 'almeidahmorenah': 10,
  'iraninarabic_ir': 10, '2949045502gu': 10, 'jellowdevz': 10, 'sejugeqepo': 10,
  'trumpgolfdc': 10, 'kristinad80518': 10, 'woiibayu25xa0c': 10, 'longkai44': 10,
  'awf93u198f': 10, 'claworldnfa': 10, 'helen8938461924': 10, 'bnb_faucet': 10,
  'chungpengzhoa': 10, 'doiiares': 10, 'courseyjon89682': 10, 'l63yfyqxy641498': 10,
  'lisa57586692055': 10, 'happyoysterai': 10, '4444_holder': 10, 'pokerwlfi': 10,
  'misternarcos': 10, 'wantedintel': 10, 'mirror_bnb': 10, 'legend_atm_op': 10,
  'fuck': 10, 'xyztwelvee': 10, 'lambs0l': 10, 'martypartymusic': 10,
  'riverswhite10': 10, 'cnm234677': 10, 'dddemoono7ogy': 10, 'hoaqin1111': 10,
  'bndsa23455': 10, 'pngs359732': 10, 'gap2026_a7': 10, '0xsakura666': 10,
  'sharmacherag': 10, 'cunningfoxes': 10, 'goyimpnl': 10,
};

const BATCH_SIZE = 5;           // 每批并发数
const DELAY_BETWEEN_BATCH = 2000; // 批次间隔（毫秒）
const OUTPUT_FILE = path.join(__dirname, 'frequent-issuer-audit.md');
const CSV_OUTPUT_FILE = path.join(__dirname, 'frequent-issuer-audit.csv');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFollowers(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return `${count}`;
}

async function main() {
  console.log(`\n🔍 开始审计 ${ACCOUNTS_TO_AUDIT.length} 个账号...\n`);

  const results = [];
  const failed = [];

  for (let i = 0; i < ACCOUNTS_TO_AUDIT.length; i += BATCH_SIZE) {
    const batch = ACCOUNTS_TO_AUDIT.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (screenName) => {
      try {
        const info = await getUserByScreenName(screenName);
        return { screenName, info, error: null };
      } catch (err) {
        return { screenName, info: null, error: err.message };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const r of batchResults) {
      if (r.error) {
        failed.push({ screenName: r.screenName, error: r.error });
        console.log(`❌ @${r.screenName} - 失败: ${r.error}`);
      } else {
        results.push(r);
        const freq = FREQUENCY_MAP[r.screenName] || '?';
        console.log(`✅ @${r.screenName} (${freq}次) - ${r.info.name} | 粉丝: ${formatFollowers(r.info.followers_count)} | 推文: ${r.info.statuses_count}`);
      }
    }

    if (i + BATCH_SIZE < ACCOUNTS_TO_AUDIT.length) {
      await delay(DELAY_BETWEEN_BATCH);
    }

    // 进度
    const progress = Math.min(i + BATCH_SIZE, ACCOUNTS_TO_AUDIT.length);
    console.log(`📊 进度: ${progress}/${ACCOUNTS_TO_AUDIT.length}\n`);
  }

  // 生成报告
  console.log('\n📝 生成审计报告...');

  // 按粉丝数排序，方便判断
  results.sort((a, b) => b.info.followers_count - a.info.followers_count);

  let md = `# 频繁发币者审计报告\n\n`;
  md += `- 数据来源：experiment_tokens 中出现 >= 10 次的账号（共 ${ACCOUNTS_TO_AUDIT.length} 个）\n`;
  md += `- 审计时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
  md += `- 成功获取：${results.length} 个\n`;
  md += `- 获取失败：${failed.length} 个\n\n`;

  md += `---\n\n`;
  md += `## 账号列表（按粉丝数降序）\n\n`;
  md += `| # | screen_name | 名称 | 粉丝数 | 推文数 | 频率 | 蓝标 | 简介 | 初步判断 |\n`;
  md += `|---|-------------|------|--------|--------|------|------|------|----------|\n`;

  results.forEach((r, idx) => {
    const freq = FREQUENCY_MAP[r.screenName] || '?';
    const blue = r.info.is_blue_verified ? '✅' : '';
    const desc = (r.info.description || '').replace(/\|/g, '｜').replace(/\n/g, ' ').slice(0, 80);
    const followers = formatFollowers(r.info.followers_count);
    const tweets = formatFollowers(r.info.statuses_count);

    // 初步判断逻辑
    let judgment = '';
    const f = r.info.followers_count;
    if (f >= 100000) {
      judgment = '⚠️ 大账号-被依托';
    } else if (f >= 10000) {
      judgment = '⚠️ 中大号-待确认';
    } else if (f >= 2000) {
      judgment = '❓ 中等-待确认';
    } else {
      judgment = '✅ 小号-可能是发币者';
    }

    md += `| ${idx + 1} | @${r.screenName} | ${r.info.name.replace(/\|/g, '｜')} | ${followers} | ${tweets} | ${freq} | ${blue} | ${desc} | ${judgment} |\n`;
  });

  md += `\n---\n\n`;

  // 失败列表
  if (failed.length > 0) {
    md += `## 获取失败的账号（${failed.length}个）\n\n`;
    md += `这些账号可能已更名、被封禁或不存在：\n\n`;
    failed.forEach(f => {
      const freq = FREQUENCY_MAP[f.screenName] || '?';
      md += `- @${f.screenName}（${freq}次）：${f.error}\n`;
    });
    md += `\n`;
  }

  // 统计摘要
  md += `---\n\n## 统计摘要\n\n`;

  const bigAccounts = results.filter(r => r.info.followers_count >= 100000);
  const mediumAccounts = results.filter(r => r.info.followers_count >= 10000 && r.info.followers_count < 100000);
  const smallAccounts = results.filter(r => r.info.followers_count >= 2000 && r.info.followers_count < 10000);
  const tinyAccounts = results.filter(r => r.info.followers_count < 2000);

  md += `- 大账号（>=10万粉丝）：${bigAccounts.length} 个 → 可能是被依托发币者\n`;
  md += `- 中大号（1万-10万粉丝）：${mediumAccounts.length} 个 → 需人工判断\n`;
  md += `- 中等号（2000-1万粉丝）：${smallAccounts.length} 个 → 需人工判断\n`;
  md += `- 小号（<2000粉丝）：${tinyAccounts.length} 个 → 可能是频繁发币者\n\n`;

  // 详细信息
  md += `---\n\n## 详细账号信息\n\n`;

  results.forEach((r, idx) => {
    const freq = FREQUENCY_MAP[r.screenName] || '?';
    md += `### ${idx + 1}. @${r.screenName}（${freq}次）\n\n`;
    md += `- **名称**：${r.info.name}\n`;
    md += `- **粉丝**：${r.info.followers_count.toLocaleString()}\n`;
    md += `- **关注**：${r.info.friends_count.toLocaleString()}\n`;
    md += `- **推文数**：${r.info.statuses_count.toLocaleString()}\n`;
    md += `- **蓝标**：${r.info.is_blue_verified ? '是' : '否'}\n`;
    md += `- **认证**：${r.info.verified ? '是' : '否'}\n`;
    md += `- **创建时间**：${r.info.created_at || '未知'}\n`;
    md += `- **位置**：${r.info.location || '未知'}\n`;
    md += `- **简介**：${r.info.description || '无'}\n`;
    md += `- **URL**：${r.info.url || '无'}\n`;
    md += `\n`;
  });

  fs.writeFileSync(OUTPUT_FILE, md, 'utf-8');
  console.log(`\n✅ 审计报告已保存到: ${OUTPUT_FILE}`);

  // 生成CSV
  const escapeCsv = (str) => {
    if (!str) return '';
    const s = String(str).replace(/\r?\n/g, ' ').replace(/\r/g, '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvHeader = 'screen_name,名称,粉丝数,关注数,推文数,频率,蓝标,认证,创建时间,位置,简介,URL,初步判断,分类(留空待填)';
  const csvRows = results.map(r => {
    const freq = FREQUENCY_MAP[r.screenName] || '?';
    const f = r.info.followers_count;
    let judgment = '';
    if (f >= 100000) judgment = '大账号-被依托';
    else if (f >= 10000) judgment = '中大号-待确认';
    else if (f >= 2000) judgment = '中等-待确认';
    else judgment = '小号-可能是发币者';

    return [
      r.screenName,
      escapeCsv(r.info.name),
      r.info.followers_count,
      r.info.friends_count,
      r.info.statuses_count,
      freq,
      r.info.is_blue_verified ? '是' : '否',
      r.info.verified ? '是' : '否',
      escapeCsv(r.info.created_at),
      escapeCsv(r.info.location),
      escapeCsv(r.info.description),
      escapeCsv(r.info.url),
      judgment,
      '', // 分类列，留给用户填写
    ].join(',');
  });

  // 失败的账号也加入CSV
  const csvFailed = failed.map(f => {
    const freq = FREQUENCY_MAP[f.screenName] || '?';
    return [
      f.screenName,
      '', '', '', '', freq, '', '', '', '', '', '', '获取失败: ' + escapeCsv(f.error), '',
    ].join(',');
  });

  const csvContent = '\uFEFF' + csvHeader + '\n' + csvRows.join('\n') + (csvFailed.length > 0 ? '\n' + csvFailed.join('\n') : '') + '\n';
  fs.writeFileSync(CSV_OUTPUT_FILE, csvContent, 'utf-8');
  console.log(`✅ CSV报告已保存到: ${CSV_OUTPUT_FILE}`);
  console.log(`   成功: ${results.length}, 失败: ${failed.length}`);
}

main().catch(err => {
  console.error('审计脚本执行失败:', err);
  process.exit(1);
});
