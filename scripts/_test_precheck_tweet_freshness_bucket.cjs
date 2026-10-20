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
    // 豁免是语料级：主推 direct_tweet + website_tweet 30 天旧也放（时效全交 Jev）。
    // C104 后本形状=「源头旧(30d)+新载体(8h≤24h)」主从结构成立 → 仍放（Jean Phil
    // new_angle 臂同款：源头年龄交 C102/C103 父推窗在 Jev 层管）
    const r3 = await run(makeTokenData(), {
      type: 'tweet', text: 'unit test news tweet text',
      author_screen_name: 'ut_news_author', author_followers_count: 417000,
      metrics: { favorite_count: 88, retweet_count: 16 },
      created_at: iso(ANCHOR_SEC - 30 * 24 * 3600),
      website_tweet: { type: 'tweet', created_at: stale },
    });
    assert(r3 === null, 'E3 主推 direct_tweet 30 天 + website_tweet 8h 旧 → 放（C104 主从结构：载体 ≤24h 救回）',
      JSON.stringify(r3?.details?.ruleName));
  }

  // ═══ F. 豁免桶互动臂（C130 后：小作者裸旧推=第③类豁免；巨触达反证拦）═══
  console.log('══ F. 互动臂豁免（4500 粉/600 赞）══');
  {
    const viralTweet = (lagSec, followers = 4500) => ({
      type: 'tweet',
      text: 'unit test viral tweet text',
      author_screen_name: 'ut_viral_author',
      author_followers_count: followers, // 缺省 4500 < 5000 粉丝臂不触发 → 豁免只能来自赞≥500 互动臂
      metrics: { favorite_count: 600, retweet_count: 50 },
      created_at: iso(ANCHOR_SEC - lagSec),
    });
    // C130 第③类：互动臂小作者（4500 粉未收录）裸旧推 → 豁免交 Jev 软评
    // （C74 旧语义无硬界放 / C104 旧语义拦 / C130 起第③类豁免——三轮语义演进锚）
    const r7d = await run(makeTokenData(), viralTweet(7 * 24 * 3600));
    assert(r7d === null,
      'F1 互动臂 4500 粉 lag=7d 裸推 → 放（C130 第③类：触达有限用不烂；C104 旧语义拦）',
      JSON.stringify(r7d?.details));
    // 巨触达反证（C130「粉≥50万即拦」）：同形状作者 60 万粉 → 回落拦
    const r7dMega = await run(makeTokenData(), viralTweet(7 * 24 * 3600, 600000));
    assert(r7dMega?.details?.ruleName === 'expired_tweet' && r7dMega?.details?.tweetType === 'direct_tweet',
      'F1\' 互动臂 60 万粉 lag=7d 裸推 → 拦（触达量主轴：未收录巨粉旧推仍用烂形状）',
      JSON.stringify(r7dMega?.details));
    const r7dc = await run(makeTokenData(), { ...viralTweet(7 * 24 * 3600, 600000), website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - 13) } });
    assert(r7dc === null, 'F1\'\' 60 万粉 7d + website_tweet 13s 新载体 → 放（主从结构成立交 Jev 软评，载体臂与作者层级独立）',
      JSON.stringify(r7dc?.details?.ruleName));
    const r30d = await run(makeTokenData(), viralTweet(30 * 24 * 3600, 600000));
    assert(r30d?.details?.ruleName === 'expired_tweet',
      'F2 互动臂 60 万粉 lag=30d 裸推 → 拦（同 F1\'）', JSON.stringify(r30d?.details));
    const r30dq = await run(makeTokenData(), { ...viralTweet(30 * 24 * 3600, 600000), quoted_status: { created_at: iso(ANCHOR_SEC - 3600) } });
    assert(r30dq === null, 'F2\' 30d + quoted_status 1h 新 → 放（载体臂覆盖 quoted 槽位）',
      JSON.stringify(r30dq?.details?.ruleName));
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

  // ═══ K. C104 主从结构门（CZ 案 0x1890c934…7777，2026-10-19）═══
  console.log('══ K. C104 direct 豁免源头年龄界（主从结构判据）══');
  {
    const DAY = 24 * 3600;
    // CZ 现场形状：主推 1299 万粉官宣推 3.47d + website_tweet=同一条旧推（无新载体）
    const czLag = Math.round(3.47 * DAY);
    const czMain = {
      type: 'tweet', text: 'Freedom of Money unit test 官宣',
      author_screen_name: 'ut_cz_author', author_followers_count: 12997788,
      metrics: { favorite_count: 2064, retweet_count: 218 },
      created_at: iso(ANCHOR_SEC - czLag),
    };
    const rK1 = await run(makeTokenData(), { ...czMain, website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - czLag) } });
    assert(rK1?.details?.ruleName === 'expired_tweet' && rK1?.details?.tweetType === 'direct_tweet',
      'K1 CZ 现场反证：1299 万粉主推 3.47d + website 同条旧推 → 拦（主从结构缺失=用烂旧推）',
      JSON.stringify(rK1?.details));
    assert(rK1?.details?.staleDirectLagSec === czLag, 'K1b staleDirectLagSec 审计落值（回落形状）');
    // 载体救援臂（Jean Phil new_angle 形状：源头旧+载体新，关系归 Jev 层 C102/C103）
    const rK2 = await run(makeTokenData(), { ...czMain, website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - 13) } });
    assert(rK2 === null, 'K2 同形状 website_tweet 13s 新载体 → 放（C103 new_angle 臂同款）',
      JSON.stringify(rK2?.details?.ruleName));
    // 主推窗边界（严格 >，C102/C103 同口径）
    const rK3 = await run(makeTokenData(), { ...czMain, created_at: iso(ANCHOR_SEC - DAY) });
    assert(rK3 === null, 'K3 主推恰 24h（86400s）无载体 → 放（严格 >）',
      JSON.stringify(rK3?.details?.ruleName));
    const rK4 = await run(makeTokenData(), { ...czMain, created_at: iso(ANCHOR_SEC - DAY - 1) });
    assert(rK4?.details?.ruleName === 'expired_tweet', 'K4 主推 24h+1s 无载体 → 拦',
      JSON.stringify(rK4?.details?.ruleName));
    // 载体窗边界（≤ 窗算新鲜）
    const rK5 = await run(makeTokenData(), { ...czMain, website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - DAY) } });
    assert(rK5 === null, 'K5 主推 3.47d + 载体恰 24h → 放（载体 ≤ 窗）',
      JSON.stringify(rK5?.details?.ruleName));
    const rK6 = await run(makeTokenData(), { ...czMain, website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - DAY - 1) } });
    assert(rK6?.details?.ruleName === 'expired_tweet', 'K6 载体 24h+1s → 不算新载体 → 拦',
      JSON.stringify(rK6?.details?.ruleName));
    // 主推 created_at 缺失 fail-open（缺证据不拦）
    const rK7 = await run(makeTokenData(), { ...czMain, created_at: undefined, website_tweet: { type: 'tweet', created_at: iso(ANCHOR_SEC - 30 * DAY) } });
    assert(rK7 === null, 'K7 主推 created_at 缺失 → fail-open 豁免照旧',
      JSON.stringify(rK7?.details?.ruleName));
    // 源码口径锁
    const pcsK = src('src/narrative/analyzer/services/pre-check-service.mjs');
    assert(pcsK.includes('const DIRECT_TWEET_STALE_SEC = 24 * 3600;'), 'K8 常量 24h 源码锁');
    assert(pcsK.includes('function _tweetLagSec') && pcsK.includes('hasFreshCarrier'), 'K9 判定链源码锁');
  }

  // ═══ L. C120 interpretive_reply 巨粉豁免（f8ab/Burn N Burn 案）═══
  console.log('══ L. C120 interpretive_reply 巨粉豁免 ══');
  {
    const DAY = 24 * 3600;
    // f8ab 现场形状：BNB Chain 官推 389 万粉回复 cz_binance（registry 命中 →
    // 优先级 1 interpretive_reply，作者量级在 classifier 不可见）
    const f8abTweet = (lagSec, followers = 3894479) => ({
      type: 'tweet',
      text: '@cz_binance Burn N Burn 🔥',
      author_screen_name: 'bnbchain',
      author_followers_count: followers,
      metrics: { favorite_count: 88, retweet_count: 16 },
      created_at: iso(ANCHOR_SEC - lagSec),
      in_reply_to: { author_screen_name: 'cz_binance', author_followers_count: 12997788 },
    });
    // L0 桶分类不动：巨粉作者回复大 IP 仍进 interpretive_reply（豁免只在 precheck 层，
    // jev-state-builder 消费同一 classifyTweetType 拿完整分类上下文）
    const { classifyTweetType } = await import('../src/narrative/analyzer/services/tweet-type-classifier.mjs');
    const clsL = classifyTweetType(f8abTweet(23 * 60));
    assert(clsL.type === 'interpretive_reply', 'L0 巨粉回复大IP仍进 interpretive_reply 桶（分类不动）', clsL.type);

    const rL1 = await run(makeTokenData(), f8abTweet(23 * 60));
    assert(rL1 === null, 'L1 f8ab 现场反证：389 万粉回复 cz_binance lag 23min → 豁免放行（null=时效交 Jev；C120 前必拦）',
      JSON.stringify(rL1?.details?.ruleName));
    const rL2 = await run(makeTokenData(), f8abTweet(23 * 60, 1500));
    assert(rL2?.details?.ruleName === 'expired_tweet' && rL2?.details?.tweetType === 'interpretive_reply',
      'L2 反证：同形状粉丝 1500 → 照拦（巨粉豁免不扩到小号回复）',
      JSON.stringify(rL2?.details?.ruleName) + '/' + String(rL2?.details?.tweetType));
    const rL3a = await run(makeTokenData(), f8abTweet(23 * 60, 4999));
    assert(rL3a?.details?.ruleName === 'expired_tweet', 'L3a 粉 4999（<5000）→ 拦（HIGH_FOLLOWERS 同尺）',
      JSON.stringify(rL3a?.details?.ruleName));
    const rL3b = await run(makeTokenData(), f8abTweet(23 * 60, 5000));
    assert(rL3b === null, 'L3b 粉恰 5000 → 豁免（≥ 含边界）', JSON.stringify(rL3b?.details?.ruleName));
    // 粉丝缺失 fail-保守（无证据不豁免，C86 followers null≠0 同教训）
    const noFollowers = f8abTweet(23 * 60);
    delete noFollowers.author_followers_count;
    const rL4 = await run(makeTokenData(), noFollowers);
    assert(rL4?.details?.ruleName === 'expired_tweet', 'L4 粉丝缺失 → 照拦（fail-保守；桶仍判 interpretive_reply，豁免判据 bigFollowers!==null 不满足）',
      JSON.stringify(rL4?.details?.ruleName));
    // 24h 上界（对齐 C104 设计语言：豁免非无界，>24h 陈旧回落拦不烧 Jev）
    const rL5a = await run(makeTokenData(), f8abTweet(DAY));
    assert(rL5a === null, 'L5a 主推恰 24h（86400s）→ 豁免（≤ 含边界）', JSON.stringify(rL5a?.details?.ruleName));
    const rL5b = await run(makeTokenData(), f8abTweet(DAY + 1));
    assert(rL5b?.details?.ruleName === 'expired_tweet', 'L5b 主推 24h+1s → 回落拦（上界严格 >）',
      JSON.stringify(rL5b?.details?.ruleName));
    // 主推 created_at 缺失 fail-open（对齐 C104 K7）
    const noTs = f8abTweet(23 * 60); noTs.created_at = undefined;
    const rL6 = await run(makeTokenData(), noTs);
    assert(rL6 === null, 'L6 主推 created_at 缺失 + 巨粉 → fail-open 豁免', JSON.stringify(rL6?.details?.ruleName));
    // 桶不越界：angle_seeking 巨粉（名单号优先级 2 压高粉）照拦——C120 只豁免
    // interpretive_reply，找角度主力票型 125/191 刻意不救
    const rosterBig = {
      type: 'tweet', text: 'unit test roster angle tweet',
      author_screen_name: 'shanyizk9', author_followers_count: 500000,
      metrics: { favorite_count: 5000, retweet_count: 1000 },
      created_at: iso(ANCHOR_SEC - 23 * 60),
    };
    const rL7 = await run(makeTokenData(), rosterBig);
    assert(rL7?.details?.ruleName === 'expired_tweet' && rL7?.details?.tweetType === 'angle_seeking',
      'L7 名单巨粉 50 万 lag 23min → 照拦（angle_seeking 桶不在豁免面）',
      JSON.stringify(rL7?.details?.ruleName) + '/' + String(rL7?.details?.tweetType));
    // 源码口径锁
    const pcsL = src('src/narrative/analyzer/services/pre-check-service.mjs');
    assert(pcsL.includes('const INTERPRETIVE_EXEMPT_STALE_SEC = DIRECT_TWEET_STALE_SEC;'),
      'L8 24h 上界常量复用 DIRECT_TWEET_STALE_SEC 源码锁');
    assert(pcsL.includes('interpretiveBigAcctExempt') && pcsL.includes('THRESHOLDS.HIGH_FOLLOWERS'),
      'L9 豁免判据读 classifier THRESHOLDS（同一把尺）源码锁');
    const ttc = src('src/narrative/analyzer/services/tweet-type-classifier.mjs');
    assert(ttc.includes('export const THRESHOLDS'), 'L10 classifier export THRESHOLDS（单一真相源）');
  }

  // ═══ I. 源码口径（锁防线）═══
  console.log('══ I. 源码口径 ═══');
  {
    const pcs = src('src/narrative/analyzer/services/pre-check-service.mjs');
    assert(pcs.includes("import { classifyTweetType, THRESHOLDS } from './tweet-type-classifier.mjs';"),
      'I1 pre-check-service import classifyTweetType（C120 起兼 import THRESHOLDS 同尺豁免）');
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

  // ═══ J. 找角度博主名单（C76 扩编：形状 + 名单压豁免机制锁）═══
  console.log('══ J. 频繁发币者名单 C76 扩编 ══');
  {
    const fiMod = await import('../src/narrative/analyzer/services/frequent-issuers.mjs');
    const roster = [...fiMod.FREQUENT_ISSUERS];
    assert(roster.length >= 147, `J1 名单规模 ≥147（95 旧 + 52 新，实际 ${roster.length}）`);
    assert(roster.every(h => h === h.toLowerCase()), 'J2 全部小写');
    assert(new Set(roster).size === roster.length, 'J3 无重复');
    // 抽查收录号在名单（2026-10-16 高频段样本）
    for (const h of ['shanyizk9', 'burbering1', 'haze0x', 'burneth888', 'mayilong0', 'gampsito']) {
      assert(fiMod.isFrequentIssuer(h), `J4 收录号在名单: ${h}`);
    }
    // 事件源剔除反证（C74 语义：媒体/官方/名人是 direct_tweet 新闻豁免对象，绝不进名单）
    const banned = ['whitehouse', 'pmarca', 'cnbc', 'blockbeatsasia', 'jessepollak',
      'binance', 'flapdotsh', 'bnbchainzh', 'aster_dex', 'flaps_launchpad',
      'fourdotmemezh', 'bnbveil', 'elonmusk', 'cz_binance', 'heyibinance'];
    for (const h of banned) {
      assert(!fiMod.isFrequentIssuer(h), `J5 事件源不在名单: ${h}`);
    }
    // 名单压豁免机制锁：名单号哪怕 50 万粉（过 direct_tweet 粉丝臂）仍判 angle_seeking——
    // 优先级 2（名单）高于优先级 3（高粉豁免），C76 收录即生效的机制本质
    const { classifyTweetType } = await import('../src/narrative/analyzer/services/tweet-type-classifier.mjs');
    const rosterTweetHighFollowers = {
      type: 'tweet', text: 'unit test roster tweet',
      author_screen_name: 'shanyizk9', author_followers_count: 500000,
      metrics: { favorite_count: 5000, retweet_count: 1000 },
      created_at: iso(ANCHOR_SEC - 3600),
    };
    const cls = classifyTweetType(rosterTweetHighFollowers);
    assert(cls.type === 'angle_seeking' && cls.reason.includes('shanyizk9'),
      `J6 名单号 50 万粉+5 千赞仍判 angle_seeking（名单优先于 direct_tweet 豁免臂）：${cls.type}/${cls.reason}`,
      JSON.stringify(cls));
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
