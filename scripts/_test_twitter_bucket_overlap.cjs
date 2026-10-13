#!/usr/bin/env node
/**
 * 第二推文并发 + collect 双账号并发单测（2026-10-13 叙事提速第二批 2d/2e）
 * ——零 DB 零网络
 *
 *   2d 第二推文并发：secondTweetUrl 只读 classifiedUrls（同步可判）→ 与主推
 *      fetchFromUrls 并发发起，挂载保持在 enrich 后（原顺序语义）——双推文票
 *      省主推链 0.5-5.5s（原串行等主推+enrich 完才发第二推）
 *   2e collect 双账号并发：primary 与 original_author（in_reply_to）Promise.all；
 *      去重判定静态化（同名 → 只拉主账号，等价原「拉完 primary 再查 Set 跳过」）
 *
 * 节：
 *   A. 第二推文时序（真 fetchDataSequentially + fetchFromUrls 桩）：第二推文
 *      与主推同拍发起、短链先完成、website_tweet 挂载
 *   B. 单推文票零额外调用；C. 第二推文失败隔离（warn + 主推不受影响）
 *   D. collect 双账号并发（真 collectAllAccountsWithFullInfo + tv 桩）：两 sn
 *      同拍、墙钟单拉级、role 顺序；同名去重单拉
 *   E. 源码口径：secondTweetPromise 声明位置（community 分支前）/ 消费 await /
 *      Promise.all 形状 / pullOriginal 静态判定
 *
 * 用法：node scripts/_test_twitter_bucket_overlap.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// global fetch 桩（断言零真网络）
const fetchCalls = [];
global.fetch = async (url) => {
  fetchCalls.push(String(url));
  return { ok: true, status: 200, headers: new Map(), text: async () => '' };
};

// ═══ 加载前覆写：twitter-validation CJS（account-community-rules 底层）═══
process.env.SILICONFLOW_FALLBACK_KEY = process.env.SILICONFLOW_FALLBACK_KEY || 'unit-test-key';
const tv = require('../src/utils/twitter-validation/index.js');
let tvLog = []; // {fn, arg, t}
tv.getUserByScreenName = async (sn) => {
  tvLog.push({ fn: 'sn', arg: sn, t: Date.now() });
  await sleep(50); // 制造并发可区分窗口
  return { screen_name: sn, id: `uid-${sn}`, name: `Name ${sn}`, description: 'd', followers_count: 900 };
};
tv.getUserTweets = async (userId) => {
  tvLog.push({ fn: 'tweets', arg: userId, t: Date.now() });
  // 100 条：getAccountWithFullTweets 全量 key 复用判据（length >= max(20,100)）
  return Array.from({ length: 100 }, (_, i) => ({
    id_str: String(i + 1), full_text: `post ${i + 1}`, created_at_seconds: 1759000000 - i * 3600,
  }));
};

// dbManager 假 supabase（ExternalResourceCache 底层）
const chainable = (result) => new Proxy(function () {}, {
  get(_t, prop) {
    const p = Promise.resolve(result);
    if (prop === 'then') return p.then.bind(p);
    if (prop === 'catch') return p.catch.bind(p);
    return () => chainable(result);
  },
  apply() { return chainable(result); },
});
const { dbManager } = require('../src/services/dbManager.js');
dbManager.getSupabase = () => ({ from: () => chainable({ data: [], error: null }) });

const EMPTY_BUCKETS = { twitter: [], weibo: [], youtube: [], github: [], tiktok: [],
  douyin: [], bilibili: [], xiaohongshu: [], instagram: [], weixin: [], amazon: [],
  telegram: [], discord: [], binanceSquare: [], websites: [] };

async function main() {
  const dfs = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');

  // ═══ A. 第二推文时序 ═══
  console.log('══ A. 第二推文与主推并发（fetchFromUrls 桩）══');
  {
    const calls = [];
    TwitterFetcher.fetchFromUrls = async (url) => {
      const isMain = url.includes('111');
      const entry = { url, start: Date.now(), isMain };
      calls.push(entry);
      await sleep(isMain ? 60 : 20); // 主推慢、第二推文快
      entry.end = Date.now();
      return { type: 'tweet', id: isMain ? '111' : '222', text: isMain ? 'main tweet text' : 'second tweet text', author_screen_name: 'main_author' };
    };
    TwitterFetcher.enrichWithLinkContent = async (info) => info;

    const MAIN = 'https://x.com/main_author/status/111';
    const SECOND = 'https://x.com/other_author/status/222';
    const classifiedUrls = { ...EMPTY_BUCKETS, twitter: [
      { url: MAIN, type: 'tweet' }, { url: SECOND, type: 'tweet' },
    ] };
    const t0 = Date.now();
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    const wall = Date.now() - t0;

    const main = calls.find(c => c.isMain);
    const second = calls.find(c => !c.isMain);
    assert(calls.length === 2 && main && second, 'A1 主推+第二推文各恰 1 次调用');
    assert(second.start - main.start < 35,
      'A2 第二推文与主推同拍发起（<35ms；串行版第二推文要等主推 60ms+enrich 完才发）',
      `${second.start - main.start}ms`);
    assert(second.end < main.end, 'A3 短的第二推文先完成（并发等待语义）');
    assert(r.twitterInfo?.website_tweet?.text === 'second tweet text',
      'A4 website_tweet 挂载（原消费点形状不变）');
    assert(wall < 160, 'A5 总墙钟 ≈ 主推单链级（60ms 主导）而非两链相加', `${wall}ms`);
  }

  // ═══ B. 单推文票零额外调用 ═══
  console.log('══ B. 单推文票 ═══');
  {
    const calls = [];
    TwitterFetcher.fetchFromUrls = async (url) => {
      calls.push(url);
      return { type: 'tweet', id: '1', text: 'only one' };
    };
    const classifiedUrls = { ...EMPTY_BUCKETS, twitter: [{ url: 'https://x.com/a/status/333', type: 'tweet' }] };
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(calls.length === 1 && !r.twitterInfo?.website_tweet,
      'B1 单推文票：恰 1 次调用、无 website_tweet（secondTweetPromise=null 路径）');
  }

  // ═══ C. 第二推文失败隔离 ═══
  console.log('══ C. 第二推文失败隔离 ═══');
  {
    TwitterFetcher.fetchFromUrls = async (url) => {
      if (url.includes('444')) throw new Error('second fetch down');
      return { type: 'tweet', id: '555', text: 'main ok' };
    };
    const classifiedUrls = { ...EMPTY_BUCKETS, twitter: [
      { url: 'https://x.com/a/status/555', type: 'tweet' }, { url: 'https://x.com/b/status/444', type: 'tweet' },
    ] };
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(r.twitterInfo?.text === 'main ok' && !r.twitterInfo?.website_tweet,
      'C1 第二推文 throw → warn 吞掉、主推照常返回（失败语义与原 try/catch 一致）');
  }

  // ═══ D. collect 双账号并发（真 collectAllAccountsWithFullInfo + tv 桩）═══
  console.log('══ D. collect 双账号并发 ═══');
  {
    // ExternalResourceCache 内存桩（getAccountWithFullTweets 底层缓存）
    const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
    const mem = new Map();
    cacheMod.ExternalResourceCache.get = async (url, type) => {
      const hit = mem.get(`${type}::${url}`);
      return hit === undefined ? null : hit;
    };
    cacheMod.ExternalResourceCache.set = async (url, type, content) => {
      mem.set(`${type}::${url}`, content);
      return true;
    };
    // NarrativeRepository.getSupabase 打桩（同模块 precheck 防御性查询走空）
    const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
    repoMod.NarrativeRepository.getSupabase = () => ({ from: () => chainable({ data: [], error: null }) });

    const aas = await import('../src/narrative/analyzer/services/account-analysis-service.mjs');
    tvLog = [];
    const t0 = Date.now();
    const accounts = await aas.collectAllAccountsWithFullInfo({
      type: 'tweet', author_screen_name: 'p_author',
      in_reply_to: { author_screen_name: 'o_author' },
    });
    const wall = Date.now() - t0;

    const sns = tvLog.filter(e => e.fn === 'sn');
    assert(sns.length === 2, 'D1 双账号各拉一次（primary + original_author）', JSON.stringify(sns.map(s => s.arg)));
    assert(Math.abs(sns[0].t - sns[1].t) < 30,
      'D2 两账号同拍发起（<30ms；串行版第二个要等第一个 50ms 拉完）', `${Math.abs(sns[0].t - sns[1].t)}ms`);
    assert(wall < 130, 'D3 墙钟 ≈ 单拉级（50ms 主导）而非两拉相加（串行 ≥100ms）', `${wall}ms`);
    assert(accounts.length === 2 && accounts[0].role === 'primary' && accounts[1].role === 'original_author',
      'D4 role 顺序 primary → original_author（与原串行版 push 序一致）',
      JSON.stringify(accounts.map(a => a.role)));

    // 同名去重：author == in_reply_to.author → 只拉主账号（等价原 Set 跳过）
    tvLog = [];
    const accounts2 = await aas.collectAllAccountsWithFullInfo({
      type: 'tweet', author_screen_name: 'same_guy',
      in_reply_to: { author_screen_name: 'same_guy' },
    });
    const sns2 = tvLog.filter(e => e.fn === 'sn');
    assert(sns2.length === 1 && sns2[0].arg === 'same_guy' && accounts2.length === 1 && accounts2[0].role === 'primary',
      'D5 同名去重静态化：只拉主账号一次（原「拉完 primary 再查 Set」等价）',
      JSON.stringify({ sns: sns2.map(s => s.arg), roles: accounts2.map(a => a.role) }));
  }

  // ═══ E. 源码口径 ═══
  console.log('══ E. 源码口径 ═══');
  {
    const dfsSrc = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    const declIdx = dfsSrc.indexOf('const secondTweetPromise = secondTweetUrl');
    const communityIdx = dfsSrc.indexOf("// 特殊处理：Twitter Community 链接");
    assert(declIdx > -1 && communityIdx > -1 && declIdx < communityIdx,
      'E1 secondTweetPromise 声明先于 community/常规分支（与主推并发发起）');
    assert(dfsSrc.includes('if (secondTweetPromise) {\n          const websiteTweet = await secondTweetPromise;'),
      'E2 消费段 = await secondTweetPromise（挂载点在 enrich 后原位）');

    const aasSrc = src('src/narrative/analyzer/services/account-analysis-service.mjs');
    assert(aasSrc.includes('const pullOriginal = !!originalAuthor && originalAuthor !== primaryScreenName;')
      && aasSrc.includes('await Promise.all([\n    primaryScreenName ? getFullAccountInfo(primaryScreenName, options) : Promise.resolve(null),\n    pullOriginal ? getFullAccountInfo(originalAuthor, options) : Promise.resolve(null),\n  ]);'),
      'E3 collect 双账号 Promise.all + 去重静态判定形状');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
