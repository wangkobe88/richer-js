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

  // ── C. preloadCache 过滤矩阵（真 NarrativeAnalyzer + 两段式方法打桩） ──
  console.log('C. NarrativeAnalyzer.preloadCache 可预载行判定');
  {
    const { NarrativeAnalyzer } = await import('../src/narrative/analyzer/NarrativeAnalyzer.mjs');
    const { NarrativeRepository } = await import('../src/narrative/db/NarrativeRepository.mjs');
    const mk = (addr, over = {}) => ({ id: 0, token_address: addr, analyzed_at: '2026-10-01T00:00:00Z', pre_check_result: null, classified_urls: null, ...over });
    // 轻列行（fetchPreloadLightRows 形状：id/token_address/analyzed_at/pre_check_result/classified_urls）
    const lightRows = [
      mk('0xok', { id: 1 }),
      // 同地址双过票行：旧行带语料键，新行无 → 胜者=新行，但旧行键仍收集（前身逐行收集不撤销）
      mk('0xdup', { id: 2, analyzed_at: '2026-10-01T00:00:00Z', classified_urls: { twitter: [{ url: 'https://x.com/d/status/old', type: 'tweet' }] } }),
      mk('0xdup', { id: 3, analyzed_at: '2026-10-02T00:00:00Z' }),
      // 同地址 analyzed_at 平局 → id 大者胜（后写）
      mk('0xtie', { id: 4, analyzed_at: '2026-10-03T00:00:00Z' }),
      mk('0xtie', { id: 5, analyzed_at: '2026-10-03T00:00:00Z' }),
      // 未过票行不夺胜：旧过票行后到一行 no_public_info（未过票不覆盖）→ 胜者仍是旧过票行
      mk('0xkeep', { id: 6, analyzed_at: '2026-10-01T00:00:00Z' }),
      mk('0xkeep', { id: 7, analyzed_at: '2026-10-02T00:00:00Z', pre_check_result: { details: { ruleName: 'no_public_info' } } }),
      // no_public_info 客户端排除（jsonb 路径断言留在 JS：pre_check_result NULL 行必须通过）
      mk('0xnopub', { id: 8, pre_check_result: { details: { ruleName: 'no_public_info' } } }),
      // analyzed_at NULL 视最早：同地址 NULL 行不夺非 NULL 胜者
      mk('0xnullts', { id: 9, analyzed_at: null }),
      mk('0xnullts', { id: 10, analyzed_at: '2026-09-01T00:00:00Z' }),
      mk('0xtw', { id: 11, classified_urls: { twitter: [
        { url: 'https://x.com/t/status/9', type: 'tweet' },
        { url: 'https://x.com/i/communities/77', type: 'community' },
        { url: 'https://x.com/t/status/10', type: 'tweet' }, // 第二推文 get('tweet')
      ] } }),
      mk('0xother', { id: 12 }), // 不在 token 集合 → 交集外
    ];
    // 全列行仓库（fetchRowsByIds 按胜者 id 回填）：轻列 id → 全列行（带 is_valid 等全字段）
    const fullById = new Map([
      [1, { id: 1, token_address: '0xok', is_valid: true, analyzed_at: '2026-10-01T00:00:00Z' }],
      [3, { id: 3, token_address: '0xdup', is_valid: true, analyzed_at: '2026-10-02T00:00:00Z' }],
      [5, { id: 5, token_address: '0xtie', is_valid: true, analyzed_at: '2026-10-03T00:00:00Z' }],
      [6, { id: 6, token_address: '0xkeep', is_valid: true, analyzed_at: '2026-10-01T00:00:00Z' }],
      [10, { id: 10, token_address: '0xnullts', is_valid: true, analyzed_at: '2026-09-01T00:00:00Z' }],
      [11, { id: 11, token_address: '0xtw', is_valid: true, classified_urls: lightRows[10].classified_urls }],
    ]);
    const origLight = NarrativeRepository.fetchPreloadLightRows;
    const origByIds = NarrativeRepository.fetchRowsByIds;
    const origPreloadKeys = ERC.preloadByKeys;
    let lightCallCount = 0, idsArg = null, preloadKeysArg = null;
    NarrativeRepository.fetchPreloadLightRows = async () => { lightCallCount++; return lightRows; };
    NarrativeRepository.fetchRowsByIds = async (ids) => { idsArg = ids; return ids.map(id => fullById.get(id)).filter(Boolean); };
    ERC.preloadByKeys = async (keys) => { preloadKeysArg = keys; return keys.length; };
    try {
      const r = await NarrativeAnalyzer.preloadCache(['0xOK', '0xinvalid', '0xnopub', '0xnogmgn', '0xdup', '0xtie', '0xkeep', '0xnullts', '0xtw']);
      eq('C1 胜者装 rowCache（ok/dup新/tie id大/keep旧行/nullts 非空）', [...r.rowCache.keys()].sort(), ['0xdup', '0xkeep', '0xnullts', '0xok', '0xtie', '0xtw']);
      eq('C2 同地址留最新过票行', r.rowCache.get('0xdup').analyzed_at, '2026-10-02T00:00:00Z');
      eq('C2b analyzed_at 平局 id 大者胜', r.rowCache.get('0xtie').id, 5);
      eq('C2c 未过票行不夺胜（no_public_info 不覆盖旧过票行）', r.rowCache.get('0xkeep').analyzed_at, '2026-10-01T00:00:00Z');
      eq('C2d analyzed_at NULL 视最早不夺胜', r.rowCache.get('0xnullts').id, 10);
      eq('C3 仅按胜者 id 拉全列（第二段不去全表）', idsArg.sort((a, b) => a - b), [1, 3, 5, 6, 10, 11]);
      eq('C3b 轻列扫描恰一次（键集全表扫）', lightCallCount, 1);
      eq('C4 语料键收集（含被覆盖旧行 + community→twitter_community 映射）', preloadKeysArg, [
        ['tweet', 'https://x.com/d/status/old'],
        ['tweet', 'https://x.com/t/status/9'],
        ['twitter_community', 'https://x.com/i/communities/77'],
        ['tweet', 'https://x.com/t/status/10'],
      ]);
      eq('C5 tweetRows 透传', r.tweetRows, 4);
      // 空集合早退（零查询）
      lightCallCount = 0;
      const r2 = await NarrativeAnalyzer.preloadCache([]);
      eq('C6 空 token 集合 → 空 rowCache 零扫描', [r2.rowCache.size, r2.tweetRows, lightCallCount], [0, 0, 0]);
    } finally {
      NarrativeRepository.fetchPreloadLightRows = origLight;
      NarrativeRepository.fetchRowsByIds = origByIds;
      ERC.preloadByKeys = origPreloadKeys;
    }
  }

  // ── D. 源码口径（analyze rowCache 分支 / BacktestEngine 挂点 / fetchAllRows 分页） ──
  console.log('D. 源码口径');
  {
    const analyzerSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/analyzer/NarrativeAnalyzer.mjs'), 'utf8');
    eq('D1 analyze 预载行优先（miss 现场 DB 查原路径）',
      /const cached = \(rowCache && rowCache\.get\(normalizedAddress\)\)\n\s*\|\| await timing\.wrap\('cacheLookup', \(\) => NarrativeRepository\.findByAddress\(normalizedAddress\)\);/.test(analyzerSrc), true);
    // N2（2026-10-13 叙事提速）在解构尾加 skipIntermediateSave = false；C63 批 1B 又加
    // visionPrefetch = false 收尾——rowCache 键保持（尾键非 skipIntermediateSave 时须跟着放宽）
    eq('D2 analyze options 解构 rowCache', /rowCache = null, skipIntermediateSave = false(, \w+ = \w+)* \} = options/.test(analyzerSrc), true);
    const repSrc = fs.readFileSync(path.join(__dirname, '../src/narrative/db/NarrativeRepository.mjs'), 'utf8');
    eq('D3 两段式查询形状：轻列键集（id 升序 + .gt 键集 + is_valid/gmgn DB 谓词）+ 全列按 id 批 50',
      /fetchPreloadLightRows[\s\S]*?\.select\('id,token_address,analyzed_at,pre_check_result,classified_urls'\)[\s\S]*?\.eq\('is_valid', true\)[\s\S]*?\.not\('gmgn_info', 'is', null\)[\s\S]*?\.order\('id', \{ ascending: true \}\)[\s\S]*?q\.gt\('id', lastId\)/.test(repSrc)
      && /fetchRowsByIds[\s\S]*?\.select\('\*'\)[\s\S]*?\.in\('id', ids\.slice\(i, i \+ CHUNK\)\)/.test(repSrc)
      && repSrc.includes('const CHUNK = 50;'), true);
    // 事故形状 = fetchAllRows 的「循环 offset 翻页 + select *」。findByAddress（单行
    // maybeSingle）/findAll（web 路由单页 limit）是合法保留的 select('*')，不作跨方法
    // 宽匹配——只断言前身方法与 preload 调用点双双不存在
    eq('D3b offset 循环全列拉取已移除（statement timeout 事故形状防回归）',
      /static\s+async\s+fetchAllRows/.test(repSrc) || analyzerSrc.includes('fetchAllRows'), false);
    const beSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
    // C84（2026-10-17）门扩：narrativeCallCondition（legacy 直调）∨ narrativeTriggerCondition
    //（触发腿，rating 预载 FA 常量）任一携带即预载
    eq('D4 BacktestEngine 挂点：narrativeCallCondition/narrativeTriggerCondition 实验预载',
      /getAllStrategies\(\)\.some\(s => s\.action === 'buy'\n      && \(s\.narrativeCallCondition \|\| s\.narrativeTriggerCondition\)\)/.test(beSrc)
      && /this\._narrativeCaller\.preload\(\[\.\.\.this\._tokenMeta\.keys\(\)\]\)/.test(beSrc)
      && /setNarrativeFactors\(addr, \{/.test(beSrc), true);
    const dcSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/pre-check/NarrativeDirectCaller.js'), 'utf8');
    eq('D5 直调透传形状（rowCache: this._rowCache || undefined）',
      /rowCache: this\._rowCache \|\| undefined/.test(dcSrc), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
