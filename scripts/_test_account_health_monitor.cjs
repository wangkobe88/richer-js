#!/usr/bin/env node
/**
 * C166 账号信息复检服务单测（2026-10-22 一次性专号 rug 家族案）——本地零 DB 零网络。
 *
 * AccountHealthMonitor：持仓期裸调 apidance 检测宣告账号四态
 * active/deleted/tweets_gone/unknown → 引擎回填 FA issuerAccountState → 卖臂。
 *
 * 覆盖：
 *   A. 四态判定（删号空骨架形状/推文清零/宣告推 ID 严格比对兜底坑/故障 fail-open）
 *   B. 机制（per-handle 缓存/inflight join/连续失败退避/退避计数复位/大小写归一）
 *   C. 超时竞速（timeoutMs 归 unknown）
 *   D. 源码口径锁（裸调红线不走缓存层/删号 message 正则与 new-apis C53 分支对拍）
 *
 * 零 DB 零网络：new-apis require.cache 打桩（Monitor 惰性 require，调用前污染即可）。
 * 用法：node scripts/_test_account_health_monitor.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ══ new-apis 打桩（Monitor 惰性 require 于 checkAccount 内，先污染 require.cache）══
const NEW_APIS_PATH = require.resolve(path.join(ROOT, 'src/utils/twitter-validation/new-apis'));
const savedEntry = require.cache[NEW_APIS_PATH];
let userImpl = null;   // async (handle) => userInfo | throw
let tweetImpl = null;  // async (id) => tweet | throw
const calls = { user: [], tweet: [] };
require.cache[NEW_APIS_PATH] = {
  id: NEW_APIS_PATH, filename: NEW_APIS_PATH, loaded: true,
  exports: {
    getUserByScreenName: async (h) => { calls.user.push(h); return userImpl(h); },
    getTweetDetail: async (id) => { calls.tweet.push(id); return tweetImpl(id); },
  },
};

const { AccountHealthMonitor, ACCOUNT_GONE_MESSAGE } =
  require(path.join(ROOT, 'src/trading-engine/core/AccountHealthMonitor'));

let passed = 0, failed = 0;
function check(name, fn) { /* 同步断言 */
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function freshCalls() { calls.user.length = 0; calls.tweet.length = 0; }

const USER_OK = { screen_name: 'fourge', statuses_count: 2, followers_count: 73 };
const TWEET_OK = (id) => ({ tweet_id: id, text: 'launch $FOURGE' });

(async () => {
  console.log('A. 四态判定');
  await checkAsync('A1 账号在+宣告推 ID 匹配 → active', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    tweetImpl = async (id) => TWEET_OK(id);
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.deepStrictEqual([r.state, r.detail], ['active', 'ok']);
  });
  await checkAsync('A2 删号（空骨架 message）→ deleted 且不查推文（判序早退）', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => { throw new Error('用户不存在（apidance 空响应骨架，@fourge 可能已停封/不存在）'); };
    tweetImpl = async () => { throw new Error('不应触达推文查询'); };
    freshCalls();
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.strictEqual(r.state, 'deleted');
    assert.strictEqual(r.detail, 'account_gone');
    assert.strictEqual(calls.tweet.length, 0);
  });
  await checkAsync('A3 账号在但 statuses_count===0 → tweets_gone（statuses_zero，不查推）', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ screen_name: 'fourge', statuses_count: 0, followers_count: 73 });
    freshCalls();
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.deepStrictEqual([r.state, r.detail], ['tweets_gone', 'statuses_zero']);
    assert.strictEqual(calls.tweet.length, 0);
  });
  await checkAsync('A4 宣告推不存在（tweets 空 throw）→ tweets_gone', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    tweetImpl = async () => { throw new Error('推文详情获取失败'); };
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.deepStrictEqual([r.state, r.detail], ['tweets_gone', 'announce_tweet_not_found']);
  });
  await checkAsync('A5 宣告推 ID 不匹配（tweets[0] 宽松兜底坑）→ tweets_gone', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    tweetImpl = async () => TWEET_OK('999别的推文'); // 兜底返回第一条但 ID 不同
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.deepStrictEqual([r.state, r.detail], ['tweets_gone', 'announce_tweet_id_mismatch']);
  });
  await checkAsync('A6 无宣告推（账号型票）→ active（不查推）', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    freshCalls();
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: null });
    assert.strictEqual(r.state, 'active');
    assert.strictEqual(calls.tweet.length, 0);
  });
  await checkAsync('A7 账号 API HTTP 错误 → unknown（fail-open 不置信号）', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => { throw new Error('HTTP错误: 500 Internal Server Error'); };
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.strictEqual(r.state, 'unknown');
    assert.ok(r.detail.startsWith('user_info_error'));
  });
  await checkAsync('A8 账号 result 缺失分支（≠删号形状）→ unknown', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => { throw new Error('用户信息获取失败'); };
    const r = await m.checkAccount({ handle: 'fourge' });
    assert.strictEqual(r.state, 'unknown');
  });
  await checkAsync('A9 推文 API 故障（HTTP 错误非「获取失败」）→ unknown', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    tweetImpl = async () => { throw new Error('HTTP错误: 404 Not Found'); };
    const r = await m.checkAccount({ handle: 'fourge', announceTweetId: '111' });
    assert.strictEqual(r.state, 'unknown');
    assert.ok(r.detail.startsWith('tweet_detail_error'));
  });

  console.log('B. 机制（缓存/inflight/退避）');
  await checkAsync('B1 per-handle 缓存：TTL 内二次调用 fromCache 且不重打', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    freshCalls();
    await m.checkAccount({ handle: 'fourge' });
    const r2 = await m.checkAccount({ handle: 'fourge' });
    assert.strictEqual(r2.fromCache, true);
    assert.strictEqual(calls.user.length, 1);
  });
  await checkAsync('B2 inflight join：并发同 handle 合一次请求', async () => {
    const m = new AccountHealthMonitor({}, null);
    let gate; userImpl = () => new Promise(res => { gate = res; });
    freshCalls();
    const p1 = m.checkAccount({ handle: 'fourge' });
    const p2 = m.checkAccount({ handle: 'fourge' });
    gate({ ...USER_OK });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(calls.user.length, 1);
    assert.strictEqual(r1.state, 'active');
    assert.strictEqual(r2.state, 'active');
  });
  await checkAsync('B3 连续失败退避：≥maxFails 次后冷却期内 fail_backoff 不打网', async () => {
    const m = new AccountHealthMonitor({ cacheTtlSec: 0.01, maxConsecutiveFails: 2 }, null); // 10ms 缓存让失败行过期
    userImpl = async () => { throw new Error('HTTP错误: 500'); };
    await m.checkAccount({ handle: 'fourge' });
    await sleep(15); await m.checkAccount({ handle: 'fourge' }); // 第 2 次失败 → 计数=2
    await sleep(15); // 缓存过期但 60s 失败冷却仍在
    freshCalls();
    const r3 = await m.checkAccount({ handle: 'fourge' });
    assert.deepStrictEqual([r3.state, r3.detail], ['unknown', 'fail_backoff']);
    assert.strictEqual(calls.user.length, 0);
  });
  await checkAsync('B4 确定形状复位退避计数：冷却到期后 active 成功 → 计数清零', async () => {
    const m = new AccountHealthMonitor({ cacheTtlSec: 0.01, maxConsecutiveFails: 2 }, null);
    userImpl = async () => { throw new Error('HTTP错误: 500'); };
    await m.checkAccount({ handle: 'fourge' });
    await sleep(15); await m.checkAccount({ handle: 'fourge' }); // fails=2
    await sleep(15);
    userImpl = async () => ({ ...USER_OK });
    const r = await m.checkAccount({ handle: 'fourge' }); // 冷却期内 → 仍 backoff 不打网
    assert.strictEqual(r.detail, 'fail_backoff');
    m._cache.clear(); // 模拟冷却到期（清掉退避时间锚）
    const r2 = await m.checkAccount({ handle: 'fourge' });
    assert.strictEqual(r2.state, 'active');
    assert.strictEqual(m._fails.get('fourge') || 0, 0);
  });
  await checkAsync('B5 handle 大小写归一（同缓存键）', async () => {
    const m = new AccountHealthMonitor({}, null);
    userImpl = async () => ({ ...USER_OK });
    freshCalls();
    await m.checkAccount({ handle: 'Fourge' });
    await m.checkAccount({ handle: 'FOURGE' });
    assert.strictEqual(calls.user.length, 1);
  });

  console.log('C. 超时竞速');
  await checkAsync('C1 竞速超时归 unknown（底层慢不阻塞卖臂判定）', async () => {
    const m = new AccountHealthMonitor({ timeoutMs: 5 }, null);
    userImpl = () => sleep(80).then(() => ({ ...USER_OK }));
    const r = await m.checkAccount({ handle: 'fourge' });
    assert.strictEqual(r.state, 'unknown');
    assert.strictEqual(r.detail, 'user_info_timeout');
  });

  console.log('D. 源码口径锁');
  check('D1 裸调红线：无缓存层 require（缓存层 1h 失败冷却会吞删号信号；头注释说明文字不算）',
    () => {
      const src = read('src/trading-engine/core/AccountHealthMonitor.js')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // 剥注释只看代码
      assert.ok(!/require\([^)]*(TwitterFetcher|[Cc]ached)/.test(src));
      assert.ok(!/fetchWithCache\(/.test(src));
      assert.ok(src.includes("require('../../utils/twitter-validation/new-apis')"));
    });
  check('D2 删号 message 正则与 new-apis C53 分支对拍（源码口径）', () => {
    const src = read('src/utils/twitter-validation/new-apis.js');
    const m = src.match(/用户不存在（apidance 空响应骨架[^）]*）/);
    assert.ok(m, 'new-apis C53 分支 message 在源');
    assert.ok(ACCOUNT_GONE_MESSAGE.test('用户不存在（apidance 空响应骨架，@x 可能已停封/不存在）'));
    assert.ok(!ACCOUNT_GONE_MESSAGE.test('HTTP错误: 500'));
    assert.ok(!ACCOUNT_GONE_MESSAGE.test('用户信息获取失败'));
  });

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (savedEntry) require.cache[NEW_APIS_PATH] = savedEntry; else delete require.cache[NEW_APIS_PATH];
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
