#!/usr/bin/env node
/**
 * apidance url_entities 透传单测（2026-10-13 叙事提速第二批 2c）——零 DB 零网络
 *
 * 背景：GraphQL/TweetDetail 的 entities.urls 自带 (t.co 短链, 终链) 对，但
 * new-apis.js 组装 urls 只留 expanded 丢短链 → fetchTweetLinks 只能对 text 正则
 * 抓到的 t.co 逐条 HEAD 展开（每条 5s 超时，死链 N×5s 白付）。
 *
 * 改动：①new-apis.js tweetDetail 增 url_entities 原始对；②twitter-fetcher
 * result 组装透传；③fetchTweetLinks t.co 分支优先 pair（命中零 HTTP），缺项
 * （旧缓存行/实体缺失/text 尾标点致不匹配）回退 HEAD = 现状行为。
 *
 * 节：
 *   A. pair 命中：expandShortUrl 零调用、expanded_urls 挂 pair 终链
 *   B. pair 缺项回退：HEAD 展开 1 次（尾标点不匹配场景）
 *   C. 无 url_entities（旧缓存行形状）→ 全回退 HEAD（现状等价）
 *   D. pair 终链为推文 → expanded_tweet_url 标记（既有逻辑在 pair 路径生效）
 *   E. 源码口径：new-apis.js 映射形状 / result 透传 / pair 优先形状
 *
 * 用法：node scripts/_test_twitter_urls_expansion.cjs
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

// global fetch 桩：断言零真 HTTP（pair 命中路径不落地任何网络调用）
const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return { ok: true, status: 200, headers: new Map(), text: async () => '' };
};

async function main() {
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');

  // expandShortUrl 覆写：记录调用（pair 命中时应为零）
  let expandCalls = [];
  TwitterFetcher.expandShortUrl = async (shortUrl) => {
    expandCalls.push(shortUrl);
    return 'https://fallback-unit-test.example.com/from-head';
  };

  // ═══ A. pair 命中：零 HEAD、挂 pair 终链 ═══
  console.log('══ A. pair 命中（零 HTTP 展开）══');
  {
    expandCalls = []; fetchCalls.length = 0;
    const tweetInfo = {
      text: 'launch now https://t.co/PairHit1 and https://plain.example.com/page',
      url_entities: [
        { url: 'https://t.co/PairHit1', expanded_url: 'https://target-unit-test.example.com/deep' },
      ],
    };
    const r = await TwitterFetcher.fetchTweetLinks(tweetInfo);

    assert(expandCalls.length === 0, 'A1 expandShortUrl 零调用（pair 命中免 HEAD——原版每条 5s 超时风险）',
      JSON.stringify(expandCalls));
    assert(fetchCalls.length === 0, 'A2 零真 HTTP（websiteFetch 默认关 + pair 路径无网络）');
    assert(tweetInfo.expanded_urls?.length === 1
      && tweetInfo.expanded_urls[0].short === 'https://t.co/PairHit1'
      && tweetInfo.expanded_urls[0].expanded === 'https://target-unit-test.example.com/deep',
      'A3 expanded_urls 挂 pair 终链（pubProxy J1.18/URL 分类/twitter-section 渲染消费点形状不变）',
      JSON.stringify(tweetInfo.expanded_urls));
    assert(r === null, 'A4 返回 null（无链接内容可取——内容抓取已去除）');
  }

  // ═══ B. pair 缺项回退 HEAD（尾标点不匹配）═══
  console.log('══ B. pair 缺项回退 HEAD ═══');
  {
    expandCalls = []; fetchCalls.length = 0;
    const tweetInfo = {
      text: 'check this https://t.co/NoPair99.', // 尾句点 → text 抓到带标点形态，pair 严格等值不匹配
      url_entities: [
        { url: 'https://t.co/NoPair99', expanded_url: 'https://unused.example.com' },
      ],
    };
    await TwitterFetcher.fetchTweetLinks(tweetInfo);
    assert(expandCalls.length === 1 && expandCalls[0] === 'https://t.co/NoPair99.',
      'B1 缺项回退 HEAD 恰 1 次（现状行为等价——text 尾标点形态原样进 expandShortUrl）',
      JSON.stringify(expandCalls));
    assert(tweetInfo.expanded_urls?.length === 1
      && tweetInfo.expanded_urls[0].short === 'https://t.co/NoPair99.',
      'B2 回退结果照常挂载');
  }

  // ═══ C. 无 url_entities（旧缓存行）→ 全回退 ═══
  console.log('══ C. 旧缓存行形状（无 url_entities）══');
  {
    expandCalls = []; fetchCalls.length = 0;
    const tweetInfo = { text: 'old cache row https://t.co/Legacy01' };
    await TwitterFetcher.fetchTweetLinks(tweetInfo);
    assert(expandCalls.length === 1 && expandCalls[0] === 'https://t.co/Legacy01',
      'C1 无 pair 字段 → 全回退 HEAD（缓存行自然过期前现状等价）', JSON.stringify(expandCalls));
  }

  // ═══ D. pair 终链为推文 → expanded_tweet_url 标记 ═══
  console.log('══ D. 展开为推文链接的标记路径 ═══');
  {
    expandCalls = []; fetchCalls.length = 0;
    const tweetInfo = {
      text: 'see https://t.co/TweetRef1',
      url_entities: [
        { url: 'https://t.co/TweetRef1', expanded_url: 'https://x.com/someone/status/999888777' },
      ],
    };
    await TwitterFetcher.fetchTweetLinks(tweetInfo);
    assert(tweetInfo.expanded_tweet_url === 'https://x.com/someone/status/999888777',
      'D1 pair 路径同样标记 expanded_tweet_url（第二推文获取链不受改动影响）',
      String(tweetInfo.expanded_tweet_url));
  }

  // ═══ E. 源码口径 ═══
  console.log('══ E. 源码口径 ═══');
  {
    const na = src('src/utils/twitter-validation/new-apis.js');
    assert(na.includes("url_entities: legacy.entities?.urls?.map(u => ({ url: u.url, expanded_url: u.expanded_url || u.url })) || [],"),
      'E1 new-apis.js tweetDetail 带 (t.co, 终链) 原始对（urls 既有 expanded-only 数组不动）');

    const tf = src('src/narrative/utils/twitter-fetcher.mjs');
    assert(tf.includes('url_entities: tweetData.url_entities || null,'),
      'E2 result 组装透传 url_entities');
    assert(tf.includes("const pair = (tweetInfo.url_entities || []).find(p => p && p.url === url);")
      && tf.includes('let expandedUrl = pair?.expanded_url || null;')
      && /if \(!expandedUrl\) \{\s*\n\s*console\.log\(`\[TwitterFetcher\] 展开t\.co短链接: \$\{url\}`\);\s*\n\s*expandedUrl = await this\.expandShortUrl\(url\);/.test(tf),
      'E3 fetchTweetLinks pair 优先 + 缺项回退 HEAD 形状');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
