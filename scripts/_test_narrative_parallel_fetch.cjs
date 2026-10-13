#!/usr/bin/env node
/**
 * N2 叙事提速单测（2026-10-13 叙事提速案）——本地零 DB 零网络
 *
 *   A. 行为级桶并发（真 ESM data-fetch-service + 类静态方法打桩）：
 *      桶间并发（twitter 慢桶不阻塞 github 快桶）/ justoneapi 桶内串行
 *      （weibo 完成后 youtube 才开始）/ 输出对象键完整 / 单平台失败隔离
 *   B. getRow + fetchWithCache 行内判定（dbManager.getSupabase 打桩）：
 *      两查合一单次 DB 往返 / success 命中 / failed 冷却 / failed 过冷却真析 /
 *      success 过期真析 / 无行负缓存登记 / 预载层短路零 DB
 *   C. 源码口径断言（锁防线）：四桶 allSettled 调度形状 / justoneapi 桶内
 *      await 链 / 13 段函数定义 / isFailed 已删 getRow 存在 / IPFS Promise.any /
 *      t.co 5s 超时 / IPFS∥GMGN 前缀并行 / skipIntermediateSave 三处接线
 *
 * 用法：node scripts/_test_narrative_parallel_fetch.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dbManager } = require('../src/services/dbManager');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // ═══ A. 行为级桶并发 ═══
  console.log('══ A. 平台桶并发（fetchDataSequentially 真 ESM）══');
  const dfs = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');
  const { WeiboFetcher } = await import('../src/narrative/utils/weibo-fetcher.mjs');
  const { YoutubeFetcher } = await import('../src/narrative/utils/youtube-fetcher.mjs');
  const { GithubFetcher } = await import('../src/narrative/utils/github-fetcher.mjs');
  {
    const events = [];
    const mark = (tag) => events.push([tag, Date.now()]);
    // apidance 桶（twitter 慢 60ms）/ github 桶（快 10ms）→ 桶间并发
    TwitterFetcher.fetchFromUrls = async () => {
      mark('twitter:start'); await sleep(60);
      mark('twitter:end'); return { type: 'tweet', id: '1', text: 'tw' };
    };
    TwitterFetcher.enrichWithLinkContent = async (info) => info;
    // justoneapi 桶内两平台（weibo 20ms → youtube 10ms）→ 桶内串行
    WeiboFetcher.fetchFromUrl = async () => {
      mark('weibo:start'); await sleep(20);
      mark('weibo:end'); return { text: 'wb' };
    };
    YoutubeFetcher.fetchVideoInfo = async () => {
      mark('youtube:start'); await sleep(10);
      mark('youtube:end'); return { title: 'yt' };
    };
    YoutubeFetcher.getInfluenceLevel = () => 'niche';
    YoutubeFetcher.getInfluenceDescription = () => 'desc';
    GithubFetcher.fetchRepoInfo = async () => {
      mark('github:start'); await sleep(10);
      mark('github:end'); return { stargazers_count: 42 };
    };
    GithubFetcher.getInfluenceLevel = () => 'niche';
    GithubFetcher.getInfluenceDescription = () => 'desc';
    GithubFetcher.isOfficialToken = () => false;

    const classifiedUrls = {
      twitter: [{ url: 'https://x.com/foo/status/123', type: 'tweet' }],
      weibo: [{ url: 'https://weibo.com/foo/123', type: 'status' }],
      youtube: [{ url: 'https://youtube.com/watch?v=abc', type: 'video' }],
      github: [{ url: 'https://github.com/foo/bar', type: 'repo' }],
      tiktok: [], douyin: [], bilibili: [], xiaohongshu: [], instagram: [],
      weixin: [], amazon: [], telegram: [], discord: [], binanceSquare: [], websites: [],
    };
    const t0 = Date.now();
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    const wall = Date.now() - t0;
    const t = Object.fromEntries(events.map(([k, v]) => [k, v]));

    // A1 桶间并发：github 在 twitter 仍在跑时已完成（原串行版 twitter 先完成才开始 github）
    assert(t['github:end'] < t['twitter:end'], 'A1 桶间并发：github 快桶先于 twitter 慢桶完成');
    assert(Math.abs(t['twitter:start'] - t['github:start']) < 30,
      'A1b 两桶近似同拍发起（间隔 <30ms）', `${t['twitter:start'] - t['github:start']}ms`);
    // A2 桶内串行：youtube（后段）开始 ≥ weibo（前段）结束——同 justoneapi 上游防限流
    assert(t['youtube:start'] >= t['weibo:end'] - 1, 'A2 桶内串行：youtube 在 weibo 完成后才开始');
    // A2b 墙钟：max(桶并发) 而非各段之和（60ms twitter 桶为主，串行版应 >100ms）
    assert(wall < 100, 'A2b 并发墙钟 < 各段之和（串行版应 >100ms）', `${wall}ms`);
    // A3 输出对象键与串行版一致
    assert(r.twitterInfo && r.twitterInfo.text === 'tw'
      && r.backgroundInfo && r.backgroundInfo.text === 'wb'
      && r.youtubeInfo && r.youtubeInfo.title === 'yt'
      && r.githubInfo && r.githubInfo.stargazers_count === 42,
      'A3 四桶数据齐落对应键');
    assert(['twitter', 'github', 'youtube'].every(k => r.dataFetchResults[k]?.success === true),
      'A3b dataFetchResults 键完整（twitter/github/youtube）');
    assert(r.classifiedUrls === classifiedUrls, 'A3c classifiedUrls 原样带出');

    // A4 失败隔离：weibo 抛错 → 只影响 backgroundInfo，twitter/github 照常
    WeiboFetcher.fetchFromUrl = async () => { throw new Error('weibo down'); };
    const r2 = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(r2.backgroundInfo === null && r2.twitterInfo?.text === 'tw' && r2.githubInfo?.stargazers_count === 42,
      'A4 单平台失败只留该键 null，其它桶不污染');
  }

  // ═══ B. getRow + fetchWithCache 行内判定 ═══
  console.log('══ B. getRow 两查合一（dbManager.getSupabase 打桩）══');
  const ERC = (await import('../src/narrative/db/ExternalResourceCache.mjs')).ExternalResourceCache;
  const { CachedFetcher } = await import('../src/narrative/db/ExternalResourceCache.mjs');
  {
    // 打桩 dbManager.getSupabase（CJS 对象属性覆盖，ESM import 侧同引用可见）
    let dbCalls = 0;
    let nextRow = null;
    dbManager.getSupabase = () => {
      dbCalls++;
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: nextRow, error: null }),
              }),
            }),
          }),
        }),
      };
    };
    const tokenData = { address: '0xt', symbol: 'TST' };
    ERC._preloadStore.clear(); ERC._missStore.clear();
    ERC.setNegativeCacheEnabled(false);

    // B1 无行 → 真析成功 set（1 次 getRow + 1 次 upsert）
    dbCalls = 0; nextRow = null;
    let fetchCalls = 0;
    let r1 = await CachedFetcher.fetchWithCache('https://e.com/1', 'tweet', async () => {
      fetchCalls++; return { data: 'fresh' };
    }, { ttl: 60 });
    assert(r1 && r1.data === 'fresh' && fetchCalls === 1, 'B1 无行 → 真析返回');
    assert(dbCalls === 2, 'B1b 全链恰 2 次 DB（getRow+set；原 isFailed+get+set=3）', String(dbCalls));

    // B2 success 未过期 → 命中 content 零真析（1 次 DB）
    dbCalls = 0; fetchCalls = 0;
    nextRow = { status: 'success', content: { data: 'cached' }, expires_at: null, cached_at: '2026-10-13T00:00:00Z' };
    r1 = await CachedFetcher.fetchWithCache('https://e.com/2', 'tweet', async () => {
      fetchCalls++; return { data: 'fresh' };
    }, { maxAge: 3600 });
    assert(r1 && r1.data === 'cached' && fetchCalls === 0, 'B2 success+expires null → 命中');
    assert(dbCalls === 1, 'B2b 单次 DB 往返（合一收益）', String(dbCalls));

    // B3 failed 冷却中（cached_at=now）→ 跳过 null 零真析
    nextRow = { status: 'failed', content: null, expires_at: null, cached_at: new Date().toISOString() };
    r1 = await CachedFetcher.fetchWithCache('https://e.com/3', 'tweet', async () => {
      fetchCalls++; return { data: 'fresh' };
    });
    assert(r1 === null && fetchCalls === 0, 'B3 failed 冷却期内 → 跳过 null');

    // B4 failed 过冷却（cached_at=2h 前）→ 真析
    dbCalls = 0;
    nextRow = { status: 'failed', content: null, expires_at: null,
      cached_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };
    r1 = await CachedFetcher.fetchWithCache('https://e.com/4', 'tweet', async () => ({ data: 'retry' }));
    assert(r1 && r1.data === 'retry', 'B4 failed 过冷却 → 真析重试');

    // B5 success 过期（expires_at 早于 now-maxAge）→ 真析
    nextRow = { status: 'success', content: { data: 'stale' },
      expires_at: new Date(Date.now() - 7200 * 1000).toISOString(), cached_at: '2026-10-13T00:00:00Z' };
    r1 = await CachedFetcher.fetchWithCache('https://e.com/5', 'tweet', async () => ({ data: 'fresh' }),
      { maxAge: 3600 });
    assert(r1 && r1.data === 'fresh', 'B5 success 过期 → 真析（不吐过期缓存）');

    // B6 无行 + 负缓存启用 → 登记，二次零 DB
    ERC.setNegativeCacheEnabled(true);
    dbCalls = 0; nextRow = null;
    await CachedFetcher.fetchWithCache('https://e.com/6', 'tweet', async () => ({ data: 'x' }));
    assert(ERC._missStore.has('tweet\u0000https://e.com/6'), 'B6 DB 无行 → 负缓存登记');
    dbCalls = 0;
    await CachedFetcher.fetchWithCache('https://e.com/6', 'tweet', async () => ({ data: 'x' }));
    assert(dbCalls === 1, 'B6b 负缓存语境二次 fetch 只剩 set 1 次 DB（getRow 短路）', String(dbCalls));

    // B7 预载层短路零 DB
    ERC._preloadStore.set('tweet\u0000https://e.com/pre', {
      status: 'success', content: { data: 'pre' }, expires_at: null,
    });
    dbCalls = 0;
    r1 = await CachedFetcher.fetchWithCache('https://e.com/pre', 'tweet', async () => ({ data: 'x' }));
    assert(r1 && r1.data === 'pre' && dbCalls === 0, 'B7 预载行短路 → 命中零 DB');
    ERC._preloadStore.clear(); ERC._missStore.clear();
    ERC.setNegativeCacheEnabled(false);
    void tokenData;
  }

  // ═══ C. 源码口径断言 ═══
  console.log('══ C. 源码口径（锁防线）══');
  {
    const dfs = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    // C1 四桶调度形状：twitter / justoneapi 串行链闭包 / github / website
    assert(/await Promise\.allSettled\(\[\n\s*runTwitter\(\),\n\s*\(async \(\) => \{/.test(dfs)
      && /runGithub\(\),\n\s*runWebsite\(\),\n\s*\]\);/.test(dfs),
      'C1 四桶 allSettled 调度形状');
    // C2 justoneapi 桶内 await 链（原全局顺序子列）
    const chain = ['runWeibo', 'runYoutube', 'runDouyin', 'runTiktok', 'runBilibili',
      'runBinanceSquare', 'runWeixin', 'runAmazon', 'runXiaohongshu', 'runInstagram'];
    const chainSrc = chain.map(n => `await ${n}();`).join('\n      ');
    assert(dfs.includes(chainSrc), 'C2 justoneapi 桶内 10 平台 await 串行链（桶内序=原全局序）');
    // C3 13 段函数定义
    const segs = ['Twitter', 'Weibo', 'Github', 'Youtube', 'Douyin', 'Tiktok', 'Bilibili',
      'BinanceSquare', 'Weixin', 'Amazon', 'Xiaohongshu', 'Instagram', 'Website'];
    assert(segs.every(n => new RegExp(`^  const run${n} = async \\(\\) => \\{`, 'm').test(dfs)),
      'C3 13 段函数定义齐全');
    // C4 IPFS∥GMGN 前缀并行（#2）
    assert(/const \[metadata, gmgnSocials\] = await Promise\.all\(\[\n\s*metaUrl \? timing\.wrap\('ipfs'/.test(dfs)
      && dfs.includes("timing.wrap('gmgn'"), 'C4 IPFS∥GMGN 前缀同发');

    const erc = src('src/narrative/db/ExternalResourceCache.mjs');
    assert(!/static async isFailed/.test(erc), 'C5 isFailed 已删（两查合一后零引用死码清理）');
    assert(/static async getRow\(url, resourceType\)/.test(erc), 'C5b getRow 存在');
    assert(/const row = await ExternalResourceCache\.getRow\(url, resourceType\);/.test(erc)
      && !erc.includes('await ExternalResourceCache.isFailed('), 'C5c fetchWithCache 单次拉行（无 isFailed 前查）');

    const ipfs = src('src/narrative/utils/ipfs-metadata-fetcher.mjs');
    assert(ipfs.includes('await Promise.any(IPFS_GATEWAYS.map(async (gateway)'), 'C6 IPFS 4 网关 Promise.any');

    const tf = src('src/narrative/utils/twitter-fetcher.mjs');
    const m = tf.match(/static async expandShortUrl[\s\S]{0,1600}/) || [''];
    assert(m[0].includes('controller.abort(), 5000')
      && (m[0].match(/signal: controller\.signal/g) || []).length === 2,
      'C7 t.co 展开 5s AbortController 总超时（HEAD+GET 两段共用）');

    const na = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    // 2026-10-13 叙事提速第二批（1B）后解构行尾新增 visionPrefetch 键
    assert(na.includes('skipIntermediateSave = false, visionPrefetch = false } = options'),
      'C8a analyze 解构 skipIntermediateSave + visionPrefetch（1B 穿透链）');
    assert(/if \(!skipIntermediateSave\) \{\s*\n\s*await timing\.wrap\('dbSave\.intermediate'/.test(na),
      'C8b 中段 save 条件化');
    assert((na.match(/if \(skipIntermediateSave\) \{/g) || []).length === 1
      && (na.match(/url_extraction_result: url_extraction_result/g) || []).length === 2,
      'C8c fallback 早退恰补一次同形状 save（skip 语境字段仍落库）');
    const ndc = src('src/trading-engine/pre-check/NarrativeDirectCaller.js');
    assert(ndc.includes('skipIntermediateSave: true,'), 'C8d 直调传 true');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
