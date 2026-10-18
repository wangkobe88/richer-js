#!/usr/bin/env node
/**
 * C99 传奇蝴蝶案修复——聚合器自动代币页不得作为项目币归属证据（零 DB 零网络单测）
 *
 * 事故现场：0x62f829bae9f387ae399ccd0c45a1360e61857777（传奇蝴蝶/群1109951764干1千倍，
 * flap 盘）。token_create 自带 webUrl=dex.coinmarketcap.com/token/bsc/<CA>（CMC dex
 * 自动聚合页，任何 BSC 币都有此形状 URL）→ isProjectCoin 的 classifiedUrls URL 臂
 * 命中 → skipAddressValidation=true → performRulesValidation 走
 * project_coin_website_verified 分支直接 addressVerified=true（账号简介/推文压根没验，
 * 64 粉/4 推小号语料无一条含 CA）→ prestage token_type 二分 → Jev 无推文可看判
 * web3_native_ip_early 0.98 → mid=rating 2 → 买腿通过。
 *
 * 修复：AUTO_TOKEN_PAGE_DOMAINS 清单（含子域匹配），isProjectCoin 的
 * websiteInfo(content/rawHtml)/URL 臂与 hasIndependentWebsite 不采信聚合器页；
 * 推文/账号简介宣告臂不动（发行方亲手贴的仍是证据）。
 *
 * 用法：node scripts/_test_isproject_coin_aggregator_urls.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${desc}`); }
  else { failed++; console.error(`  ✗ ${desc}\n      期望: ${e}\n      实际: ${a}`); }
}

(async () => {
  const { isProjectCoin, hasIndependentWebsite, isAutoTokenPageUrl } =
    await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { performRulesValidation } =
    await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');

  const ADDR = '0x62f829bae9f387ae399ccd0c45a1360e61857777';

  console.log('== 1. isAutoTokenPageUrl 谓词 ==');
  check('事故域名 dex.coinmarketcap.com → true',
    isAutoTokenPageUrl(`https://dex.coinmarketcap.com/token/bsc/${ADDR}`), true);
  check('顶域 coinmarketcap.com → true',
    isAutoTokenPageUrl('https://coinmarketcap.com/dex/scan/x'), true);
  check('dexscreener → true', isAutoTokenPageUrl('https://dexscreener.com/bsc/0xabc'), true);
  check('gmgn.ai → true', isAutoTokenPageUrl('https://gmgn.ai/bsc/token/0xabc'), true);
  check('flap.sh → true', isAutoTokenPageUrl('https://flap.sh/token/0xabc'), true);
  check('four.meme → true', isAutoTokenPageUrl('https://four.meme/token/0xabc'), true);
  check('冒充子域前缀不误伤（cmcdexscreener.example.com → false）',
    isAutoTokenPageUrl('https://cmdexscreener.example.com/t/0xabc'), false);
  check('独立站 → false', isAutoTokenPageUrl(`https://legendbutterfly.io/token/${ADDR}`), false);
  check('无效 URL → false', isAutoTokenPageUrl('not a url'), false);
  check('空值 → false', isAutoTokenPageUrl(null), false);

  console.log('== 2. isProjectCoin 事故现场反证 ==');
  // 本案落库 classified_urls 原样（twitter account + CMC dex 页 + share11 短链）
  const incidentClassifiedUrls = {
    twitter: [{ url: 'https://x.com/AEIXGysp3s61796', type: 'account', platform: 'twitter', priority: 2 }],
    websites: [
      { url: `https://dex.coinmarketcap.com/token/bsc/0x62F829BAE9F387aE399cCd0c45A1360E61857777`, type: 'website', platform: 'web', priority: 3 },
      { url: 'http://s.share11.top/+raiF_wrqx5RhOTgx', type: 'website', platform: 'web', priority: 3 },
    ],
  };
  const incidentTwitterInfo = {
    type: 'account',
    screen_name: 'AEIXGysp3s61796',
    name: 'MC',
    description: '新征程，新起途。',
    followers_count: 64,
    statuses_count: 4,
  };
  check('事故现场（CMC URL 含全地址+账号无 CA）→ false（修复前 true）',
    isProjectCoin(ADDR, { twitterInfo: incidentTwitterInfo, websiteInfo: null, classifiedUrls: incidentClassifiedUrls }),
    false);

  console.log('== 3. isProjectCoin 清单域名逐个（URL 臂不采信）==');
  for (const d of ['dexscreener.com', 'geckoterminal.com', 'dextools.io', 'birdeye.so', 'ave.ai', 'gmgn.ai', 'pancakeswap.finance', 'four.meme', 'flap.sh', 'coingecko.com']) {
    check(`${d} token 页 URL 含地址 → false`,
      isProjectCoin(ADDR, {
        twitterInfo: null, websiteInfo: null,
        classifiedUrls: { websites: [{ url: `https://${d}/token/${ADDR}`, type: 'website', platform: 'web', priority: 3 }] },
      }), false);
  }

  console.log('== 4. isProjectCoin 不误杀（真证据臂） ==');
  check('独立站 URL 路径含地址 → true',
    isProjectCoin(ADDR, {
      twitterInfo: null, websiteInfo: null,
      classifiedUrls: { websites: [{ url: `https://legendbutterfly.io/token/${ADDR}`, type: 'website', platform: 'web', priority: 3 }] },
    }), true);
  check('独立站 websiteInfo content 含地址 → true',
    isProjectCoin(ADDR, {
      twitterInfo: null,
      websiteInfo: { url: 'https://legendbutterfly.io/', content: `合约地址 ${ADDR}` },
      classifiedUrls: null,
    }), true);
  check('聚合器 websiteInfo content 含地址 → false（修复前 true）',
    isProjectCoin(ADDR, {
      twitterInfo: null,
      websiteInfo: { url: `https://dex.coinmarketcap.com/token/bsc/${ADDR}`, content: `Token ${ADDR} on BSC` },
      classifiedUrls: null,
    }), false);
  check('聚合器 websiteInfo rawHtml 含地址 → false',
    isProjectCoin(ADDR, {
      twitterInfo: null,
      websiteInfo: { url: 'https://dexscreener.com/bsc/abc', rawHtml: `<a href="/bsc/${ADDR}">x</a>` },
      classifiedUrls: null,
    }), false);
  check('websiteInfo 无 url 字段 + content 含地址 → true（无域名可判，维持原信任）',
    isProjectCoin(ADDR, {
      twitterInfo: null,
      websiteInfo: { content: `CA ${ADDR}` },
      classifiedUrls: null,
    }), true);
  check('推文文本宣告 CA → true（宣告臂不受清单影响）',
    isProjectCoin(ADDR, { twitterInfo: { type: 'tweet', text: `发币 ${ADDR}` }, websiteInfo: null, classifiedUrls: null }), true);
  check('账号简介宣告 CA → true（account 型 bio 臂不受清单影响）',
    isProjectCoin(ADDR, { twitterInfo: { type: 'account', description: `CA: ${ADDR}` }, websiteInfo: null, classifiedUrls: null }), true);
  check('无关 URL（短链不含地址）→ false（原行为）',
    isProjectCoin(ADDR, {
      twitterInfo: null, websiteInfo: null,
      classifiedUrls: { websites: [{ url: 'http://s.share11.top/+raiF_wrqx5RhOTgx', type: 'website', platform: 'web', priority: 3 }] },
    }), false);
  check('混合语料：CMC URL + 独立站短链均无地址 → false',
    isProjectCoin(ADDR, {
      twitterInfo: incidentTwitterInfo, websiteInfo: null, classifiedUrls: incidentClassifiedUrls,
    }), false);

  console.log('== 5. hasIndependentWebsite ==');
  check('CMC dex 页不算独立网站（修复前 true）',
    hasIndependentWebsite({ websites: [{ url: `https://dex.coinmarketcap.com/token/bsc/${ADDR}` }] }), false);
  check('dexscreener 页不算独立网站',
    hasIndependentWebsite({ websites: [{ url: 'https://dexscreener.com/bsc/abc' }] }), false);
  check('linktr.ee 不算独立网站（存量行为）',
    hasIndependentWebsite({ websites: [{ url: 'https://linktr.ee/foo' }] }), false);
  check('独立站算（存量行为不回归）',
    hasIndependentWebsite({ websites: [{ url: 'https://legendbutterfly.io/' }] }), true);

  console.log('== 6. performRulesValidation 端到端（修复后链路） ==');
  // 事故账号形状（64 粉/4 推/简介无 CA/无推文含 CA）
  const smallAcct = {
    type: 'account', screen_name: 'AEIXGysp3s61796', name: 'MC',
    description: '新征程，新起途。',
    followers_count: 64, statuses_count: 4, verified: false, is_blue_verified: false,
    tweets: [{ text: '新征程，新起途。' }, { text: '冲' }, { text: '第一桶金' }, { text: '起飞' }],
  };
  const incidentResult = performRulesValidation(ADDR, '传奇蝴蝶', '群1109951764干1千倍', smallAcct, {});
  check('事故现场（质量不达标+无 CA）→ passed=false stage=address（修复后正确拦截）',
    { passed: incidentResult.passed, stage: incidentResult.stage, addressVerified: incidentResult.addressVerified },
    { passed: false, stage: 'address', addressVerified: false });

  // 小号 + 推文真宣告 CA + 名字精确匹配 → 照旧过地址门
  const honestAcct = {
    ...smallAcct, name: '传奇蝴蝶',
    tweets: [{ text: `我们的币 ${ADDR} 正式开盘` }],
  };
  const honestResult = performRulesValidation(ADDR, '传奇蝴蝶', '传奇蝴蝶', honestAcct, {});
  check('小号推文宣告 CA+名字匹配 → passed=true addressVerified=true（真宣告不受影响）',
    { passed: honestResult.passed, stage: honestResult.stage, addressVerified: honestResult.addressVerified, nameMatch: honestResult.nameMatch },
    { passed: true, stage: 'passed', addressVerified: true, nameMatch: true });

  // 质量达标大号 + 无 CA → abm 两条件路径（addressVerified=false 交 Jev 判断）
  const bigAcct = {
    ...smallAcct, followers_count: 600, statuses_count: 30,
  };
  const bigResult = performRulesValidation(ADDR, '传奇蝴蝶', '群1109951764干1千倍', bigAcct, {});
  check('质量达标大号无 CA → passed=true stage=account_quality_no_address addressVerified=false（CMC URL 不再送 addressVerified=true）',
    { passed: bigResult.passed, stage: bigResult.stage, addressVerified: bigResult.addressVerified },
    { passed: true, stage: 'account_quality_no_address', addressVerified: false });

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
