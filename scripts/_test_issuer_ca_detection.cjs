#!/usr/bin/env node
/**
 * 发行方 CA 宣告检测——本地零网络零 DB 单测
 * （detectIssuerByCaTimeline 通过 options.fetchAccount 注入打桩，findCaTweetInAccount 纯函数直测）
 *
 * 覆盖：
 *   1. findCaTweetInAccount：命中（大小写不敏感）/ 未命中 / 空地址 / null 账号 /
 *      无 tweets 数组 / 空文本推文
 *   2. detectIssuerByCaTimeline 前置门：type!=='tweet' / 无 author_screen_name → null（不拉取）
 *   3. fail-open：fetchAccount 抛异常 / 返回 null → null
 *   4. 命中：返回 { screenName, method:'ca_timeline', tweetId, account }
 *   5. untilSec 透传给 fetchAccount（时间窗口径随调用方）
 *
 * 用法：node scripts/_test_issuer_ca_detection.cjs
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
  const { findCaTweetInAccount } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { detectIssuerByCaTimeline } = await import('../src/narrative/analyzer/services/account-analysis-service.mjs');

  console.log('== 1. findCaTweetInAccount 纯函数 ==');
  const ADDR = '0x125aebe35439c8547c5f9485eb9893f66db17777';
  const acct = (tweets) => ({ screen_name: 'testuser', tweets });

  check('命中（推文含小写地址）',
    findCaTweetInAccount(ADDR, acct([{ tweet_id: '1', text: `来吧 ${ADDR} 开盘` }])),
    { tweetId: '1', text: `来吧 ${ADDR} 开盘` });
  check('命中（推文含混合大小写地址，查询地址小写）',
    findCaTweetInAccount(ADDR, acct([{ tweet_id: '2', text: 'CA: 0x125AEBE35439C8547C5F9485EB9893F66DB17777' }])),
    { tweetId: '2', text: 'CA: 0x125AEBE35439C8547C5F9485EB9893F66DB17777' });
  check('命中（多条推文取首条含地址的）',
    findCaTweetInAccount(ADDR, acct([
      { tweet_id: 'a', text: '蝴蝶涅槃' },
      { tweet_id: 'b', text: `合约 ${ADDR}` },
      { tweet_id: 'c', text: `again ${ADDR}` },
    ])).tweetId, 'b');
  check('未命中（时间线无地址）',
    findCaTweetInAccount(ADDR, acct([{ tweet_id: '1', text: '无关推文' }])),
    null);
  check('空地址 → null', findCaTweetInAccount('', acct([{ text: ADDR }])), null);
  check('null 账号 → null', findCaTweetInAccount(ADDR, null), null);
  check('无 tweets 数组 → null', findCaTweetInAccount(ADDR, { screen_name: 'x' }), null);
  check('空文本推文跳过不炸', findCaTweetInAccount(ADDR, acct([{ tweet_id: '1', text: null }])), null);

  console.log('== 2. detectIssuerByCaTimeline（fetchAccount 打桩）==');
  const twInfo = (over = {}) => ({ type: 'tweet', author_screen_name: 'rongluBSC', ...over });
  const stub = (accountImpl) => async () => accountImpl;
  const seen = [];

  check('type 非 tweet → null 且不拉取',
    await detectIssuerByCaTimeline(ADDR, twInfo({ type: 'account', screen_name: 'rongluBSC' }),
      { fetchAccount: stub(acct([{ text: ADDR }])) }),
    null);
  check('无 author_screen_name → null',
    await detectIssuerByCaTimeline(ADDR, twInfo({ author_screen_name: null }),
      { fetchAccount: stub(acct([{ text: ADDR }])) }),
    null);
  check('fetchAccount 抛异常 → fail-open null',
    await detectIssuerByCaTimeline(ADDR, twInfo(), {
      fetchAccount: async () => { throw new Error('api down'); },
    }),
    null);
  check('fetchAccount 返回 null → null',
    await detectIssuerByCaTimeline(ADDR, twInfo(), { fetchAccount: stub(null) }),
    null);
  check('时间线不含 CA → null',
    await detectIssuerByCaTimeline(ADDR, twInfo(), { fetchAccount: stub(acct([{ text: '别的' }])) }),
    null);

  const hit = await detectIssuerByCaTimeline(ADDR, twInfo(), {
    fetchAccount: async (screenName, opts) => {
      seen.push({ screenName, opts });
      return { ...acct([{ tweet_id: '42', text: `正式宣告 ${ADDR}` }]), screen_name: screenName };
    },
    untilSec: 1790498441 - 24 * 3600,
  });
  check('命中 → { screenName, method, tweetId, account }',
    { screenName: hit.screenName, method: hit.method, tweetId: hit.tweetId, hasAccount: !!hit.account },
    { screenName: 'rongluBSC', method: 'ca_timeline', tweetId: '42', hasAccount: true });
  check('screenName + untilSec 透传给 fetchAccount', seen, [
    { screenName: 'rongluBSC', opts: { untilSec: 1790498441 - 24 * 3600 } },
  ]);

  console.log(`\n${passed + failed}/${passed + failed}${failed ? `（✗ ${failed}）` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
