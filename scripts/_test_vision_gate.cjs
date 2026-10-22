#!/usr/bin/env node
/**
 * vision 前置 Jev 预判门单测（C72，2026-10-15 小黑案 0x9641293a…7777）——零 DB 零网络
 *
 * 打桩手法（先例 _test_jev_client_backoff / _test_tweet_image_analysis /
 * _test_narrative_middle_parallel）：
 *   - global.fetch 按 URL + body.questions key 路由：systemone 含
 *     vision_gate_sufficiency → 门桩；其余 systemone → 主 Jev 桩（400 立抛零重试）；
 *     siliconflow → vision API 桩；pbs.twimg.com → 图片字节
 *   - 服务级用 options.config 注入；E 段端到端用 getConfig() 缓存对象原地改
 *   - E 段骨架复用 middle_parallel：twitter-validation CJS 预覆写 + dbManager
 *     假 supabase + Repository/Cache statics 覆写
 *
 * 节：
 *   A. judgeVisionGate 纯函数（概率阈值 / miss→0 fail-safe / 版本常量）
 *   B. runVisionGate 服务行为（门关零 fetch / sufficient 恰 1 次 POST + state 无图
 *      形态 / need_image / fetch 400 fail-safe 不 throw）
 *   C. shouldAskVisionGate 资格矩阵（已挂载→false / type≠tweet→false / 门关→false）
 *   D. 源码口径锁 analyzer 接线（门在前 / 外层 if 跳过形状 / 三布尔屏蔽 /
 *      jevFetchResults 恰 2 处 / config 默认开防线 / options 解构行无新增键）
 *   E. 端到端 analyze()：门开默认 → timing 有 vision.gate 无 vision + tweet_image
 *      零读 + 主 Jev state 无图块；门关对照 → vision 段在场；
 *      visionPrefetch+门跳过 → 竞态屏蔽（后台挂载不影响主 Jev state）
 *
 * 用法：node scripts/_test_vision_gate.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
const count = (s, needle) => s.split(needle).length - 1;

// ═══ E 段加载前覆写（必须在任何 narrative ESM import 之前）═══
process.env.TYPESAFE_API_KEY = 'unit-test-key';
process.env.SILICONFLOW_FALLBACK_KEY = process.env.SILICONFLOW_FALLBACK_KEY || 'unit-test-key';

// twitter stub
const tv = require('../src/utils/twitter-validation/index.js');
let tweetStub = null;
let accountStub = null;
tv.getTweetDetail = async (tweetId) => (tweetStub ? { ...tweetStub } : null);
tv.getTweetDetailGraphQL = async () => null;
tv.getUserByScreenName = async (sn) => (accountStub ? { ...accountStub.userInfo } : null);
tv.getUserTweets = async (userId) => (accountStub ? accountStub.tweets.map(t => ({ ...t })) : []);

// dbManager 假 supabase（链式 Proxy + thenable）
const chainable = (result) => new Proxy(function () {}, {
  get(_t, prop) {
    const p = Promise.resolve(result);
    if (prop === 'then') return p.then.bind(p);
    if (prop === 'catch') return p.catch.bind(p);
    return () => chainable(result);
  },
  apply() { return chainable(result); },
});
let tokenRow = null;
const supabaseStub = {
  from(table) {
    const rows = table === 'experiment_tokens' ? [tokenRow] : [];
    return chainable({ data: rows, error: null });
  },
};
const { dbManager } = require('../src/services/dbManager.js');
dbManager.getSupabase = () => supabaseStub;

// ═══ global.fetch 桩（URL + questions key 路由）═══
const jevCalls = [];        // systemone 调用记录 {gate:boolean, body, resp}
let visionApiCalls = 0;     // siliconflow 调用计数
let visionDelayMs = 0;      // E3 用：让预启动 visionPromise 在门判定时仍在飞（真实世界 11s 天然如此）
let imgDlCalls = 0;         // pbs.twimg.com 下载计数
let gateAnswer = { choice: 'sufficient', probabilities: { sufficient: 0.9 } }; // 门桩当前答案
const IMG_BUF = Buffer.alloc(512, 9);

function fakeJsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(obj),
    json: async () => obj,
  };
}

global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.typesafe.ai')) {
    const body = JSON.parse(init?.body || '{}');
    const isGate = Object.keys(body.questions || {}).includes('vision_gate_sufficiency');
    jevCalls.push({ gate: isGate, body });
    if (isGate) {
      return fakeJsonResponse({
        model: 'jev-test',
        answers: { vision_gate_sufficiency: { type: 'choice', ...gateAnswer } },
        usage: { input_tokens: 5 },
      });
    }
    // 主 Jev 桩：400 立抛（4xx 不重试零 sleep）——E 段断言不依赖主 Jev 成功
    return fakeJsonResponse({ error: 'unit-test main jev disabled' }, 400);
  }
  if (u.includes('api.siliconflow.cn')) {
    visionApiCalls++;
    if (visionDelayMs > 0) await new Promise(res => setTimeout(res, visionDelayMs));
    const content = JSON.stringify({ description: 'e3-vision-stub', key_elements: ['x'], visible_text: '', meme_type: '', meme_meaning: '' });
    return fakeJsonResponse({ choices: [{ message: { content } }] });
  }
  if (u.includes('pbs.twimg.com')) {
    imgDlCalls++;
    return { ok: true, arrayBuffer: async () => IMG_BUF.buffer.slice(IMG_BUF.byteOffset, IMG_BUF.byteOffset + IMG_BUF.length) };
  }
  return fakeJsonResponse({}, 404);
};

const VISION_CFG_ON = {
  enabled: true, baseUrl: 'https://fake-vision.test', model: 'stub-model',
  apiKeyEnv: 'SILICONFLOW_FALLBACK_KEY', timeoutMs: 500, maxTokens: 800, retryCount: 2, cacheTtlSec: 7776000,
};
const GATE_CFG = { enabled: true, minSufficientProb: 0.6 };

function makeTweet(over = {}) {
  return {
    type: 'tweet',
    text: 'the narrative is fully explained in this text: e-CNY digital currency pilot',
    media: { has_media: true, images: [{ url: 'https://pbs.twimg.com/media/GATE1.jpg' }], videos: [] },
    ...over,
  };
}

async function main() {
  // ═══ A. judgeVisionGate 纯函数 ═══
  console.log('══ A. judgeVisionGate 纯函数 ═══');
  {
    const q = await import('../src/narrative/analyzer/llm/jev-visiongate-questions.mjs');
    const a = (choice, p) => ({ vision_gate_sufficiency: { type: 'choice', choice, probabilities: { sufficient: p } } });
    assert(q.judgeVisionGate(a('sufficient', 0.8), { minSufficientProb: 0.6 }).skipped === true, 'A1 sufficient 0.8≥0.6 → 跳过');
    assert(q.judgeVisionGate(a('sufficient', 0.5), { minSufficientProb: 0.6 }).skipped === false, 'A2 sufficient 0.5<0.6 → 不跳');
    assert(q.judgeVisionGate(a('need_image', 0.9), { minSufficientProb: 0.6 }).skipped === false, 'A3 need_image 0.9 → 不跳');
    const miss = q.judgeVisionGate({ vision_gate_sufficiency: { type: 'choice', choice: 'sufficient' } }, { minSufficientProb: 0.6 });
    assert(miss.skipped === false && miss.prob === 0, 'A4 probabilities 缺失 → prob=0 不跳（fail-safe 宁跑勿跳）');
    assert(/^G\d+\.\d+$/.test(q.JEV_VISIONGATE_QUESTIONS_VERSION), 'A5 版本常量 G1.x 形状', q.JEV_VISIONGATE_QUESTIONS_VERSION);
    const qs = q.buildVisionGateQuestions();
    assert(qs.vision_gate_sufficiency?.type === 'choice'
      && qs.vision_gate_sufficiency?.criteria?.sufficient && qs.vision_gate_sufficiency?.criteria?.need_image,
    'A6 题形状：1 题 choice + 两选项 criteria');
    assert(q.JEV_VISIONGATE_QUESTIONS_VERSION === 'G1.2', 'A7 版本 G1.2（裸口号 + 已讲清叙事反锚）', q.JEV_VISIONGATE_QUESTIONS_VERSION);
    const instr = qs.vision_gate_sufficiency.instructions;
    assert(instr.includes('Bare slogan / official-wording citation without context')
      && instr.includes('币安官方称之为智能时代')
      && instr.includes('independently explains the narrative'),
    'A8 G1.1 锚：裸口号/官方措辞无上下文 → need_image；文本须独立讲清叙事');
    assert(instr.includes('Counter-anchor (G1.2)')
      && instr.includes('抖音热搜meme')
      && instr.includes('NOT need_image'),
    'A9 G1.2 反锚：文本已讲清热点 meme/二创 → 附图只是佐证，不判 need_image');
  }

  // ═══ B. runVisionGate 服务行为 ═══
  console.log('══ B. runVisionGate 服务行为 ═══');
  {
    const svc = await import('../src/narrative/analyzer/services/vision-gate-service.mjs');
    const tokenData = { symbol: 'TEST', raw_api_data: { name: 'Test Token' } };
    const fetchResults = { twitterInfo: makeTweet(), websiteInfo: null, extractedInfo: null, classifiedUrls: {}, relatedAccounts: [] };

    jevCalls.length = 0; gateAnswer = { choice: 'sufficient', probabilities: { sufficient: 0.75 } };
    const rOff = await svc.runVisionGate(tokenData, fetchResults, { config: { vision: { ...VISION_CFG_ON, gate: { enabled: false } } } });
    assert(rOff.skipped === false && jevCalls.length === 0, 'B1 门关 → 零 fetch 零 Jev 调用');

    jevCalls.length = 0;
    const rSkip = await svc.runVisionGate(tokenData, fetchResults, { config: { vision: { ...VISION_CFG_ON, gate: GATE_CFG } } });
    assert(rSkip.skipped === true && rSkip.choice === 'sufficient' && rSkip.prob === 0.75, 'B2 sufficient 0.75 → skipped=true');
    assert(jevCalls.length === 1 && jevCalls[0].gate === true, 'B3 恰 1 次 POST 且命中门题路由');
    assert(typeof jevCalls[0].body.state === 'string'
      && jevCalls[0].body.state.includes('e-CNY digital currency pilot')
      && !jevCalls[0].body.state.includes('【图片内容分析】'),
    'B4 state=与主调用同语料的无图形态（含推文文本、无图块）');

    jevCalls.length = 0; gateAnswer = { choice: 'need_image', probabilities: { sufficient: 0.2 } };
    const rNeed = await svc.runVisionGate(tokenData, fetchResults, { config: { vision: { ...VISION_CFG_ON, gate: GATE_CFG } } });
    assert(rNeed.skipped === false && rNeed.choice === 'need_image', 'B5 need_image → 不跳（跑 vision 原行为）');

    // 失败注入：门桩换成 400（非门题路由不可用——直接换 endpoint 桩：临时改 gate 路由失败用 400 响应）
    jevCalls.length = 0;
    const origFetch = global.fetch;
    global.fetch = async () => fakeJsonResponse({ error: 'x' }, 400);
    let threw = false;
    let rFail;
    try { rFail = await svc.runVisionGate(tokenData, fetchResults, { config: { vision: { ...VISION_CFG_ON, gate: GATE_CFG } } }); }
    catch (e) { threw = true; }
    global.fetch = origFetch;
    assert(!threw && rFail?.skipped === false && typeof rFail?.error === 'string', 'B6 Jev 失败 → 不 throw、skipped=false fail-safe 跑 vision');
  }

  // ═══ C. shouldAskVisionGate 资格矩阵 ═══
  console.log('══ C. shouldAskVisionGate 资格矩阵 ═══');
  {
    const svc = await import('../src/narrative/analyzer/services/vision-gate-service.mjs');
    const cfgOn = { config: { vision: { ...VISION_CFG_ON, gate: GATE_CFG } } };
    const cfgOff = { config: { vision: { ...VISION_CFG_ON, gate: { enabled: false } } } };
    assert(svc.shouldAskVisionGate(makeTweet(), cfgOn) === true, 'C1 门开+tweet+首图+未挂载 → true');
    assert(svc.shouldAskVisionGate(makeTweet({ image_analysis: { analysis: {} } }), cfgOn) === false, 'C2 已挂 image_analysis → false（缓存命中零耗时直接用图）');
    assert(svc.shouldAskVisionGate(makeTweet({ type: 'account' }), cfgOn) === false, 'C3 type=account → false');
    assert(svc.shouldAskVisionGate(makeTweet({ media: {} }), cfgOn) === false, 'C4 无首图 → false');
    assert(svc.shouldAskVisionGate(makeTweet(), cfgOff) === false, 'C5 门关 → false');
  }

  // ═══ D. 源码口径锁 analyzer 接线 ═══
  console.log('══ D. 源码口径锁接线 ═══');
  {
    const A = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    assert(A.includes("import { runVisionGate, shouldAskVisionGate } from './services/vision-gate-service.mjs'"), 'D1 import 门服务');
    const gateIdx = A.indexOf("timing.wrap('vision.gate'");
    // C84（2026-10-17）visionPrefetch 预启动退役：vision await 不再有 visionPromise join 臂
    const visionIdx = A.indexOf("await timing.wrap('vision', () => analyzeTweetImage(twitterInfo))");
    assert(gateIdx > -1 && visionIdx > -1 && gateIdx < visionIdx, 'D2 门 wrap 在原 vision await 之前', `gate@${gateIdx} vision@${visionIdx}`);
    assert(A.includes('if (!visionSkipped) {\n          await timing.wrap(\'vision\''), 'D3 外层 if 跳过形状（跳过时无 vision 段）');
    assert(count(A, 'imageEvidence: !visionSkipped && !!twitterInfo?.image_analysis') === 1, 'D4 imageEvidence 屏蔽恰 1 处（C83 后仅 standard 分支）', count(A, 'imageEvidence: !visionSkipped && !!twitterInfo?.image_analysis'));
    assert(count(A, 'imageConsistency: !visionSkipped && !!twitterInfo?.image_analysis') === 1, 'D5 imageConsistency 屏蔽恰 1 处');
    assert(count(A, 'buildJevState(tokenData, jevFetchResults') === 1, 'D6 jevFetchResults 传参恰 1 处（C83 后仅 standard state 构建）', count(A, 'buildJevState(tokenData, jevFetchResults'));
    assert(count(A, 'buildJevState(tokenData, jevFetchResults, { superIPInfo, knowledgeMatches, now: jevNowMs })') === 1, 'D6b standard 调用点含 superIPInfo 注入（C83 registry 命中进 state；C164 knowledgeMatches 同点透传）', count(A, 'buildJevState(tokenData, jevFetchResults, { superIPInfo, knowledgeMatches, now: jevNowMs })'));
    assert(A.includes('const jevFetchResults = visionSkipped && twitterInfo'), 'D7 竞态屏蔽拷贝（image_analysis: undefined 浅拷贝）');
    const cfg = src('config/narrative-engine.json');
    const gateCfg = JSON.parse(cfg).vision?.gate;
    assert(gateCfg?.enabled === true && typeof gateCfg?.minSufficientProb === 'number', 'D8 config 默认开防线（用户裁定默认 true）', JSON.stringify(gateCfg));
    // options 层零 vision 键（C84 visionPrefetch 退役：options 无 visionPrefetch 键；
    // 门恒 config 驱动非 options 驱动——runVisionGate 大写 V 不会被小写子串误中）
    const noCommentsA = A.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert(!noCommentsA.includes('visionPrefetch'), 'D9a options 零 visionPrefetch 键（C84 预启动机制退役，注释豁免）');
    assert(!A.includes('visionGate'), 'D9b 全文件零 visionGate options 键（门是 config 驱动非 options 驱动）');
  }

  // ═══ E. 端到端 analyze() ═══
  console.log('══ E. 端到端 analyze() ═══');
  {
    const repoMod = await import('../src/narrative/db/NarrativeRepository.mjs');
    repoMod.NarrativeRepository.findByAddress = async () => null;
    repoMod.NarrativeRepository.getSupabase = () => supabaseStub;
    const saves = [];
    repoMod.NarrativeRepository.save = async (fields) => { saves.push(fields); return { id: 1, ...fields }; };

    const cacheMod = await import('../src/narrative/db/ExternalResourceCache.mjs');
    const cacheGets = [];
    cacheMod.ExternalResourceCache.get = async (url, type) => { cacheGets.push({ url, type }); return null; };
    cacheMod.ExternalResourceCache.set = async () => true;

    const { NarrativeAnalyzer } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');
    const { getConfig } = await import('../src/narrative/engine/config.mjs');
    const cfg = getConfig();
    const origGate = cfg.vision?.gate ? { ...cfg.vision.gate } : null;

    const IMG_URL = 'https://pbs.twimg.com/media/GATE1.jpg';
    const makeTStub = () => ({
      text: 'narrative fully in text about ECNY pilot program',
      user: { screen_name: 'author_gate', name: 'Author Gate', followers_count: 1500, verified: false },
      favorite_count: 10, retweet_count: 2,
      created_at: 'Wed Oct 01 10:00:00 +0000 2025',
      urls: [],
      medias: [IMG_URL],
    });
    const makeAStub = () => ({
      userInfo: { screen_name: 'author_gate', id: 'u-gate', name: 'x', description: 'd', followers_count: 900 },
      tweets: Array.from({ length: 100 }, (_, i) => ({ id_str: String(i + 1), full_text: `post ${i + 1}`, created_at_seconds: 1759000000 - i * 3600 })),
    });
    const run = (addr) => {
      tokenRow = { token_symbol: 'TEST', raw_api_data: { twitter: 'https://x.com/author_gate/status/111222333' }, blockchain: 'bsc', platform: 'fourmeme' };
      tweetStub = makeTStub();
      accountStub = makeAStub();
      const timing = [];
      return NarrativeAnalyzer.analyze(addr, { _timing: timing }).then(r => ({ r, timing }));
    };

    // E1: 门开（真实 config 默认 true）→ sufficient 跳过
    jevCalls.length = 0; cacheGets.length = 0; visionApiCalls = 0; imgDlCalls = 0;
    gateAnswer = { choice: 'sufficient', probabilities: { sufficient: 0.9 } };
    {
      const { r, timing } = await run('0xeeee1111eeee1111eeee1111eeee1111eeee1111');
      const segs = (timing || []).map(t => t.seg);
      assert(segs.includes('vision.gate') && !segs.includes('vision'), 'E1 门开 sufficient → timing 有 vision.gate 段无 vision 段', JSON.stringify(segs));
      assert(!cacheGets.some(c => c.type === 'tweet_image') && visionApiCalls === 0 && imgDlCalls === 0,
        'E2 vision 整段未触达（tweet_image 缓存零读 + 零 API + 零图片下载）', `gets=${cacheGets.length} api=${visionApiCalls} dl=${imgDlCalls}`);
      const gateAsk = jevCalls.find(c => c.gate);
      const mainAsk = jevCalls.find(c => !c.gate);
      assert(gateAsk != null, 'E3 门题真调（1 次 POST）');
      assert(mainAsk != null && !mainAsk.body.state.includes('【图片内容分析】') && mainAsk.body.state.includes('ECNY pilot'),
        'E4 主 Jev state 无图块含推文文本（屏蔽拷贝生效）');
    }

    // E2: 门关对照 → vision 段在场（缓存命中路径零网络）
    cfg.vision.gate = { enabled: false, minSufficientProb: 0.6 };
    try {
      cacheMod.ExternalResourceCache.get = async (url, type) => {
        cacheGets.push({ url, type });
        if (type === 'tweet_image') return { url, analysis: { description: 'gate-off-stub', key_elements: [], meme_type: '', meme_meaning: '' }, promptVersion: 'img-v3' };
        return null;
      };
      jevCalls.length = 0;
      const { timing } = await run('0xeeee2222eeee2222eeee2222eeee2222eeee2222');
      const segs = (timing || []).map(t => t.seg);
      assert(!segs.includes('vision.gate') && segs.includes('vision'), 'E5 门关对照 → vision 段在场无门段（原行为）', JSON.stringify(segs));
      // 主 Jev state：vision 段缓存命中挂载 → state 有图块（未屏蔽=门关语义）
      const mainAsk = jevCalls.find(c => !c.gate);
      assert(mainAsk != null && mainAsk.body.state.includes('【图片内容分析】'), 'E6 门关时 vision 挂载进主 Jev state（图证据可用）');
    } finally {
      cacheMod.ExternalResourceCache.get = async (url, type) => { cacheGets.push({ url, type }); return null; };
    }

    // E3（visionPrefetch 预启动竞态场景）已随 C84（2026-10-17）机制退役删除：
    // dataPrefetch/visionPrefetch 整链下线，analyze() 不再有后台 visionPromise 挂载路径，
    // 「后台挂载不影响主 Jev state」竞态无从构造。C72 门本体覆盖=E1-E6。

    // 恢复真实 config 门态（本地 config 默认 true，写回原值）
    if (origGate) cfg.vision.gate = origGate;
    else delete cfg.vision.gate;
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
