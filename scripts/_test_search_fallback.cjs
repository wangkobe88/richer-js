#!/usr/bin/env node
/**
 * 空语料推特搜索兜底单测（C76，2026-10-16 特斯拉飞行汽车案 C73 提案①）——零 DB 零网络
 *
 * 打桩手法（先例 _test_vision_gate / _test_narrative_middle_parallel）：
 *   - twitter-validation CJS 预覆写 tv.searchTimeline（服务层/端到端走桩）；
 *     A 段用 new-apis.js 原始函数 + global.fetch 桩测 GraphQL 解析
 *   - dbManager 假 supabase（chainable Proxy）+ Repository/Cache statics 覆写
 *   - getConfig() 缓存对象原地改（vision gate E2 先例）
 *
 * 节：
 *   A. API 层 searchTimeline（variables 核验 / GraphQL 两路径 + TweetWithVisibilityResults
 *      下钻 / 零结果不 throw / 非 200 throw / makeRequest timeoutMs 透传源码锁）
 *   B. buildSearchQuery（短名/名缺失/无锚 → null；sinceDate 字面）
 *   C. 有语料判定（engagementOf / hasSearchCorpus 边界——2026-10-20 股城案用户
 *      裁定「不卡互动，只通过语料了解叙事」：语料非空即旁路，engagement 只作展示）
 *   D. collectSearchEvidence 缓存语义（★有语料才 set / 零结果-失败零 set /
 *      缓存命中零 stub 调用 / get throw 降级真拉 / 纯转推剔除 / Top 互动序）
 *   E. inflight（同 query 并发每产品 1 次真调 / 失败后清理可重试）
 *   F. section 渲染（null→'' / 来源声明行 / 行形状 / 截断）
 *   G. lag 隔离事故反证（extractCorpusTs 三路径 + 两侧源码断言）
 *   H. state builder bit-parity（无证据不改一字 / 有证据恰追加段 / 不占四区配额）
 *   I. 源码口径锁 analyzer 接线
 *   J. 端到端 analyze()（J1 强证据旁路 / J2 失败 bit-identical / J3 低互动语料仍旁路
 *      +零语料保重试域 / J4 关=零触达 / J5 enabled 残缺 throw fail-loud）
 *
 * 用法：node scripts/_test_search_fallback.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

// ═══ 加载前覆写（必须在任何 narrative ESM import 之前）═══
process.env.TYPESAFE_API_KEY = 'unit-test-key';

// twitter stub：searchTimeline 可编程桩（服务层与 J 段消费；A 段用 new-apis 原始函数走 fetch 桩）
const tv = require('../src/utils/twitter-validation/index.js');
const newApis = require('../src/utils/twitter-validation/new-apis.js');
const searchStub = { calls: [], impl: null, error: null };
tv.searchTimeline = async (params) => {
  searchStub.calls.push(params);
  if (searchStub.error) throw searchStub.error;
  return searchStub.impl ? searchStub.impl(params) : { tweets: [] };
};

// dbManager 假 supabase（链式 Proxy + thenable）
const chainable = (result) => new Proxy(function () {}, {
  get(_t, prop) {
    const p = Promise.resolve(result);
    if (prop === 'then') return p.then.bind(p);
    if (prop === 'catch') return p.catch.bind(p);
    return () => chainable(result);
  },
  apply() { return chainable(result); },
});
let tokenRow = null;
const emptyResult = { data: [], error: null };
const supabaseStub = {
  from(table) {
    const rows = table === 'experiment_tokens' && tokenRow ? [tokenRow] : [];
    return chainable({ data: rows, error: null });
  },
};
const { dbManager } = require('../src/services/dbManager.js');
dbManager.getSupabase = () => supabaseStub;

// ═══ global.fetch 桩（A 段原始函数 + J 段 Jev 400）═══
let apidanceCalls = [];
function fakeJsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(obj),
    json: async () => obj,
  };
}
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.apidance.pro')) {
    apidanceCalls.push(u);
    return fakeJsonResponse(apidanceFixture);
  }
  if (u.includes('api.typesafe.ai')) {
    return fakeJsonResponse({ error: 'unit-test main jev disabled' }, 400);
  }
  return fakeJsonResponse({}, 404);
};

// A 段 fixture 主体（可被各 case 替换）
let apidanceFixture = {};

// ── fixture 工具 ──
function rawTweet(id, over = {}) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    legacy: {
      full_text: over.text || `tweet ${id} about the flying car event`,
      created_at: over.created_at || 'Wed Oct 15 08:00:00 +0000 2026',
      favorite_count: over.fav ?? 100,
      retweet_count: over.rt ?? 10,
      reply_count: over.reply ?? 5,
    },
    core: {
      user_results: {
        result: {
          legacy: { screen_name: over.user || 'author', followers_count: over.followers ?? 1000 },
          core: { screen_name: over.user || 'author' },
        },
      },
    },
  };
}
function gqlSearchResponse(raws) {
  const entries = raws.map((raw, i) => ({
    entryId: `tweet-${i}`,
    content: { entryType: 'TimelineTimelineItem', itemContent: { __typename: 'TimelineTweet', tweet_results: { result: raw } } },
  }));
  return { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } };
}
/** 服务层归一化推文（tv.searchTimeline 桩返回形状） */
function normTweet(id, over = {}) {
  return {
    tweet_id: String(id),
    text: over.text ?? `tweet ${id} about the flying car event`,
    created_at: over.created_at ?? 'Wed Oct 15 08:00:00 +0000 2026',
    author_screen_name: over.user ?? 'author',
    author_followers_count: over.followers ?? 1000,
    favorite_count: over.fav ?? 100,
    retweet_count: over.rt ?? 10,
    reply_count: over.reply ?? 5,
  };
}
function makeTokenData(term, createdAtSec = 1792108800) { // 2026-10-16 00:00 UTC → since=2026-10-09
  // C131 追加裁定：搜索词优先 symbol——测试里 symbol=词，保持各 case 查询互不撞键
  return { address: '0xabc', symbol: term, raw_api_data: { name: term, symbol: term, created_at: createdAtSec }, tokenCreatedAtSec: createdAtSec };
}
const CFG_FULL = {
  enabled: true, corpusMode: 'empty', minTermChars: 2, sinceDays: 7,
  products: ['Top', 'Latest'], count: 20, stateTopTweets: 5, stateMaxChars: 2500,
  timeoutMs: 5000, cacheTtlSec: 1800,
};

async function main() {
  // ═══ A. API 层 searchTimeline（原始函数 + fetch 桩）═══
  console.log('══ A. API 层 searchTimeline ═══');
  {
    // A1 variables 核验
    apidanceFixture = gqlSearchResponse([rawTweet('1')]);
    apidanceCalls = [];
    await newApis.searchTimeline({ rawQuery: '"Flying Car" since:2026-10-08', product: 'Latest', count: 7 });
    assert(apidanceCalls.length === 1, 'A1 单次调用打到 SearchTimeline 端点');
    const vars = JSON.parse(new URL(apidanceCalls[0]).searchParams.get('variables'));
    assert(vars.rawQuery === '"Flying Car" since:2026-10-08' && vars.product === 'Latest' && vars.count === 7
      && vars.querySource === 'typed_query' && vars.cursor === '' && vars.includePromotedContent === false,
      'A2 variables 六字段核验', JSON.stringify(vars));

    // A3 itemContent 单推解析 + 归一化字段
    apidanceFixture = gqlSearchResponse([rawTweet('11', { user: 'Tesla', followers: 24800000, fav: 43700, rt: 8200 })]);
    let r = await newApis.searchTimeline({ rawQuery: 'x' });
    assert(r.tweets.length === 1 && r.tweets[0].tweet_id === '11' && r.tweets[0].author_screen_name === 'Tesla'
      && r.tweets[0].author_followers_count === 24800000 && r.tweets[0].favorite_count === 43700
      && r.tweets[0].retweet_count === 8200 && r.tweets[0].reply_count === 5
      && typeof r.tweets[0].text === 'string' && r.tweets[0].created_at.includes('2026'),
      'A3 itemContent 单推归一化八字段');

    // A4 TweetWithVisibilityResults 下钻
    const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: rawTweet('22', { user: 'w' }) };
    apidanceFixture = gqlSearchResponse([wrapped]);
    r = await newApis.searchTimeline({ rawQuery: 'x' });
    assert(r.tweets.length === 1 && r.tweets[0].tweet_id === '22', 'A4 TweetWithVisibilityResults 下钻 .tweet');

    // A5 items 模块推路径
    const moduleEntry = {
      entryId: 'mod-0',
      content: {
        entryType: 'TimelineTimelineModule',
        items: [
          { itemContent: { tweet_results: { result: rawTweet('31') } } },
          { itemContent: { tweet_results: { result: rawTweet('32') } } },
        ],
      },
    };
    apidanceFixture = { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [moduleEntry] }] } } } } };
    r = await newApis.searchTimeline({ rawQuery: 'x' });
    assert(r.tweets.length === 2 && r.tweets.map(t => t.tweet_id).join(',') === '31,32', 'A5 TimelineModule items 两推全解析');

    // A6 零结果/空骨架不 throw
    for (const [label, fixture] of [['零 entries', gqlSearchResponse([])], ['空骨架', {}], ['data null', { data: null }]]) {
      apidanceFixture = fixture;
      let threw = false;
      try { r = await newApis.searchTimeline({ rawQuery: 'x' }); } catch { threw = true; }
      assert(!threw && r.tweets.length === 0, `A6 ${label} → {tweets:[]} 不 throw`);
    }

    // A7 非 200 throw
    const origFetch = global.fetch;
    global.fetch = async () => fakeJsonResponse({ e: 1 }, 500);
    let threw = false;
    try { await newApis.searchTimeline({ rawQuery: 'x' }); } catch { threw = true; }
    global.fetch = origFetch;
    assert(threw, 'A7 HTTP 500 → throw（调用方 catch）');

    // A8 timeoutMs 透传源码锁
    const NA = src('src/utils/twitter-validation/new-apis.js');
    assert(NA.includes('options.timeoutMs || API_CONFIG.timeout'), 'A8 makeRequest timeoutMs 透传（源码锁）');
    assert(NA.includes('graphql/SearchTimeline'), 'A8b NEW_ENDPOINTS.searchTimeline 在场');
  }

  // ═══ B. buildSearchQuery 纯函数 ═══
  console.log('══ B. buildSearchQuery ═══');
  {
    const { buildSearchQuery } = await import('../src/narrative/analyzer/services/twitter-search-fallback.mjs');
    // B1 ★symbol 优先（用户看到的是 symbol；股城案：name=STOCKOPOLIS, symbol=股城）
    const qSymbol = buildSearchQuery({
      address: '0xabc', symbol: '股城',
      raw_api_data: { name: 'STOCKOPOLIS', symbol: '股城', created_at: 1792108800 },
      tokenCreatedAtSec: 1792108800,
    }, CFG_FULL);
    assert(qSymbol && qSymbol.rawQuery === '"股城" since:2026-10-09' && qSymbol.term === '股城',
      'B1 ★搜索词优先 symbol（股城而非 STOCKOPOLIS；since=创建-7d → 2026-10-09）', JSON.stringify(qSymbol));
    // B1b symbol 不可用（1 字符）→ 回落 name
    const qName = buildSearchQuery({
      address: '0xabc', symbol: 'A',
      raw_api_data: { name: 'Stockopolis', symbol: 'A', created_at: 1792108800 },
      tokenCreatedAtSec: 1792108800,
    }, CFG_FULL);
    assert(qName && qName.term === 'Stockopolis' && qName.rawQuery === '"Stockopolis" since:2026-10-09',
      'B1b symbol 过短（1<2）→ 回落链上 name', JSON.stringify(qName));
    // B2 两词都过短 → null
    assert(buildSearchQuery({ address: '0x1', symbol: 'A', raw_api_data: { name: 'B', created_at: 1792108800 } }, CFG_FULL) === null,
      'B2 symbol/name 去空格均 <2 → null');
    // B3 名缺失 → null
    assert(buildSearchQuery({ address: '0x1', symbol: '', raw_api_data: { name: '', created_at: 1792108800 } }, CFG_FULL) === null,
      'B3 symbol/name 均缺失 → null');
    // B4 无创建时间锚 → null fail-safe（词合法仍拒）
    const noAnchor = { address: '0x1', symbol: 'STOCK', raw_api_data: { name: 'STOCK' } };
    assert(buildSearchQuery(noAnchor, CFG_FULL) === null, 'B4 无创建时间锚（tokenCreatedAtSec 与 created_at 双缺）→ null fail-safe');
    // B5 tokenCreatedAtSec 优先（raw_api_data.created_at 缺）
    const q2 = buildSearchQuery({ address: '0x2', symbol: 'STOCK', raw_api_data: { name: 'STOCK' }, tokenCreatedAtSec: 1792108800 }, CFG_FULL);
    assert(q2 && q2.sinceDate === '2026-10-09', 'B5 tokenCreatedAtSec 兜底锚生效');
  }

  // ═══ C. 有语料判定 ═══
  console.log('══ C. engagementOf / hasSearchCorpus ═══');
  {
    const { engagementOf, hasSearchCorpus } = await import('../src/narrative/analyzer/services/twitter-search-fallback.mjs');
    assert(engagementOf({ favorite_count: 100, retweet_count: 50 }) === 200, 'C1 engagement = fav + 2×rt（仅展示/审计口径）');
    assert(engagementOf({}) === 0 && engagementOf({ favorite_count: 5 }) === 5, 'C1b 缺省键计 0');
    const ev = (n, m) => ({ uniqueTweets: n, maxEngagement: m });
    assert(hasSearchCorpus(ev(0, 99999)) === false, 'C2 零条 → 无语料（互动再高也不放行）');
    assert(hasSearchCorpus(ev(1, 0)) === true, 'C3 ★1 条低互动 → 有语料（C130：不卡互动）');
    assert(hasSearchCorpus(ev(2, 3)) === true, 'C4 2 条弱互动 → 有语料');
    assert(hasSearchCorpus(null) === false, 'C5 null 输入 fail-safe');
    const FB = src('src/narrative/analyzer/services/twitter-search-fallback.mjs');
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const FBCode = stripComments(FB);
    assert(!FBCode.includes('meetsBypassThreshold') && !FBCode.includes('minTopEngagement') && !FBCode.includes('minTweets'),
      'C6 ★可执行代码无互动/条数门槛（C130 裁定：只通过语料了解叙事；注释中的历史说明除外）');
  }

  // ═══ D/E. collectSearchEvidence 缓存语义 + inflight ═══
  console.log('══ D. collectSearchEvidence 缓存语义 ═══');
  const cacheMap = new Map();
  const cacheOps = { gets: [], sets: [] };
  let cacheGetError = null;
  {
    const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
    cacheMod.ExternalResourceCache.get = async (key, type) => {
      cacheOps.gets.push({ key, type });
      if (cacheGetError) throw cacheGetError;
      return cacheMap.get(key) ?? null;
    };
    cacheMod.ExternalResourceCache.set = async (key, type, content, opts) => {
      cacheOps.sets.push({ key, type, content, opts });
      cacheMap.set(key, content);
      return true;
    };
    const svc = await import('../src/narrative/analyzer/services/twitter-search-fallback.mjs');

    // D1 有语料 → 两产品各 set 一次（ttl 透传）+ evidence 形状
    searchStub.calls = [];
    searchStub.error = null;
    searchStub.impl = ({ product }) => ({
      tweets: [
        normTweet(`${product}-1`, { fav: 43700, rt: 8200, user: 'Tesla', followers: 24800000 }),
        normTweet(`${product}-2`, { fav: 300, rt: 50 }),
        normTweet(`${product}-3`, { fav: 10, rt: 0 }),
      ],
    });
    cacheMap.clear(); cacheOps.sets.length = 0; cacheOps.gets.length = 0;
    const ev1 = await svc.collectSearchEvidence(makeTokenData('Strong Event One'), { config: CFG_FULL });
    assert(ev1 && ev1.hasCorpus === true && ev1.uniqueTweets === 6, 'D1 有语料（两产品 6 条去重）', JSON.stringify({ u: ev1?.uniqueTweets }));
    assert(cacheOps.sets.length === 2 && cacheOps.sets.every(s => s.type === 'twitter_search' && s.opts.ttl === 1800),
      'D2 有语料 → 两产品各 set 一次（resourceType=twitter_search, ttl=1800s）', JSON.stringify(cacheOps.sets.map(s => s.key)));
    assert(cacheOps.sets.some(s => s.key.startsWith('twitter_search:Top:')) && cacheOps.sets.some(s => s.key.startsWith('twitter_search:Latest:')),
      'D2b 缓存键前缀 twitter_search:<product>:<query>');
    assert(ev1.products.Top.tweets[0].user === 'Tesla' && ev1.products.Top.tweets[0].fav === 43700
      && typeof ev1.products.Top.tweets[0].text === 'string' && ev1.products.Top.tweets[0].text.length <= 200,
      'D3 evidence.products.Top.tweets 瘦形态（互动序首条=Tesla 43.7K）');
    assert(ev1.maxEngagement === 43700 + 2 * 8200 && ev1.query.sinceDate === '2026-10-09', 'D4 maxEngagement 跨产品口径 + query 留痕');

    // D5 Top 互动序（stub 乱序给）
    searchStub.impl = () => ({
      tweets: [
        normTweet('Top-low', { fav: 5 }),
        normTweet('Top-high', { fav: 5000 }),
        normTweet('Top-mid', { fav: 500 }),
      ],
    });
    cacheMap.clear();
    const evTop = await svc.collectSearchEvidence(makeTokenData('Order Event Two'), { config: CFG_FULL });
    assert(evTop.products.Top.tweets.map(t => t.id).join(',') === 'Top-high,Top-mid,Top-low', 'D5 Top 块显式按互动排序（不信任 API 序）');

    // D6 纯转推剔除：1 原推 + 2 条 RT@ → uniqueTweets=1，仍有语料
    searchStub.impl = () => ({
      tweets: [
        normTweet('orig-1', { fav: 43700, rt: 100 }),
        normTweet('rt-1', { text: 'RT @someone: original', fav: 50 }),
        normTweet('rt-2', { text: 'RT @someone: original again', fav: 60 }),
      ],
    });
    cacheMap.clear(); cacheOps.sets.length = 0;
    const evRt = await svc.collectSearchEvidence(makeTokenData('Rt Filter Three'), { config: CFG_FULL });
    assert(evRt.uniqueTweets === 1 && evRt.hasCorpus === true && cacheOps.sets.length === 2,
      'D6 纯转推剔除（1 原推 + 2 RT@ → unique=1，仍有语料并落缓存）');

    // D7 ★低互动语料照常旁路并落缓存（C130：不卡互动）
    searchStub.impl = () => ({ tweets: [normTweet('w-1', { fav: 3 }), normTweet('w-2', { fav: 2 })] });
    cacheMap.clear(); cacheOps.sets.length = 0;
    const evWeak = await svc.collectSearchEvidence(makeTokenData('Weak Event Four'), { config: CFG_FULL });
    assert(evWeak && evWeak.hasCorpus === true && cacheOps.sets.length === 2,
      'D7 ★低互动语料（2 条 maxEng=3）→ hasCorpus true 且落缓存（互动不做门槛）');

    // D8 零结果 → evidence 在场（hasCorpus false）零 set（保 1800s 重试域）
    searchStub.impl = () => ({ tweets: [] });
    cacheOps.sets.length = 0;
    const evZero = await svc.collectSearchEvidence(makeTokenData('Zero Event Five'), { config: CFG_FULL });
    assert(evZero && evZero.uniqueTweets === 0 && evZero.hasCorpus === false && cacheOps.sets.length === 0,
      'D8 零结果 ≠ 错误（evidence 在场，hasCorpus false）且零 set');

    // D9 API 失败 → null
    searchStub.error = new Error('apidance down');
    const evFail = await svc.collectSearchEvidence(makeTokenData('Fail Event Six'), { config: CFG_FULL });
    assert(evFail === null, 'D9 全产品失败 → null（analyzer 维持原拒）');
    searchStub.error = null;

    // D10 缓存命中 → 零 stub 调用
    searchStub.calls = [];
    searchStub.impl = ({ product }) => ({
      tweets: [
        normTweet(`${product}-1`, { fav: 43700 }),
        normTweet(`${product}-2`, { fav: 900 }),
        normTweet(`${product}-3`, { fav: 800 }),
      ],
    });
    cacheMap.clear(); cacheOps.sets.length = 0;
    await svc.collectSearchEvidence(makeTokenData('Cache Event Seven'), { config: CFG_FULL }); // 真调落缓存
    const callsAfterFirst = searchStub.calls.length;
    const evCached = await svc.collectSearchEvidence(makeTokenData('Cache Event Seven'), { config: CFG_FULL }); // 同 query 二次
    assert(evCached.hasCorpus === true && searchStub.calls.length === callsAfterFirst,
      'D10 缓存命中 → 零真调（每产品 set 行复用）', `${searchStub.calls.length} vs ${callsAfterFirst}`);

    // D11 get throw → 降级真拉不 throw
    cacheGetError = new Error('cache read fail');
    searchStub.calls = [];
    searchStub.impl = ({ product }) => ({
      tweets: [normTweet(`${product}-c1`, { fav: 43700 }), normTweet(`${product}-c2`, { fav: 900 }), normTweet(`${product}-c3`, { fav: 800 })],
    });
    const evDegrade = await svc.collectSearchEvidence(makeTokenData('Degrade Event Eight'), { config: CFG_FULL });
    cacheGetError = null;
    assert(evDegrade && evDegrade.hasCorpus === true && searchStub.calls.length === 2, 'D11 缓存读失败 → 降级每产品真拉');

    // E 段：inflight
    console.log('══ E. inflight 去重 ═══');
    searchStub.calls = [];
    let resolvers = [];
    searchStub.impl = ({ product }) => new Promise(resolve => {
      resolvers.push(() => resolve({
        tweets: [normTweet(`if-${product}-1`, { fav: 43700 }), normTweet(`if-${product}-2`, { fav: 900 }), normTweet(`if-${product}-3`, { fav: 800 })],
      }));
    });
    const tdE = makeTokenData('Inflight Event Nine');
    const p1 = svc.collectSearchEvidence(tdE, { config: CFG_FULL });
    const p2 = svc.collectSearchEvidence(tdE, { config: CFG_FULL });
    await new Promise(res => setTimeout(res, 10));
    resolvers.forEach(fn => fn()); // 两产品全部放行（单 release 覆写会让另一 promise 永远 pending）
    const [e1, e2] = await Promise.all([p1, p2]);
    assert(searchStub.calls.length === 2, 'E1 同 rawQuery 并发两调 → 每产品恰 1 次真调（2 产品=2）', String(searchStub.calls.length));
    assert(e1 === e2, 'E2 并发 join 共享同一 evidence 对象');

    // E3 失败后 inflight 清理可重试
    searchStub.error = new Error('first fail');
    await svc.collectSearchEvidence(makeTokenData('Retry Event Ten'), { config: CFG_FULL });
    searchStub.error = null;
    searchStub.calls = [];
    searchStub.impl = () => ({ tweets: [normTweet('r-ok', { fav: 43700 })] });
    const evRetry = await svc.collectSearchEvidence(makeTokenData('Retry Event Ten'), { config: CFG_FULL });
    assert(evRetry !== null && searchStub.calls.length === 2, 'E3 失败后 inflight 清理（重试真调非旧 reject）');

    // E4 配置关 → null 零调用
    searchStub.calls = [];
    const evOff = await svc.collectSearchEvidence(makeTokenData('Off Event Elvn'), { config: { enabled: false } });
    assert(evOff === null && searchStub.calls.length === 0, 'E4 config.enabled=false → null 零调用');

    // E5 getSearchFallbackConfig 校验
    const { getSearchFallbackConfig } = svc;
    assert(getSearchFallbackConfig({ config: {} }) === null, 'E5 段缺失 → null 静默关');
    assert(getSearchFallbackConfig({ config: { searchFallback: { enabled: false } } }) === null, 'E5b enabled:false → null');
    assert(getSearchFallbackConfig({ config: { searchFallback: { enabled: true, products: ['Top', 'Latest'], count: 20 } } }) !== null,
      'E5c 合法段 → 完整 cfg（代码默认值兜底；C130 起无 bypass 段）');
    for (const [label, bad] of [
      ['缺 products', { enabled: true, count: 20 }],
      ['products 成员非法', { enabled: true, products: ['Media'], count: 20 }],
      ['缺 count', { enabled: true, products: ['Top'] }],
    ]) {
      let threw = false;
      try { getSearchFallbackConfig({ config: { searchFallback: bad } }); } catch { threw = true; }
      assert(threw, `E5d enabled 但${label} → throw fail-loud`);
    }
    const cfgWithStaleBypass = getSearchFallbackConfig({ config: { searchFallback: { enabled: true, products: ['Top'], count: 20, bypass: { minTweets: 3, minTopEngagement: 200 } } } });
    assert(cfgWithStaleBypass !== null && cfgWithStaleBypass.bypass !== undefined,
      'E5d2 存量配置带旧 bypass 段 → 忽略不报错（不参与判定）');
    let threwMode = false;
    try { getSearchFallbackConfig({ config: { searchFallback: { enabled: true, corpusMode: 'partial', products: ['Top'], count: 20 } } }); } catch { threwMode = true; }
    assert(threwMode, 'E5e corpusMode 非 empty → throw（首版仅 empty）');
  }

  // ═══ F. section 渲染 ═══
  console.log('══ F. buildTwitterSearchSection ═══');
  {
    const { buildTwitterSearchSection } = await import('../src/narrative/analyzer/prompts/sections/twitter-search-section.mjs');
    assert(buildTwitterSearchSection(null) === '', 'F1 null → ""（bit-parity 锚点）');
    assert(buildTwitterSearchSection({}) === '' && buildTwitterSearchSection({ products: {} }) === '', 'F1b 无 products / 空 products → ""');
    assert(buildTwitterSearchSection({ products: { Top: { total: 0, tweets: [] } } }) === '', 'F1c 全零 total → ""');

    const evidence = {
      v: 1,
      query: { rawQuery: '"Tesla Flying Car" since:2026-10-08', sinceDate: '2026-10-08', term: 'Tesla Flying Car' },
      sinceDate: '2026-10-08',
      products: {
        Top: { total: 8, maxEngagement: 43700, tweets: [ { id: '1', at: 'Wed Oct 15 08:00:00 +0000 2026', user: 'Tesla', followers: 24800000, fav: 43700, rt: 8200, reply: 3100, text: 'the flying car is real' } ] },
        Latest: { total: 20, maxEngagement: 900, tweets: [ { id: '2', at: 'Wed Oct 15 09:00:00 +0000 2026', user: 'fan', followers: 100, fav: 5, rt: 1, reply: 0, text: 'wow' } ] },
      },
      uniqueTweets: 28, maxEngagement: 43700,
      meta: { topN: 5, maxChars: 2500 },
    };
    const s = buildTwitterSearchSection(evidence);
    assert(s.startsWith('[TWITTER_SEARCH]') && s.includes('不是本代币的宣告推文') && s.includes('「Tesla Flying Car」') && s.includes('2026-10-08'),
      'F2 来源声明行（搜索词+时间窗+非宣告语料警示）');
    assert(s.includes('Top 8 条') && s.includes('Latest 20 条') && s.includes('点赞+2×转发'), 'F3 聚合行（两产品命中+口径）');
    assert(s.includes('[10-15] @Tesla(粉丝24800000) 赞43700/转8200/回3100：the flying car is real'), 'F4 推文行形状');
    assert(s.includes('按互动排序') && s.includes('时间序'), 'F5 Top/Latest 块标签');

    const sTrunc = buildTwitterSearchSection(evidence, { maxChars: 180 });
    assert(sTrunc.length <= 180 + 20 && sTrunc.includes('…(搜索结果已截断)'), 'F6 截断标记（maxChars 覆盖）', sTrunc.length);
  }

  // ═══ G. lag 隔离事故反证 ═══
  console.log('══ G. lag 隔离（narrativeCorpusLagSec 不受搜索证据污染）═══');
  {
    const { extractCorpusTs } = require('../src/trading-engine/pre-check/NarrativeDirectCaller.js');
    assert(extractCorpusTs(null) === null, 'G1 旁路票 twitter=null → corpusTs null（lag=晚票门不变）');
    assert(extractCorpusTs({ created_at: 'Wed Oct 15 08:00:00 +0000 2026' }) !== null, 'G2 主推 created_at 照常读');
    const NDC = src('src/trading-engine/pre-check/NarrativeDirectCaller.js');
    const m = NDC.match(/function extractCorpusTs\(twitter\) \{[\s\S]*?\n\}/);
    assert(m !== null, 'G3 extractCorpusTs 函数体定位');
    if (m) {
      const body = m[0];
      assert(body.includes('twitter?.created_at') && body.includes('in_reply_to') && body.includes('website_tweet')
        && !body.includes('raw_api_data') && !body.includes('search_evidence'),
        'G4 ★candidates 恰三路径（主推/父推/第二推文），无 raw_api_data/search_evidence');
    }
    const FBSRC = src('src/narrative/analyzer/services/twitter-search-fallback.mjs');
    const SECSRC = src('src/narrative/analyzer/prompts/sections/twitter-search-section.mjs');
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const [label, text] of [['服务层', FBSRC], ['渲染层', SECSRC]]) {
      const code = stripComments(text);
      assert(!code.includes('twitterInfo') && !code.includes('website_tweet') && !code.includes('in_reply_to'),
        `G5 ${label}可执行代码不含 twitterInfo/website_tweet/in_reply_to（结构性隔离；注释中的红线声明除外）`);
    }
  }

  // ═══ H. state builder bit-parity ═══
  console.log('══ H. buildJevState bit-parity ═══');
  {
    const { buildJevState } = await import('../src/narrative/analyzer/llm/jev-state-builder.mjs');
    const { buildTwitterSearchSection } = await import('../src/narrative/analyzer/prompts/sections/twitter-search-section.mjs');
    const baseTd = { address: '0xabc', symbol: 'TST', raw_api_data: { name: 'Plain Token' } };
    const fr = { twitterInfo: null, extractedInfo: { intro_en: 'some intro text long enough' } };
    const now = 1760580000000;
    const state0 = buildJevState(baseTd, fr, { now });
    assert(!state0.state.includes('[TWITTER_SEARCH]'), 'H1 无证据 → state 无 [TWITTER_SEARCH] 段');

    const evidence = {
      query: { rawQuery: '"Plain Token" since:2026-10-08', term: 'Plain Token' }, sinceDate: '2026-10-08',
      products: { Top: { total: 3, maxEngagement: 500, tweets: [{ id: '1', at: 'Wed Oct 15 08:00:00 +0000 2026', user: 'a', followers: 1, fav: 100, rt: 0, reply: 0, text: 'x' }] } },
      uniqueTweets: 3, maxEngagement: 500, meta: { topN: 5, maxChars: 2500 },
    };
    const tdWith = { ...baseTd, raw_api_data: { ...baseTd.raw_api_data, search_evidence: evidence } };
    const state1 = buildJevState(tdWith, fr, { now });
    const sectionStr = buildTwitterSearchSection(evidence, { now });
    // 空语料票 bodyParts 恒空 → state0 尾恒 '\n\n'，s1 = state0 + section + '\n\n'
    // （corpusMode=empty：search_evidence 只存在于四区全空的旁路票，这是唯一生产形状）
    assert(state1.state === state0.state + sectionStr + '\n\n', 'H2 ★有证据 → state 恰= 无证据 state 追加段（逐字节关系锁，无证据时与现状一致）');
    assert(JSON.stringify(state1.stats.groups) === JSON.stringify(state0.stats.groups),
      'H3 四区配额零占用（groups.stats 深相等）');
    assert(state1.state.indexOf('[TWITTER_SEARCH]') > state1.state.indexOf('[PRECOMPUTED]'), 'H4 段挂 [PRECOMPUTED] 之后（header 位形）');
  }

  // ═══ I. 源码口径锁 analyzer 接线 ═══
  console.log('══ I. 源码口径锁 ═══');
  {
    const A = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    assert(A.includes("timing.wrap('search.twitter'"), 'I1 timing 段名 search.twitter');
    assert(A.includes('accountChainPromise, precheckPromise, issuerCaPromise, searchPromise'), 'I2 Promise.all 恰四元含 searchPromise');
    assert(A.includes("ruleName === 'no_public_info' && searchEvidenceReady"), 'I3 旁路条件字面（no_public_info && 有语料）');
    assert(A.includes('hasSearchCorpus(searchEvidence)') && !A.includes('meetsBypassThreshold'),
      'I3b ★analyzer 用 hasSearchCorpus（无语料才拒），互动/条数门槛已退役');
    assert(A.includes('hasValidDataForAnalysis(fetchResults) || bypassedBySearch'), 'I4 第二道门放行');
    assert(A.includes('performPreCheck(tokenData, twitterInfo, extractedInfo, websiteInfo, classifiedUrls,'), 'I5 performPreCheck 调用签名未变（旁路在 analyzer 层不在 precheck 层）');
    assert(A.includes('search_evidence: searchEvidence'), 'I6 证据浅拷贝附加 raw_api_data');
    assert(A.includes('searchBypassed: true'), 'I7 meta.searchBypassed 标记');
    assert(!A.match(/hasValidDataForAnalysis\(fetchResults\) \|\| bypassedBySearch[\s\S]{0,200}function/), 'I8 hasValidDataForAnalysis 本体未改（消费处覆盖）');
    const IDX = src('src/utils/twitter-validation/index.js');
    assert(IDX.includes('searchTimeline'), 'I9 index.js re-export searchTimeline');
  }

  // ═══ J. 端到端 analyze() ═══
  console.log('══ J. 端到端 analyze() ═══');
  {
    const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
    repoMod.NarrativeRepository.findByAddress = async () => null;
    repoMod.NarrativeRepository.getSupabase = () => supabaseStub;
    const saves = [];
    repoMod.NarrativeRepository.save = async (fields) => { saves.push(fields); return { id: 1, ...fields }; };

    const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
    cacheMod.ExternalResourceCache.get = async () => null;
    cacheMod.ExternalResourceCache.set = async () => true;

    const { NarrativeAnalyzer } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');
    const { getConfig } = await import('../src/narrative/engine/config.mjs');
    const cfg = getConfig();
    const origSearch = cfg.searchFallback ? JSON.parse(JSON.stringify(cfg.searchFallback)) : null;

    const EMPTY_TOKEN = (name, addr) => {
      tokenRow = {
        token_symbol: 'TST',
        blockchain: 'bsc',
        platform: 'fourmeme',
        raw_api_data: { name, created_at: 1760580000, source: 'wss_token_create' }, // 零 URL 空语料 + 创建锚
      };
      return addr;
    };
    const lastSave = () => saves[saves.length - 1];

    try {
      // J1 空语料 + 强证据 → 旁路走 Jev
      cfg.searchFallback = CFG_FULL;
      searchStub.calls = []; searchStub.error = null;
      searchStub.impl = ({ product }) => ({
        tweets: [
          normTweet(`${product}-1`, { fav: 43700, rt: 8200, user: 'Tesla' }),
          normTweet(`${product}-2`, { fav: 900 }),
          normTweet(`${product}-3`, { fav: 800 }),
        ],
      });
      const timing1 = [];
      const r1 = await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Tesla Flying Car', '0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111'), { _timing: timing1 });
      const s1 = lastSave();
      const segs1 = (timing1 || []).map(t => t.seg);
      assert(segs1.includes('search.twitter'), 'J1a timing 含 search.twitter 段', JSON.stringify(segs1));
      assert(s1.pre_check_result === null, 'J1b ★save.pre_check_result === null（旁路=不再被 pre_check 形状遮蔽/穿透/排除）');
      assert(s1.raw_api_data?.search_evidence?.hasCorpus === true, 'J1c save.raw_api_data.search_evidence 在场（有语料）');
      assert(r1.meta?.searchBypassed === true && r1.meta.preCheckTriggered === false, 'J1d meta.searchBypassed=true / preCheckTriggered=false');
      assert(s1.prompt_type !== 'no_data', 'J1e 未死在第二道门 no_data 兜底');

      // J2 搜索失败 → 与关闭功能同票逐键 bit-identical
      const runOff = async (addr) => {
        saves.length = 0;
        const timing = [];
        await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Fail Compare Tokn', addr), { _timing: timing });
        return { save: lastSave(), segs: (timing || []).map(t => t.seg) };
      };
      cfg.searchFallback = CFG_FULL;
      searchStub.error = new Error('apidance outage');
      const { save: sFail, segs: segsFail } = await runOff('0xbbbb1111bbbb1111bbbb1111bbbb1111bbbb1111');
      cfg.searchFallback = null;
      searchStub.error = null; searchStub.calls = [];
      const { save: sOff, segs: segsOff } = await runOff('0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222');
      const COMPARE_KEYS = ['pre_check_result', 'prompt_type', 'raw_api_data', 'classified_urls', 'twitter_info', 'extracted_info', 'token_category'];
      let bitIdentical = true, diffKeys = [];
      for (const k of COMPARE_KEYS) {
        if (JSON.stringify(sFail[k]) !== JSON.stringify(sOff[k])) { bitIdentical = false; diffKeys.push(k); }
      }
      assert(bitIdentical, `J2a ★搜索失败 → 与 enabled:null 逐键 bit-identical`, diffKeys.join(','));
      assert(segsFail.includes('search.twitter') && !segsOff.includes('search.twitter'), 'J2b timing 段差异（失败有段/关闭无段）');
      assert(sFail.pre_check_result?.details?.ruleName === 'no_public_info', 'J2c 失败维持原拒（ruleName 不变）');
      assert(!sFail.pre_check_result?.details?.searchEvidence, 'J2d 失败（evidence=null）不注摘要键');

      // J3 空语料 + 低互动语料（2 条 maxEng=3）→ 仍旁路走 Jev（C130 核心裁定）
      cfg.searchFallback = CFG_FULL;
      searchStub.error = null; searchStub.calls = [];
      searchStub.impl = () => ({ tweets: [normTweet('w1', { fav: 3, rt: 0 }), normTweet('w2', { fav: 2, rt: 0 })] });
      const r3 = await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Weak Headline X', '0xcccc1111cccc1111cccc1111cccc1111cccc1111'), { _timing: [] });
      const s3 = lastSave();
      assert(s3.pre_check_result === null, 'J3a ★低互动语料 → pre_check_result=null（不卡互动，交 Jev 判叙事）');
      assert(s3.raw_api_data?.search_evidence?.hasCorpus === true && s3.raw_api_data.search_evidence.uniqueTweets === 2,
        'J3b 语料证据落 raw_api_data.search_evidence（hasCorpus=true，2 条）');
      assert(r3.meta?.searchBypassed === true && r3.meta.preCheckTriggered === false, 'J3c meta.searchBypassed=true / preCheckTriggered=false');

      // J3d 零语料 → ruleName 保重试域 + additive 摘要（无可判语料才维持原拒）
      searchStub.calls = [];
      searchStub.impl = () => ({ tweets: [] });
      await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Empty Headline Y', '0xcccc2222cccc2222cccc2222cccc2222cccc2222'), { _timing: [] });
      const s3d = lastSave();
      assert(s3d.pre_check_result?.details?.ruleName === 'no_public_info', 'J3d ★零语料 ruleName 不动（1800s 重试域保真）');
      assert(s3d.pre_check_result?.details?.searchEvidence?.bypass === false
        && s3d.pre_check_result?.details?.searchEvidence?.tweets === 0,
        'J3e additive searchEvidence 摘要（tweets=0, bypass=false）', JSON.stringify(s3d.pre_check_result?.details?.searchEvidence));
      assert(!s3d.raw_api_data?.search_evidence, 'J3f 零语料不落 raw_api_data.search_evidence');

      // J4 enabled:false / 段缺失 → 零触达
      cfg.searchFallback = { enabled: false };
      searchStub.calls = []; saves.length = 0;
      const timing4 = [];
      await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Off Compare Tokn', '0xdddd1111dddd1111dddd1111dddd1111dddd1111'), { _timing: timing4 });
      assert(searchStub.calls.length === 0 && !(timing4 || []).map(t => t.seg).includes('search.twitter'),
        'J4a enabled:false → 零 stub 调用 + 零 search.twitter 段');
      delete cfg.searchFallback;
      searchStub.calls = []; saves.length = 0;
      const timing4b = [];
      await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Missing Cfg Tokn', '0xdddd2222dddd2222dddd2222dddd2222dddd2222'), { _timing: timing4b });
      assert(searchStub.calls.length === 0 && !(timing4b || []).map(t => t.seg).includes('search.twitter'),
        'J4b 段缺失 → 静默关零触达');

      // J5 enabled 残缺 → analyze throw fail-loud（部署错误炸出来）
      cfg.searchFallback = { enabled: true };
      let threwJ5 = false;
      try {
        await NarrativeAnalyzer.analyze(EMPTY_TOKEN('Broken Cfg Tokn', '0xeeee1111eeee1111eeee1111eeee1111eeee1111'), { _timing: [] });
      } catch { threwJ5 = true; }
      assert(threwJ5, 'J5 enabled 但 products/count 残缺 → analyze throw fail-loud');

      // J6 非空语料票不触发搜索（有 twitter URL）
      cfg.searchFallback = CFG_FULL;
      searchStub.calls = [];
      tokenRow = {
        token_symbol: 'TST', blockchain: 'bsc', platform: 'fourmeme',
        raw_api_data: {
          name: 'Has Corpus Token', created_at: 1760580000,
          twitterUrl: 'https://x.com/someone/status/999888777666',
        },
      };
      await NarrativeAnalyzer.analyze('0xffff1111ffff1111ffff1111ffff1111ffff1111', { _timing: [] });
      assert(searchStub.calls.length === 0, 'J6 非空语料 → 搜索不触发（corpusMode=empty 首版语义）');
    } finally {
      if (origSearch) cfg.searchFallback = origSearch;
      else delete cfg.searchFallback;
    }
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
