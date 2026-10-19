#!/usr/bin/env node
/**
 * 叙事 case 回归集 runner（2026-10-19）：C94-C110 近期案票在当前题集
 * （J1.43/J1.44/J1.45+P1.12）整链重析（analyze ignoreCache，覆盖落库），对拍 fixtures 预期。
 *
 * 在 182 跑（重析含真实抓取+Jev 调用，本地不跑）：
 *   node scripts/narrative/run-case-regression.mjs [--only C98,C104] [--dry] [--backup-dir /tmp]
 *
 * - 跑前备份全部票现行 token_narrative 整行到 backup-dir JSON（重析 upsert 覆盖，
 *   备份留档可对查/回滚，符合「跑过的数据绝不丢」精神）
 * - 断言器=case-regression-lib.mjs（零 DB 零网络单测 _test_case_regression_lib.cjs 锁定）
 * - 退出码：0=全过；1=存在非 observe 票断言失败；2=存在重析异常（数据源不可用，未完成验证）
 * - observe 票（fixtures 带 observe 键）：断言失败只 ⚠️ 警示不计失败（已知分数移动面）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { interpret, assertExpectation, loadAndValidateFixtures, toCsv } = await import('./case-regression-lib.mjs');
const { NarrativeAnalyzer } = await import('../../src/narrative/analyzer/NarrativeAnalyzer.mjs');
const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');

const ROW_COLS = 'token_address,token_symbol,analyzed_at,analysis_stage,stage1_result,stage2_result,stage_final_result,pre_check_result';

function parseArgs(argv) {
  const out = { only: null, dry: false, backupDir: '/tmp' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--dry') out.dry = true;
    else if (argv[i] === '--backup-dir') out.backupDir = argv[++i];
    else { console.error(`未知参数: ${argv[i]}`); process.exit(1); }
  }
  return out;
}

async function fetchRows(addrs) {
  const supabase = NarrativeRepository.getSupabase();
  const rows = [];
  // .in 批 50 上限（红线）
  for (let i = 0; i < addrs.length; i += 50) {
    const { data, error } = await supabase.from('token_narrative').select(ROW_COLS).in('token_address', addrs.slice(i, i + 50));
    if (error) throw new Error(`回读失败: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(resolve(__dirname, 'case-regression-fixtures.json'), 'utf8'));
  const { cases, errors } = loadAndValidateFixtures(doc);
  if (errors.length) {
    console.error('fixtures 校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  const selected = args.only ? cases.filter((c) => args.only.includes(c.caseId)) : cases;
  if (!selected.length) { console.error(`--only 过滤后无票（可用 caseId: ${cases.map((c) => c.caseId).join(',')}）`); process.exit(1); }
  console.log(`叙事 case 回归集：${selected.length}/${cases.length} 票（题集=${'J1.45+P1.12'}）`);

  const addrs = selected.map((c) => c.addr);

  // 基线（现行行，dry 模式下即对照表；跑模式仅用于备份）
  const baselineRows = await fetchRows(addrs);
  const baselineByAddr = new Map(baselineRows.map((r) => [r.token_address.toLowerCase(), r]));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(args.backupDir, `case-regression-backup-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), rows: baselineRows }, null, 2));
  console.log(`基线备份 → ${backupPath}（${baselineRows.length} 行）`);

  if (args.dry) {
    for (const c of selected) {
      const b = interpret(baselineByAddr.get(c.addr.toLowerCase()));
      console.log(`[dry] ${c.caseId} ${c.symbol} 现行: rating=${b.rating ?? '无行'} score=${b.score ?? '-'} rule=${b.ruleName ?? '-'} reason=${(b.reason ?? '').slice(0, 50)}`);
    }
    return;
  }

  const results = [];
  for (const c of selected) {
    const base = interpret(baselineByAddr.get(c.addr.toLowerCase()));
    let status = 'PASS';
    const failures = [];
    let interp = null;
    try {
      await NarrativeAnalyzer.analyze(c.addr, { ignoreCache: true });
      const [row] = await fetchRows([c.addr]);
      interp = interpret(row);
      failures.push(...assertExpectation(interp, c.expect).failures);
      if (failures.length) status = c.observe ? 'OBSERVE-DEVIATION' : 'FAIL';
    } catch (e) {
      status = 'ERROR';
      failures.push(`重析异常: ${e?.message || e}`);
    }
    const tag = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'ERROR' ? '💥' : '⚠️';
    console.log(`${tag} ${c.caseId} ${c.symbol}: 基线 ${base.rating ?? '无'} → 现评级 ${interp?.rating ?? '-'} score=${interp?.score ?? '-'} rule=${interp?.ruleName ?? '-'} [${status}]`);
    console.log(`   reason: ${(interp?.reason ?? '-').slice(0, 120)}`);
    for (const f of failures) console.log(`   · ${f}`);
    if (c.observe && status !== 'PASS') console.log(`   ⚠ observe: ${c.observe}`);
    results.push({ caseId: c.caseId, symbol: c.symbol, addr: c.addr, status, expect: c.expect ?? {}, observe: c.observe ?? null, caseNote: c.note ?? '', baseline: { rating: base.rating, reason: base.reason, ruleName: base.ruleName, score: base.score }, current: interp ? { rating: interp.rating, reason: interp.reason, ruleName: interp.ruleName, score: interp.score, stage: interp.stage } : null, failures });
  }

  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length, observeDeviation: results.filter((r) => r.status === 'OBSERVE-DEVIATION').length, error: results.filter((r) => r.status === 'ERROR').length };
  const resultPath = resolve(args.backupDir, `case-regression-result-${ts}.json`);
  writeFileSync(resultPath, JSON.stringify({ ranAt: new Date().toISOString(), summary, results }, null, 2));
  const csvPath = resolve(args.backupDir, `case-regression-result-${ts}.csv`);
  writeFileSync(csvPath, '﻿' + toCsv(results), 'utf8'); // BOM 便于 Excel 直接打开中文
  console.log(`\n汇总: ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.observeDeviation} OBSERVE-DEVIATION / ${summary.error} ERROR`);
  console.log(`结果 JSON → ${resultPath}\n结果 CSV（期望/基线/当前同表）→ ${csvPath}`);
  if (summary.fail) process.exit(1);
  if (summary.error) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
