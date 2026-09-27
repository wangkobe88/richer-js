/**
 * 子进程 stdout 汇总解析（纯函数，零依赖——step3/step4 与单测 _test_daily_parse_summary.cjs
 * 三方共用的单一真相源）。
 *
 * ⚠️ 输出格式是协议：以下正则逐行锚定 scripts/build-token-profiles.cjs /
 *   scripts/build-wallet-profiles.cjs 的 console.log 文案（行号见各正则注释）。
 *   改子进程输出格式必须同步此处 + 单测 fixture，否则 metrics 静默变 null（不崩、页面显 —）。
 *
 * 全字段 null 容错（格式漂移不抛错）；正则 fixture 见 scripts/_test_daily_parse_summary.cjs。
 */
'use strict';

/**
 * 解析单实验 build-token-profiles 输出。
 * 协议行（scripts/build-token-profiles.cjs）：
 *   :65  `token 全集 1234`
 *   :98  `ticks 456789 / 1200 token（34567ms）`
 *   :158 `写入 token_profiles 1234 行（source=offline, bsc-v2.x）`
 *   :160 `  wash             123`（2 空格 + cat.padEnd(16) + 字面空格 + padStart(4)，无冒号）
 * @param {string} out 单实验完整 stdout
 * @returns {{tokens:number|null, ticks:number|null, tokens_with_ticks:number|null, fetch_ms:number|null,
 *            written:number|null, classifier_version:string|null, category_counts:Object}}
 */
function parseTokenProfileRun(out) {
  const mTokens = out.match(/^token 全集\s+(\d+)$/m);
  // ★ /m 必须：`^` 无 m flag 只匹配字符串开头（多行 stdout 中永远 miss）
  const mTicks = out.match(/^ticks\s+(\d+)\s*\/\s*(\d+)\s*token（(\d+)ms）/m);
  const mWrite = out.match(/^写入 token_profiles\s+(\d+)\s*行（source=offline,\s*([^）]+)）/m);
  // 恰两空格行首锚定：区分「── 分类分布 ──」表头与无缩进行；` +` 不依赖 padEnd(16) 精度
  const category_counts = {};
  let m;
  const catRe = /^ {2}([a-z_]+) +(\d+) *$/gm;
  while ((m = catRe.exec(out)) !== null) category_counts[m[1]] = parseInt(m[2], 10);
  return {
    tokens: mTokens ? parseInt(mTokens[1], 10) : null,
    ticks: mTicks ? parseInt(mTicks[1], 10) : null,
    tokens_with_ticks: mTicks ? parseInt(mTicks[2], 10) : null,
    fetch_ms: mTicks ? parseInt(mTicks[3], 10) : null,
    written: mWrite ? parseInt(mWrite[1], 10) : null,
    classifier_version: mWrite ? mWrite[2].trim() : null,
    category_counts,
  };
}

/**
 * 解析整段 build-wallet-profiles 输出。
 * 协议行（scripts/build-wallet-profiles.cjs）：
 *   :222 `[阶段1] fresh 1234567 行 / 45.6 万 trader / HF(count≥3)=12345 / 89s`
 *   :271 `[阶段3] 8901 token → 有分类行 7654（85.9%）/ 1s`
 *   :314 `[阶段4] 12345 个 HF 钱包 profile / 45s`
 *   :334 `=== 完成 === upsert 12345 行（threshold=3 days=14）/ ...`
 * ⚠️ :164 `  upsert 200/12345` 进度行——完成行正则靠 `=== 完成 ===` 前缀锚定避开。
 * @param {string} out 整段完整 stdout
 * @returns {{cache_source:string|null, rows_scanned:number|null, threshold:number, high_freq_found:number|null,
 *            tp_tokens:number|null, tp_hit:number|null, hf_profiles:number|null, upserted:number|null}}
 */
function parseWalletProfilesRun(out) {
  const hfM = out.match(/\[阶段1\]\s*(\w+)\s+(\d+)\s+行.*?HF\(count≥(\d+)\)=(\d+)/);
  const tpM = out.match(/\[阶段3\]\s+(\d+)\s+token → 有分类行\s+(\d+)/);
  const p4M = out.match(/\[阶段4\]\s+(\d+)\s+个 HF 钱包 profile/);
  const doneM = out.match(/===\s*完成\s*===\s*upsert\s+(\d+)\s+行/);
  return {
    cache_source: hfM ? hfM[1] : null,          // miss | fresh | stale（GlobalTickCache 源）
    rows_scanned: hfM ? parseInt(hfM[2], 10) : null,
    threshold: hfM ? parseInt(hfM[3], 10) : 3,
    high_freq_found: hfM ? parseInt(hfM[4], 10) : null,
    tp_tokens: tpM ? parseInt(tpM[1], 10) : null,
    tp_hit: tpM ? parseInt(tpM[2], 10) : null,
    hf_profiles: p4M ? parseInt(p4M[1], 10) : null,
    upserted: doneM ? parseInt(doneM[1], 10) : null,
  };
}

module.exports = { parseTokenProfileRun, parseWalletProfilesRun };
