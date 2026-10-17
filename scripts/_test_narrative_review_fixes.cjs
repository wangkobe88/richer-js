#!/usr/bin/env node
/**
 * C86 叙事模块 Review 修复批（2026-10-17 docs/叙事模块Review与流程整理-2026-10-17.md
 * §十一 A/B 级问题）——本地零 DB 零网络单测
 *
 * 覆盖（编号=Review 文档问题号）：
 *   A-2  推特黑名单大小写归一（isUserBlacklisted 未导出→源码口径断言）
 *   A-3  classifyTweetType followers 缺失三态（缺失=unknown 非 angle；显式 0 仍 angle；
 *        高互动臂不依赖粉丝字段）
 *   A-4  precheck 规则 2.2 视频时效五平台键对齐（youtube=published_at / weixin=
 *        publish_time 原取值链读不到=静默跳过；tiktok create_time 为 fetcher 补键）
 *   A-5  telegram 判定边界锚定（rocket.meme 等 .meme 域不再被子串 /t\.me/ 误归）
 *   B-7  规则 1.2 回退正则补 twitter.com 域+边界锚（源码口径）
 *   B-3  justoneapi 家族 30s 超时 + github 星标正则 [\\d,]→[\d,]（源码口径）
 *   B-5  Worker dotenv 三级相对路径（源码口径）
 *
 * A-1（quoted_status 幽灵字段）的行为断言在 _test_angle_timing_override.cjs
 * A7/B4 用例（夹具已改生产形状=事故反证），本文件不重复。
 *
 * 用法：node scripts/_test_narrative_review_fixes.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const { readFileSync } = require('fs');
const { join } = require('path');

const SRC = (p) => readFileSync(join(__dirname, '..', p), 'utf8');
const ANCHOR_SEC = 1791986448;   // 固定锚（token 创建时间），保持可复现
const DAY = 86400;

async function main() {
  // ═══ A. classifyTweetType followers 三态（A-3）═══
  console.log('\n── A. classifyTweetType 粉丝数缺失三态 ──');
  const { classifyTweetType } = await import('../src/narrative/analyzer/services/tweet-type-classifier.mjs');

  // 夹具基线：screen_name 避开 frequent-issuers 名单；无回复/引用/转发结构
  const baseTweet = (over = {}) => ({
    type: 'tweet', text: 'some narrative tweet text',
    author_screen_name: 'zzz_not_in_any_roster', ...over,
  });

  // A1 粉丝字段缺失（producer 写 null）+ 低互动 → unknown「粉丝数字段缺失」
  // 事故反证：修复前 `?? 0` 把缺失归零落 angle_seeking 桶（吃 C68 6h override）
  const a1 = classifyTweetType(baseTweet({ author_followers_count: null }));
  check('A1 followers=null → unknown + reason 标缺失（不进 angle 桶）',
    a1.type === 'unknown' && a1.reason.includes('粉丝数字段缺失'), a1);

  // A1b 键整个不在 → 同上（undefined ?? null = null）
  const a1b = classifyTweetType(baseTweet({}));
  check('A1b followers 键缺失 → 同 unknown 形状',
    a1b.type === 'unknown' && a1b.reason.includes('粉丝数字段缺失'), a1b);

  // A2 显式 0 粉 + 低互动 → angle_seeking（0 粉是真数据，防矫枉过正）
  const a2 = classifyTweetType(baseTweet({ author_followers_count: 0 }));
  check('A2 followers=0 显式在场 → angle_seeking（低粉桶保留）',
    a2.type === 'angle_seeking', a2);

  // A3 0 粉 + 高互动 → direct_tweet（高互动臂不看粉丝）
  const a3 = classifyTweetType(baseTweet({ author_followers_count: 0, metrics: { favorite_count: 600, retweet_count: 0 } }));
  check('A3 followers=0 + 600 赞 → direct_tweet（高互动臂不依赖粉丝字段）',
    a3.type === 'direct_tweet', a3);

  // A4 粉丝缺失 + 高互动 → direct_tweet（缺失≠低粉，互动证据自足）
  const a4 = classifyTweetType(baseTweet({ metrics: { favorite_count: 0, retweet_count: 150 } }));
  check('A4 followers 缺失 + 150 转 → direct_tweet（转发臂同样自足）',
    a4.type === 'direct_tweet', a4);

  // A5 对照：数值分桶原行为不变（5000 高粉 direct / 100 低粉低互动 angle）
  const a5a = classifyTweetType(baseTweet({ author_followers_count: 5000 }));
  const a5b = classifyTweetType(baseTweet({ author_followers_count: 100 }));
  check('A5 对照：5000 粉 direct / 100 粉低互动 angle（分桶不变）',
    a5a.type === 'direct_tweet' && a5b.type === 'angle_seeking', { a: a5a.type, b: a5b.type });

  // A6 对照：中间地带（2000≤followers<5000 低互动）→ unknown
  const a6 = classifyTweetType(baseTweet({ author_followers_count: 3000 }));
  check('A6 对照：3000 粉低互动 → unknown「中间地带」（原行为）',
    a6.type === 'unknown' && a6.reason.includes('中间地带'), a6);

  // ═══ B. precheck 规则 2.2 视频时效五平台键（A-4）═══
  console.log('\n── B. 规则 2.2 视频时效（fetcher 产出键对齐）──');
  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  const videoToken = { symbol: 'VT', name: 'VideoToken', tokenCreatedAtSec: ANCHOR_SEC, raw_api_data: { name: 'VideoToken' } };
  const iso = (sec) => new Date(sec * 1000).toISOString();
  const runVideo = (videoInfos) => performPreCheck(videoToken, null, {}, null, {}, videoInfos, null, null, {});
  const isExpiredVideo = (r) => r?.rating === 'low' && r.details?.ruleName === 'expired_video';

  // B1 youtube=published_at（事故反证：修复前取值链读不到该键=静默跳过，400 天老视频放行）
  const b1 = await runVideo({ youtubeInfo: { title: 't', published_at: iso(ANCHOR_SEC - 400 * DAY) } });
  check('B1 youtube published_at 400 天 → low expired_video（原静默跳过）', isExpiredVideo(b1), b1);

  // B2 weixin=publish_time
  const b2 = await runVideo({ weixinInfo: { title: 't', publish_time: iso(ANCHOR_SEC - 400 * DAY) } });
  check('B2 weixin publish_time 400 天 → low expired_video', isExpiredVideo(b2), b2);

  // B3 tiktok=create_time（C86 fetcher 侧补键，消费链对齐）
  const b3 = await runVideo({ tiktokInfo: { title: 't', create_time: iso(ANCHOR_SEC - 400 * DAY) } });
  check('B3 tiktok create_time 400 天 → low expired_video', isExpiredVideo(b3), b3);

  // B4 对照：同平台 10 天新视频 → 不因视频时效拦（夹具语料刻意全空，后续落
  // no_public_info 是空语料兜底的预期行为，与本案修复正交）
  const b4 = await runVideo({ youtubeInfo: { title: 't', published_at: iso(ANCHOR_SEC - 10 * DAY) } });
  check('B4 youtube 10 天新视频 → 不以 expired_video 拦', !isExpiredVideo(b4), b4?.details?.ruleName);

  // B5 回归：原有键（douyin create_time / bilibili publish_date）不破坏
  const b5a = await runVideo({ douyinInfo: { title: 't', create_time: iso(ANCHOR_SEC - 400 * DAY) } });
  const b5b = await runVideo({ bilibiliInfo: { title: 't', publish_date: iso(ANCHOR_SEC - 400 * DAY) } });
  check('B5 回归：douyin create_time / bilibili publish_date 仍拦',
    isExpiredVideo(b5a) && isExpiredVideo(b5b), { a: b5a?.details?.ruleName, b: b5b?.details?.ruleName });

  // ═══ C. classifyUrl telegram 边界（A-5）═══
  console.log('\n── C. telegram 判定边界锚定 ──');
  const { classifyUrl } = await import('../src/narrative/utils/url-classifier.mjs');

  // C1 t.me 正形 → telegram
  const c1 = classifyUrl('https://t.me/some_channel');
  check('C1 https://t.me/xxx → telegram', c1?.platform === 'telegram', c1);

  // C2 事故反证：rocket.meme 含子串 "t.me"（rocke[t.me]me）→ 修复前被误归 telegram 桶
  const c2 = classifyUrl('https://rocket.meme');
  check('C2 rocket.meme（子串 t.me）→ 不归 telegram（website）', c2?.platform !== 'telegram', c2);

  // C3 telegram.org 正形 → telegram
  const c3 = classifyUrl('https://telegram.org/joinchat/abc123');
  check('C3 telegram.org → telegram', c3?.platform === 'telegram', c3);

  // C4 变体域正形：foo.t.me（子域）仍应命中（边界 [/@.] 含 .）
  const c4 = classifyUrl('https://foo.t.me/channel');
  check('C4 子域 foo.t.me → telegram（边界锚不误伤子域正形）', c4?.platform === 'telegram', c4);

  // ═══ D. 源码口径断言（未导出纯函数/超时纪律/路径）═══
  console.log('\n── D. 源码口径 ──');
  const twSrc = SRC('src/narrative/utils/twitter-fetcher.mjs');
  const tfSeg = twSrc.slice(twSrc.indexOf('function isUserBlacklisted'), twSrc.indexOf('function isUserBlacklisted') + 300);
  check('D1 A-2 isUserBlacklisted 大小写归一（h.toLowerCase() === lower）',
    tfSeg.includes('toLowerCase() === lower'), null);

  const pcSrc = SRC('src/narrative/analyzer/services/pre-check-service.mjs');
  check('D2 B-7 规则 1.2 回退正则含 twitter 域 + 边界锚',
    pcSrc.includes('(?:^|[/@.])(?:x|twitter)\\.com\\/([^\\/]+)/'), null);

  const ghSrc = SRC('src/narrative/utils/github-fetcher.mjs');
  check('D3 B-7 github 星标正则 [\\d,]（字面 \\d 死字符类形状不在）',
    ghSrc.includes('[\\d,]') && !/\\\[[\\\\]*d,/.test(ghSrc.replace('[\\d,]', '')), null);

  const ttSrc = SRC('src/narrative/utils/tiktok-fetcher.mjs');
  check('D4 B-3 tiktok create_time 补键 + 短链 10s/JustOneAPI 30s 超时',
    ttSrc.includes('create_time: itemStruct.createTime')
      && ttSrc.includes('AbortSignal.timeout(10000)')
      && ttSrc.includes('AbortSignal.timeout(30000)'), null);

  const wbSrc = SRC('src/narrative/utils/weibo-fetcher.mjs');
  const ytSrc = SRC('src/narrative/utils/youtube-fetcher.mjs');
  check('D5 B-3 weibo/youtube JustOneAPI 30s 超时（weibo=AbortController / youtube=AbortSignal）',
    wbSrc.includes('controller.abort(), 30000') && ytSrc.includes('AbortSignal.timeout(30000)'), null);

  const wkSrc = SRC('src/narrative/engine/Worker.mjs');
  check('D6 B-5 Worker dotenv 三级相对路径（与 config.mjs 同基準）',
    wkSrc.includes("'../../../config/.env'"), null);

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
