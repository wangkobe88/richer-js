#!/usr/bin/env node
/**
 * C144：叙事 save 载荷非法 Unicode 清洗（PGRST102 lone surrogate/NUL）——零 DB 零网络单测
 *
 * 事故现场（2026-10-21 全量 case-regression C133 股城）：
 * searchFallback 推文文本截断在 emoji 代理对中间（结尾 \ud83d 单高代理）→
 * JSON.stringify 产出 lone surrogate escape → PostgREST PGRST102「Empty or invalid json」
 * → 整条 token_narrative 行保存失败。NUL（\u0000）Postgres 同样不接受。
 *
 * 用法：node scripts/_test_narrative_save_sanitize.cjs
 */
'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

(async () => {
  const { sanitizeJsonValue } = await import('../src/narrative/db/NarrativeRepository.mjs');

  console.log('\n── A. 字符串清洗 ──');
  const stats = { replaced: 0 };
  check('A1 合法代理对（😀）原样保留',
    sanitizeJsonValue('a😀b', stats) === 'a😀b', sanitizeJsonValue('a😀b'));
  check('A2 孤立高代理（\ud83d）→ U+FFFD', sanitizeJsonValue('x\ud83d', stats) === 'x�');
  check('A3 孤立低代理（\udc00）→ U+FFFD', sanitizeJsonValue('\udc00y', stats) === '�y');
  check('A4 NUL（\u0000）→ U+FFFD', sanitizeJsonValue('a\u0000b', stats) === 'a�b');
  check('A5 stats 计数=3（A2/A3/A4 各一处）', stats.replaced === 3, stats);

  console.log('\n── B. 嵌套结构 ──');
  const input = {
    raw_api_data: { search_evidence: { products: { Latest: { tweets: [{ text: 'ok \ud83d' }] } } } },
    jev_prompt: 'p\u0000q',
    jev_raw_output: '{"answers":{}}',
    n: 1, b: true, z: null,
  };
  const out = sanitizeJsonValue(input);
  check('B1 嵌套推文文本清洗', out.raw_api_data.search_evidence.products.Latest.tweets[0].text === 'ok �', out);
  check('B2 prompt NUL 清洗', out.jev_prompt === 'p�q');
  check('B3 非字符串值原样', out.n === 1 && out.b === true && out.z === null && out.jev_raw_output === '{"answers":{}}');
  check('B4 不 mutate 入参', input.raw_api_data.search_evidence.products.Latest.tweets[0].text === 'ok \ud83d');
  check('B5 清洗后可 JSON 往返且无 lone surrogate',
    (() => { const s = JSON.stringify(out); try { JSON.parse(s); } catch { return false; }
      return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s); })());
  check('B6 Date 实例原样保留', (() => { const d = new Date(); return sanitizeJsonValue(d) === d; })());

  console.log(`\n══════ ${passed} passed, ${failed} failed ══════`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
