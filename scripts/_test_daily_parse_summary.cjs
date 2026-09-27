#!/usr/bin/env node
/**
 * daily-model-update stdout 解析单测（本地零 DB 零 env）
 *
 * fixture = build-token-profiles / build-wallet-profiles 实测输出行（协议行行号见 lib/parse.js 头注）。
 * 改子进程 console.log 文案必须同步 lib/parse.js + 本 fixture——本测是协议漂移的唯一防线
 * （漂移后果：metrics 静默 null，页面显 —）。
 *
 * 运行：node scripts/_test_daily_parse_summary.cjs（退出码 0=全过）
 */
'use strict';

const assert = require('assert');
const { parseTokenProfileRun, parseWalletProfilesRun } = require('./daily-model-update/lib/parse');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ── step3 fixture：协议行刻意放在输出中间（验证 ^…$ 的 /m 多行锚定，非串首）──
// 分类行格式 = 2 空格 + padEnd(16) + 1 空格 + padStart(4)（build-token-profiles.cjs :160）
const step3Out = [
  '[build-token-profiles] virtual 实验 572033ad-xxxx 处理中（sc=bsc-v2）',
  '拉取全史 ticks ...',
  'token 全集 1234',
  'ticks 456789 / 1200 token（34567ms）',
  '── 分类分布 ──',
  '  wash             123',
  '  high_mcap_wash    45',
  '  normal           900',
  '  pump_dump         66',
  '  low_activity     100',
  '写入 token_profiles 1234 行（source=offline, bsc-v2.4）',
  '完成',
].join('\n');

// ── step4 fixture：含 :164 进度行 `  upsert 200/12345`（doneM 反例锚点）──
const step4Out = [
  '[GlobalTickCache] STALE: 复用 1200000 行，增量拉取 ...',
  '[阶段1] stale 1234567 行 / 45.6 万 trader / HF(count≥3)=12345 / 89s',
  '[阶段2] HF 钱包 64 磁盘桶 spill ...',
  '[阶段3] 8901 token → 有分类行 7654（85.9%）/ 1s',
  '[阶段4] 12345 个 HF 钱包 profile / 45s',
  '  upsert 200/12345',
  '  upsert 12000/12345',
  '=== 完成 === upsert 12345 行（threshold=3 days=14）/ offline cache 已失效 / 总耗时 123s',
].join('\n');

console.log('== parseTokenProfileRun（step3）==');
check('tokens=1234（中间行 /m 锚定）', () => {
  assert.strictEqual(parseTokenProfileRun(step3Out).tokens, 1234);
});
check('ticks/tokens_with_ticks/fetch_ms', () => {
  const r = parseTokenProfileRun(step3Out);
  assert.strictEqual(r.ticks, 456789);
  assert.strictEqual(r.tokens_with_ticks, 1200);
  assert.strictEqual(r.fetch_ms, 34567);
});
check('written=1234 + classifier_version=bsc-v2.4', () => {
  const r = parseTokenProfileRun(step3Out);
  assert.strictEqual(r.written, 1234);
  assert.strictEqual(r.classifier_version, 'bsc-v2.4');
});
check('category_counts 五类全中（含 high_mcap_wash 下划线长名）', () => {
  const c = parseTokenProfileRun(step3Out).category_counts;
  assert.deepStrictEqual(c, {
    wash: 123, high_mcap_wash: 45, normal: 900, pump_dump: 66, low_activity: 100,
  });
});
check('反例：`── 分类分布 ──` 表头行不被 catRe 匹配', () => {
  const c = parseTokenProfileRun('── 分类分布 ──\n  wash   1').category_counts;
  assert.strictEqual(c['──'], undefined);
  assert.strictEqual(c.wash, 1);
});
check('反例：无缩进的分类样行（若子进程改缩进）不被匹配', () => {
  const c = parseTokenProfileRun('wash   1\n  wash   2').category_counts;
  // 无缩进行不匹配 ^ {2} 锚定；有缩进行的值不被前者污染
  assert.deepStrictEqual(c, { wash: 2 });
});
check('容错：无关输出全 null、category_counts 空', () => {
  const r = parseTokenProfileRun('完全无关的输出\n另一行');
  assert.strictEqual(r.tokens, null);
  assert.strictEqual(r.ticks, null);
  assert.strictEqual(r.written, null);
  assert.strictEqual(r.classifier_version, null);
  assert.deepStrictEqual(r.category_counts, {});
});

console.log('== parseWalletProfilesRun（step4）==');
check('cache_source=stale / rows_scanned / threshold / high_freq_found', () => {
  const r = parseWalletProfilesRun(step4Out);
  assert.strictEqual(r.cache_source, 'stale');
  assert.strictEqual(r.rows_scanned, 1234567);
  assert.strictEqual(r.threshold, 3);
  assert.strictEqual(r.high_freq_found, 12345);
});
check('tp_tokens=8901 / tp_hit=7654', () => {
  const r = parseWalletProfilesRun(step4Out);
  assert.strictEqual(r.tp_tokens, 8901);
  assert.strictEqual(r.tp_hit, 7654);
});
check('hf_profiles=12345', () => {
  assert.strictEqual(parseWalletProfilesRun(step4Out).hf_profiles, 12345);
});
check('★upserted=12345：`  upsert 200/12345` 进度行不被误认为完成行', () => {
  // doneM 靠 `=== 完成 ===` 前缀锚定；若误匹配进度行会得 200
  assert.strictEqual(parseWalletProfilesRun(step4Out).upserted, 12345);
});
check('反例：只有进度行无完成行 → upserted=null（协议漂移显式暴露）', () => {
  const out = '[阶段4] 100 个 HF 钱包 profile / 1s\n  upsert 50/100';
  assert.strictEqual(parseWalletProfilesRun(out).upserted, null);
});
check('容错：无关输出全 null（threshold 缺省 3）', () => {
  const r = parseWalletProfilesRun('无关输出');
  assert.strictEqual(r.cache_source, null);
  assert.strictEqual(r.rows_scanned, null);
  assert.strictEqual(r.high_freq_found, null);
  assert.strictEqual(r.tp_tokens, null);
  assert.strictEqual(r.hf_profiles, null);
  assert.strictEqual(r.upserted, null);
  assert.strictEqual(r.threshold, 3);
});

if (failed) {
  console.error(`\nFAIL: ${failed} 项未过`);
  process.exit(1);
}
console.log('\nALL PASS');
