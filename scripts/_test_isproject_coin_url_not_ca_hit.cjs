#!/usr/bin/env node
/**
 * C100 OK❌ 案修复——URL 含 CA 不算命中 CA（零 DB 零网络单测）
 *
 * 事故现场：0x0195119e4806441c871adada6256296265ed7777（OK❌，flap 税币，
 * 2026-10-18 08:22:45 创建，净 -12.75%）。token metadata URLs 含本币 CA
 * （t.me/#0x0195… + CMC dex 自动页）→ isProjectCoin 的 classifiedUrls URL 臂
 * 命中（t.me 不在 C99 聚合器清单内，CMC 自动页 pre-C99 也算独立站→账号链
 * 收集 @Notickernowif）→ 路由进 prestage + skipAddressValidation=true →
 * performRulesValidation skip 分支直接返回 addressVerified=true（stage=
 * 'project_coin_website_verified'）——账号简介「404」/3 推/0 粉，时间线 6 条
 * 推文零 CA（prestage state 实证：全地址仅出现于 [TOKEN] 元数据段 1 次），
 * 验证压根没执行=伪造 → token_type 二分 → web3_native_ip_early 0.96 →
 * 粉丝带 0-299 → mid=rating 2 → 买腿过（GMGN 首币拦不住）→ 买 0.004 BNB →
 * P4 清仓 -12.75%。孪生票欧抑（同梗不同账号）走标准路径 jev-J1.36 low 拦住。
 *
 * 用户裁定（2026-10-18）：「把假 addressVerified 给修了」「说白了网址里头
 * 有CA不算命中CA」→ isProjectCoin 加 includeUrlArm 选项；skipAddressValidation
 * 的证据源只认内容臂（isProjectCoinContentVerified）|| issuerCaTimeline；
 * URL 臂保留给路由/账号补充收集（存量语义不变）。
 *
 * 用法：node scripts/_test_isproject_coin_url_not_ca_hit.cjs
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
  const { isProjectCoin } =
    await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { performRulesValidation } =
    await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');
  const fs = await import('node:fs');

  const ADDR = '0x0195119e4806441c871adada6256296265ed7777';

  console.log('== 1. OK❌ 事故现场反证（URL 臂 gated） ==');
  // 本案落库 classified_urls 原样形状：twitter 推文 URL + telegram t.me/#CA +
  // websites CMC dex 自动页（C99 前算独立站 → 触发账号链收集）；twitterInfo
  // 为推文语料（@Notickernowif 19 粉，文本无 CA，简介「404」）；websiteInfo=null
  //（websiteFetch 默认关）。URL 臂全语义命中（t.me 非 C99 聚合器域）。
  const incidentFetchResults = {
    twitterInfo: {
      type: 'tweet',
      author_screen_name: 'Notickernowif',
      text: '何必东奔西走，欧易啥也没有=OK❌',
      description: '404',
    },
    websiteInfo: null,
    classifiedUrls: {
      twitter: [{ url: 'https://x.com/Notickernowif/status/1900000000000000000', type: 'tweet', platform: 'twitter', priority: 1 }],
      telegram: [{ url: `https://t.me/#${ADDR}`, type: 'telegram', platform: 'telegram', priority: 2 }],
      websites: [
        { url: `https://dex.coinmarketcap.com/token/bsc/${ADDR}`, type: 'website', platform: 'web', priority: 3 },
      ],
    },
  };
  check('事故形状 isProjectCoin 全语义（t.me URL 臂）→ true（路由/收集线索保留）',
    isProjectCoin(ADDR, incidentFetchResults), true);
  check('事故形状 isProjectCoin 强证据模式（includeUrlArm:false）→ false（不命中 CA）',
    isProjectCoin(ADDR, incidentFetchResults, { includeUrlArm: false }), false);
  check('options 缺省=全语义（存量调用点零变化）',
    isProjectCoin(ADDR, incidentFetchResults, {}), true);

  console.log('== 2. 通用 URL 臂形状（非聚合器独立站路径含 CA） ==');
  const urlOnlyFetchResults = {
    twitterInfo: null,
    websiteInfo: null,
    classifiedUrls: {
      websites: [{ url: `https://myproject.example.com/token/${ADDR}`, type: 'website', platform: 'web', priority: 3 }],
    },
  };
  check('独立站 URL 含 CA：全语义 → true',
    isProjectCoin(ADDR, urlOnlyFetchResults), true);
  check('独立站 URL 含 CA：强证据模式 → false（网址里头有CA不算命中CA）',
    isProjectCoin(ADDR, urlOnlyFetchResults, { includeUrlArm: false }), false);

  console.log('== 3. 内容臂在强证据模式下全部保留（真公示不受影响） ==');
  const caTweet = { ...incidentFetchResults, twitterInfo: { ...incidentFetchResults.twitterInfo, text: `我的新币 $OK 合约 ${ADDR} 已上线` } };
  check('推文文本含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caTweet, { includeUrlArm: false }), true);
  const caBio = { ...incidentFetchResults, twitterInfo: { ...incidentFetchResults.twitterInfo, description: `CA: ${ADDR}` } };
  check('账号简介含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caBio, { includeUrlArm: false }), true);
  const caReply = { ...incidentFetchResults, twitterInfo: { ...incidentFetchResults.twitterInfo, in_reply_to: { text: `contract ${ADDR}` } } };
  check('回复推文含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caReply, { includeUrlArm: false }), true);
  const caQuoted = { ...incidentFetchResults, twitterInfo: { ...incidentFetchResults.twitterInfo, quoted_status: { text: `addr ${ADDR}` } } };
  check('引用推文含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caQuoted, { includeUrlArm: false }), true);
  const caWebsiteTweet = { ...incidentFetchResults, twitterInfo: { ...incidentFetchResults.twitterInfo, website_tweet: { text: `launch ${ADDR}` } } };
  check('website_tweet 含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caWebsiteTweet, { includeUrlArm: false }), true);
  const caWebsiteContent = {
    twitterInfo: null,
    websiteInfo: { url: 'https://myproject.example.com', content: `Our token contract: ${ADDR}`, rawHtml: '' },
    classifiedUrls: {},
  };
  check('独立站正文含 CA：强证据模式 → true',
    isProjectCoin(ADDR, caWebsiteContent, { includeUrlArm: false }), true);
  const aggregatorContent = {
    twitterInfo: null,
    websiteInfo: { url: `https://dex.coinmarketcap.com/token/bsc/${ADDR}`, content: `token page ${ADDR}`, rawHtml: `raw ${ADDR}` },
    classifiedUrls: {},
  };
  check('聚合器页正文/rawHtml 含 CA（C99）：强证据模式 → false',
    isProjectCoin(ADDR, aggregatorContent, { includeUrlArm: false }), false);
  const aggregatorRawHtml = {
    twitterInfo: null,
    websiteInfo: { url: 'https://dexscreener.com/bsc/' + ADDR, content: '', rawHtml: `footer ${ADDR}` },
    classifiedUrls: {},
  };
  check('聚合器 rawHtml 含 CA（C99）：全语义/强证据均 false',
    [isProjectCoin(ADDR, aggregatorRawHtml), isProjectCoin(ADDR, aggregatorRawHtml, { includeUrlArm: false })],
    [false, false]);

  console.log('== 4. performRulesValidation 事故链路反证（skip 断源后的真实语义） ==');
  // 本案 prestage state 实证的账号形状：0 粉/3 推/简介「404」/时间线零 CA
  const incidentAccount = {
    type: 'account',
    screen_name: 'Notickernowif',
    description: '404',
    followers_count: 0,
    statuses_count: 3,
    verified: false,
    is_blue_verified: false,
    tweets: [
      { tweet_id: '1', text: '我操，我发现一只会说妈个逼的鱼' },
      { tweet_id: '2', text: '京小安出自这个反诈汪汪队节目' },
      { tweet_id: '3', text: '库克亲自拜访胡彦斌' },
    ],
  };
  const noSkip = performRulesValidation(ADDR, 'OK', 'OK❌', incidentAccount, { skipAddressValidation: false });
  check('修复后 OK❌ 形状（skip=false）：passed=false / stage=address / addressVerified=false',
    { passed: noSkip.passed, stage: noSkip.stage, addressVerified: noSkip.addressVerified },
    { passed: false, stage: 'address', addressVerified: false });
  const withSkip = performRulesValidation(ADDR, 'OK', 'OK❌', incidentAccount, { skipAddressValidation: true });
  check('对照组（skip=true 强证据通道保留，C35 语义）：passed=true / addressVerified=true / stage=project_coin_website_verified',
    { passed: withSkip.passed, stage: withSkip.stage, addressVerified: withSkip.addressVerified },
    { passed: true, stage: 'project_coin_website_verified', addressVerified: true });

  // 边界：质量达标账号 + URL-CA 票 + 无 CA 宣告 → account_quality_no_address 通道
  // （addressVerified=false 交给 ABM 两条件，不是伪造 true）
  const qualityAccount = {
    ...incidentAccount,
    followers_count: 800,
    statuses_count: 60,
    tweets: [
      { tweet_id: '1', text: '市场观点分享' },
      { tweet_id: '2', text: '行业观察' },
    ],
  };
  const qualityNoAddr = performRulesValidation(ADDR, 'OK', 'OK❌', qualityAccount, { skipAddressValidation: false });
  check('质量达标+无 CA 宣告：account_quality_no_address / addressVerified=false（不伪造）',
    { passed: qualityNoAddr.passed, stage: qualityNoAddr.stage, addressVerified: qualityNoAddr.addressVerified },
    { passed: true, stage: 'account_quality_no_address', addressVerified: false });

  console.log('== 5. NarrativeAnalyzer 源码口径锁（防回归：skip 证据源不得退回全语义） ==');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const wiringOk = analyzerSrc.includes(
    'skipAddressValidation: isProjectCoinContentVerified || !!issuerCaTimeline');
  check('skipAddressValidation 行引用 isProjectCoinContentVerified（强证据源）',
    wiringOk, true);
  check('skipAddressValidation 行不得引用 isProjectCoinResult（伪造链复活防线）',
    analyzerSrc.includes('skipAddressValidation: isProjectCoinResult'), false);
  const contentVarOk = analyzerSrc.includes(
    "isProjectCoin(normalizedAddress, { twitterInfo, websiteInfo, classifiedUrls }, { includeUrlArm: false })");
  check('isProjectCoinContentVerified 由 includeUrlArm:false 构造',
    contentVarOk, true);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
