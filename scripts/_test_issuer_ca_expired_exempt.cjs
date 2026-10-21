#!/usr/bin/env node
/**
 * C153（2026-10-21，REPEG 0x88900da3…7777 案用户裁定）——发行方 CA 证据豁免
 * expired_tweet 硬窗（零 DB 零网络单测）
 *
 * 事故形状：@thresiltech（894 粉/1 赞/0 转）发「重启一场关于稳定币的实验…
 * Re-pegging.」+ 作者时间线含 CA 宣告 → classifyTweetType 判 angle_seeking →
 * precheck 规则 2.1 的 300s 硬窗照拦（lag 4315s），LLM 未跑。用户裁定：小项目
 * 自己发推晒地址，不应卡 300 秒；时效交 Jev 软评。防线=频繁发币者名单仍优先
 * （C95 永生蝴蝶 @burnfloor_ 照拦）。
 *
 * 覆盖：
 *   A. shouldExemptIssuerCaExpired 真值表（issuerCA / 主推 CA / 名额号 / 非
 *      expired_tweet / 作者缺失 / issuer 作者不一致）
 *   B. 源码口径：analyzer 在 isPreCheckTriggered 之前调用豁免；helper 引入
 *      frequent-issuers 防线
 *
 * 用法：node scripts/_test_issuer_ca_expired_exempt.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

(async () => {
  const { shouldExemptIssuerCaExpired } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const fs = require('fs');
  const path = require('path');
  const ADDR = '0x88900da3c4b3418708d99d880129cacd9b037777';
  const expired = { rating: 'low', pass: false, reason: '时效已过', details: { ruleName: 'expired_tweet', tweetType: 'angle_seeking' } };

  console.log('── A. 真值表（C153）──');
  check('A1 expired_tweet + 作者时间线 CA 宣告 + 非名单号 → 豁免（true）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: { screenName: 'thresiltech', tweetId: '2112556059831480733' },
      authorScreenName: 'thresiltech',
      mainTweetText: '重启一场关于稳定币的实验\n\n重新锚定',
      tokenAddress: ADDR,
    }) === true);
  check('A2 expired_tweet + 主推文本逐字含 CA + 非名单号 → 豁免（true）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: null,
      authorScreenName: 'smallbuilder',
      mainTweetText: `我们的合约 ${ADDR} 已上线`,
      tokenAddress: ADDR,
    }) === true);
  check('A3 expired_tweet + issuerCA 但作者是频繁发币者（C95 @burnfloor_）→ 不豁免（false）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: { screenName: 'burnfloor_', tweetId: '1' },
      authorScreenName: 'burnfloor_',
      mainTweetText: '多重托底共识协议',
      tokenAddress: ADDR,
    }) === false);
  check('A4 expired_tweet + 无 issuerCA + 主推无 CA → 不豁免（false）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: null,
      authorScreenName: 'thresiltech',
      mainTweetText: '重启一场关于稳定币的实验',
      tokenAddress: ADDR,
    }) === false);
  check('A5 非 expired_tweet 规则 → 不豁免（false）',
    shouldExemptIssuerCaExpired({ details: { ruleName: 'public_info_fetch_failed' } }, {
      issuerCaTimeline: { screenName: 'thresiltech' },
      authorScreenName: 'thresiltech',
      tokenAddress: ADDR,
    }) === false);
  check('A6 issuerCa 作者与语料作者不一致 → 不豁免（false）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: { screenName: 'someone_else' },
      authorScreenName: 'thresiltech',
      mainTweetText: '稳定币实验',
      tokenAddress: ADDR,
    }) === false);
  check('A7 作者缺失 → 不豁免（false，fail-closed）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: { screenName: 'thresiltech' },
      authorScreenName: null,
      tokenAddress: ADDR,
    }) === false);
  check('A8 作者大小写归一（IssuerCA/THRESILTECH 同名）→ 豁免（true）',
    shouldExemptIssuerCaExpired(expired, {
      issuerCaTimeline: { screenName: 'thresiltech' },
      authorScreenName: 'THRESILTECH',
      tokenAddress: ADDR,
    }) === true);

  console.log('\n── B. 源码口径 ──');
  const utilsSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/utils/narrative-utils.mjs'), 'utf8');
  const anaSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
  check('B1 helper 引入 frequent-issuers 防线',
    utilsSrc.includes("import { isFrequentIssuer } from '../services/frequent-issuers.mjs';")
    && utilsSrc.includes('isFrequentIssuer(authorScreenName)'), null);
  check('B2 analyzer 在 isPreCheckTriggered 之前调用豁免（先清 preCheckResult 再判触发）',
    anaSrc.indexOf('shouldExemptIssuerCaExpired(preCheckResult,') > 0
    && anaSrc.indexOf('shouldExemptIssuerCaExpired(preCheckResult,') < anaSrc.indexOf('let isPreCheckTriggered = preCheckResult !== null;'), null);
  check('B3 豁免后显式 preCheckResult = null（不落 expired_tweet 行）',
    /if \(shouldExemptIssuerCaExpired\([\s\S]{0,500}?preCheckResult = null;/.test(anaSrc), null);

  console.log(`\n══════ _test_issuer_ca_expired_exempt: ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
