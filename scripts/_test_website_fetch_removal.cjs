#!/usr/bin/env node
/**
 * website 内容抓取去除单测（2026-10-13 叙事提速第二批 1C）——零 DB 零网络
 *
 * 用户裁定原话「网站内容现在就基本上没用到，我认为网站的信息下载是可以去除的」：
 * fetch.website 段（N1 实测 avg 3.8s / max 16.3s，12/47 票）整段退出临界路径。
 * 总开关 config/narrative-engine.json `websiteFetch.enabled` 默认 false（键缺省同义）；
 * 回滚 = 配置改 true 重启，无代码回滚。
 *
 * 范围界定（plan）：只砍 websites 桶内容抓取（runWebsite 桶）+ 推文链接内容抓取
 * （fetchTweetLinks→fetchWebsiteContent）；t.co 展开保留（pubProxy J1.18 域名判据 /
 * URL 分类实体 / twitter-section 渲染吃 expanded_urls）；URL 分类与
 * hasIndependentWebsite（只看 URL 域名）不受影响 → shouldCollectAccounts 门不变。
 *
 * 节：
 *   A. fetchTweetLinks 行为级（开关关）：t.co 展开保留+挂载 expanded_urls、
 *      普通网站 URL 零抓取（global fetch 零调用）、返回 null
 *   B. fetchDataSequentially websites 桶行为级（开关关）：runWebsite 首行 return、
 *      websiteInfo 缺省、classifiedUrls 原样带出、零 fetch
 *   C. hasIndependentWebsite 门不变：websites 桶 URL 域名判据（与内容抓取无关）
 *   D. 源码口径：runWebsite 守卫 / websiteEnabled 读取形状与判定位置（isFetchableUrl
 *      后、fetchWebsiteContent 前）/ t.co 展开段在守卫前 / 配置默认 false
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

// global fetch 桩：记录一切真 HTTP（本测试断言「零」——开关关不得有任何网络）
const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return { ok: true, status: 200, headers: new Map(), text: async () => '' };
};

async function main() {
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');
  const dfs = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
  const { hasIndependentWebsite } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');

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
      'A4 零网站内容抓取（普通网站 URL 不发起任何 HTTP；开关关守卫）', JSON.stringify(fetchCalls));
  }

  // ═══ B. fetchDataSequentially websites 桶（开关关默认配置）═══
  console.log('══ B. websites 桶：runWebsite 首行 return ═══');
  {
    fetchCalls.length = 0;
    const classifiedUrls = {
      ...EMPTY_BUCKETS,
      websites: [{ url: 'https://project-UnitTest.example.com', type: 'website' }],
    };
    const r = await dfs.fetchDataSequentially(classifiedUrls, { address: '0xt', symbol: 'TST' }, {});
    assert(!r.websiteInfo, 'B1 websiteInfo 缺省（消费点零改动：与「网站抓取失败」同形状）');
    assert(fetchCalls.length === 0, 'B2 零真 HTTP（jina 回退等整链不触发）', JSON.stringify(fetchCalls));
    assert(r.classifiedUrls === classifiedUrls, 'B3 classifiedUrls 原样带出（websites 桶 URL 分类不受影响）');
  }

  // ═══ C. hasIndependentWebsite 门不变（级联面锁）═══
  console.log('══ C. shouldCollectAccounts 门上游判据 ═══');
  {
    const withSite = { ...EMPTY_BUCKETS, websites: [{ url: 'https://project-UnitTest.example.com' }] };
    assert(hasIndependentWebsite(withSite) === true,
      'C1 websites 桶有独立域 URL → 门开（URL 域名判据，与内容抓取无关——抓取去除不改链触发语义）');
    assert(hasIndependentWebsite({ ...EMPTY_BUCKETS }) === false, 'C2 空桶 → 门关');
  }

  // ═══ D. 源码口径 ═══
  console.log('══ D. 源码口径 ═══');
  {
    const dfsSrc = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    assert(dfsSrc.includes("if ((getConfig().websiteFetch || {}).enabled !== true) return;"),
      'D1 runWebsite 首行守卫（缺段/键缺/false 全跳过；回滚=配置 true）');
    // runWebsite 守卫在 selectFirstUrl/recordDataFetch 之前（零副作用早退）
    const runSiteStart = dfsSrc.indexOf('const runWebsite = async () => {');
    const guardIdx = dfsSrc.indexOf("if ((getConfig().websiteFetch || {}).enabled !== true) return;");
    const selectIdx = dfsSrc.indexOf("const websiteUrlInfo = selectFirstUrl('websites');");
    assert(runSiteStart > -1 && guardIdx > runSiteStart && guardIdx < selectIdx,
      'D2 守卫先于桶内任何取 URL 动作');

    const tf = src('src/narrative/utils/twitter-fetcher.mjs');
    assert(tf.includes("const websiteEnabled = (getConfig().websiteFetch || {}).enabled === true;"),
      'D3 fetchTweetLinks 开关读取形状');
    const tcoIdx = tf.indexOf("if (url.includes('t.co/'))");
    const fetchableIdx = tf.indexOf('if (!isFetchableUrl(url))');
    const guardIdx2 = tf.indexOf('if (!websiteEnabled) continue;');
    const fetchContentIdx = tf.indexOf('const linkContent = await fetchWebsiteContent(url');
    assert(tcoIdx > -1 && fetchableIdx > -1 && guardIdx2 > -1 && fetchContentIdx > -1
      && tcoIdx < guardIdx2 && fetchableIdx < guardIdx2 && guardIdx2 < fetchContentIdx,
      'D4 守卫判定位置：t.co 展开（continue 在守卫前=不受影响）→ isFetchableUrl → websiteEnabled → fetchWebsiteContent');

    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/narrative-engine.json'), 'utf8'));
    assert(cfg.websiteFetch?.enabled === false,
      'D5 配置默认 false（键缺省同义；182 无需配置变更即生效）');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
