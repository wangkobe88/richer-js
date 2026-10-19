#!/usr/bin/env node
/**
 * website 内容抓取总开关 + C115 纯 website 兜底语料单测——零 DB 零网络
 *
 * 开关背景（2026-10-13 叙事提速第二批 1C，用户裁定原话「网站内容现在就基本上
 * 没用到，我认为网站的信息下载可以去除的」）：fetch.website 段（N1 实测 avg
 * 3.8s / max 16.3s，12/47 票）退出临界路径。总开关 config/narrative-engine.json
 * `websiteFetch.enabled` 默认 false（键缺省同义）；回滚 = 配置改 true 重启。
 *
 * C115（2026-10-19 CZ4 案 0xc6fe…7777，用户裁定「如果所有的信息都不能获取，
 * 又提供了网站信息，就去获取一下 web 网站信息」）：开关关的提速语义只作用于
 * 「有其它语料在手」的票——全平台 <x>Info 全 null（无 URL 与抓取失败同形状）
 * 而 websites 桶提供可抓 URL 时，allSettled 后补抓一次网站内容当唯一语料源；
 * dataFetchResults.website 落 additive 标记 corpusFallback=true；失败 fail-closed
 * null 与「网站抓取失败」旧形状一致。
 *
 * 节：
 *   A. fetchTweetLinks 行为级（开关关）：t.co 展开保留+挂载 expanded_urls、
 *      普通网站 URL 零抓取（global fetch 零调用）、返回 null（C115 不触及——
 *      推文链接内容抓取非兜底范围）
 *   B. 开关关 + 纯 website 语料票（CZ4 现场形状）：C115 兜底抓取发生
 *   B'. 开关关 + 有 twitter 语料在手：提速语义保留（零抓取、websiteInfo 缺省）
 *   C. hasIndependentWebsite 门不变：websites 桶 URL 域名判据（与内容抓取无关）
 *   D. 源码口径：runWebsite 守卫 / fetchWebsiteCorpusOnce 单点 / C115 判定键集
 *      与标记 / t.co 展开段在守卫前 / 配置默认 false
 *   E. C115 边界矩阵：twitter 抓取失败形状仍兜底 / websites 桶空不兜底 /
 *      不可抓 URL 不兜底 / enabled=true 桶内抓且无标记 / 死站 fail-closed
 *
 * 用法：node scripts/_test_website_fetch_removal.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const EMPTY_BUCKETS = { twitter: [], weibo: [], youtube: [], github: [], tiktok: [],
  douyin: [], bilibili: [], xiaohongshu: [], instagram: [], weixin: [], amazon: [],
  telegram: [], discord: [], binanceSquare: [], websites: [] };

/** 手工 Response 桩（代码只消费 ok/status/text） */
function res(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const SITE = 'https://czfour-unittest.example.com';
const SITE_BODY = '<html><body><p>' + 'CZ4 ignore the FUD collect all 4 meme payout. '.repeat(10) + '</p></body></html>';

// global fetch 桩：按 URL 分派（本测试全程零真网络）
const fetchCalls = [];
global.fetch = async (url) => {
  const u = String(url);
  fetchCalls.push(u);
  if (u === SITE) return res(200, SITE_BODY);
  if (u.startsWith('https://r.jina.ai/')) return res(500, 'dead upstream');
  return res(200, '');
};

async function main() {
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');
  const dfs = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
  const { hasIndependentWebsite } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const { getConfig } = await import('../src/narrative/engine/config.mjs');
  const { CachedFetcher } = await import('../src/narrative/db/ExternalResourceCache.mjs');

  // 缓存层直透（零 DB；只测 data-fetch-service 真析逻辑）
  CachedFetcher.fetchWithCache = (_url, _rt, fn) => fn();

  // ═══ A. fetchTweetLinks（开关关默认配置）═══
  console.log('══ A. fetchTweetLinks：t.co 展开保留 + 内容抓去除 ═══');
  {
    const expands = [];
    TwitterFetcher.expandShortUrl = async (shortUrl) => {
      expands.push(shortUrl);
      return 'https://project-UnitTest.example.com/deep/page';
    };
    fetchCalls.length = 0;
    const tweetInfo = {
      text: 'check https://project-UnitTest.example.com and https://t.co/AbCdEf1234 now',
    };
    const r = await TwitterFetcher.fetchTweetLinks(tweetInfo);

    assert(r === null, 'A1 无链接内容可取 → null（websiteInfo 缺省同形状）');
    assert(expands.length === 1 && expands[0] === 'https://t.co/AbCdEf1234',
      'A2 t.co 展开保留（pubProxy J1.18 域名判据/URL 分类实体的上游）', JSON.stringify(expands));
    assert(tweetInfo.expanded_urls?.length === 1
      && tweetInfo.expanded_urls[0].short === 'https://t.co/AbCdEf1234'
      && tweetInfo.expanded_urls[0].expanded === 'https://project-UnitTest.example.com/deep/page',
      'A3 expanded_urls 挂载保留（twitter-section 渲染消费点）', JSON.stringify(tweetInfo.expanded_urls));
    assert(fetchCalls.length === 0,
      'A4 零网站内容抓取（推文内普通网站 URL 不发起任何 HTTP；C115 兜底不触及推文链接层）', JSON.stringify(fetchCalls));
  }

  // ═══ B. 开关关 + 纯 website 语料票（CZ4 现场形状）═══
  console.log('══ B. 纯 website 语料票：C115 兜底抓取发生 ═══');
  {
    // 纯 website 票：twitter 等其余桶全空、无任何平台语料可得
    TwitterFetcher.fetchFromUrls = async () => null;
    TwitterFetcher.enrichWithLinkContent = async (info) => info;
    fetchCalls.length = 0;
    const classifiedUrls = {
      ...EMPTY_BUCKETS,
      websites: [{ url: SITE, type: 'website' }],
    };
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(!!r.websiteInfo?.content && r.websiteInfo.content.length > 50,
      'B1 websiteInfo 进 results（>50 字真内容——该票唯一语料源）', JSON.stringify(r.websiteInfo && r.websiteInfo.content?.length));
    assert(r.dataFetchResults?.website?.corpusFallback === true,
      'B2 dataFetchResults.website.corpusFallback=true（additive 审计标记，与 enabled 路径可区分）', JSON.stringify(r.dataFetchResults?.website));
    assert(fetchCalls.includes(SITE),
      'B3 兜底真抓该 URL（直抓成功一次）', JSON.stringify(fetchCalls));
    assert(r.classifiedUrls === classifiedUrls, 'B4 classifiedUrls 原样带出（websites 桶 URL 分类不受影响）');
  }

  // ═══ B'. 开关关 + 有 twitter 语料在手：提速语义保留 ═══
  console.log("══ B'. 有 twitter 语料在手：开关关 = 零抓取（提速裁定保留）═══");
  {
    fetchCalls.length = 0;
    const classifiedUrls = {
      ...EMPTY_BUCKETS,
      twitter: [{ url: 'https://x.com/someone/status/123', type: 'tweet' }],
      websites: [{ url: SITE, type: 'website' }],
    };
    TwitterFetcher.fetchFromUrls = async () => ({ type: 'tweet', text: 'real corpus tweet about the token', author_screen_name: 'someone' });
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(!!r.twitterInfo?.text, "B'1 twitter 语料在手（前提成立）");
    assert(!r.websiteInfo, "B'2 websiteInfo 缺省（有其它语料在手不兜底）");
    assert(!r.dataFetchResults?.website, "B'3 无 website 抓取记录（提速语义原样保留）", JSON.stringify(r.dataFetchResults?.website));
    assert(fetchCalls.length === 0, "B'4 零真 HTTP", JSON.stringify(fetchCalls));
  }

  // ═══ C. hasIndependentWebsite 门不变（级联面锁）═══
  console.log('══ C. shouldCollectAccounts 门上游判据 ═══');
  {
    const withSite = { ...EMPTY_BUCKETS, websites: [{ url: 'https://project-UnitTest.example.com' }] };
    assert(hasIndependentWebsite(withSite) === true,
      'C1 websites 桶有独立域 URL → 门开（URL 域名判据，与内容抓取无关——抓取开关不改链触发语义）');
    assert(hasIndependentWebsite({ ...EMPTY_BUCKETS }) === false, 'C2 空桶 → 门关');
  }

  // ═══ D. 源码口径 ═══
  console.log('══ D. 源码口径 ═══');
  {
    const dfsSrc = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    assert(dfsSrc.includes("if ((getConfig().websiteFetch || {}).enabled !== true) return;"),
      'D1 runWebsite 桶内守卫（缺段/键缺/false 桶内跳过；回滚=配置 true）');
    // 守卫先于桶内任何抓取动作（fetchWebsiteCorpusOnce 调用点在守卫后）
    const runSiteStart = dfsSrc.indexOf('const runWebsite = async () => {');
    const guardIdx = dfsSrc.indexOf("if ((getConfig().websiteFetch || {}).enabled !== true) return;");
    const bucketFetchIdx = dfsSrc.indexOf('await fetchWebsiteCorpusOnce();');
    assert(runSiteStart > -1 && guardIdx > runSiteStart && bucketFetchIdx > guardIdx,
      'D2 守卫先于桶内抓取动作（fetchWebsiteCorpusOnce 单点共用）');

    // C115 兜底段：位置在 allSettled 之后、判定键集、标记
    const allSettledIdx = dfsSrc.indexOf('await Promise.allSettled([');
    const fbGateIdx = dfsSrc.indexOf('&& CORPUS_FALLBACK_INFO_KEYS.every(k => results[k] == null)');
    const fbFetchIdx = dfsSrc.lastIndexOf('await fetchWebsiteCorpusOnce();');
    const markerIdx = dfsSrc.indexOf('dataFetchResults.website.corpusFallback = true;');
    assert(allSettledIdx > -1 && fbGateIdx > allSettledIdx && fbFetchIdx > fbGateIdx && markerIdx > fbFetchIdx,
      'D3 C115 兜底段在 allSettled 后（全平台语料落空才判），标记在抓取后落');
    // 键集：12 个非 website Info 键，不含 websiteInfo/fetchErrors（兜底判定的「全平台语料」）
    const keysMatch = dfsSrc.match(/const CORPUS_FALLBACK_INFO_KEYS = \[([\s\S]*?)\];/);
    const keys = keysMatch ? keysMatch[1].match(/'(\w+)'/g)?.map(s => s.slice(1, -1)) : null;
    assert(keys !== null && keys.length === 12 && !keys.includes('websiteInfo')
      && keys.includes('twitterInfo') && keys.includes('binanceSquareInfo'),
      'D4 判定键集=12 个 <x>Info（websiteInfo 自身不在集内）', JSON.stringify(keys));
    // enabled=true 时兜底不重跑（互斥门）
    const fbGateCount = (dfsSrc.match(/\(getConfig\(\)\.websiteFetch \|\| \{\}\)\.enabled !== true/g) || []).length;
    assert(fbGateCount >= 2,
      'D5 兜底门与桶内门同形同读（enabled=true 时桶内已抓，兜底不重跑）', String(fbGateCount));

    const tf = src('src/narrative/utils/twitter-fetcher.mjs');
    assert(tf.includes("const websiteEnabled = (getConfig().websiteFetch || {}).enabled === true;"),
      'D6 fetchTweetLinks 开关读取形状');
    const tcoIdx = tf.indexOf("if (url.includes('t.co/'))");
    const fetchableIdx = tf.indexOf('if (!isFetchableUrl(url))');
    const guardIdx2 = tf.indexOf('if (!websiteEnabled) continue;');
    const fetchContentIdx = tf.indexOf('const linkContent = await fetchWebsiteContent(url');
    assert(tcoIdx > -1 && fetchableIdx > -1 && guardIdx2 > -1 && fetchContentIdx > -1
      && tcoIdx < guardIdx2 && fetchableIdx < guardIdx2 && guardIdx2 < fetchContentIdx,
      'D7 守卫判定位置：t.co 展开（continue 在守卫前=不受影响）→ isFetchableUrl → websiteEnabled → fetchWebsiteContent');

    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/narrative-engine.json'), 'utf8'));
    assert(cfg.websiteFetch?.enabled === false,
      'D8 配置默认 false（键缺省同义；C115 兜底是代码行为不受此键关闭）');
  }

  // ═══ E. C115 边界矩阵 ═══
  console.log('══ E. C115 边界矩阵 ═══');
  {
    // E1 twitter URL 在但抓空（fetchFromUrls null=抓取失败形状）→ 「不能获取」含失败，兜底仍触发
    fetchCalls.length = 0;
    TwitterFetcher.fetchFromUrls = async () => null;
    const r1 = await dfs.fetchDataSequentially({
      ...EMPTY_BUCKETS,
      twitter: [{ url: 'https://x.com/someone/status/456', type: 'tweet' }],
      websites: [{ url: SITE, type: 'website' }],
    }, { address: '0xt', symbol: 'TST' }, {});
    assert(!r1.twitterInfo && r1.websiteInfo?.content?.length > 50 && r1.dataFetchResults?.website?.corpusFallback === true,
      'E1 twitter 抓取失败形状 → 兜底仍触发（全 <x>Info null 同形状判定）', JSON.stringify({ tw: !!r1.twitterInfo, fb: r1.dataFetchResults?.website?.corpusFallback }));

    // E2 websites 桶空 → 无从兜底
    fetchCalls.length = 0;
    const r2 = await dfs.fetchDataSequentially({
      ...EMPTY_BUCKETS,
      twitter: [{ url: 'https://x.com/someone/status/789', type: 'tweet' }],
    }, { address: '0xt', symbol: 'TST' }, {});
    assert(!r2.websiteInfo && !r2.dataFetchResults?.website && fetchCalls.length === 0,
      'E2 websites 桶空 → 零抓取（该形状归 C77 搜索兜底域，与 C115 无交集）', JSON.stringify(fetchCalls));

    // E3 websites URL 不可抓形状（DEX 交易页）→ 不兜底
    fetchCalls.length = 0;
    const r3 = await dfs.fetchDataSequentially({
      ...EMPTY_BUCKETS,
      websites: [{ url: 'https://pancakeswap.finance/swap?outputCurrency=0xt', type: 'website' }],
    }, { address: '0xt', symbol: 'TST' }, {});
    assert(!r3.websiteInfo && !r3.dataFetchResults?.website && fetchCalls.length === 0,
      'E3 不可抓 URL（isFetchableUrl 排除形状）→ 零抓取', JSON.stringify(fetchCalls));

    // E4 enabled=true → 桶内照旧抓（并行桶），record 无 corpusFallback 标记
    {
      const cfg = getConfig();
      const prev = cfg.websiteFetch;
      cfg.websiteFetch = { enabled: true };
      try {
        fetchCalls.length = 0;
        const r4 = await dfs.fetchDataSequentially({
          ...EMPTY_BUCKETS,
          websites: [{ url: SITE, type: 'website' }],
        }, { address: '0xt', symbol: 'TST' }, {});
        assert(r4.websiteInfo?.content?.length > 50 && r4.dataFetchResults?.website?.corpusFallback !== true,
          'E4 enabled=true → 桶内抓取照旧 + 无 corpusFallback 标记（两路径可区分）', JSON.stringify(r4.dataFetchResults?.website));
      } finally {
        cfg.websiteFetch = prev;
      }
    }

    // E5 死站（直抓+jina 回退全失败）→ fail-closed null，与「网站抓取失败」旧形状一致
    {
      fetchCalls.length = 0;
      const r5 = await dfs.fetchDataSequentially({
        ...EMPTY_BUCKETS,
        websites: [{ url: 'https://dead-site-unittest.example.com', type: 'website' }],
      }, { address: '0xt', symbol: 'TST' }, {});
      const rec = r5.dataFetchResults?.website;
      assert(!r5.websiteInfo && rec?.corpusFallback === true && rec?.success === true,
        'E5 死站 → websiteInfo null（fail-closed）+ 兜底尝试留痕（与 enabled 路径死站同形状：success=true data=null）', JSON.stringify(rec));
    }
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
