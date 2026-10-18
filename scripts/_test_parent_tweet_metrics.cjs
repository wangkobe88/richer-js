#!/usr/bin/env node
/**
 * C92 父推互动数透传单测（零 DB 零网络）
 *
 * 事故现场：유과 강아지 0x9d95…7777（2026-10-18）——父推（事件源头帖）API 返回
 * 点赞 58,730 / 转发 10,324 / 引用 582 / 浏览 932,891，fetcher 组装 in_reply_to
 * 时丢弃（quoted_status/retweeted_status 都有 metrics 映射唯独父推没有），渲染层
 * 【回复的推文】/【引用推文】/【转发推文】三段也全无互动行——Jev 判事件量级时
 * 对平台级热度一无所知，C 档封顶 35.64<60 拦（J1.35 E 类证据层级同批）。
 *
 * 防线：①渲染层三段子推互动行（新形状渲染/旧形状不渲染=存量缓存行 bit-compat）
 * ②fetcher 源码口径（in_reply_to metrics 四字段映射存在）③主推自身互动行口径
 * 不变（陈述者自己的数据不是事件数据，刻意不加浏览/引用）
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, actual) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${actual !== undefined ? ` → ${JSON.stringify(actual)}` : ''}`); }
}

/** 从渲染输出截取【xxx】段——注意：子段内行（【发布时间】/【推文互动】）以【开头
 * 但属于段内容，此处按「空行+下一个顶层段头」切；断言主体用全局唯一数字子串兜底 */
function sectionOf(output, header) {
  const lines = output.split('\n');
  const start = lines.findIndex(l => l.trim() === header);
  if (start === -1) return null;
  const rest = [];
  for (let i = start + 1; i < lines.length; i++) {
    // 顶层段头 = 空行后跟【引用推文】/【转发推文】/【推文链接内容】等段级标记
    if (lines[i] === '' && /^【[^推]*/.test(lines[i + 1] || '') && !lines[i + 1].includes('【推文互动') && !lines[i + 1].includes('【发布时间')) break;
    rest.push(lines[i]);
  }
  return rest.join('\n');
}

/** 数【推文互动】出现次数 */
function engagementCount(output) {
  return (output.match(/【推文互动】/g) || []).length;
}

(async () => {
  const { buildTwitterSection } = await import(
    path.resolve(__dirname, '../src/narrative/analyzer/prompts/sections/twitter-section.mjs')
  );

  console.log('── A. 渲染层：in_reply_to 互动行（事故现场数字反证）──');
  // 本票 token_narrative 行同形状（twitter_info.in_reply_to + 新增 metrics）
  const CASE_METRICS = { favorite_count: 58730, retweet_count: 10324, view_count: 932891, quote_count: 582 };
  const out1 = buildTwitterSection({
    type: 'tweet', text: '유과 강아지 发射推', author_screen_name: 'GETGEORGEMEME',
    metrics: { favorite_count: 0, retweet_count: 0 },
    in_reply_to: {
      text: '와 완전 통모짜핫도그 몸매 강아지', author_screen_name: 'june_kyuuu',
      author_followers_count: 2189, tweet_id: '2111456064705384795', metrics: { ...CASE_METRICS }
    }
  }, {});
  const replySec = sectionOf(out1, '【回复的推文】');
  check('A1 回复的推文段存在', replySec !== null, out1);
  // 数字全局唯一（58730/10324/932891/582 只可能来自父推 metrics）
  check('A2 互动行四段全渲染（点赞/转发/浏览/引用=父推实测数字）',
    out1.includes('【推文互动】点赞 58730 / 转发 10324 / 浏览 932891 / 引用 582') === true, out1);
  check('A2b 互动行共两处（主推+父推）', engagementCount(out1) === 2, engagementCount(out1));

  console.log('── B. 存量缓存行旧形状 bit-compat ──');
  const out2 = buildTwitterSection({
    type: 'tweet', text: 'x', author_screen_name: 'a',
    metrics: { favorite_count: 3, retweet_count: 1 },
    in_reply_to: { text: '旧形状无 metrics 键', author_screen_name: 'b', author_followers_count: 100 }
  }, {});
  check('B1 旧形状（无 metrics）父推不加互动行（全文恰 1 处=主推）',
    engagementCount(out2) === 1, engagementCount(out2));
  check('B2 旧形状主推互动行照常（口径不变）', out2.includes('【推文互动】点赞 3 / 转发 1') === true, out2);

  console.log('── C. 引用/转发段（fetcher 旧有映射、渲染层本次补显）──');
  const out3 = buildTwitterSection({
    type: 'tweet', text: 'x', author_screen_name: 'a',
    quoted_status: { text: 'q', author_screen_name: 'q1', metrics: { favorite_count: 5, retweet_count: 1 } },
    retweeted_status: { text: 'r', author_screen_name: 'r1', metrics: { favorite_count: 7, retweet_count: 2 } }
  }, {});
  const qSec = sectionOf(out3, '【引用推文】');
  const rSec = sectionOf(out3, '【转发推文】');
  check('C1 引用推文段互动行（favorite/retweet 形状，无浏览/引用段）',
    qSec !== null && out3.includes('【推文互动】点赞 5 / 转发 1') === true
    && !out3.includes('浏览'), out3);
  check('C2 转发推文段互动行', rSec !== null && out3.includes('【推文互动】点赞 7 / 转发 2') === true, out3);

  console.log('── D. view/quote null 收窄形状 ──');
  const out4 = buildTwitterSection({
    type: 'tweet', text: 'x', author_screen_name: 'a',
    in_reply_to: { text: 'p', author_screen_name: 'b', metrics: { favorite_count: 10, retweet_count: 0, view_count: null, quote_count: null } }
  }, {});
  check('D1 null 浏览/引用不显示（只有点赞/转发）',
    out4.includes('【推文互动】点赞 10 / 转发 0') === true && !out4.includes('浏览'), out4);

  console.log('── E. 源码口径（fetcher 映射锁定）──');
  const fetcherSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/narrative/utils/twitter-fetcher.mjs'), 'utf8');
  const inReplyBlock = fetcherSrc.slice(
    fetcherSrc.indexOf('result.in_reply_to = {'),
    fetcherSrc.indexOf('media: originalMedia', fetcherSrc.indexOf('result.in_reply_to = {')));
  check('E1 in_reply_to 组装含 metrics 四字段映射（favorite/retweet/view/quote）',
    /favorite_count:\s*originalTweet\.favorite_count/.test(inReplyBlock)
    && /retweet_count:\s*originalTweet\.retweet_count/.test(inReplyBlock)
    && /view_count:\s*originalTweet\.view_count/.test(inReplyBlock)
    && /quote_count:\s*originalTweet\.quote_count/.test(inReplyBlock), null);
  check('E2 修复注释含 C92 案号（源码可追溯）', inReplyBlock.includes('C92'), null);
  // 主推互动行刻意不加浏览/引用：陈述者自己的数据不是事件数据（J1.35 层级④）
  const mainPart = out1.slice(0, out1.indexOf('【回复的推文】'));
  check('E3 主推互动行保持旧口径（点赞/转发两项，无浏览——陈述者数据≠事件数据）',
    mainPart.includes('【推文互动】点赞 0 / 转发 0') && !mainPart.includes('浏览'), mainPart);

  console.log(`\n═══ _test_parent_tweet_metrics: ${passed} passed, ${failed} failed ═══`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('FATAL', err); process.exit(1); });
