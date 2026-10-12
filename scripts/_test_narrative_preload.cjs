#!/usr/bin/env node
// 叙事预载单测（回测性能 2026-10-12）：回放中每 token 首次直调的 2 次 DB 往返
// （token_narrative 行 + 语料推文缓存行，e50 实测 4007 次 × 34ms = 137s）→ 装载时
// 批量预拉灌内存层。行为 bit-identical：预载行 = analyze 命中路径原样返回的行。
//
// 零 DB 零网络：dbManager.getSupabase / NarrativeRepository 静态方法 / ExternalResourceCache
// 静态方法打桩（ESM 类对象的 static 方法属性可在导入侧覆盖，调用时属性查找可见）。
// 用法：node scripts/_test_narrative_preload.cjs
'use strict';

const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { NarrativeDirectCaller } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const eq = (name, v, expected) => check(name, v, expected);

async function main() {
  // ── A. ExternalResourceCache 预载层（真 ESM 模块 + dbManager.getSupabase 打桩） ──
  console.log('A. ExternalResourceCache 预载层（preloadByKeys + get 短路）');
  const ERC = (await import('../src/narrative/db/ExternalResourceCache.mjs')).ExternalResourceCache;
  {
    let dbCalls = 0;
    const rows = [
      { url: 'https://x.com/a/status/1', resource_type: 'tweet', status: 'success', content: { id_str: '1' }, expires_at: null },
      { url: 'https://x.com/a/status/2', resource_type: 'tweet', status: 'success', content: { id_str: '2' }, expires_at: '2020-01-01T00:00:00Z' },
    ];
    dbManager.getSupabase = () => {
      dbCalls++;
      return { from: () => ({ select: () => ({ eq: () => ({ in: async (_col, arr) => ({ data: rows.filter(r => arr.includes(r.url)) }) }) }) }) };
    };
    const n = await ERC.preloadByKeys([['tweet', 'https://x.com/a/status/1'], ['tweet', 'https://x.com/a/status/2'], ['tweet', 'https://x.com/a/status/1']]);
    eq('A1 去重后灌入 2 行（重复键单次）', n, 2);
    eq('A2 DB 批量调用 1 次（3 键 2 URL 一批）', dbCalls, 1);

    dbCalls = 0;
    const hit = await ERC.get('https://x.com/a/status/1', 'tweet', { maxAge: 365 * 86400 });
    eq('A3 预载命中 → content 零 DB', [hit, dbCalls], [{ id_str: '1' }, 0]);
    const stale = await ERC.get('https://x.com/a/status/2', 'tweet', { maxAge: 60 });
    eq('A4 expires_at 早于 now-maxAge → null（与 DB or 条件一致的 miss 语义）', stale, null);

    dbManager.getSupabase = () => {
      dbCalls++;
      return { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ or: () => ({ maybeSingle: async () => ({ data: { content: { fromDb: true } } }) }) }) }) }) }) }) };
    };
    const miss = await ERC.get('https://x.com/x/other', 'tweet', {});
    eq('A5 无键 → 原路径查询', miss, { fromDb: true });
    ERC._preloadStore.clear();
  }

  // ── B. NarrativeDirectCaller.preload / rowCache 透传（_getAnalyzer 打桩） ──
  console.log('B. NarrativeDirectCaller 预载接线');
  {
    let capturedOpts = null; let preloadCallCount = 0;
    const fakeRowCache = new Map([['0xabc', { token_address: '0xabc', is_valid: true }]]);
    const FakeAnalyzer = {
      preloadCache: async (addrs) => { preloadCallCount++; return { rowCache: fakeRowCache, tweetRows: 7 }; },
      analyze: async (addr, opts) => { capturedOpts = opts; return { numericRating: 3, rating: 'high', meta: { fromCache: true } }; },
    };
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    caller._getAnalyzer = async () => FakeAnalyzer;

    const r = await caller.preload(['0xABC', '0xdef']);
    eq('B1 preload 返回统计并灌 _rowCache', [preloadCallCount, r.tweetRows, caller._rowCache === fakeRowCache], [1, 7, true]);

    const rr = await caller.getRating('0xabc');
    eq('B2 getRating 端到端（假 analyze 命中返回）', [rr.numericRating, rr.rating, rr.fromCache], [3, 'high', true]);
    eq('B3 _startAnalysis 透传 rowCache 给 analyze', capturedOpts.rowCache === fakeRowCache, true);
    eq('B4 enrichSocialByGmgn 直调语义保持', capturedOpts.enrichSocialByGmgn, true);

    const caller2 = new NarrativeDirectCaller({ memoryCacheResults: true });
    caller2._getAnalyzer = async () => FakeAnalyzer;
    await caller2.getRating('0xabc');
    eq('B5 未 preload → rowCache undefined（实时链路原行为）', capturedOpts.rowCache, undefined);
  }

  // ── C. preloadCache 过滤矩阵（真 NarrativeAnalyzer + 静态方法打桩） ──
  console.log('C. NarrativeAnalyzer.preloadCache 可预载行判定');
  {
    const { NarrativeAnalyzer } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');
    const { NarrativeRepository } = await import('../src/narrative/db/NarrativeRepository.mjs');
    const mk = (addr, over = {}) => ({ token_address: addr, is_valid: true, gmgn_info: { risk: null }, pre_check_result: null, classified_urls: null, analyzed_at: '2026-10-01T00:00:00Z', ...over });
    const rows = [
      mk('0xok'), // 三条件齐 → 进
      mk('0xinvalid', { is_valid: false }), // 排除：invalid → 回放重析
      mk('0xnopub', { pre_check_result: { details: { ruleName: 'no_public_info' } } }), // 排除：穿透重析域
      mk('0xnogmgn', { gmgn_info: null }), // 排除：命中分支补调 GMGN
      // 同地址双行：升序遍历后写覆盖 → 留 analyzed_at 最新
      mk('0xdup', { analyzed_at: '2026-10-01T00:00:00Z', is_valid: false }),
      mk('0xdup', { analyzed_at: '2026-10-02T00:00:00Z' }),
      mk('0xtw', { classified_urls: { twitter: [
        { url: 'https://x.com/t/status/9', type: 'tweet' },
        { url: 'https://x.com/i/communities/77', type: 'community' },
        { url: 'https://x.com/t/status/10', type: 'tweet' }, // 第二推文 get('tweet')
      ] } }),
      mk('0xother'), // 不在 token 集合 → 交集外
    ];
    const origFetch = NarrativeRepository.fetchAllRows;
    const origPreloadKeys = ERC.preloadByKeys;
    let preloadKeysArg = null;
    NarrativeRepository.fetchAllRows = async () => rows;
    ERC.preloadByKeys = async (keys) => { preloadKeysArg = keys; return keys.length; };
    try {
      const r = await NarrativeAnalyzer.preloadCache(['0xOK', '0xinvalid', '0xnopub', '0xnogmgn', '0xdup', '0xtw']);
      eq('C1 可预载 4 行（ok/dup最新/tw + 排除 3 形状）', [...r.rowCache.keys()].sort(), ['0xdup', '0xok', '0xtw']);
      eq('C2 同地址留最新行（升序覆盖）', r.rowCache.get('0xdup').analyzed_at, '2026-10-02T00:00:00Z');
      eq('C3 语料键收集（community→twitter_community 映射）', preloadKeysArg, [
        ['tweet', 'https://x.com/t/status/9'],
        ['twitter_community', 'https://x.com/i/communities/77'],
        ['tweet', 'https://x.com/t/status/10'],
      ]);
      eq('C4 tweetRows 透传', r.tweetRows, 3);
      // 空集合早退
      const r2 = await NarrativeAnalyzer.preloadCache([]);
      eq('C5 空 token 集合 → 空 rowCache 不拉全表', [r2.rowCache.size, r2.tweetRows], [0, 0]);
    } finally {
      NarrativeRepository.fetchAllRows = origFetch;
      ERC.preloadByKeys = origPreloadKeys;
    }
  }

  // ── D. 源码口径（analyze rowCache 分支 / BacktestEngine 挂点 / fetchAllRows 分页） ──
  console.log('D. 源码口径');
  {
    const analyzerSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
    eq('D1 analyze 预载行优先（miss 现场 DB 查原路径）',
      /const cached = \(rowCache && rowCache\.get\(normalizedAddress\)\)\n\s*\|\| await NarrativeRepository\.findByAddress\(normalizedAddress\);/.test(analyzerSrc), true);
    eq('D2 analyze options 解构 rowCache', /rowCache = null \} = options/.test(analyzerSrc), true);
    const repSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'), 'utf8');
    eq('D3 fetchAllRows 分页 500 + analyzed_at 升序 nullsFirst（覆盖留最新口径）',
      /order\('analyzed_at', \{ ascending: true, nullsFirst: true \}\)/.test(repSrc)
      && repSrc.includes('range(offset, offset + 499)'), true);
    const beSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    eq('D4 BacktestEngine 挂点：仅 narrativeCallCondition 实验预载',
      /getAllStrategies\(\)\.some\(s => s\.action === 'buy' && s\.narrativeCallCondition\)/.test(beSrc)
      && /this\._narrativeCaller\.preload\(\[\.\.\.this\._tokenMeta\.keys\(\)\]\)/.test(beSrc), true);
    const dcSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/pre-check/NarrativeDirectCaller.js'), 'utf8');
    eq('D5 直调透传形状（rowCache: this._rowCache || undefined）',
      /rowCache: this\._rowCache \|\| undefined/.test(dcSrc), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
