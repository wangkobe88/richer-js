#!/usr/bin/env node
/**
 * GMGN 超级IP推文补源单测（C51 龙虾案，2026-10-01 用户裁定
 * 「GMGN 补源返回的 twitterUrl 是推文 URL——如果是超级IP再并入」）
 * ——本地零 DB 零网络（registry 纯数据模块直测矩阵 + 源码口径断言）
 *
 * 背景：GMGN link.twitter_username 可能带完整推文路径（龙虾案实测
 * "binancezh/status/2027304629890072818"——币安中文 Day 559 梗帖
 * 2m57s 抢发票 0xeccbb861c0dda7efd964010085488b69317e4444，token 自挂
 * x.com/lobstercoinbnb 是 222 粉 3 推马甲号）；data-fetch 补源条件
 * 「已有 twitter 链接就不并入」（C10）使 superIP 真语料被马甲号挡住。
 *
 * 例外口径：仅「推文级 URL（含 /status/）× 作者在超级IP注册表」突破并入；
 * 普通推文/账号 URL 守 C10 原语义。并入后 selectTwitterUrl 的
 * tweet 类型优先保证 superIP 推文被选中（自挂账号链接保留但靠后）。
 *
 * 覆盖：
 *   A. isSuperIpTweetUrl 判定矩阵（龙虾案数值锚定 / 普通账号推文不并入 /
 *      superIP 账号 URL（非推文）不触发例外 / 垃圾 username 形状 / 大小写）
 *   B. data-fetch-service 源码口径（例外分支接线 / website 不随例外并入 /
 *      selectTwitterUrl tweet 优先 / C10 原路径零回归）
 *   C. gmgn-social-fetcher 源码口径（twitter_username 拼 URL 对推文路径天然工作）
 *
 * 用法：node scripts/_test_gmgn_superip_tweet_enrich.cjs
 */

'use strict';

const { readFileSync } = require('fs');
const { resolve } = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const ROOT = resolve(__dirname, '..');

const run = async () => {
  const { isSuperIpTweetUrl, detectSuperIP, SUPER_IP_REGISTRY } = await import(
    '../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs'
  );

  // ═══ A. isSuperIpTweetUrl 判定矩阵 ═══
  console.log('\n── A. isSuperIpTweetUrl 判定矩阵 ──');

  // 龙虾案真实形状：GMGN twitter_username = "binancezh/status/2027304629890072818"
  // → fetchGmgnSocialLinks 拼成完整推文 URL
  const LOBSTER_GMGN_URL = 'https://x.com/binancezh/status/2027304629890072818';
  const a1 = isSuperIpTweetUrl(LOBSTER_GMGN_URL);
  check('A1 龙虾案 binancezh 推文 URL 命中（币安中文，tier S）',
    a1?.tier === 'S' && a1?.type === 'institution', a1);
  check('A2 命中返回注册表完整形状（name/tier/desc）',
    a1?.name === SUPER_IP_REGISTRY['binancezh'].name);

  // 普通账号的推文 URL：registry 外作者 → 不触发例外（守 C10）
  const a3 = isSuperIpTweetUrl('https://x.com/lobstercoinbnb/status/2100000000000000000');
  check('A3 普通账号（马甲号）推文 URL → null（守 C10 不并入）', a3 === null, a3);

  // superIP 账号 URL（非推文级）：不触发例外——C10「有链接不补」对账号 URL 不变
  const a4 = isSuperIpTweetUrl('https://x.com/binancezh');
  check('A4 superIP 账号 URL（无 /status/）→ null（账号级不触发例外）', a4 === null, a4);

  // twitter_username 垃圾 search query 形状（C37 已知）拼出的 URL：非注册表作者
  const a5 = isSuperIpTweetUrl('https://x.com/search?q=lobster%20coin');
  check('A5 search query 垃圾形状 URL → null', a5 === null, a5);

  // 大小写容错：URL path 提取已 lower
  const a6 = isSuperIpTweetUrl('https://x.com/BinanceZH/status/2027304629890072818');
  check('A6 大小写 URL 同样命中（extractScreenNameFromUrl lower）',
    a6?.tier === 'S', a6);

  // 边界：null / 空串 / 非推文数字
  check('A7 null/空串 → null',
    isSuperIpTweetUrl(null) === null && isSuperIpTweetUrl('') === null);

  // 对照：detectSuperIP 对推文 URL 的 screen_name 提取（推文第一段 path = 作者）
  check('A8 detectSuperIP 推文 URL 提取作者（binancezh 在册 S 级）',
    detectSuperIP(LOBSTER_GMGN_URL)?.tier === 'S');

  // ═══ B. data-fetch-service 源码口径 ═══
  console.log('\n── B. data-fetch-service 源码口径 ──');
  const dfs = readFileSync(resolve(ROOT,
    'src/narrative/analyzer/services/data-fetch-service.mjs'), 'utf8');

  check('B1 isSuperIpTweetUrl 已 import 并在补源段消费',
    /import \{ isSuperIpTweetUrl \}/.test(dfs) && /isSuperIpTweetUrl\(socials\?\.twitterUrl \|\| null\)/.test(dfs));

  check('B2 例外分支：已有 twitter 链接时 superIP 推文仍并入（else if superIpTweet）',
    /else if \(superIpTweet && !allUrls\.includes\(socials\.twitterUrl\)\)/.test(dfs));

  check('B3 例外路径只并入推文 URL（websiteUrl 不随例外并入——C10 对它不变）',
    (() => {
      // 例外分支体（else if superIpTweet {...}）：剥掉注释行后，代码层只 push twitterUrl
      // （分支注释本身写着「websiteUrl 不随例外并入」，字面匹配会被注释击中）
      const m = dfs.match(/else if \(superIpTweet && !allUrls\.includes\(socials\.twitterUrl\)\) \{([\s\S]*?)\n      \}/);
      if (!m) return false;
      const codeOnly = m[1].split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      return /allUrls\.push\(socials\.twitterUrl\)/.test(codeOnly) && !/websiteUrl/.test(codeOnly);
    })());

  check('B4 C10 原路径零回归（无 twitter 链接时 twitterUrl+websiteUrl 都补）',
    /if \(!hasTwitterUrl\) \{[\s\S]*?const addUrls = \[socials\?\.twitterUrl, socials\?\.websiteUrl\]/.test(dfs));

  check('B5 并入后选择层 tweet 优先（selectTwitterUrl find type===tweet 先于 account）',
    (() => {
      const m = dfs.match(/const selectTwitterUrl = \(\) => \{([\s\S]*?)\n  \};/);
      if (!m) return false;
      const body = m[1];
      const tweetIdx = body.indexOf("u.type === 'tweet'");
      const communityIdx = body.indexOf("u.type === 'community'");
      const fallbackIdx = body.indexOf('return classifiedUrls.twitter[0]');
      return tweetIdx !== -1 && communityIdx > tweetIdx && fallbackIdx > communityIdx;
    })());

  // ═══ C. gmgn-social-fetcher 源码口径 ═══
  console.log('\n── C. gmgn-social-fetcher 源码口径 ──');
  const gsf = readFileSync(resolve(ROOT,
    'src/narrative/utils/gmgn-social-fetcher.mjs'), 'utf8');

  check('C1 twitter_username 拼接逻辑对推文路径天然工作（x.com/${username} 直拼）',
    /`\$\{'https:\/\/x\.com\/'\}\$\{link\.twitter_username\}`/.test(gsf) ||
    /https:\/\/x\.com\/\$\{link\.twitter_username\}/.test(gsf));

  // 龙虾案数值锚定：拼接结果就是可被 isSuperIpTweetUrl 命中的完整推文 URL
  const joined = `https://x.com/${'binancezh/status/2027304629890072818'}`;
  check('C2 拼接产物数值锚定（GMGN twitter_username=推文路径 → 完整推文 URL 命中 S 级）',
    isSuperIpTweetUrl(joined)?.tier === 'S');

  console.log(`\n══════ _test_gmgn_superip_tweet_enrich: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(e => { console.error('单测执行失败:', e); process.exit(1); });
