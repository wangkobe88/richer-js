#!/usr/bin/env node
/**
 * N1 分段计时探针单测（2026-10-13 叙事提速案）——本地零 DB 零网络
 *
 *   A. segment-timer 单元：旁路模式零开销/active 落段/同名段多行/异常路径也落/
 *      未 start 的 end 空操作/wrap 返回值透传
 *   B. NarrativeDirectCaller 透传：_timing 数组传入 analyze options/成功路径带
 *      timing 快照/inflight join 共享同一数组/异常路径 timing=null/fromCache 命中
 *      只含命中段（引用共享实证）/memoryCache 命中透传
 *   C. 行为级（真 ESM data-fetch-service + 类静态方法打桩）：timing 从
 *      fetchAllDataViaClassifier 透传到 fetchDataSequentially，平台段名 fetch.twitter
 *   D. 源码口径断言（项目惯例锁防线）：NarrativeAnalyzer 12 段 wrap / data-fetch
 *      全链接线（options.timing + ipfs/gmgn + recordDataFetch 四参 + 13 平台实参）/
 *      引擎慢调用日志行
 *
 * 用法：node scripts/_test_narrative_timing_probe.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { NarrativeDirectCaller } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra ? ` | ${extra}` : ''}`); }
}
function src(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

async function main() {
  // ═══ A. segment-timer 单元 ═══
  console.log('══ A. segment-timer 单元（真 ESM 模块）══');
  const { createSegmentTimer } = await import('../src/narrative/utils/segment-timer.mjs');
  {
    const idle = createSegmentTimer(null);
    assert(idle.active === false, 'A1 非数组 sink → 旁路模式');
    const v = await idle.wrap('x', async () => 42);
    assert(v === 42, 'A2 旁路 wrap 返回值透传');

    const sink = [];
    const t = createSegmentTimer(sink);
    assert(t.active === true, 'A3 数组 sink → active');
    await t.wrap('seg1', async () => { /* 空转 */ });
    t.start('seg2'); t.end('seg2');
    await t.wrap('seg1', async () => { /* 再来一次 */ });
    const seg1 = sink.filter(r => r.seg === 'seg1');
    assert(sink.length === 3 && seg1.length === 2, 'A4 同名段多次 push 多行', JSON.stringify(sink));
    assert(sink.every(r => typeof r.ms === 'number' && r.ms >= 0), 'A5 段形状 {seg, ms>=0}');

    t.end('never-started'); // 未 start 的 end
    assert(sink.length === 3, 'A6 未 start 的 end 空操作不落行');

    let threw = null;
    try { await t.wrap('boom', async () => { throw new Error('x'); }); } catch (e) { threw = e; }
    assert(threw && sink.some(r => r.seg === 'boom'), 'A7 异常路径段仍落（finally）');
  }

  // ═══ B. NarrativeDirectCaller 透传（打桩 _getAnalyzer，先例 _test_narrative_memcache）═══
  console.log('══ B. NarrativeDirectCaller 透传 ═══');
  const analyzeResult = (over = {}) => Object.assign({
    numericRating: 2, rating: 'medium', reason: null, meta: {},
    classifiedUrls: null, gmgnRisk: null, llmAnalysis: null,
  }, over);
  {
    // B1/B2: _timing 数组传入 options + 成功路径 timing 快照
    const caller = new NarrativeDirectCaller();
    let capturedOpts = null;
    caller._getAnalyzer = async () => ({
      analyze: async (_addr, opts) => {
        capturedOpts = opts;
        if (Array.isArray(opts._timing)) {
          opts._timing.push({ seg: 'fetch.twitter', ms: 123 }, { seg: 'jev.standard', ms: 45 });
        }
        return analyzeResult();
      },
    });
    const r = await caller.getRating('0xabc');
    assert(Array.isArray(capturedOpts?._timing), 'B1 _timing 数组传入 analyze options');
    assert(Array.isArray(r.timing) && r.timing.length === 2 && r.timing[0].seg === 'fetch.twitter',
      'B2 成功路径带 timing 快照', JSON.stringify(r.timing));
  }
  {
    // B3: inflight join 共享同一数组（并发两调，analyze 慢）
    const caller = new NarrativeDirectCaller();
    let analyzeCalls = 0;
    caller._getAnalyzer = async () => ({
      analyze: async (_addr, opts) => {
        analyzeCalls++;
        await new Promise(res => setTimeout(res, 30));
        if (Array.isArray(opts._timing)) opts._timing.push({ seg: 'total-ish', ms: 30 });
        return analyzeResult();
      },
    });
    const [r1, r2] = await Promise.all([caller.getRating('0xjoin'), caller.getRating('0xJOIN')]);
    assert(analyzeCalls === 1, 'B3a inflight 去重 analyze 仅 1 次（大小写归一）');
    assert(Array.isArray(r1.timing) && r1.timing.length === 1
      && Array.isArray(r2.timing) && r2.timing.length === 1,
      'B3b join 双方均拿到共享数组的分段', JSON.stringify([r1.timing, r2.timing]));
  }
  {
    // B4: 异常路径 timing=null
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({ analyze: async () => { throw new Error('boom'); } });
    const r = await caller.getRating('0xerr');
    assert(r.error === 'boom' && r.timing === null, 'B4 异常路径 timing=null');
  }
  {
    // B5: fromCache 命中路径——引用共享实证（analyze 真塞段进 _timing，结果原样带出）
    const caller = new NarrativeDirectCaller();
    caller._getAnalyzer = async () => ({
      analyze: async (_addr, opts) => {
        opts._timing.push({ seg: 'cacheLookup', ms: 8 }, { seg: 'reassemble', ms: 5 });
        return analyzeResult({ meta: { fromCache: true } });
      },
    });
    const r = await caller.getRating('0xcached');
    assert(r.fromCache === true && r.timing.length === 2 && r.timing[0].seg === 'cacheLookup',
      'B5 fromCache 命中 timing=命中段（引用共享）', JSON.stringify(r.timing));
  }
  {
    // B6: memoryCache 命中透传 timing（回测 opt-in 链路）
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    caller._getAnalyzer = async () => ({
      analyze: async (_addr, opts) => {
        opts._timing.push({ seg: 'jev.standard', ms: 10 });
        return analyzeResult({ numericRating: 2 });
      },
    });
    await caller.getRating('0xmc');
    const r2 = await caller.getRating('0xmc');
    assert(r2.fromMemoryCache === true && Array.isArray(r2.timing) && r2.timing[0].seg === 'jev.standard',
      'B6 memoryCache 命中 timing 透传', JSON.stringify(r2.timing));
  }

  // ═══ C. 行为级：data-fetch-service 透传链（真 ESM + 类静态方法打桩）═══
  console.log('══ C. data-fetch-service 行为级透传 ═══');
  {
    const dfs = await import('../src/narrative/analyzer/services/data-fetch-service.mjs');
    const { TwitterFetcher } = await import('../src/narrative/utils/twitter-fetcher.mjs');
    let twitterCalls = 0;
    TwitterFetcher.fetchFromUrls = async () => {
      twitterCalls++;
      return { type: 'tweet', id: '1', text: 'hello' }; // 无链接 → enrichWithLinkContent 不触发（info.text 有值但桩链不真跑）
    };
    TwitterFetcher.enrichWithLinkContent = async (info) => info;
    const sink = [];
    const timing = createSegmentTimer(sink);
    const tokenData = {
      address: '0xfeed',
      raw_api_data: { twitter: 'https://x.com/foo/status/123' },
    };
    const r = await dfs.fetchAllDataViaClassifier(tokenData, {}, { timing });
    assert(twitterCalls === 1, 'C1 twitter 桩被调用');
    assert(r.twitterInfo && r.twitterInfo.text === 'hello', 'C2 数据返回形状不变');
    const segs = sink.map(s => s.seg);
    assert(segs.includes('fetch.twitter'), 'C3 timing 透传到平台段 fetch.twitter', JSON.stringify(segs));
  }

  // ═══ D. 源码口径断言（锁防线，项目惯例）═══
  console.log('══ D. 源码口径断言 ═══');
  {
    const na = src('src/narrative/analyzer/NarrativeAnalyzer.mjs');
    for (const seg of ['cacheLookup', 'tokenData', 'dbSave.intermediate', 'accountCollect',
      'issuerCa', 'precheck', 'vision', 'jev.prestage', 'jev.superip', 'jev.standard',
      'dbSave.final', 'reassemble']) {
      assert(na.includes(`timing.wrap('${seg}'`), `D1 NarrativeAnalyzer 段 ${seg} 存在`);
    }
    assert(na.includes('createSegmentTimer(options._timing)'), 'D2 analyze 入口 _timing → collector');
    assert(na.includes('{ enrichSocialByGmgn, timing }'), 'D3 timing 传入 fetchAllDataViaClassifier');
    // accountCollect 三处调用点（主路径/项目币 twitterInfo/issuer 补收）+ getFullAccountInfo
    const acCount = (na.match(/timing\.wrap\('accountCollect'/g) || []).length;
    assert(acCount === 4, `D4 accountCollect 4 处 wrap（3×collect + 1×getFullAccountInfo）`, String(acCount));

    const dfs = src('src/narrative/analyzer/services/data-fetch-service.mjs');
    assert(dfs.includes("timing.wrap('ipfs'"), 'D5 ipfs 段 wrap');
    assert(dfs.includes("timing.wrap('gmgn'"), 'D6 gmgn 段 wrap');
    assert(dfs.includes("timing.wrap('fetch.weibo'"), 'D7 微博段手动 wrap');
    assert(/export async function recordDataFetch\(fetcherFn, platform, url, timing\)/.test(dfs),
      'D8 recordDataFetch 四参签名');
    // 13 平台全覆盖 = 11× xxxUrlInfo.url + 1× websiteUrl 的 recordDataFetch 实参（12）
    // + 微博手动 wrap（D7 单独锁）；twitter/github/youtube/douyin/tiktok/bilibili/
    // binanceSquare/weixin/amazon/xiaohongshu/instagram 共 11 个 UrlInfo 调用点
    const argCount = (dfs.match(/UrlInfo\.url, timing/g) || []).length
      + (dfs.match(/websiteUrl, timing/g) || []).length;
    assert(argCount === 12, `D9 recordDataFetch 12 调用点全带 timing 实参（+微博 D7=13 平台）`, String(argCount));
    assert(dfs.includes('fetchDataSequentially(classifiedUrls, tokenData, extractedInfo, timing)'),
      'D10 fetchDataSequentially 透传 timing');
    assert(dfs.includes('timing.start(`fetch.${platform}`)') && dfs.includes('timing.end(`fetch.${platform}`)'),
      'D11 recordDataFetch 内 fetch.<platform> 段（成功/失败两路径）');

    const ndc = src('src/trading-engine/pre-check/NarrativeDirectCaller.js');
    assert(ndc.includes('_timing: timingSink,'), 'D12 _startAnalysis 透传 _timing');
    assert(ndc.includes('entry.timing.slice()'), 'D13 成功路径 timing 快照');

    const eng = src('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    assert(eng.includes('叙事直调分段') && eng.includes('narrativeCallInfo.timing'),
      'D14 引擎慢调用（≥3s）top3 分段日志');
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
