#!/usr/bin/env node
/**
 * C79 语料充分门单测（2026-10-16 用户裁定泛化版）——本地零 DB 零网络
 *
 * 用户原话：「不仅仅是抖音的调用，很多外部资源的调用都是类似思路，就是如果
 * 对叙事的理解已经不需要其它信息补充，那就不用去取了」。机制=twitter 主语料
 * 等齐后 1 题 Choice 判「其余待抓平台语料还需要吗」，sufficient 则 justoneapi
 * 串行桶 + github 桶全部待抓段整段跳过。
 *
 *   A. judgeCorpusGate 纯函数：阈值边界 / need_fetch 高 prob / probabilities
 *      缺失→0 / 答案缺席 / 版本 CG1.0 / 题集形状 / 阈值注入
 *   B. runCorpusGate 服务行为（global.fetch 桩）：门关零 POST / sufficient 恰
 *      1 次 POST 且 state 含 twitter 语料+[UNFETCHED SOURCES] 附加段 /
 *      need_fetch / 4xx 失败不 throw / race 上界（gateTimeoutMs=80+桩 300ms）/
 *      options.config 注入覆盖全局
 *   C. 资格矩阵：pendingCorpusPlatforms 清单口径（剔 twitter/websites/
 *      telegram）/ null 容忍 / shouldAskCorpusGate 四象限
 *   D. 源码口径锁（防线）：import 行 / hoist+守卫在 await twitter 前 /
 *      陷阱①（资格判定与 {...results} 展开都在 await twitterPromise 之后）/
 *      桶闭包跳过形状 / github 桶闭包 / websites 直调不经门 / runDouyin 恢复
 *      无参 / config 默认开 / 门管清单 / douyin 专属门文件已删
 *   E. 端到端 fetchDataSequentially（类静态打桩）：sufficient→三平台桩零调用
 *      +跳过标记+timing 门段无抓取段 / need_fetch 照抓 / 门关不等 twitter
 *      （时序反证）/ 无 twitter URL 照抓 / 慢 twitter→门 POST 在其后 / github
 *      待跳 / websites-only 不问门 / 门挂起 2s race 照抓 / twitter 失败照抓 /
 *      门 4xx 照抓
 *
 * 用法：node scripts/_test_corpus_gate.cjs
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── fetch 桩：按 URL+题集 key 路由（api.typesafe.ai 且含 corpus_gate_sufficiency
//    → 门桩；其余 Jev POST 直接 throw 暴露意外调用）──
let gateAnswer = { choice: 'need_fetch', probabilities: { sufficient: 0.11, need_fetch: 0.89 } };
let gateDelayMs = 0;
let gateStatus = 200;
let gatePosts = [];
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).includes('api.typesafe.ai')) {
    const body = JSON.parse(init?.body || '{}');
    const qs = body.questions || {};
    if (qs.corpus_gate_sufficiency) {
      if (gateDelayMs) await sleep(gateDelayMs);
      gatePosts.push({ at: Date.now(), state: String(body.state || '') });
      if (gateStatus !== 200) {
        return { ok: false, status: gateStatus, headers: { get: () => null }, text: async () => 'stub err' };
      }
      return { ok: true, status: 200, json: async () => ({ model: 'stub', answers: { corpus_gate_sufficiency: gateAnswer }, usage: {} }) };
    }
    throw new Error(`意外 Jev POST（题集 ${Object.keys(qs).join(',')}）`);
  }
  return realFetch(url, init);
};
function resetGate(choice) {
  gatePosts = []; gateDelayMs = 0; gateStatus = 200;
  gateAnswer = choice === 'sufficient'
    ? { choice: 'sufficient', probabilities: { sufficient: 0.92, need_fetch: 0.08 } }
    : { choice: 'need_fetch', probabilities: { sufficient: 0.11, need_fetch: 0.89 } };
}

async function main() {
  const dfsMod = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
  const cg = await import('../src/narrative/analyzer/services/corpus-gate-service.mjs');
  const q = await import('../src/narrative/analyzer/llm/jev-corpusgate-questions.mjs');
  const { getConfig } = await import('../src/narrative/engine/config.mjs');
  const { createSegmentTimer } = await import('../src/narrative/utils/segment-timer.mjs');
  const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');
  const { WeiboFetcher } = await import('../src/narrative/utils/weibo-fetcher.mjs');
  const { DouyinFetcher } = await import('../src/narrative/utils/douyin-fetcher.mjs');
  const { GithubFetcher } = await import('../src/narrative/utils/github-fetcher.mjs');

  const cfg = getConfig();
  const savedGate = cfg.corpusGate;
  const GATE_ON = { enabled: true, minSufficientProb: 0.6 };

  // ═══ A. judgeCorpusGate 纯函数 ═══
  console.log('══ A. judgeCorpusGate 纯函数 ══');
  {
    const ans = (choice, probs) => ({ corpus_gate_sufficiency: { choice, probabilities: probs } });
    assert(q.judgeCorpusGate(ans('sufficient', { sufficient: 0.6 }), {}).skipped === true,
      'A1 sufficient p=0.6 恰达阈值 → 跳过');
    assert(q.judgeCorpusGate(ans('sufficient', { sufficient: 0.59 }), {}).skipped === false,
      'A2 sufficient p=0.59 边界下 → 不跳过');
    assert(q.judgeCorpusGate(ans('need_fetch', { sufficient: 0.95 }), {}).skipped === false,
      'A3 need_fetch 高 prob → 不跳过');
    assert(q.judgeCorpusGate(ans('sufficient', {}), {}).skipped === false,
      'A4 probabilities.sufficient 缺失 → 0 宁抓勿跳');
    const r5 = q.judgeCorpusGate({}, {});
    assert(r5.choice === 'need_fetch' && r5.prob === null && r5.skipped === false,
      'A5 答案缺席 → need_fetch/null 不跳过');
    assert(q.JEV_CORPUSGATE_QUESTIONS_VERSION === 'CG2.0', 'A6 版本常量 CG2.0');
    const qq = q.buildCorpusGateQuestions().corpus_gate_sufficiency;
    assert(qq.type === 'choice' && !!qq.criteria.sufficient && !!qq.criteria.need_fetch
      && qq.instructions.includes('[UNFETCHED SOURCES]')
      && qq.instructions.includes('TRUST PRINCIPLE')
      && qq.instructions.includes('taken at face value')
      && qq.instructions.includes('NEVER reasons to pick need_fetch'),
      'A7 题集形状（choice/双 criteria/待抓清单语境/CG2.0 采信原则锚）');
    assert(q.judgeCorpusGate(ans('sufficient', { sufficient: 0.7 }), { minSufficientProb: 0.75 }).skipped === false,
      'A8 minSufficientProb 注入生效');
  }

  // ═══ B. runCorpusGate 服务行为 ═══
  console.log('══ B. runCorpusGate 服务行为（fetch 桩）══');
  const tokenData = { address: '0xt', symbol: 'TST', name: 'Tst Token',
    tokenCreatedAtSec: 1760000000, raw_api_data: { created_at: 1760000000 } };
  const partial = { twitterInfo: { type: 'tweet', text: '宣告：Tst Token 上线' }, douyinInfo: null };
  const PENDING1 = [{ platform: 'douyin', url: 'https://douyin.com/video/1' }];
  {
    cfg.corpusGate = { enabled: false };
    resetGate('sufficient');
    let r = await cg.runCorpusGate(tokenData, partial, {});
    assert(r.skipped === false && r.ms === 0 && gatePosts.length === 0,
      'B1 门关 → 零 POST 立即返回');

    cfg.corpusGate = GATE_ON;
    resetGate('sufficient');
    r = await cg.runCorpusGate(tokenData, partial, { pending: PENDING1 });
    assert(r.skipped === true && r.choice === 'sufficient' && Math.abs((r.prob ?? 0) - 0.92) < 1e-9,
      'B2 sufficient → skipped');
    assert(gatePosts.length === 1, 'B2b 恰 1 次 POST');
    assert(gatePosts[0].state.includes('Tst Token 上线'),
      'B2c state 含 twitter 主语料（判据输入）');
    assert(gatePosts[0].state.includes('[UNFETCHED SOURCES]')
      && gatePosts[0].state.includes('- douyin: https://douyin.com/video/1'),
      'B2d state 末尾 [UNFETCHED SOURCES] 清单附加段');

    resetGate('need_fetch');
    r = await cg.runCorpusGate(tokenData, partial, { pending: PENDING1 });
    assert(r.skipped === false && r.choice === 'need_fetch' && gatePosts.length === 1,
      'B3 need_fetch → 照抓');

    resetGate('sufficient'); gateStatus = 400;
    r = await cg.runCorpusGate(tokenData, partial, { pending: PENDING1 });
    assert(r.skipped === false && !!r.error && gatePosts.length === 1,
      'B4 4xx 失败 → 不 throw {skipped:false,error}（fail-safe）');

    resetGate('sufficient'); gateDelayMs = 300;
    r = await cg.runCorpusGate(tokenData, partial, { pending: PENDING1, gateTimeoutMs: 80 });
    assert(r.skipped === false && r.ms >= 75 && r.ms < 290,
      'B5 race 上界：~80ms 返回不等桩完成（300ms）', `${r.ms}ms`);
    await sleep(350); // 排空飞行中的门桩

    cfg.corpusGate = { enabled: false };
    resetGate('sufficient');
    r = await cg.runCorpusGate(tokenData, partial,
      { config: { corpusGate: GATE_ON }, pending: PENDING1 });
    assert(r.skipped === true && gatePosts.length === 1,
      'B6 options.config 注入覆盖全局配置');
    cfg.corpusGate = GATE_ON;
  }

  // ═══ C. 资格矩阵 ═══
  console.log('══ C. 资格矩阵（pendingCorpusPlatforms / shouldAskCorpusGate）══');
  {
    const urls = {
      twitter: [{ url: 'https://x.com/a/status/1', type: 'tweet' }],
      weibo: [{ url: 'https://weibo.com/a/1', type: 'status' }],
      douyin: [{ url: 'https://douyin.com/video/1', type: 'video' }],
      github: [{ url: 'https://github.com/a/b', type: 'repo' }],
      websites: [{ url: 'https://a.com', type: 'website' }],
      telegram: [{ url: 'https://t.me/a', type: 'link' }],
    };
    const pend = cg.pendingCorpusPlatforms(urls);
    assert(JSON.stringify(pend.map(p => p.platform)) === JSON.stringify(['weibo', 'douyin', 'github']),
      'C1 清单=门管平台×URL 非空桶（twitter/websites/telegram 刻意剔除）');
    assert(pend[0].url === 'https://weibo.com/a/1' && pend[2].url === 'https://github.com/a/b',
      'C1b 取各桶首 URL（标记与 state 附加段共用）');
    assert(cg.pendingCorpusPlatforms(null).length === 0, 'C2 null classifiedUrls → []');
    cfg.corpusGate = GATE_ON;
    assert(cg.shouldAskCorpusGate({ text: 'x' }, pend) === true,
      'C3 门开+twitter+待抓 → 问门');
    assert(cg.shouldAskCorpusGate(null, pend) === false,
      'C4 twitter 缺席 → 不问门照抓（主语料无从判）');
    assert(cg.shouldAskCorpusGate({ text: 'x' }, []) === false,
      'C5 无待抓 → 不问门');
    cfg.corpusGate = { enabled: false };
    assert(cg.shouldAskCorpusGate({ text: 'x' }, pend) === false, 'C6 门关 → 不问门');
    cfg.corpusGate = GATE_ON;
  }

  // ═══ D. 源码口径锁 ═══
  console.log('══ D. 源码口径（锁防线）══');
  {
    const dfs = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    const cgs = src('src/narrative/analyzer/services/corpus-gate-service.mjs');
    const conf = JSON.parse(src('config/narrative-engine.json'));
    assert(dfs.includes("import { isCorpusGateOn, pendingCorpusPlatforms, shouldAskCorpusGate, runCorpusGate } from './corpus-gate-service.mjs';"),
      'D1 import 行');
    assert(/const twitterPromise = runTwitter\(\);\n  const pendingSources = pendingCorpusPlatforms\(classifiedUrls\);\n  const corpusGatePromise = \(async \(\) => \{\n    if \(!isCorpusGateOn\(\) \|\| pendingSources\.length === 0\) return \{ skipped: false \};/.test(dfs),
      'D2 hoist 形状+门守卫在 await twitter 前（门关零等待）');
    const iAwaitTw = dfs.indexOf('await twitterPromise.catch(() => {});');
    const iShould = dfs.indexOf('if (!shouldAskCorpusGate(results.twitterInfo, pendingSources))');
    const iGateCall = dfs.indexOf('runCorpusGate(tokenData, { ...results, extractedInfo }');
    assert(iAwaitTw !== -1 && iShould > iAwaitTw && iGateCall > iShould,
      'D3 陷阱①防线：资格判定与 {...results} 展开都在 await twitterPromise 之后（runTwitter 完成时才原地写 twitterInfo）');
    assert(dfs.includes("timing.wrap('fetch.corpusGate'"), 'D4 timing 段名 fetch.corpusGate');
    const iBucket = dfs.indexOf('const gate = await corpusGatePromise;');
    const iMark = dfs.indexOf("skipped: 'corpus_gate'");
    const iChain = dfs.indexOf('await runWeibo();');
    assert(iBucket !== -1 && iMark > iBucket && iChain > iMark,
      'D5 justoneapi 桶闭包：门判定→跳过标记→串行链序');
    assert(/const gate = await corpusGatePromise;\n      if \(gate\.skipped\) return;\n      await runGithub\(\);/.test(dfs),
      'D6 github 桶闭包受同一门判定控制');
    assert(/runWebsite\(\),\n  \]\);/.test(dfs),
      'D7 websites 桶直调不经门（websiteFetch.enabled 独立开关语义）');
    assert(/^  const runDouyin = async \(\) => \{/m.test(dfs),
      'D8 runDouyin 恢复无参原形状（门上移编排层）');
    assert(conf.corpusGate?.enabled === true && conf.corpusGate?.minSufficientProb === 0.6,
      'D9 config corpusGate 默认开');
    const iPlat = cgs.indexOf('const GATED_PLATFORMS');
    const seg = cgs.slice(iPlat, cgs.indexOf(']', iPlat));
    assert(seg.includes("'github'") && !/\['twitter'/.test(seg) && !seg.includes("'websites'"),
      'D10 门管清单含 github、剔 twitter/websites');
    assert(!fs.existsSync(path.join(ROOT, 'src/narrative/analyzer/services/douyin-gate-service.mjs'))
      && !fs.existsSync(path.join(ROOT, 'src/narrative/analyzer/llm/jev-douyingate-questions.mjs')),
      'D11 douyin 专属门文件已删（当日泛化替换，不留双机制）');
    assert(cgs.includes('JEV_CORPUSGATE_QUESTIONS_VERSION}'), 'D12 服务日志带版本常量');
  }

  // ═══ E. 端到端 fetchDataSequentially ═══
  console.log('══ E. 端到端（类静态打桩）══');
  const mkUrls = (extra = {}) => ({
    twitter: [{ url: 'https://x.com/foo/status/123', type: 'tweet' }],
    weibo: [{ url: 'https://weibo.com/foo/123', type: 'status' }],
    douyin: [{ url: 'https://douyin.com/video/1', type: 'video' }],
    github: [], tiktok: [], bilibili: [], xiaohongshu: [], instagram: [],
    weixin: [], amazon: [], telegram: [], discord: [], binanceSquare: [], websites: [],
    ...extra,
  });
  let calls, marks, twDelay;
  const mark = (t) => marks.push([t, Date.now()]);
  function resetStubs() {
    calls = { twitter: 0, weibo: 0, douyin: 0, github: 0 };
    marks = []; twDelay = 0;
    TwitterFetcher.fetchFromUrls = async () => {
      calls.twitter++; mark('tw:start'); await sleep(twDelay); mark('tw:end');
      return { type: 'tweet', id: '1', text: '主推宣告 TST' };
    };
    TwitterFetcher.enrichWithLinkContent = async (info) => info;
    WeiboFetcher.fetchFromUrl = async () => { calls.weibo++; mark('weibo:start'); return { text: 'wb' }; };
    DouyinFetcher.fetchVideoInfo = async () => { calls.douyin++; mark('dy:start'); return { title: 'dy' }; };
    DouyinFetcher.getInfluenceLevel = () => 'mid';
    DouyinFetcher.getInfluenceDescription = () => 'd';
    GithubFetcher.fetchRepoInfo = async () => { calls.github++; return { stargazers_count: 42 }; };
    GithubFetcher.getInfluenceLevel = () => 'niche';
    GithubFetcher.getInfluenceDescription = () => 'd';
    GithubFetcher.isOfficialToken = () => false;
  }
  try {
    cfg.corpusGate = GATE_ON;

    // E1 sufficient → justoneapi+github 全桶跳过
    resetGate('sufficient'); resetStubs();
    const arr1 = [];
    const r1 = await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, createSegmentTimer(arr1));
    assert(calls.twitter === 1 && calls.weibo === 0 && calls.douyin === 0 && calls.github === 0,
      'E1 sufficient → weibo/douyin/github 桩零调用（twitter 主语料照抓）');
    assert(r1.twitterInfo?.text === '主推宣告 TST' && r1.backgroundInfo === null
      && r1.douyinInfo === null && r1.githubInfo === null,
      'E1b 跳过=无该平台 URL 同形状（Info 全 null，下游零改动）');
    assert(r1.dataFetchResults.weibo?.skipped === 'corpus_gate'
      && r1.dataFetchResults.douyin?.skipped === 'corpus_gate'
      && r1.dataFetchResults.github === undefined,
      'E1c 跳过标记落在待抓平台（github 无 URL 无标记）');
    assert(r1.dataFetchResults.weibo?.url === 'https://weibo.com/foo/123'
      && r1.dataFetchResults.douyin?.url === 'https://douyin.com/video/1'
      && r1.dataFetchResults.twitter?.success === true,
      'E1d 标记带各平台首 URL；twitter 正常落 record');
    const segs1 = arr1.map(s => s.seg);
    assert(segs1.includes('fetch.corpusGate') && !segs1.includes('fetch.weibo')
      && !segs1.includes('fetch.douyin'),
      'E1e timing 有门段无抓取段（镜像 vision gate 审计口径）');
    assert(gatePosts[0]?.state.includes('- weibo: https://weibo.com/foo/123')
      && gatePosts[0]?.state.includes('- douyin: https://douyin.com/video/1'),
      'E2 门 POST state 清单含全部待抓平台');

    // E3 need_fetch → 照抓原路径
    resetGate('need_fetch'); resetStubs();
    const arr3 = [];
    const r3 = await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, createSegmentTimer(arr3));
    const segs3 = arr3.map(s => s.seg);
    assert(calls.weibo === 1 && calls.douyin === 1 && r3.backgroundInfo?.text === 'wb'
      && r3.douyinInfo?.title === 'dy',
      'E3 need_fetch → 照抓原路径（两平台数据齐落）');
    assert(segs3.includes('fetch.corpusGate') && segs3.includes('fetch.weibo')
      && segs3.includes('fetch.douyin'),
      'E3b timing 门段+抓取段都在');

    // E4 门关不等 twitter（N2 并发形状 bit 一致反证）
    cfg.corpusGate = { enabled: false };
    resetGate('sufficient'); resetStubs(); twDelay = 80;
    await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, null);
    const t4 = Object.fromEntries(marks);
    assert(t4['weibo:start'] < t4['tw:end'] && t4['dy:start'] < t4['tw:end'],
      'E4 门关 → weibo/douyin 不等 twitter（守卫包住 await 锁定）');
    assert(gatePosts.length === 0, 'E4b 门关零 POST');
    cfg.corpusGate = GATE_ON; twDelay = 0;

    // E5 无 twitter URL → 不问门照抓
    resetGate('sufficient'); resetStubs();
    await dfsMod.fetchDataSequentially(mkUrls({ twitter: [] }), tokenData, null, null);
    assert(gatePosts.length === 0 && calls.douyin === 1 && calls.weibo === 1,
      'E5 twitter 缺席 → 资格不过照抓');

    // E6 慢 twitter + 门开 → 门 POST 在 twitter 完成后
    resetGate('sufficient'); resetStubs(); twDelay = 120;
    await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, null);
    const t6 = Object.fromEntries(marks);
    assert(t6['tw:end'] <= gatePosts[0].at, 'E6 门 POST 在 twitter 完成之后（判据输入就绪）');
    twDelay = 0;

    // E7 github 单待抓 → sufficient 整桶跳过含 github
    resetGate('sufficient'); resetStubs();
    const urls7 = mkUrls({ weibo: [], douyin: [], github: [{ url: 'https://github.com/foo/bar', type: 'repo' }] });
    const r7 = await dfsMod.fetchDataSequentially(urls7, tokenData, null, null);
    assert(calls.github === 0 && r7.githubInfo === null
      && r7.dataFetchResults.github?.skipped === 'corpus_gate',
      'E7 github 待抓 → sufficient 跳过（github 桶受同一门控制）');

    // E8 websites-only → 待抓清单空不问门
    resetGate('sufficient'); resetStubs();
    await dfsMod.fetchDataSequentially(
      mkUrls({ twitter: [], weibo: [], douyin: [], websites: [{ url: 'https://a.com', type: 'website' }] }),
      tokenData, null, null);
    assert(gatePosts.length === 0, 'E8 websites-only → 不问门（websiteFetch 独立开关语义）');

    // E9 门挂起 → 2s race 上界 → fail-safe 照抓
    resetGate('sufficient'); gateDelayMs = 2300; resetStubs();
    const t9 = Date.now();
    const r9 = await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, null);
    const wall9 = Date.now() - t9;
    assert(calls.douyin === 1 && r9.douyinInfo?.title === 'dy'
      && r9.dataFetchResults.douyin?.success === true,
      'E9 门超时 → 照抓（真 record 非跳过标记）');
    assert(wall9 >= 1900, 'E9b race 真等满上限（~2s）', `${wall9}ms`);
    await sleep(400); // 排空飞行中的门桩防进程挂死

    // E10 twitter 抓取失败 → 资格不过照抓
    resetGate('sufficient'); resetStubs();
    TwitterFetcher.fetchFromUrls = async () => { throw new Error('tw down'); };
    const r10 = await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, null);
    assert(gatePosts.length === 0 && calls.douyin === 1 && r10.twitterInfo === null,
      'E10 twitter 失败 → 不问门照抓（fail-safe）');
    resetStubs();

    // E11 门 4xx → 照抓
    resetGate('sufficient'); gateStatus = 400; resetStubs();
    const r11 = await dfsMod.fetchDataSequentially(mkUrls(), tokenData, null, null);
    assert(gatePosts.length === 1 && calls.douyin === 1 && r11.douyinInfo?.title === 'dy',
      'E11 门 4xx → fail-safe 照抓');
  } finally {
    cfg.corpusGate = savedGate;
    global.fetch = realFetch;
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
