#!/usr/bin/env node
/**
 * YouTube fetcher 双结构载荷归一——本地零 DB 零网络单测
 * （2026-09-29 熊熊波西 0x254e…7777 案：JustOneAPI get-video-detail 平铺结构
 *  被旧代码按 videoDetails 包装读取 → 恒 null → precheck 规则 4
 *  public_info_fetch_failed 误杀，9 个 YouTube 语料 token 死于此）
 *
 * 覆盖：
 *   A. parseVideoDetailPayload：平铺结构归一（真实响应快照锚定）/
 *      旧 videoDetails 包装原样透传 / null 载荷 / 空对象 / 无可识别视频字段
 *   B. fetchViaJustOneAPI 集成（打桩 globalThis.fetch）：平铺响应 → 完整
 *      videoInfo（title/频道/播放量/时长/缩略图数值锚定）/ code!=0 → null /
 *      HTTP 非 200 → null / json 解析抛错 → null
 *   C. 语义闭环：归一产物作为 youtubeInfo 喂 hasValidDataForAnalysis → true
 *      （修复前 null → false → public_info_fetch_failed low）
 *
 * 用法：node scripts/_test_youtube_fetcher.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

// ── 2026-09-29 实测响应快照（Binance Ukraine「What Is Spoofing in Crypto?」，平铺结构）──
const FLAT_PAYLOAD = {
  errorId: 'Success',
  type: 'video',
  id: 'LGFMM6JiOb8',
  title: 'What Is Spoofing in Crypto? How Fake Orders Work',
  description: '#спуфінг #spoofing #trading … Спуфінг - це маніпуляція ринком…',
  channel: {
    type: 'channel',
    id: 'UCGXukejHd44IJ1N_0Ceo2Zw',
    name: 'Binance Ukraine',
    handle: '@BinanceUkraine',
    subscriberCountText: '61.2K subscribers'
  },
  lengthSeconds: 187,
  viewCount: 259,
  likeCount: 1,
  thumbnails: [
    { url: 'https://i.ytimg.com/vi/LGFMM6JiOb8/hqdefault.jpg', width: 168, height: 94 },
    { url: 'https://i.ytimg.com/vi_webp/LGFMM6JiOb8/maxresdefault.webp', width: 1920, height: 1080 }
  ]
};

/** 旧 innertube 原生包装形状（历史上出现过的合法结构，兼容保留） */
const WRAPPED_PAYLOAD = {
  videoDetails: {
    videoId: 'abc123',
    title: 'Old Shape Video',
    shortDescription: 'old shape description',
    channelId: 'UCold',
    author: 'Old Channel',
    viewCount: '12345',
    likeCount: '678',
    lengthSeconds: '90',
    thumbnail: { thumbnails: [{ url: 'https://example.com/old.jpg' }] }
  }
};

// ═══════════════════════════ A. parseVideoDetailPayload ═══════════════════════════
async function sectionA(YoutubeFetcher) {
  console.log('\nA. parseVideoDetailPayload 载荷归一');

  const flat = YoutubeFetcher.parseVideoDetailPayload(FLAT_PAYLOAD);
  check('A1 平铺结构归一: title', flat?.title === 'What Is Spoofing in Crypto? How Fake Orders Work', flat);
  check('A2 平铺结构归一: description → shortDescription', flat?.shortDescription === FLAT_PAYLOAD.description);
  check('A3 平铺结构归一: channel.id → channelId', flat?.channelId === 'UCGXukejHd44IJ1N_0Ceo2Zw');
  check('A4 平铺结构归一: channel.name → author', flat?.author === 'Binance Ukraine');
  check('A5 平铺结构归一: viewCount/likeCount/lengthSeconds 透传',
    flat?.viewCount === 259 && flat?.likeCount === 1 && flat?.lengthSeconds === 187, flat);
  check('A6 平铺结构归一: thumbnails → thumbnail.thumbnails',
    Array.isArray(flat?.thumbnail?.thumbnails) && flat.thumbnail.thumbnails.length === 2);

  const wrapped = YoutubeFetcher.parseVideoDetailPayload(WRAPPED_PAYLOAD);
  check('A7 旧包装结构: videoDetails 原样透传', wrapped === WRAPPED_PAYLOAD.videoDetails);

  check('A8 null 载荷 → null', YoutubeFetcher.parseVideoDetailPayload(null) === null);
  check('A9 空对象 → null', YoutubeFetcher.parseVideoDetailPayload({}) === null);
  check('A10 无视频字段（仅 errorId）→ null',
    YoutubeFetcher.parseVideoDetailPayload({ errorId: 'Success', type: 'video', id: 'x' }) === null);
  check('A11 title 空串且有 description → 仍可归一',
    YoutubeFetcher.parseVideoDetailPayload({ title: '', description: 'd' })?.shortDescription === 'd');
}

// ═══════════════════════════ B. fetchViaJustOneAPI（打桩 fetch）═══════════════════════════
async function sectionB(YoutubeFetcher) {
  console.log('\nB. fetchViaJustOneAPI 集成（打桩 globalThis.fetch）');
  const realFetch = globalThis.fetch;

  const okResponse = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ code: 0, data: FLAT_PAYLOAD })
  });

  try {
    globalThis.fetch = okResponse;
    const info = await YoutubeFetcher.fetchViaJustOneAPI('LGFMM6JiOb8');
    check('B1 平铺响应 → videoInfo 非空', !!info, info);
    check('B2 videoInfo.title', info?.title === 'What Is Spoofing in Crypto? How Fake Orders Work');
    check('B3 videoInfo.channel_title', info?.channel_title === 'Binance Ukraine');
    check('B4 videoInfo.view_count 数字化', info?.view_count === 259, info?.view_count);
    check('B5 videoInfo.like_count 数字化', info?.like_count === 1);
    check('B6 videoInfo.duration', info?.duration === 187);
    check('B7 videoInfo.thumbnail 取首个', info?.thumbnail === 'https://i.ytimg.com/vi/LGFMM6JiOb8/hqdefault.jpg');
    check('B8 videoInfo.fetched_via 标记', info?.fetched_via === 'justoneapi', info?.fetched_via);

    globalThis.fetch = () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ code: 301, data: null, message: 'COLLECT FAILED, SEND REQUEST AGAIN' })
    });
    check('B9 业务错误码 301 → null', (await YoutubeFetcher.fetchViaJustOneAPI('INVALID')) === null);

    globalThis.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('no body')) });
    check('B10 HTTP 500 → null', (await YoutubeFetcher.fetchViaJustOneAPI('x')) === null);

    globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });
    check('B11 json 抛错 → null 不外抛', (await YoutubeFetcher.fetchViaJustOneAPI('x')) === null);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ═══════════════════════════ C. hasValidDataForAnalysis 语义闭环 ═══════════════════════════
async function sectionC(YoutubeFetcher, hasValidDataForAnalysis) {
  console.log('\nC. hasValidDataForAnalysis 语义闭环（修复的最终判定点）');

  const videoInfo = await (async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ code: 0, data: FLAT_PAYLOAD })
    });
    try { return await YoutubeFetcher.fetchViaJustOneAPI('LGFMM6JiOb8'); }
    finally { globalThis.fetch = realFetch; }
  })();

  // 修复后：youtubeInfo 有 title → hasValidDataForAnalysis 判 true → 规则 4 不再误杀
  check('C1 youtubeInfo(title 非空) → hasValidDataForAnalysis true',
    hasValidDataForAnalysis({ youtubeInfo: videoInfo }) === true);

  // 修复前现场：youtubeInfo=null + 无其他语料源 → false → public_info_fetch_failed low
  check('C2 youtubeInfo=null（旧 bug 现场）→ false',
    hasValidDataForAnalysis({ youtubeInfo: null }) === false);

  // 标题空但有 description 也算有效（C31 可读语料同源口径）
  check('C3 title 空 + description 非空 → true',
    hasValidDataForAnalysis({ youtubeInfo: { title: '', description: 'опис відео' } }) === true);
}

// ═══════════════════════════ 主流程 ═══════════════════════════
(async () => {
  console.log('══ YoutubeFetcher 双结构载荷归一单测 ══');

  const { YoutubeFetcher } = await import('../src/narrative/utils/youtube-fetcher.mjs');
  const { hasValidDataForAnalysis } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');

  await sectionA(YoutubeFetcher);
  await sectionB(YoutubeFetcher);
  await sectionC(YoutubeFetcher, hasValidDataForAnalysis);

  console.log(`\n══ 结果: ${passed} 通过 / ${failed} 失败 ══`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('单测执行异常:', err);
  process.exit(1);
});
