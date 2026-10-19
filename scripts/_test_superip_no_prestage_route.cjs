#!/usr/bin/env node
/**
 * C117 f8ab/Burn N Burn 案——超大账号不走 prestage 账号判定路径（零 DB 零网络单测）
 *
 * 用户裁定（2026-10-19）：「首先超大账号肯定不适合走账号判断这条路」。
 * 案发现场：0xf8abd6a6bdc0d87291b4f79abc6188c48a807777（Burn N Burn / BNB͏，
 * flap 税币，34 分钟毕业 16 BNB）。语料=BNB Chain 官推（@BNBCHAIN 389 万粉）
 * 回复 CZ（@cz_binance，父推「哪条链每季度烧 11 亿美元的代币？」BNB 季度销毁
 * 话题）的「Burn N Burn 🔥」。detectIssuerSelfLaunch 双机械条件命中：
 * ①品牌同一性 norm(bnb)⊂norm(bnbchain) ②宣告指纹=币名 Burn N Burn 全串出现
 * （官推谈 BNB 销毁，非宣告发币）→ 劫进 prestage abm → 用 original_author
 * cz_binance 判 30 天 web3 流量 no_traffic(0.75) → rating=1(low) 拦截。
 *
 * 修复双门：
 * - A 门（analyzer 级）：superIP registry 命中（本案 BNB Chain tier S）→
 *   shouldUseAccountCommunity 三臂全短路，强制标准路径（C83 既定语义）。
 * - C 门（函数级）：detectIssuerSelfLaunch 粉丝量级门 ≥100 万不判自发宣告
 * （兜 registry 漏网超大号；粉丝缺失 fail-open）。
 *
 * 用法：node scripts/_test_superip_no_prestage_route.cjs
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
  const { detectIssuerSelfLaunch } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { detectSuperIP, SUPER_IP_REGISTRY } = await import('../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');

  // f8ab 案现场形状（token_narrative 落库值逐字复刻）
  const f8abToken = {
    symbol: 'BNB͏',
    name: 'Burn N Burn',
    raw_api_data: { name: 'Burn N Burn' },
  };
  const bnbChainTweet = (over = {}) => ({
    type: 'tweet',
    text: '@cz_binance Burn N Burn 🔥',
    author_screen_name: 'BNBCHAIN',
    author_name: 'BNB Chain',
    author_followers_count: 3894479,
    ...over,
  });

  console.log('== 1. C 门：detectIssuerSelfLaunch 粉丝量级门 ==');

  console.log('== 1a. f8ab 事故现场反证（389 万粉官推不再判自发宣告） ==');
  check('BNB Chain 389 万粉 → null（C 门拦截）',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: bnbChainTweet() }), null);

  check('粉丝 999,999（门内）→ 照常命中（门不误伤中小账号）',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: bnbChainTweet({ author_followers_count: 999999 }) }),
    { screenName: 'BNBCHAIN', symbol: 'BNB͏' });

  check('恰好 100 万（边界含）→ null',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: bnbChainTweet({ author_followers_count: 1000000 }) }), null);

  console.log('== 1b. 粉丝缺失 fail-open（保守=不改既有行为） ==');
  const noFollowers = bnbChainTweet();
  delete noFollowers.author_followers_count;
  check('author_followers_count 缺失 → 照常命中（C 门不拦无证据形状）',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: noFollowers }),
    { screenName: 'BNBCHAIN', symbol: 'BNB͏' });
  check('author_followers_count=null → 照常命中',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: bnbChainTweet({ author_followers_count: null }) }),
    { screenName: 'BNBCHAIN', symbol: 'BNB͏' });

  console.log('== 1c. options.maxFollowers 可覆盖 ==');
  check('maxFollowers=5000000 显式放宽 → 389 万粉照判（恢复旧行为的逃生口）',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: bnbChainTweet() }, { maxFollowers: 5000000 }),
    { screenName: 'BNBCHAIN', symbol: 'BNB͏' });

  console.log('== 1d. 既有形状回归（非 tweet 型/无品牌同一性 不受门影响） ==');
  check('account 型语料 → null（原语义）',
    detectIssuerSelfLaunch(f8abToken, { twitterInfo: { type: 'account', text: 'x', author_followers_count: 100 } }), null);
  check('tweet 型但无品牌同一性（截词借势盘反例保护）→ null',
    detectIssuerSelfLaunch({ symbol: 'CONV', name: 'CONVICTION' },
      { twitterInfo: { type: 'tweet', text: 'conviction plays', author_screen_name: 'tradermax', author_followers_count: 50 } }), null);

  console.log('== 2. A 门前置：detectSuperIP 对案发语料命中（短路判据来源） ==');
  check('BNBCHAIN 作者备选臂命中 registry（tier S institution）',
    detectSuperIP('https://x.com/i/status/2112164393655882063', bnbChainTweet()),
    SUPER_IP_REGISTRY['bnbchain']);
  check('cz_binance 在 registry（original_author 同为超大 IP）',
    SUPER_IP_REGISTRY['cz_binance']?.tier, 'S');

  console.log('== 3. A 门：analyzer 短路源码口径断言（事故现场反证锁定） ==');
  // NarrativeAnalyzer 是重 io 大函数，路由短路为 inline 判定——按项目事故反证
  // 惯例（源码口径断言锁定防线）锁两件事：①短路存在且在 shouldUseAccountCommunity
  // 计算之后、prestage 分支之前 ②短路判据是 superIPInfo（registry 命中对象）
  const analyzerSrc = fs.readFileSync(
    path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  const shortCircuit = 'if (superIPInfo && shouldUseAccountCommunity) {';
  check('短路判定行存在（superIPInfo && shouldUseAccountCommunity）',
    analyzerSrc.includes(shortCircuit), true);
  const shortCircuitIdx = analyzerSrc.indexOf(shortCircuit);
  const prestageCallIdx = analyzerSrc.indexOf('analyzeAccountCommunityToken(tokenData');
  check('短路位于 prestage 调用之前（顺序防线）',
    shortCircuitIdx > 0 && prestageCallIdx > shortCircuitIdx, true);
  check('短路回写 shouldUseAccountCommunity = false',
    analyzerSrc.includes('shouldUseAccountCommunity = false;'), true);
  const cGateSrc = fs.readFileSync(
    path.join(__dirname, '../src/narrative/analyzer/utils/narrative-utils.mjs'), 'utf8');
  check('C 门默认阈值 100 万（源码口径）',
    cGateSrc.includes('options.maxFollowers ?? 1000000'), true);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
