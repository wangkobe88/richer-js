#!/usr/bin/env node
/**
 * NarrativeDirectCaller 结果内存缓存（P0-3，bc4f756e 性能案 2026-09-28）——本地零 DB 单测
 *
 *   A. live 默认关：无参构造 → 同 token 重复调用仍每次真调（零行为变化）
 *   B. 缓存谓词八路：rating 2/3+干净形状缓存；1/9/超时/错误/precheck-fail 形状不缓存
 *   C. 命中行为：rating=2 二调 fromMemoryCache=true / durationMs=0 / analyze 仅 1 次
 *   D. 命中透传字段完整：除标记位外逐字段相等（sourceTweetId/gmgnRisk/precheckStage）
 *   E. 不缓存形状二次真调：rating=1（拉黑承担）/ rating=9 超时 / address 形状
 *   F. key 小写归一：大小写混用地址命中同一缓存槽
 *
 * 用法：node scripts/_test_narrative_memcache.cjs
 */

'use strict';

const { NarrativeDirectCaller } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

/** 打桩 _getAnalyzer：计数 + 固定返回形状 */
function stubAnalyzer(caller, analyzeFn) {
  let calls = 0;
  caller._getAnalyzer = async () => ({ analyze: async (...a) => { calls++; return analyzeFn(...a); } });
  return () => calls;
}

function analyzeResult(over = {}) {
  return Object.assign({
    numericRating: 2, rating: 'medium', reason: null, meta: {},
    classifiedUrls: null, gmgnRisk: null, llmAnalysis: null,
  }, over);
}

async function main() {
  console.log('A. live 默认关（无参构造零行为变化）');
  {
    const caller = new NarrativeDirectCaller();
    const getCalls = stubAnalyzer(caller, () => analyzeResult());
    await caller.getRating('0xabc');
    await caller.getRating('0xabc');
    check('两次调用 analyze 均真调（无内存缓存）', getCalls() === 2);
    check('命中计数恒 0', caller.getMemoryCacheHits() === 0);
  }

  console.log('B. 缓存谓词八路');
  {
    const c = new NarrativeDirectCaller({ memoryCacheResults: true });
    const p = (r) => c._isCacheableRatingResult(Object.assign(
      { numericRating: 2, timedOut: false, error: null, precheckStage: null }, r));
    check('rating=2 干净形状 → 缓存', p({ numericRating: 2 }) === true);
    check('rating=3 干净形状 → 缓存', p({ numericRating: 3 }) === true);
    check('rating=1 → 不缓存（引擎侧拉黑承担）', p({ numericRating: 1 }) === false);
    check('rating=9 → 不缓存（保留重试）', p({ numericRating: 9 }) === false);
    check('timedOut → 不缓存', p({ timedOut: true }) === false);
    check('error → 不缓存', p({ error: 'boom' }) === false);
    check("precheckStage='address' → 不缓存（重试域可翻正）", p({ precheckStage: 'address' }) === false);
    check("precheckStage='no_public_info' → 不缓存（1800s 重试域同理）", p({ numericRating: 3, precheckStage: 'no_public_info' }) === false);
  }

  console.log('C. 命中行为');
  {
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    const getCalls = stubAnalyzer(caller, () => analyzeResult({ numericRating: 2 }));
    const r1 = await caller.getRating('0xabc');
    const r2 = await caller.getRating('0xabc');
    check('analyze 仅真调 1 次', getCalls() === 1);
    check('二调 fromMemoryCache=true / durationMs=0', r2.fromMemoryCache === true && r2.durationMs === 0,
      JSON.stringify(r2));
    check('首调无 fromMemoryCache 标记', r1.fromMemoryCache === undefined);
    check('命中计数 1', caller.getMemoryCacheHits() === 1);
  }

  console.log('D. 命中透传字段完整');
  {
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    stubAnalyzer(caller, () => analyzeResult({
      numericRating: 3,
      classifiedUrls: { twitter: [{ url: 'https://x.com/a/status/123456' }] },
      gmgnRisk: { issuerTokenCount: 4, bundlerWallets: 3, topWallets: 46 },
      llmAnalysis: { preCheck: null },
      reason: 'ok-case',
      meta: { fromCache: true },
    }));
    const r1 = await caller.getRating('0xabc');
    const r2 = await caller.getRating('0xabc');
    const fields = ['numericRating', 'rating', 'reason', 'fromCache', 'timedOut', 'error',
      'sourceTweetId', 'gmgnRisk', 'precheckStage'];
    const allEq = fields.every(f => JSON.stringify(r1[f]) === JSON.stringify(r2[f]));
    check('九字段逐项相等（含 sourceTweetId/gmgnRisk/precheckStage）', allEq,
      fields.filter(f => JSON.stringify(r1[f]) !== JSON.stringify(r2[f])).join(','));
    check('透传关键值抽查（tweetId 提取 / gmgnRisk 对象）',
      r2.sourceTweetId === '123456' && r2.gmgnRisk.issuerTokenCount === 4);
  }

  console.log('E. 不缓存形状二次真调');
  {
    const c1 = new NarrativeDirectCaller({ memoryCacheResults: true });
    const g1 = stubAnalyzer(c1, () => analyzeResult({ numericRating: 1 }));
    await c1.getRating('0xabc'); await c1.getRating('0xabc');
    check('rating=1 不缓存（两次真调）', g1() === 2);

    const c2 = new NarrativeDirectCaller({ memoryCacheResults: true });
    const g2 = stubAnalyzer(c2, () => { throw new Error('timeout-boom'); });
    await c2.getRating('0xabc'); await c2.getRating('0xabc');
    check('异常(rating=9) 不缓存（两次真调）', g2() === 2);

    const c3 = new NarrativeDirectCaller({ memoryCacheResults: true });
    const g3 = stubAnalyzer(c3, () => analyzeResult({
      numericRating: 2,
      llmAnalysis: { preCheck: { details: { validationStage: 'address' } } },
    }));
    await c3.getRating('0xabc'); await c3.getRating('0xabc');
    check('address 形状 rating=2 不缓存（两次真调）', g3() === 2);
  }

  console.log('F. key 小写归一');
  {
    const caller = new NarrativeDirectCaller({ memoryCacheResults: true });
    const getCalls = stubAnalyzer(caller, () => analyzeResult({ numericRating: 3 }));
    await caller.getRating('0xABCdef');
    const r = await caller.getRating('0xabcDEF');
    check('大小写混用地址命中同一缓存槽（真调 1 次）', getCalls() === 1 && r.fromMemoryCache === true);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exitCode = 1;
});
