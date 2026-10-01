#!/usr/bin/env node
/**
 * C44 Instagram 链路修复 + IG 影响力兜底锚——本地零 DB 零网络单测
 * （2026-10-01 土豪猫猫案 0xfade76ef97ada757be21a4a1aba87d576eda7777，用户裁定
 * 「因为我们无法知道在Ins上这个猫的影响力多大…如果引用了Insgram的链接，就认为
 * 影响力达标」+ mid-turn 升级「这个API能支持…进一步获取instagram的信息」）
 *
 * 三处修复：
 *   ① url-classifier classifyAllUrls 漏 case 'instagram' → IG URL 落 websites 桶
 *      → selectFirstUrl('instagram') 恒 null → fetcher 从未被调用（死链根因）
 *   ② instagram-fetcher 端点旧路径 404（post-details/v1 → get-post-detail/v1、
 *      user-profile/v1 → get-user-detail/v1）+ 解析层按真实 GraphQL 形状重写
 *      （edge_media_preview_like / owner / taken_at_timestamp / data.data.user 嵌套）
 *   ③ mapper IG 影响力兜底锚：A 类 + linked + 数据未抓到 → dim2=max(dim2,18)
 *      （真数据已进 state 时不兜底，Jev 按真证据判分）
 *
 * 覆盖：
 *   A. 端点路径断言（新路径在、旧路径不在）
 *   B. post 解析矩阵（本案真实响应 fixture：19596 赞 GraphSidecar / 视频帖 reel）
 *   C. user 解析矩阵（嵌套 data.data.user：128737 粉）
 *   D. classifyAllUrls 桶归属（IG post/user → instagram 桶，不再落 websites）
 *   E. mapper 兜底矩阵（本案数值复现 51.7→60 / 真数据不锚 / 非A不锚 /
 *      只升不降 / W 不触达 / 存量零变化 / 审计 reason）
 *   F. analyzer 传递点 + superIP 路径不挂（源码口径）
 *   G. state section 形状兼容（fetcher 输出喂 buildInstagramSection）
 *
 * 用法：node scripts/_test_instagram_pipeline.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 本案真实响应 fixture（2026-10-01 实测，已裁剪无关字段）─────────────────
const IG_POST_RESPONSE = {
  code: 0,
  data: {
    __typename: 'GraphSidecar',
    shortcode: 'DFZg9g0Bz5E',
    is_video: false,
    taken_at_timestamp: 1738130442, // 2025-01-29T06:00:42Z
    accessibility_caption: '新年 農曆 紅包 利是 貓貓 富豪',
    owner: { username: 'meowmomagazine', full_name: 'MEOW MO MAGAZINE', is_verified: false, id: '56643697904' },
    edge_media_preview_like: { count: 19596 },
    edge_media_to_parent_comment: { count: 12 },
    edge_media_to_caption: {
      edges: [{ node: { text: '【#MEWLIFE】新年請用錢錢狠狠砸我！紅包多多利是滿滿跟著土豪貓貓秒變富豪\n.\nOnly on @meowmomagazine' } }],
    },
    thumbnail_src: 'https://example.invalid/thumb.jpg',
  },
};

const IG_VIDEO_RESPONSE = {
  code: 0,
  data: {
    __typename: 'GraphVideo',
    is_video: true,
    video_view_count: 250000,
    taken_at_timestamp: 1738130442,
    owner: { username: 'meowmomagazine', full_name: 'MEOW MO MAGAZINE', is_verified: false },
    edge_media_preview_like: { count: 8000 },
    edge_media_to_parent_comment: { count: 300 },
    edge_media_to_caption: { edges: [] },
  },
};

const IG_USER_RESPONSE = {
  code: 0,
  data: {
    data: {
      user: {
        username: 'meowmomagazine',
        full_name: 'MEOW MO MAGAZINE',
        is_verified: false,
        biography: '𝘽𝙚 𝙥𝙞𝙘𝙠𝙮 𝙤𝙛 𝙝𝙤𝙬 𝙮𝙤𝙪 𝙡𝙞𝙫𝙚, 𝙡𝙞𝙠𝙚 𝙖 𝙨𝙚𝙣𝙨𝙞𝙩𝙞𝙫𝙚 𝙘𝙖𝙩 🇭🇰🇹🇼',
        edge_followed_by: { count: 128737 },
        edge_follow: { count: 875 },
        edge_owner_to_timeline_media: { count: 920 },
        category_name: 'Magazine',
        is_private: false,
        profile_pic_url_hd: 'https://example.invalid/pic.jpg',
        external_url: 'https://www.facebook.com/profile.php?id=100093110700411',
        bio_links: [],
      },
    },
  },
};

/** 桩 fetch：按 URL 分发 fixture，记录调用 */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [needle, body] of routes) {
      if (String(url).includes(needle)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ code: 404, data: null, message: 'Resource not found' }) };
  };
  return calls;
}

// ── mapper 测试用：本案 J1.25 快照简化 answers（A 类 + C 档 + strong_fit + dim2 0.97）──
const tuhaoTokenData = { symbol: '土豪猫猫', name: '土豪--猫猫', raw_api_data: { name: '土豪--猫猫' } };

function tuhaoAnswers({ magnitude = 2.4, dim2Score = 0.97, strongFit = 0.9, timing = 'within_7d' } = {}) {
  return {
    event_category: { choice: 'A', probabilities: { A: 0.8, E: 0.12 } },
    event_magnitude: { score: magnitude, probabilities: { '2': 0.55, '3': 0.3 } },
    event_timing: { choice: timing, probabilities: { [timing]: 0.9 } },
    dimension2: { score: dim2Score, probabilities: { '1': 0.55, '2': 0.3 } },
    block_reason: { choice: 'none', probabilities: { none: 0.62, subject_unqualified: 0.2 } },
    name_referent: { choice: 'none_related', probabilities: { none_related: 0.6 } },
    web3_fit: { choice: 'strong_fit', probabilities: { strong_fit: strongFit, fit: 0.08 } },
    relevance_type: { choice: 'exact_match', probabilities: { exact_match: 0.8 } },
    relevance_level: { score: 4, probabilities: { '4': 0.85 } },
    block_misspelling: { noul: 0.1 },
    quality_spelling: { score: 6, probabilities: { '3': 0.9 } },
    quality_reasonability: { score: 4, probabilities: { '2': 0.88 } },
  };
}

function makeContext({ tokenData = tuhaoTokenData, instagramLinked, instagramInfoFetched } = {}) {
  const ctx = {
    tokenData,
    twitterInfo: null,
    includeBrandHijack: false,
    credibleEventAnchor: false,
    tweetClassification: null,
    callInfo: { model: 'stub', questions: { q1: {} }, stateStats: { chars: 0 }, state: '', usage: {}, startedAt: 't0', finishedAt: 't1' },
  };
  if (instagramLinked !== undefined) ctx.instagramLinked = instagramLinked;
  if (instagramInfoFetched !== undefined) ctx.instagramInfoFetched = instagramInfoFetched;
  return ctx;
}

function stage2Of(mapped) { return mapped?.stage2DataToSave?.parsed_output || {}; }
function stage3Of(mapped) { return mapped?.stage3DataToSave?.parsed_output || {}; }

async function main() {
  const { InstagramFetcher } = await import('../src/narrative/utils/instagram-fetcher.mjs');
  const { classifyAllUrls, classifyUrl } = await import('../src/narrative/utils/url-classifier.mjs');
  const { mapStandardAnswers } = await import('../src/narrative/analyzer/llm/jev-result-mapper.mjs');
  const { buildInstagramSection } = await import('../src/narrative/analyzer/prompts/sections/instagram-section.mjs');

  console.log('\n── A. 端点路径断言 ──');
  const fs = require('fs');
  const fetcherSrc = fs.readFileSync('src/narrative/utils/instagram-fetcher.mjs', 'utf8');
  check('A1 新端点路径（get-post-detail/v1 + get-user-detail/v1）',
    fetcherSrc.includes('api/instagram/get-post-detail/v1') && fetcherSrc.includes('api/instagram/get-user-detail/v1'));
  check('A2 旧路径已清除（post-details/v1 / user-profile/v1 路径 404 根因）',
    !fetcherSrc.includes('api/instagram/post-details/v1') && !fetcherSrc.includes('api/instagram/user-profile/v1'));

  console.log('\n── B. post 解析矩阵（真实 GraphQL 形状） ──');
  const calls = stubFetch([
    ['get-post-detail', IG_POST_RESPONSE],
    ['get-user-detail', IG_USER_RESPONSE],
  ]);
  const post = await InstagramFetcher.fetchPostDetails('DFZg9g0Bz5E');
  check('B1 请求打到新端点且带 code 参数',
    calls[0].includes('get-post-detail/v1') && calls[0].includes('code=DFZg9g0Bz5E'), calls[0]);
  check('B2 输出形状：type post / media_type 1 / media_name GraphSidecar / fetched_via justoneapi',
    post.type === 'post' && post.media_type === 1 && post.media_name === 'GraphSidecar' && post.fetched_via === 'justoneapi', post);
  check('B3 互动数据：like 19596 / comment 12（edge 结构解析）',
    post.metrics.like_count === 19596 && post.metrics.comment_count === 12, post.metrics);
  check('B4 用户：owner → user.{username,full_name,is_verified}',
    post.user.username === 'meowmomagazine' && post.user.full_name === 'MEOW MO MAGAZINE' && post.user.is_verified === false, post.user);
  check('B5 时间：taken_at_timestamp 秒 → ISO（2025-01-29T06:00:42Z）',
    post.taken_at === '2025-01-29T06:00:42.000Z', post.taken_at);
  check('B6 文案与标签提取：caption 全文 / #MEWLIFE / @meowmomagazine',
    post.caption.includes('土豪貓貓秒變富豪') && post.hashtags.includes('#MEWLIFE') && post.mentions.includes('@meowmomagazine'),
    { hashtags: post.hashtags, mentions: post.mentions });
  check('B7 影响力分级：19596赞 → super_viral（metric=max(plays, likes×5, comments×50)≥1万）',
    post.influence_level === 'super_viral', post.influence_level);

  // 视频帖形状（GraphVideo + video_view_count）
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => IG_VIDEO_RESPONSE });
  const videoPost = await InstagramFetcher.fetchPostDetails('DVideo1');
  check('B8 视频帖（GraphVideo）：type reel / media_type 2 / play_count 25万',
    videoPost.type === 'reel' && videoPost.media_type === 2 && videoPost.metrics.play_count === 250000,
    { type: videoPost.type, metrics: videoPost.metrics });
  check('B8b 视频帖影响力：250000 播放 → mega_viral（≥10万）',
    videoPost.influence_level === 'mega_viral', videoPost.influence_level);

  console.log('\n── C. user 解析矩阵（嵌套 data.data.user） ──');
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('get-user-detail') ? IG_USER_RESPONSE : { code: 404, data: null }),
  });
  const userFetchCalls = [];
  globalThis.fetch = async (url) => {
    userFetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => IG_USER_RESPONSE };
  };
  const user = await InstagramFetcher.fetchUserProfile('meowmomagazine');
  check('C1 请求打到 get-user-detail/v1 且带 username',
    userFetchCalls[0].includes('get-user-detail/v1') && userFetchCalls[0].includes('username=meowmomagazine'), userFetchCalls[0]);
  check('C2 双层嵌套解析：followers 128737 / following 875 / posts 920（edge_* 计数）',
    user.type === 'user_profile' && user.follower_count === 128737 && user.following_count === 875 && user.media_count === 920, user);
  check('C3 附加字段：category_name Magazine / biography / external_url 保留',
    user.category_name === 'Magazine' && user.biography.length > 0 && user.external_url.includes('facebook.com'), user);

  console.log('\n── D. classifyAllUrls 桶归属 ──');
  const buckets = classifyAllUrls([
    'https://www.instagram.com/p/DFZg9g0Bz5E/',
    'https://www.instagram.com/meowmomagazine/',
    'https://example.com/normal-page',
  ]);
  check('D1 IG post + user_profile 双 URL 进 instagram 桶（修复前落 websites）',
    buckets.instagram.length === 2 && buckets.instagram[0].type === 'post' && buckets.instagram[1].type === 'user_profile',
    buckets.instagram);
  check('D2 websites 桶只剩普通网页（IG 不再混入）',
    buckets.websites.length === 1 && buckets.websites[0].platform === 'web', buckets.websites);
  check('D3 classifyUrl 识别 IG 帖子 platform/type 不变（分类逻辑本来就对）',
    classifyUrl('https://www.instagram.com/p/DFZg9g0Bz5E/').platform === 'instagram');

  console.log('\n── E. mapper IG 影响力兜底矩阵 ──');

  // E1 本案数值复现：A 类 + C 档(2.4) + strong_fit 0.9 → web3FitAnchored 锚 B(27)
  //    + dim2 0.97→9.7 兜底锚 18 + within_7d 15 = 60.0 恰好压线 pass
  const m1 = mapStandardAnswers(tuhaoAnswers(), makeContext({ instagramLinked: true, instagramInfoFetched: false }));
  const e1 = stage2Of(m1);
  check('E1 本案复现：51.7（27+9.7+15 拦）→ 60.0（27+18+15 pass）',
    e1.pass === true && e1.scoringResult.totalScore === 60 && e1.scoringResult.dimension2 === 18,
    { total: e1.scoringResult.totalScore, dim2: e1.scoringResult.dimension2 });
  check('E1b 审计：jev.instagramDim2Anchor.from = 9.7（原值可追溯）',
    e1.jev?.instagramDim2Anchor?.from === 9.7, e1.jev?.instagramDim2Anchor);
  check('E1c reason 标注：stage2「IG影响力豁免(原9.7)」+ llm 前缀「IG影响力豁免(C44)」',
    /IG影响力豁免\(原9\.7\)/.test(e1.reason || '') && /IG影响力豁免\(C44\)/.test(m1.llmResult?.reason || ''),
    { stage2: e1.reason, llm: m1.llmResult?.reason });

  // E2 真数据已抓到 → 不兜底（Jev 按真证据判分）
  const m2 = mapStandardAnswers(tuhaoAnswers(), makeContext({ instagramLinked: true, instagramInfoFetched: true }));
  const e2 = stage2Of(m2);
  check('E2 instagramInfoFetched=true：不锚，dim2 照 Jev（9.7 → 51.7 拦）',
    e2.pass === false && e2.scoringResult.dimension2 === 9.7 && e2.scoringResult.totalScore === 51.7
      && e2.jev?.instagramDim2Anchor === null,
    { total: e2.scoringResult.totalScore, dim2: e2.scoringResult.dimension2, anchor: e2.jev?.instagramDim2Anchor });

  // E3 非 A 类（C 类）→ 不锚
  const cAnswers = tuhaoAnswers();
  cAnswers.event_category = { choice: 'C', probabilities: { C: 0.8 } };
  cAnswers.web3_fit = { choice: 'fit', probabilities: { fit: 0.7 } };
  const m3 = mapStandardAnswers(cAnswers, makeContext({ instagramLinked: true, instagramInfoFetched: false }));
  const e3 = stage2Of(m3);
  check('E3 C 类不锚（IG 是形象主阵地，豁免限 A 类）',
    e3.jev?.instagramDim2Anchor === null && e3.scoringResult.dimension2 === 9.7, e3.jev);

  // E4 dim2 已 ≥18 → 只升不降（score 2.5 落「小[18,26]」带 → 18+0.5×8=22）
  const m4 = mapStandardAnswers(tuhaoAnswers({ dim2Score: 2.5 }), makeContext({ instagramLinked: true, instagramInfoFetched: false }));
  const e4 = stage2Of(m4);
  check('E4 dim2 22 ≥18：不锚不降',
    e4.scoringResult.dimension2 === 22 && e4.jev?.instagramDim2Anchor === null, e4.scoringResult.dimension2);

  // E5 W 类 → 不触达（W 数学不消费 dim2）
  const wAnswers = tuhaoAnswers();
  wAnswers.event_category = { choice: 'W', probabilities: { W: 0.7 } };
  wAnswers.w_product_score = { score: 2.2, probabilities: { '2': 0.6, '3': 0.2 } };
  wAnswers.w_binance_interaction = { score: 0.5, probabilities: { '0': 0.9 } };
  const m5 = mapStandardAnswers(wAnswers, makeContext({ instagramLinked: true, instagramInfoFetched: false }));
  const e5 = stage2Of(m5);
  check('E5 W 类走 W 数学不触达（dimension2 null / anchor null）',
    e5.scoringResult.dimension2 === null && e5.jev?.instagramDim2Anchor === null, e5.scoringResult);

  // E6 存量调用形状（不传 IG context）→ 零行为变化（本案 J1.25 实测 51.7 拦复现）
  const m6 = mapStandardAnswers(tuhaoAnswers(), makeContext());
  const e6 = stage2Of(m6);
  check('E6 存量形状（无 IG 字段）：51.7 维持拦截（J1.25 实测 bit-identical）',
    e6.pass === false && e6.scoringResult.totalScore === 51.7 && e6.scoringResult.dimension2 === 9.7,
    e6.scoringResult);

  // E7 全链 pass 形状：stage3 走通（relevance 20 + 质量）
  const s3 = stage3Of(m1);
  check('E7 stage3 全链：exact_match 20 + 质量 → mid/high',
    m1.llmResult.pass === true && (s3.category_agg === 'mid' || s3.category_agg === 'high'),
    { agg: s3.category_agg, total: m1.stageFinalData.totalScore });

  console.log('\n── F. analyzer 传递点 + superIP 不挂（源码口径） ──');
  const analyzerSrc = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
  const mapperSrc = fs.readFileSync('src/narrative/analyzer/llm/jev-result-mapper.mjs', 'utf8');
  check('F1 analyzer：instagramLinked 按 classifiedUrls.instagram / instagramInfoFetched 按抓取结果传入',
    /instagramLinked: !!\(classifiedUrls\?\.instagram\?\.length > 0\)/.test(analyzerSrc)
      && /instagramInfoFetched: instagramInfo != null/.test(analyzerSrc));
  check('F2 mapper：igDim2Anchor 四条件（A类/linked/未抓到/只升不降）+ effDim2 计分',
    /const igDim2Anchor = category === 'A' && instagramLinked === true/.test(mapperSrc)
      && /instagramInfoFetched !== true && dim2 < 18/.test(mapperSrc)
      && /const effDim2 = igDim2Anchor \? 18 : dim2/.test(mapperSrc)
      && /tierScore \+ effDim2 \+ timeliness/.test(mapperSrc));
  const superipSeg = mapperSrc.slice(mapperSrc.indexOf('mapSuperIPAnswers'));
  check('F3 superIP 快车道不挂 IG 兜底（一期范围）',
    !superipSeg.includes('igDim2Anchor') && !superipSeg.includes('instagramLinked'));

  console.log('\n── G. state section 形状兼容 ──');
  const section = buildInstagramSection(post);
  check('G1 buildInstagramSection 消费新解析输出：标题/作者/点赞 19596/发布时间 2025/影响力',
    section.includes('Instagram帖子') && section.includes('meowmomagazine')
      && section.includes('点赞: 19596') && section.includes('2025') && section.includes('高度病毒传播级'),
    section.slice(0, 200));
  const userSection = buildInstagramSection(user);
  check('G2 用户主页 section：粉丝 128737 / Magazine 类目',
    userSection.includes('Instagram用户主页') && userSection.includes('128737'), userSection.slice(0, 200));

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
