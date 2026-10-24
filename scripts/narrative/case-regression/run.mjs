#!/usr/bin/env node
/**
 * 叙事 case 回归集 runner（2026-10-19 建，同日工具正式化+目录收拢）——长期维护的叙事回归测试集，
 * 工具文档与工作流见 docs/case-regression-tool.md。
 *
 * 在 182 跑（重析/回读含真实 DB 访问，本地不跑）：
 *   npm run case-regression [-- --only C98,C104] [--dry] [--backup-dir /tmp]   # 全量/选定重析对拍
 *   npm run case-regression -- --list                                        # 集合清单（零 DB，本地可跑）
 *   npm run case-regression -- --add <addr> --case C112 [--note ..] [--observe ..] [--dry]   # 收录新票
 *   npm run case-regression -- --update-expect C97,C102 --because "C113 裁定.." [--dry]      # 预期更新留痕
 *
 * - 对拍结果（JSON+CSV）默认写本目录 data/（进 git 的历史存档，长期维护资产）
 * - 跑前备份全部票现行 token_narrative 整行到 backup-dir JSON（重析 upsert 覆盖，
 *   备份留档可对查/回滚，符合「跑过的数据绝不丢」精神——整行含完整 state 大文件，刻意留 /tmp 不进 git）
 * - 写回 fixtures（--add/--update-expect）：tmp+rename 原子写 + 写前备份到 backup-dir
 * - 断言器=同目录 lib.mjs（零 DB 零网络单测 scripts/_test_case_regression_lib.cjs 锁定）
 * - 退出码：0=全过；1=存在非 observe 票断言失败 / 收录或更新校验失败；2=存在重析异常（数据源不可用）
 * - observe 票（fixtures 带 observe 键）：断言失败只 ⚠️ 警示不计失败（已知分数移动面）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../../..'));

const { interpret, assertExpectation, loadAndValidateFixtures, toCsv, buildCase, updateExpect } = await import('./lib.mjs');
const { NarrativeAnalyzer } = await import('../../../src/narrative/analyzer/NarrativeAnalyzer.mjs');
const { JEV_QUESTIONS_VERSION } = await import('../../../src/narrative/analyzer/llm/jev-questions.mjs');
const { JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../../../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
const { NarrativeRepository } = await import('../../../src/narrative/db/NarrativeRepository.mjs');

const FIXTURES_PATH = resolve(__dirname, 'fixtures.json');
const DATA_DIR = resolve(__dirname, 'data');
const ROW_COLS = 'token_address,token_symbol,token_category,analyzed_at,analysis_stage,prestage_result,event_result,event_score_result,final_result,pre_check_result';

function parseArgs(argv) {
  const out = { only: null, dry: false, backupDir: '/tmp', list: false, add: null, caseId: null, note: '', observe: '', updateExpect: null, because: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') out.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry') out.dry = true;
    else if (a === '--backup-dir') out.backupDir = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--add') out.add = argv[++i];
    else if (a === '--case') out.caseId = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--observe') out.observe = argv[++i];
    else if (a === '--update-expect') out.updateExpect = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--because') out.because = argv[++i];
    else { console.error(`未知参数: ${a}`); process.exit(1); }
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

/** fixtures 原子写回（tmp+rename），写前先备份到 backup-dir */
function writeFixturesSafely(doc, backupDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(FIXTURES_PATH, resolve(backupDir, `case-regression-fixtures-backup-${ts}.json`));
  const tmp = `${FIXTURES_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmp, FIXTURES_PATH);
  console.log(`fixtures 已写回 ${FIXTURES_PATH}（写前备份 → ${backupDir}/case-regression-fixtures-backup-${ts}.json）`);
}

function validateOrExit(doc) {
  const { errors } = loadAndValidateFixtures(doc);
  if (errors.length) {
    console.error('写回前校验失败（未写入任何内容）:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
}

/** --list：集合清单（零 DB） */
function cmdList(cases) {
  console.log(`回归集共 ${cases.length} 票：`);
  for (const c of cases) {
    const rating = Array.isArray(c.expect.rating) ? c.expect.rating.join('|') : c.expect.rating ?? '不断言';
    const since = c.expectSince ? ` since=${c.expectSince}${c.expectBecause ? `（${c.expectBecause}）` : ''}` : '';
    const obs = c.observe ? ' [observe]' : '';
    const note = (c.note ?? '').slice(0, 46).replace(/\n/g, ' ');
    console.log(`  ${c.caseId.padEnd(6)} ${(c.symbol ?? '').padEnd(14).slice(0, 14)} ${String(rating).padEnd(8)}${obs}${since}  ${note}`);
  }
}

/** --add：收录新票（不重析不烧 Jev 配额，快照现行行为作 rating 基线，意图键人工复核补写） */
async function cmdAdd(args, doc, cases) {
  if (!args.caseId) { console.error('--add 必须带 --case <caseId>（=台账 case 编号）'); process.exit(1); }
  const addr = args.add.toLowerCase();
  if (cases.some((c) => c.addr.toLowerCase() === addr)) { console.error(`addr 已收录（一票一 case）: ${addr}`); process.exit(1); }
  if (cases.some((c) => c.caseId === args.caseId)) { console.error(`caseId 已存在: ${args.caseId}`); process.exit(1); }
  const [row] = await fetchRows([addr]);
  const interp = interpret(row ?? null);
  if (!row || interp.rating === null) {
    console.error('token_narrative 无行或无终态 rating——先跑一次 analyze（或回归 --only）出终态再收录；--add 刻意不重析'); process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const c = buildCase({ caseId: args.caseId, symbol: row.token_symbol ?? '', addr, interp, note: args.note, observe: args.observe, today });
  const nextDoc = { ...doc, cases: [...doc.cases, c] };
  console.log('生成 case（请人工复核 expect——机器只记录现状，断言意图必须人来定）：');
  console.log(JSON.stringify(c, null, 2));
  console.log('复核要点：①rating 是否即断言语义（观察票配 observe 键）②补 reasonIncludes/auditIncludes 等意图键——只写确定性键（拦截位/审计键），勿写死 Jev 掷骰面（C111 纪律）');
  validateOrExit(nextDoc);
  if (args.dry) { console.log('--dry：未写回 fixtures'); return; }
  writeFixturesSafely(nextDoc, args.backupDir);
}

/** --update-expect：预期更新留痕（rating 从现行行刷新，细节键保留，expectSince/Because 记因） */
async function cmdUpdateExpect(args, doc, cases) {
  if (!args.because) { console.error('--update-expect 必须带 --because "<case 编号> <裁定一句话>"（预期变更留痕，长期维护的根）'); process.exit(1); }
  const missing = args.updateExpect.filter((id) => !cases.some((c) => c.caseId === id));
  if (missing.length) { console.error(`caseId 不存在: ${missing.join(',')}`); process.exit(1); }
  const byId = new Map(cases.map((c) => [c.caseId, c]));
  const rows = await fetchRows(args.updateExpect.map((id) => byId.get(id).addr));
  const byAddr = new Map(rows.map((r) => [r.token_address.toLowerCase(), r]));
  const today = new Date().toISOString().slice(0, 10);
  const idx = new Map(doc.cases.map((c, i) => [c.caseId, i]));
  for (const id of args.updateExpect) {
    const old = byId.get(id);
    const row = byAddr.get(old.addr.toLowerCase());
    const interp = interpret(row ?? null);
    if (!row || interp.rating === null) { console.error(`${id} 现行行无终态 rating——先重析再更新预期`); process.exit(1); }
    const next = updateExpect(old, interp, args.because, today);
    const cat = old.expect.tokenCategory !== next.expect.tokenCategory ? ` tokenCategory ${old.expect.tokenCategory ?? '-'}→${next.expect.tokenCategory}` : '';
    console.log(`${id}: rating ${JSON.stringify(old.expect.rating)} → ${JSON.stringify(next.expect.rating)}${cat}  because=${args.because}`);
    doc.cases[idx.get(id)] = next;
  }
  validateOrExit(doc);
  if (args.dry) { console.log('--dry：未写回 fixtures'); return; }
  writeFixturesSafely(doc, args.backupDir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const { cases, errors } = loadAndValidateFixtures(doc);
  if (errors.length) {
    console.error('fixtures 校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  if (args.list) { cmdList(cases); return; }
  if (args.add) { await cmdAdd(args, doc, cases); return; }
  if (args.updateExpect) { await cmdUpdateExpect(args, doc, cases); return; }
  const selected = args.only ? cases.filter((c) => args.only.includes(c.caseId)) : cases;
  if (!selected.length) { console.error(`--only 过滤后无票（可用 caseId: ${cases.map((c) => c.caseId).join(',')}）`); process.exit(1); }
  console.log(`叙事 case 回归集：${selected.length}/${cases.length} 票（题集=${JEV_QUESTIONS_VERSION}+${JEV_PRESTAGE_QUESTIONS_VERSION}）`);

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
    console.log(`${tag} ${c.caseId} ${c.symbol}: 基线 ${base.rating ?? '无'} → 现评级 ${interp?.rating ?? '-'} score=${interp?.score ?? '-'} cat=${interp?.tokenCategory ?? '-'} rule=${interp?.ruleName ?? '-'} [${status}]`);
    console.log(`   reason: ${(interp?.reason ?? '-').slice(0, 120)}`);
    for (const f of failures) console.log(`   · ${f}`);
    if (c.observe && status !== 'PASS') console.log(`   ⚠ observe: ${c.observe}`);
    results.push({ caseId: c.caseId, symbol: c.symbol, addr: c.addr, status, expect: c.expect ?? {}, observe: c.observe ?? null, caseNote: c.note ?? '', baseline: { rating: base.rating, reason: base.reason, ruleName: base.ruleName, score: base.score, tokenCategory: base.tokenCategory }, current: interp ? { rating: interp.rating, reason: interp.reason, ruleName: interp.ruleName, score: interp.score, stage: interp.stage, tokenCategory: interp.tokenCategory } : null, failures });
  }

  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length, observeDeviation: results.filter((r) => r.status === 'OBSERVE-DEVIATION').length, error: results.filter((r) => r.status === 'ERROR').length };
  mkdirSync(DATA_DIR, { recursive: true }); // 对拍结果存档目录（git 否定规则保进版本库）
  const resultPath = resolve(DATA_DIR, `case-regression-result-${ts}.json`);
  writeFileSync(resultPath, JSON.stringify({ ranAt: new Date().toISOString(), summary, results }, null, 2));
  const csvPath = resolve(DATA_DIR, `case-regression-result-${ts}.csv`);
  writeFileSync(csvPath, '﻿' + toCsv(results), 'utf8'); // BOM 便于 Excel 直接打开中文
  console.log(`\n汇总: ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.observeDeviation} OBSERVE-DEVIATION / ${summary.error} ERROR`);
  console.log(`结果 JSON → ${resultPath}\n结果 CSV（期望/基线/当前同表，存档进 git）→ ${csvPath}`);
  if (summary.fail) process.exit(1);
  if (summary.error) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
