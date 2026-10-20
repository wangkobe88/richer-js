#!/usr/bin/env node
/**
 * J1.68（彪弟 0x3b5c3271…7777 案，用户裁定）——有内容的推文语料不被发行方检出
 * 劫进账号/社区路径；抖音账号页仅为推文引用时不抓取
 * ——本地零 DB 零网络单测
 *
 * 事故形状：@jiaodudashi232 发推「彪哥的主人有了新的宠物 取名为彪弟…」+ 抖音账号页
 * 引用；作者时间线另有一条含 CA 的推文 → detectIssuerByCaTimeline 命中 →
 * 旧路由 `|| !!issuerDetected` 把票劫进 account/community prestage →
 * 标成 account_based_meme（web3ip 被 C101 拒后回落 abm）→ 账号 129 粉无 Web3
 * 流量 → low。实际叙事主体是推文内容（新宠物狗），不是账号。
 *
 * 用户裁定：「这个不是 account_based_meme，account_based_meme 是指有推特账号的」；
 * 「抖音账号页，只是一个信息引用，而且推文本身的信息够了，无需获取其信息」。
 *
 * 覆盖：
 *   A. shouldRouteToAccountCommunity 真值表（tweet 语料 + issuer → 标准路径；
 *      项目币臂保留；account/community 语料照走；空推文 + issuer 照走）
 *   B. 源码口径：analyzer 用纯函数路由；data-fetch 跳过 tweet 引用的抖音账号页
 *
 * 用法：node scripts/_test_account_route_tweet_corpus.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const { shouldRouteToAccountCommunity } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const fs = require('fs');

  console.log('\n── A. 路由真值表（J1.68）──');
  const tweet = { type: 'tweet', text: '彪哥的主人有了新的宠物 取名为彪弟…' };
  check('A1 有内容的推文 + issuerDetected → 标准路径（false）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: tweet }, isProjectCoinResult: false, issuerDetected: true }) === false);
  check('A2 有内容的推文 + 无任何信号 → 标准路径（false）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: tweet }, isProjectCoinResult: false, issuerDetected: false }) === false);
  check('A3 项目币臂保留：isProjectCoin + relatedAccounts → 账号路径（true）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: tweet, relatedAccounts: [{}] }, isProjectCoinResult: true, issuerDetected: false }) === true);
  const account = { type: 'account', text: '' };
  check('A4 账号型语料 → 账号路径（true）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: account }, isProjectCoinResult: false, issuerDetected: false }) === true);
  const emptyTweet = { type: 'tweet', text: '   ' };
  check('A5 空推文 + issuerDetected → 账号路径（true，无内容可走标准路径）',
    shouldRouteToAccountCommunity({ fetchResults: { twitterInfo: emptyTweet }, isProjectCoinResult: false, issuerDetected: true }) === true);
  check('A6 无 twitterInfo + issuerDetected → 账号路径（true）',
    shouldRouteToAccountCommunity({ fetchResults: {}, isProjectCoinResult: false, issuerDetected: true }) === true);

  console.log('\n── B. 源码口径 ──');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const fetchSrc = fs.readFileSync('src/narrative/analyzer/services/data-fetch-service.mjs', 'utf8');
  const utilsSrc = fs.readFileSync('src/narrative/analyzer/utils/narrative-utils.mjs', 'utf8');
  check('B1 analyzer 改用纯函数路由（不再 || !!issuerDetected 裸臂）',
    analyzerSrc.includes('shouldRouteToAccountCommunity({')
    && !analyzerSrc.includes('|| !!issuerDetected'));
  check('B2 utils 导出 shouldRouteToAccountCommunity + 推文语料门',
    utilsSrc.includes('export function shouldRouteToAccountCommunity')
    && utilsSrc.includes("twitterInfo?.type === 'tweet' && !!twitterInfo?.text?.trim()"));
  check('B3 data-fetch 跳过「推文引用的抖音账号页」抓取',
    fetchSrc.includes('tweet_corpus_reference')
    && fetchSrc.includes("douyinUrlInfo.type === 'user_profile'")
    && fetchSrc.includes('results.twitterInfo?.text?.trim()'));

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
