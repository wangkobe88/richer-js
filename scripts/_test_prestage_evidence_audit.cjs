#!/usr/bin/env node
/**
 * C257 prestage 证据审计落档单测（零 DB 零网络）
 *
 * 案由（0x517d7658e44f4be58c0f5abcd16138abc4d78888 Grid—ID，2026-10-29）：
 * @Grid_Agent 2 粉 0 落库推文，10:16:13 发含 CA 宣告推 → prestage 10:16:27 现拉
 * 时间线（CA 惰性早停）命中 → verifyTokenAddress 推文臂 found → addressVerified=true
 * → project mid → live 买入。事后 DB 全文零 CA 可回放（fetch 阶段 twitter_info 与
 * prestage 现拉不同源；官网核验内容不落库），唯一痕迹=external_resource_cache
 * CA 专属 key（90 天 TTL）。修复=parsed_output additive 三键：
 * addressLocations（mapper 曾丢弃）/caHitTweets（命中推文清单）/websiteCheckInfo。
 *
 * 锁定口径：
 * - containsTokenAddress：带 0x/不带 0x 两形状、大小写不敏感（verifyTokenAddress
 *   行为 bit 一致——同逻辑抽出的单一真相）
 * - findAddressHitTweets：只扫推文、无命中空数组、输入无效空数组
 * - appendEvidenceAudit：addressVerified=true 才落 caHitTweets（false=null 不冒充
 *   「扫过没有」）；findHits 缺失=null；websiteCheckInfo 不落正文只落 status/url
 * - parsed_output 既有键零改动（additive）
 *
 * 用法：node scripts/_test_prestage_evidence_audit.cjs
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
  const {
    containsTokenAddress, findAddressHitTweets, verifyTokenAddress,
  } = await import('../src/narrative/analyzer/prompts/account/account-community-rules.mjs');
  const { appendEvidenceAudit } = await import('../src/narrative/analyzer/services/account-analysis-service.mjs');

  const ADDR = '0x517d7658e44f4be58c0f5abcd16138abc4d78888';

  console.log('\n── A. containsTokenAddress 匹配口径 ──');
  check('A1 带 0x 全等命中', containsTokenAddress(`CA已上线：${ADDR}`, ADDR), true);
  check('A2 大小写不敏感（文本大写）', containsTokenAddress(ADDR.toUpperCase(), ADDR), true);
  check('A3 不带 0x 前缀命中', containsTokenAddress('合约 517d7658e44f4be58c0f5abcd16138abc4d78888 已锁', ADDR), true);
  check('A4 tokenAddress 不带 0x 入参、文本带 0x', containsTokenAddress(`addr=${ADDR}`, ADDR.replace(/^0x/, '')), true);
  check('A5 不同地址不命中', containsTokenAddress('CA已上线：0x517d7658e44f4be58c0f5abcd16138abc4d78889', ADDR), false);
  check('A6 空文本 false', containsTokenAddress('', ADDR), false);
  check('A7 null 文本 false', containsTokenAddress(null, ADDR), false);
  check('A8 空地址 false', containsTokenAddress('随便什么文本', ''), false);
  check('A9 尾 6 位不算命中（防短串误报）', containsTokenAddress('看看 c4d78888 这个尾号', ADDR), false);

  console.log('\n── B. findAddressHitTweets ──');
  const caTweet = {
    tweet_id: '2115749537512059282',
    text: `构建一个协议远不止发布功能。开始构建你的Grid ID。CA已上线：${ADDR}`,
    created_at: 'Thu Oct 29 10:16:13 +0000 2026',
  };
  const normalTweet = {
    tweet_id: '2115733524187869385',
    text: '代币未上线 ，外面的都是假的 认准X的公布',
    created_at: 'Thu Oct 29 09:12:35 +0000 2026',
  };
  const timeline = {
    type: 'account', screen_name: 'Grid_Agent', description: 'Agent全链启动平台',
    tweets: [normalTweet, caTweet],
  };
  check('B1 命中清单=恰一条且字段齐', findAddressHitTweets(ADDR, timeline),
    [{ tweet_id: '2115749537512059282', text: caTweet.text, created_at: 'Thu Oct 29 10:16:13 +0000 2026' }]);
  check('B2 无命中=空数组（非 null）', findAddressHitTweets(ADDR, { type: 'account', tweets: [normalTweet] }), []);
  check('B3 tweets 非数组=空数组', findAddressHitTweets(ADDR, { type: 'account' }), []);
  check('B4 accountData null=空数组', findAddressHitTweets(ADDR, null), []);
  check('B5 地址空=空数组', findAddressHitTweets('', timeline), []);
  check('B6 bio 命中不进清单（只扫推文，bio 由 addressLocations 留痕）',
    findAddressHitTweets(ADDR, { type: 'account', description: `bio 含 ${ADDR}`, tweets: [normalTweet] }), []);

  console.log('\n── C. verifyTokenAddress 抽函数后行为 bit 一致 ──');
  const r1 = verifyTokenAddress(ADDR, timeline);
  check('C1 推文命中 found=true + 位置「推文2」', [r1.found, r1.locations], [true, ['推文2']]);
  const r2 = verifyTokenAddress(ADDR, { type: 'account', description: `官网 ${ADDR}`, tweets: [] });
  check('C2 bio 命中=账号简介', [r2.found, r2.locations], [true, ['账号简介']]);
  const r3 = verifyTokenAddress(ADDR, { type: 'account', description: '无地址', tweets: [normalTweet] });
  check('C3 双不命中 found=false', [r3.found, r3.locations], [false, []]);
  check('C4 地址空=found false 带原因', verifyTokenAddress('', timeline).found, false);

  console.log('\n── D. appendEvidenceAudit（事故现场反证：0x517d…8888）──');
  const parsedOutput = {
    tokenType: 'project', rating: 'mid', reason: '项目币评级：粉丝2 → mid',
    details: { followers: 2, websiteCheck: 'website_substantiates' },
    rulesValidationPassed: true, addressVerified: true, nameMatch: true,
  };
  const rulesResultPassed = {
    passed: true, stage: 'passed', addressVerified: true, nameMatch: true,
    details: { addressLocations: ['推文2'], nameMatchType: 'exact' },
  };
  const websiteCheckReachable = { status: 'reachable', url: 'https://gridid.fun/', info: { content: 'x'.repeat(5000) } };
  const out = appendEvidenceAudit(parsedOutput, {
    rulesResult: rulesResultPassed,
    accountData: timeline,
    websiteCheck: websiteCheckReachable,
    tokenAddress: ADDR,
    findHits: findAddressHitTweets,
  });
  check('D1 返回同一引用（就地补键）', out === parsedOutput, true);
  check('D2 addressLocations 透传（mapper 曾丢弃）', out.addressLocations, ['推文2']);
  check('D3 caHitTweets=宣告推清单', out.caHitTweets,
    [{ tweet_id: '2115749537512059282', text: caTweet.text, created_at: 'Thu Oct 29 10:16:13 +0000 2026' }]);
  check('D4 websiteCheckInfo 只落 status/url（5000 字正文不落）', out.websiteCheckInfo,
    { status: 'reachable', url: 'https://gridid.fun/' });
  check('D5 既有键零改动（additive）', Object.keys(out).filter((k) => !['addressLocations', 'caHitTweets', 'websiteCheckInfo'].includes(k)),
    ['tokenType', 'rating', 'reason', 'details', 'rulesValidationPassed', 'addressVerified', 'nameMatch']);

  console.log('\n── E. 其余形状 ──');
  // skip 路径（project_coin_website_verified）：官网内容臂证据、时间线无 CA
  const outSkip = appendEvidenceAudit({ tokenType: 'project' }, {
    rulesResult: { passed: true, addressVerified: true, details: { addressLocations: ['website_content'] } },
    accountData: { type: 'account', tweets: [normalTweet] },
    websiteCheck: { status: 'unreachable', url: 'https://gridid.fun/' },
    tokenAddress: ADDR, findHits: findAddressHitTweets,
  });
  check('E1 skip 路径 addressLocations=website_content', outSkip.addressLocations, ['website_content']);
  check('E2 skip 路径时间线无 CA=空数组（扫过没有，非 null）', outSkip.caHitTweets, []);
  check('E3 unreachable 摘要照落', outSkip.websiteCheckInfo, { status: 'unreachable', url: 'https://gridid.fun/' });

  const outNoAddr = appendEvidenceAudit({ tokenType: 'account_based_meme' }, {
    rulesResult: { passed: true, addressVerified: false, details: { addressLocations: [] } },
    accountData: timeline, websiteCheck: null, tokenAddress: ADDR, findHits: findAddressHitTweets,
  });
  check('E4 addressVerified=false → caHitTweets=null（无验证语义，不冒充空证据）', outNoAddr.caHitTweets, null);
  check('E5 websiteCheck=null（功能关/abm 不抓）→ websiteCheckInfo=null', outNoAddr.websiteCheckInfo, null);
  check('E6 addressLocations 空数组如实透传', outNoAddr.addressLocations, []);

  const outNoRules = appendEvidenceAudit({}, { accountData: timeline, tokenAddress: ADDR, findHits: findAddressHitTweets });
  check('E7 rulesResult 缺失 → addressLocations/caHitTweets 均 null', [outNoRules.addressLocations, outNoRules.caHitTweets], [null, null]);
  const outNoHits = appendEvidenceAudit({}, {
    rulesResult: rulesResultPassed, accountData: timeline, tokenAddress: ADDR,
  });
  check('E8 findHits 注入缺失 → null 不冒充', outNoHits.caHitTweets, null);
  check('E9 parsedOutput null 防御=原样返回不炸', appendEvidenceAudit(null, {}), null);
  const outNone = appendEvidenceAudit({}, {
    rulesResult: rulesResultPassed, accountData: timeline,
    websiteCheck: { status: 'none' }, tokenAddress: ADDR, findHits: findAddressHitTweets,
  });
  check('E10 websiteCheck none 形状 url=null', outNone.websiteCheckInfo, { status: 'none', url: null });

  console.log(`\n合计: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
