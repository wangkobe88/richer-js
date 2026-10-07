#!/usr/bin/env node
/**
 * 推文配图视觉分析服务单测（2026-10-07 现金猫案，智谱 glm-5.3 图片分析开启）
 *
 * 零 DB 零网络：打桩 global fetch（图片下载 + 智谱 API）与 ExternalResourceCache
 * 静态方法（模块实例同对象，static 可写——与 precheck retry 测试同手法）。
 *
 * 用户两点约束的机器验证：
 *   1. 同图缓存（external_resource_cache 按图片 URL 键控 + 版本校验 + in-flight 并发去重）
 *   2. 每代币只分析主推文第一张图
 *
 * 节：
 *   A. 关闭态（无 vision 节 / enabled=false）→ 跳过，零调用
 *   B. miss 全链：只下载首图、API 一次、缓存写入键/形状、image_analysis 挂载、
 *      prompt 不含 token 名（跨 token 缓存健全性）、```json 围栏剥离
 *   C. 缓存命中 → 零 fetch 直接挂
 *   D. 缓存版本不符（旧 promptVersion）→ 视为 miss 重析
 *   E. 跳过形状：account 类型 / 无 media / images 空 → false 零调用
 *   F. 幂等：已有 image_analysis → true 零调用
 *   G. API 5xx → 重试耗尽后 false 且不写缓存（下次重试语义）
 *   H. API 4xx → 不重试（单次调用）→ false
 *   I. JSON 解析失败 → 整段原文进 description（不丢证据）
 *   J. in-flight 去重：两个不同 twitterInfo 同图并发 → API 只打一次，双双挂载
 *   K. state 渲染：twitter-section 输出【图片内容分析】块（渲染层零改动口径）
 *   L. 源码口径：NarrativeAnalyzer 正常流程分支挂点存在
 *   M. 配置残缺（enabled 但 key 缺失）→ throw fail-loud
 *
 * 用法：node scripts/_test_tweet_image_analysis.cjs
 */
'use strict';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// ── 打桩 global fetch（先于被测模块加载无意义，运行期路由即可）──────────────
const fetchCalls = [];
let apiResponse = null; // 当前 API 响应桩（对象或其队列函数）
const IMG_BUF = Buffer.alloc(2048, 7);
global.fetch = async (url, init) => {
  const u = String(url);
  fetchCalls.push({ url: u, body: init?.body });
  if (u.includes('/v1/messages')) {
    return typeof apiResponse === 'function' ? apiResponse() : apiResponse;
  }
  return {
    ok: true,
    arrayBuffer: async () => IMG_BUF.buffer.slice(IMG_BUF.byteOffset, IMG_BUF.byteOffset + IMG_BUF.length),
  };
};

// ── 打桩 ExternalResourceCache（模块实例同对象，static 方法可写）────────────
const cacheState = { next: null, gets: [], sets: [] };

const okApi = (text) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });

function makeTweet(over = {}) {
  return {
    type: 'tweet',
    author_screen_name: 'binance',
    text: 'POV: You check the Binance #TradersLeagueS4 leaderboard.',
    media: { has_media: true, images: [{ url: 'https://pbs.twimg.com/media/FIRST.jpg' }, { url: 'https://pbs.twimg.com/media/SECOND.jpg' }], videos: [] },
    ...over,
  };
}

const VISION_CFG = {
  enabled: true,
  baseUrl: 'https://fake-vision.test',
  model: 'glm-test',
  apiKeyEnv: 'TEST_VISION_KEY',
  timeoutMs: 500,
  maxTokens: 800,
  retryCount: 2,
  cacheTtlSec: 7776000,
};
const OPTS = { config: { vision: VISION_CFG } };

async function main() {
  process.env.TEST_VISION_KEY = 'k';
  const svcMod = await import('../src/narrative/analyzer/services/image-analysis-service.mjs');
  const { analyzeTweetImage } = svcMod;

  const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
  cacheMod.ExternalResourceCache.get = async (url, type) => {
    cacheState.gets.push({ url, type });
    return cacheState.next;
  };
  cacheMod.ExternalResourceCache.set = async (url, type, content, opts) => {
    cacheState.sets.push({ url, type, content, ttl: opts?.ttl });
    return true;
  };

  // ═══ A. 关闭态 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.next = null;
    const tw = makeTweet();
    check('A1: 无 vision 节 → false 零调用',
      (await analyzeTweetImage(tw, { config: {} })) === false && fetchCalls.length === 0 && cacheState.gets.length === 0);
    check('A2: enabled=false → false 零调用',
      (await analyzeTweetImage(tw, { config: { vision: { ...VISION_CFG, enabled: false } } })) === false && fetchCalls.length === 0);
    console.log('A. 关闭态 ✓');
  }

  // ═══ B. miss 全链 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.sets.length = 0; cacheState.next = null;
    apiResponse = okApi('```json\n{"description":"排行榜截图，榜首有一只卡通猫","key_elements":["排行榜","猫","Binance logo"],"meme_type":"POV梗图","meme_meaning":"登顶的得意"}\n```');
    const tw = makeTweet();
    const r = await analyzeTweetImage(tw, OPTS);
    check('B1: 返回 true 且挂载 image_analysis', r === true && !!tw.image_analysis);
    const imgFetches = fetchCalls.filter(c => !c.url.includes('/v1/messages'));
    const apiFetches = fetchCalls.filter(c => c.url.includes('/v1/messages'));
    check('B2: 只下载第一张图（用户约束 2）',
      imgFetches.length === 1 && imgFetches[0].url === 'https://pbs.twimg.com/media/FIRST.jpg');
    check('B3: API 只调一次', apiFetches.length === 1 && apiFetches[0].url === 'https://fake-vision.test/v1/messages');
    check('B4: 缓存 get 键控图片 URL + resourceType=tweet_image',
      cacheState.gets.length === 1 && cacheState.gets[0].url === 'https://pbs.twimg.com/media/FIRST.jpg' && cacheState.gets[0].type === 'tweet_image');
    check('B5: 缓存 set 写入（url/形状/版本/90天TTL）',
      cacheState.sets.length === 1
      && cacheState.sets[0].url === 'https://pbs.twimg.com/media/FIRST.jpg'
      && cacheState.sets[0].type === 'tweet_image'
      && cacheState.sets[0].content.promptVersion === 'img-v1'
      && cacheState.sets[0].content.analysis.description === '排行榜截图，榜首有一只卡通猫'
      && cacheState.sets[0].content.analysis.key_elements.length === 3
      && cacheState.sets[0].ttl === 7776000);
    const body = JSON.parse(apiFetches[0].body);
    const prompt = body.messages[0].content.find(b => b.type === 'text').text;
    check('B6: prompt 含推文文字与作者', prompt.includes('TradersLeagueS4') && prompt.includes('@binance'));
    check('B7: 服务签名无 token 维度入参（跨 token 缓存健全性，Function.length 默认参数截断计 1）',
      analyzeTweetImage.length === 1 && !/tokenName|tokenData|token_relevance/.test(prompt));
    check('B8: 请求体 thinking disabled + 图片块 base64',
      body.thinking?.type === 'disabled'
      && body.messages[0].content[0].type === 'image'
      && body.messages[0].content[0].source.media_type === 'image/jpeg'
      && typeof body.messages[0].content[0].source.data === 'string');
    check('B9: ```json 围栏剥离解析成功', tw.image_analysis.analysis.meme_type === 'POV梗图');
    console.log('B. miss 全链 ✓');
  }

  // ═══ C. 缓存命中 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.sets.length = 0;
    cacheState.next = { url: 'https://pbs.twimg.com/media/FIRST.jpg', analysis: { description: '缓存里的描述' }, promptVersion: 'img-v1' };
    const tw = makeTweet();
    const r = await analyzeTweetImage(tw, OPTS);
    check('C1: 命中直接挂载零 fetch 零 set', r === true && fetchCalls.length === 0 && cacheState.sets.length === 0
      && tw.image_analysis.analysis.description === '缓存里的描述');
    console.log('C. 缓存命中 ✓');
  }

  // ═══ D. 缓存版本不符 → 重析 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.sets.length = 0;
    cacheState.next = { url: 'x', analysis: { description: '旧版本' }, promptVersion: 'img-v0' };
    apiResponse = okApi('{"description":"新版描述","key_elements":[],"meme_type":"","meme_meaning":""}');
    const tw = makeTweet();
    const r = await analyzeTweetImage(tw, OPTS);
    check('D1: 旧版本缓存视为 miss 重析', r === true && fetchCalls.some(c => c.url.includes('/v1/messages'))
      && tw.image_analysis.analysis.description === '新版描述');
    console.log('D. 版本校验 ✓');
  }

  // ═══ E. 跳过形状 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.next = null;
    check('E1: account 类型跳过', (await analyzeTweetImage({ type: 'account', media: { has_media: true, images: [{ url: 'https://x/a.jpg' }] } }, OPTS)) === false);
    check('E2: 无 media 跳过', (await analyzeTweetImage({ type: 'tweet' }, OPTS)) === false);
    check('E3: images 空跳过', (await analyzeTweetImage(makeTweet({ media: { has_media: true, images: [], videos: [] } }), OPTS)) === false);
    check('E4: 零调用', fetchCalls.length === 0 && cacheState.gets.length === 0);
    console.log('E. 跳过形状 ✓');
  }

  // ═══ F. 幂等 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.next = null;
    const tw = makeTweet();
    tw.image_analysis = { url: 'https://pbs.twimg.com/media/FIRST.jpg', analysis: { description: '已有' } };
    check('F1: 已有 image_analysis → true 零调用', (await analyzeTweetImage(tw, OPTS)) === true && fetchCalls.length === 0);
    console.log('F. 幂等 ✓');
  }

  // ═══ G. API 5xx 重试耗尽 ═══
  {
    fetchCalls.length = 0; cacheState.gets.length = 0; cacheState.sets.length = 0; cacheState.next = null;
    apiResponse = { ok: false, status: 500, text: async () => 'boom' };
    const tw = makeTweet();
    const t0 = Date.now();
    const r = await analyzeTweetImage(tw, OPTS);
    const apiCount = fetchCalls.filter(c => c.url.includes('/v1/messages')).length;
    check('G1: 5xx 重试耗尽（retryCount=2 → 3 次）后 false', r === false && apiCount === 3);
    check('G2: 失败不写缓存（下次重试语义）', cacheState.sets.length === 0 && !tw.image_analysis);
    check('G3: 有退避（≥500ms）', Date.now() - t0 >= 500);
    console.log('G. 5xx 重试 ✓');
  }

  // ═══ H. API 4xx 不重试 ═══
  {
    fetchCalls.length = 0; cacheState.sets.length = 0; cacheState.next = null;
    apiResponse = { ok: false, status: 400, text: async () => 'bad request' };
    const tw = makeTweet();
    const r = await analyzeTweetImage(tw, OPTS);
    const apiCount = fetchCalls.filter(c => c.url.includes('/v1/messages')).length;
    check('H1: 4xx 单次调用即失败', r === false && apiCount === 1 && cacheState.sets.length === 0);
    console.log('H. 4xx 不重试 ✓');
  }

  // ═══ I. JSON 解析失败降级 ═══
  {
    fetchCalls.length = 0; cacheState.sets.length = 0; cacheState.next = null;
    apiResponse = okApi('这不是JSON，模型直接输出了描述文字。');
    const tw = makeTweet();
    const r = await analyzeTweetImage(tw, OPTS);
    check('I1: 原文进 description 不丢证据', r === true && tw.image_analysis.analysis.description === '这不是JSON，模型直接输出了描述文字。'
      && Array.isArray(tw.image_analysis.analysis.key_elements) && tw.image_analysis.analysis.key_elements.length === 0);
    console.log('I. 解析降级 ✓');
  }

  // ═══ J. in-flight 并发去重 ═══
  {
    fetchCalls.length = 0; cacheState.sets.length = 0; cacheState.next = null;
    let release;
    const gate = new Promise(res => { release = res; });
    apiResponse = async () => { await gate; return okApi('{"description":"并发结果","key_elements":[],"meme_type":"","meme_meaning":""}'); };
    const tw1 = makeTweet();
    const tw2 = makeTweet({ author_screen_name: 'other_guy', text: '另一个 token 的同图语料' });
    const p1 = analyzeTweetImage(tw1, OPTS);
    const p2 = analyzeTweetImage(tw2, OPTS);
    await new Promise(r => setTimeout(r, 50));
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const apiCount = fetchCalls.filter(c => c.url.includes('/v1/messages')).length;
    const imgCount = fetchCalls.filter(c => !c.url.includes('/v1/messages')).length;
    check('J1: 并发同图 API 只打一次（复蹭簇形状）', r1 === true && r2 === true && apiCount === 1 && imgCount === 1);
    check('J2: 两个 twitterInfo 都挂上同一结果', tw1.image_analysis.analysis.description === '并发结果' && tw2.image_analysis.analysis.description === '并发结果');
    console.log('J. in-flight 去重 ✓');
  }

  // ═══ K. state 渲染（twitter-section 既有渲染块）═══
  {
    const { buildTwitterSection } = await import('../src/narrative/analyzer/prompts/sections/twitter-section.mjs');
    const tw = makeTweet();
    tw.image_analysis = { url: 'https://pbs.twimg.com/media/FIRST.jpg', analysis: { description: '排行榜截图，榜首有一只卡通猫', key_elements: ['排行榜', '猫'], meme_type: 'POV梗图', meme_meaning: '登顶的得意' } };
    const section = buildTwitterSection(tw, { now: 1759900000000 });
    check('K1: 渲染含【图片内容分析】块', section.includes('【图片内容分析】'));
    check('K2: 渲染含描述/元素/梗图含义', section.includes('排行榜截图，榜首有一只卡通猫') && section.includes('排行榜, 猫') && section.includes('登顶的得意'));
    console.log('K. state 渲染 ✓');
  }

  // ═══ L. 源码口径：NarrativeAnalyzer 挂点 ═══
  {
    const fs = require('fs');
    const src = fs.readFileSync('src/narrative/analyzer/NarrativeAnalyzer.mjs', 'utf8');
    check('L1: import 存在', src.includes("import { analyzeTweetImage } from './services/image-analysis-service.mjs'"));
    const hookIdx = src.indexOf('await analyzeTweetImage(twitterInfo);');
    const precheckIdx = src.indexOf('const preCheckResult = await performPreCheck');
    check('L2: 挂点在 pre-check 之后（预检拦截票不烧视觉调用）', hookIdx > precheckIdx && hookIdx > 0);
    console.log('L. 源码口径 ✓');
  }

  // ═══ M. 配置残缺 throw ═══
  {
    const savedKey = process.env.TEST_VISION_KEY;
    delete process.env.TEST_VISION_KEY;
    let threw = false;
    try { await analyzeTweetImage(makeTweet(), OPTS); } catch { threw = true; }
    check('M1: enabled 但 key 缺失 → throw fail-loud', threw);
    if (savedKey !== undefined) process.env.TEST_VISION_KEY = savedKey;
    let threw2 = false;
    try { await analyzeTweetImage(makeTweet(), { config: { vision: { ...VISION_CFG, apiKeyEnv: undefined, baseUrl: undefined } } }); } catch { threw2 = true; }
    check('M2: baseUrl/model 残缺 → throw', threw2);
    console.log('M. 配置残缺 fail-loud ✓');
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
