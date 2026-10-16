#!/usr/bin/env node
/**
 * precheck 规则 2.1 expired_tweet 分桶单测（C74 啾啾案配套）——零 DB 零网络
 *
 *   C74（2026-10-16 用户裁定，0x21bfeeddb550e3e84d3c9783523e1153e19a7777）：
 *   时效硬拦迁入叙事引擎——非豁免桶（classifyTweetType ∈ {angle_seeking,
 *   interpretive_reply, unknown}）窗 6h→300s（relocate 买腿 narrativeCorpusLagSec
 *   < 300 门；边界对齐旧买门秒粒度 <，300 整拦）；豁免桶（direct_tweet：粉≥5000
 *   或 赞≥500 或 转≥100——高影响力用户的新闻推文）跳过硬拦交 Jev event_timing
 *   软评。config 键 expiredTweetMinutesThreshold 废止删除。
 *
 * 节：
 *   A.  啾啾现场豁免：417k 粉/88 赞/16 转（粉丝臂豁免，赞转双不足证伪互动臂）
 *       lag 8.8h → 放行（null，全链穿过规则 4）
 *   A'. 现场反证（铁律）：同 A 只改粉丝 1500（落 angle_seeking 桶）→ expired_tweet
 *       kill + details.tweetType/freshWindowSec——翻转来自分桶非窗变宽
 *   B.  边界三元组：非豁免 lag=299/300/301s → 放/拦/拦（旧买门 < 300 口径）
 *   C1. 回归锚：非豁免 lag=2h（旧 precheck 6h 放、旧买门拦）→ 拦
 *   C2. interpretive_reply（in_reply_to 挂大IP）lag=2h → 拦
 *   C3. unknown 中间地带（3000 粉/200 赞/50 转）lag=2h → 拦
 *   D.  负 lag（推文晚于锚 60s，宣告竞态）→ 放
 *   E.  website_tweet 任一新即活（主推 stale+website 新 / 对称）→ 放
 *   F.  豁免桶互动臂（4500 粉/600 赞）lag=7d/30d → 放（无硬界）
 *   G.  account 型语料 → 规则 2.1 整体跳过（分支 A 放宽语义）
 *   H.  ignoreExpired=true + 非豁免 lag=8h → 规则 2 整体跳过（原语义不变）
 *   I.  源码口径防回流：classifyTweetType import / 常量=300 / `<` 方向 /
 *       expiredTweetMinutesThreshold 三处零残留 / mapper 纵深防御保留
 *
 * 用法：node scripts/_test_precheck_tweet_freshness_bucket.cjs
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

// 假 supabase（q58 等查询空回；规则 0.55/0.7 前置不满足零发）
const supabaseStub = {
  from() {
    const chain = {};
    for (const m of ['select', 'eq', 'neq', 'lt', 'gte', 'in', 'contains', 'order', 'limit']) {
      chain[m] = () => chain;
    }
    chain.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return chain;
  },
};

const ANCHOR_SEC = 1759000000; // 代币创建锚（wss 行 tokenCreatedAtSec 口径）
const iso = (sec) => new Date(sec * 1000).toISOString();

// 非豁免桶推文形状（angle_seeking 条件 B：1500<2000 粉 且 88<100 赞 且 16<20 转）
const angleTweet = (lagSec) => ({
  type: 'tweet',
  text: 'unit test angle tweet text',
  author_screen_name: 'ut_angle_author',
  author_followers_count: 1500,
  metrics: { favorite_count: 88, retweet_count: 16 },
  created_at: iso(ANCHOR_SEC - lagSec),
});

async function run(tokenData, twitterInfo, options = {}) {
  const { performPreCheck } = run._mod;
  return performPreCheck(tokenData, twitterInfo, null, null,
    { twitter: ['https://x.com/ut_angle_author/status/1'] }, {}, null, null, options);
}

async function main() {
  const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
  repoMod.NarrativeRepository.getSupabase = () => supabaseStub;
  run._mod = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  // 基底 tokenData：短 symbol/name 过规则 0；无 appendix/raw_api_data → q55/q70 零发；
  // classifiedUrls.twitter + 有 text twitterInfo 穿过规则 4 → 放行用例终态 null
  const makeTokenData = () => ({
    address: '0xUnitTestC74Token1234567890abcdef12',
    symbol: 'UTEST',
    name: 'Unit Test Token',
    tokenCreatedAtSec: ANCHOR_SEC,
  });

  // ═══ A / A'. 啾啾现场豁免 vs 现场反证 ═══
  console.log('══ A. 啾啾现场豁免（417k 粉新闻推 lag 8.8h）══');
  {
    // 现场形状：@KarluskaP 41.7 万粉 verified 新闻转发推，88 赞/16 转（互动双不足
    // → 豁免只能来自粉丝臂，证伪互动臂混入）；作者名用合成名防名单耦合
    const newsTweet = {
      type: 'tweet',
      text: 'BREAKING: unit test news tweet text',
      author_screen_name: 'ut_news_author',
      author_followers_count: 417000,
      metrics: { favorite_count: 88, retweet_count: 16 },
      created_at: iso(ANCHOR_SEC - 8.8 * 3600),
    };
    const rA = await run(makeTokenData(), newsTweet);
    assert(rA === null,
      'A1 高粉新闻推 lag 8.8h 豁免放行（null=全链穿过规则 4；旧 6h 窗下必拦）',
      JSON.stringify(rA?.details?.ruleName));

    console.log('══ A\'. 现场反证：同形状只改粉丝 1500 → 落 angle_seeking 拦 ══');
    const clone = JSON.parse(JSON.stringify(newsTweet));
    clone.author_followers_count = 1500;
    const rA2 = await run(makeTokenData(), clone);
    assert(rA2?.details?.ruleName === 'expired_tweet',
      'A\'1 粉丝 1500（angle_seeking 桶）lag 8.8h → expired_tweet kill——翻转来自分桶非窗变宽',
      JSON.stringify(rA2?.details?.ruleName));
    assert(rA2?.details?.tweetType === 'angle_seeking',
      'A\'2 details.tweetType 落桶名', String(rA2?.details?.tweetType));
    assert(rA2?.details?.freshWindowSec === 300,
      'A\'3 details.freshWindowSec=300（窗宽审计键）', String(rA2?.details?.freshWindowSec));
    assert(rA2?.rating === 'low' && rA2?.pass === false, 'A\'4 low 终判（一票否决语义不变）');
  }

  // ═══ B. 边界三元组（旧买门 < 300 秒粒度口径）═══
  console.log('══ B. 边界 299/300/301s ═══');
  {
    const r299 = await run(makeTokenData(), angleTweet(299));
    assert(r299 === null, 'B1 lag=299s 放（< 300）', JSON.stringify(r299?.details?.ruleName));
    const r300 = await run(makeTokenData(), angleTweet(300));
    assert(r300?.details?.ruleName === 'expired_tweet', 'B2 lag=300s 拦（300 整拦，旧买门口径）',
      JSON.stringify(r300?.details?.ruleName));
    const r301 = await run(makeTokenData(), angleTweet(301));
    assert(r301?.details?.ruleName === 'expired_tweet', 'B3 lag=301s 拦',
      JSON.stringify(r301?.details?.ruleName));
  }

  // ═══ C1-C3. 非豁免三桶回归锚 ═══
  console.log('══ C1. angle_seeking lag=2h（旧 precheck 6h 放、旧买门拦）══');
  {
    const r = await run(makeTokenData(), angleTweet(2 * 3600));
    assert(r?.details?.ruleName === 'expired_tweet',
      'C1 拦（301s~6h 区间从「precheck 放、买门拦」变「评级直接 low」）',
      JSON.stringify(r?.details?.ruleName));
    assert(r?.details?.tweetType === 'angle_seeking', 'C1b tweetType 落桶名');
  }
  console.log('══ C2. interpretive_reply（in_reply_to 挂大IP）lag=2h ═══');
  {
    const replyTweet = {
      ...angleTweet(2 * 3600),
      in_reply_to: { author_screen_name: 'elonmusk', author_followers_count: 200000000 },
    };
    const r = await run(makeTokenData(), replyTweet);
    assert(r?.details?.ruleName === 'expired_tweet' && r?.details?.tweetType === 'interpretive_reply',
      'C2 回复大IP推 lag=2h 拦（interpretive_reply 桶）',
      JSON.stringify(r?.details?.ruleName) + '/' + String(r?.details?.tweetType));
  }
  console.log('══ C3. unknown 中间地带（3000 粉/200 赞/50 转）lag=2h ═══');
  {
    const midTweet = {
      ...angleTweet(2 * 3600),
      author_followers_count: 3000,
      metrics: { favorite_count: 200, retweet_count: 50 },
    };
    const r = await run(makeTokenData(), midTweet);
    assert(r?.details?.ruleName === 'expired_tweet' && r?.details?.tweetType === 'unknown',
      'C3 中间地带 lag=2h 拦（unknown 兜底桶=字段缺失偏拦 fail-safe）',
      JSON.stringify(r?.details?.ruleName) + '/' + String(r?.details?.tweetType));
  }

  // ═══ D. 负 lag（宣告竞态：推文晚于锚）═══
  console.log('══ D. 负 lag ═══');
  {
    const r = await run(makeTokenData(), angleTweet(-60));
    assert(r === null, 'D1 推文晚于锚 60s → 放（< 300 恒真，宣告竞态语义不变）',
      JSON.stringify(r?.details?.ruleName));
  }

  // ═══ E. website_tweet 任一新即活 ═══
  console.log('══ E. 多源任一新即活（四源口径不变）══');
  {
    const stale = iso(ANCHOR_SEC - 8 * 3600);
    const fresh = iso(ANCHOR_SEC - 60);
    const r1 = await run(makeTokenData(), { ...angleTweet(8 * 3600), website_tweet: { type: 'tweet', created_at: fresh } });
    assert(r1 === null, 'E1 主推 stale 8h + website_tweet 新 60s → 放',
      JSON.stringify(r1?.details?.ruleName));
    const r2 = await run(makeTokenData(), { ...angleTweet(60), website_tweet: { type: 'tweet', created_at: stale } });
    assert(r2 === null, 'E2 主推新 60s + website_tweet stale 8h → 放（对称）',
      JSON.stringify(r2?.details?.ruleName));
    // 豁免是语料级：主推 direct_tweet + website_tweet 30 天旧也放（时效全交 Jev）
    const r3 = await run(makeTokenData(), {
      type: 'tweet', text: 'unit test news tweet text',
      author_screen_name: 'ut_news_author', author_followers_count: 417000,
      metrics: { favorite_count: 88, retweet_count: 16 },
      created_at: iso(ANCHOR_SEC - 30 * 24 * 3600),
      website_tweet: { type: 'tweet', created_at: stale },
    });
    assert(r3 === null, 'E3 主推 direct_tweet 30 天 + website_tweet 8h 旧 → 放（豁免语料级）',
      JSON.stringify(r3?.details?.ruleName));
  }

  // ═══ F. 豁免桶互动臂无硬界 ═══
  console.log('══ F. 互动臂豁免（4500 粉/600 赞）7d/30d ═══');
  {
    const viralTweet = (lagSec) => ({
      type: 'tweet',
      text: 'unit test viral tweet text',
      author_screen_name: 'ut_viral_author',
      author_followers_count: 4500, // < 5000 粉丝臂不触发 → 豁免只能来自赞≥500 互动臂
      metrics: { favorite_count: 600, retweet_count: 50 },
      created_at: iso(ANCHOR_SEC - lagSec),
    });
    const r7d = await run(makeTokenData(), viralTweet(7 * 24 * 3600));
    assert(r7d === null, 'F1 互动臂 lag=7d 放（无硬界，Jev 软评）', JSON.stringify(r7d?.details?.ruleName));
    const r30d = await run(makeTokenData(), viralTweet(30 * 24 * 3600));
    assert(r30d === null, 'F2 互动臂 lag=30d 放', JSON.stringify(r30d?.details?.ruleName));
  }

  // ═══ G. account 型语料（分支 A 放宽）═══
  console.log('══ G. account 型 ═══');
  {
    const account = { type: 'account', screen_name: 'ut_account_author', followers_count: 1000 };
    const r = await run(makeTokenData(), account);
    assert(r === null, 'G1 account 型规则 2.1 整体跳过（无锚语料接受放宽，评级 2/3 即可买）',
      JSON.stringify(r?.details?.ruleName));
  }

  // ═══ H. ignoreExpired 穿透（原语义不变）═══
  console.log('══ H. ignoreExpired=true ═══');
  {
    const r = await run(makeTokenData(), angleTweet(8 * 3600), { ignoreExpired: true });
    assert(r === null, 'H1 ignoreExpired 跳过规则 2 整段（web 重析穿透；C68 mapper 6h 纵深防御兜 angle 类）',
      JSON.stringify(r?.details?.ruleName));
  }

  // ═══ I. 源码口径（锁防线）═══
  console.log('══ I. 源码口径 ═══');
  {
    const pcs = src('src/narrative/analyzer/services/pre-check-service.mjs');
    assert(pcs.includes("import { classifyTweetType } from './tweet-type-classifier.mjs';"),
      'I1 pre-check-service import classifyTweetType');
    assert(pcs.includes('const NON_EXEMPT_TWEET_FRESH_SEC = 300;'),
      'I2 常量=300（relocate 旧买门口径）');
    assert(pcs.includes('lagSec < NON_EXEMPT_TWEET_FRESH_SEC'),
      'I3 放行方向 `<`（300 整拦，秒粒度——旧 precheck 分钟 <= 已废）');
    assert(!pcs.includes('expiredTweetMinutesThreshold'),
      'I4 pre-check-service 零 expiredTweetMinutesThreshold 残留');
    const na = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    assert(!na.includes('expiredTweetMinutesThreshold'),
      'I5 NarrativeAnalyzer 死 fallback 键已删');
    const cfg = src('config/default.json');
    assert(!cfg.includes('expiredTweetMinutesThreshold'),
      'I6 config/default.json 无该键（本就未设，防回流）');
    const mapper = src('src/narrative/analyzer/llm/jev-result-mapper.mjs');
    assert(mapper.includes('const ANGLE_TWEET_STALE_SEC = 6 * 3600;') && mapper.includes('overrideAngleTiming'),
      'I7 C68 mapper 6h 纵深防御保留（ignoreExpired 穿透/锚缺失/缓存残例兜底）');
    assert(pcs.includes("'expired_tweet'"),
      "I8 ruleName 保持 'expired_tweet'（历史行/监控口径连续）");
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
