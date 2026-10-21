#!/usr/bin/env node
/**
 * 叙事抽样测试集 runner（case 回归集 run.mjs 的姊妹，2026-10-21 建）。
 *
 * 与回归集的差异：抽样票没有人工 expect（机器只记录现状），runner 只做
 * 「整链重析 → 判读 → 分层汇总」，不断言；核心产出是三层（top/bottom/random）
 × 评级（low/mid/high）分布矩阵 + 每票明细 CSV（含涨幅列，供评级 vs 涨幅对拍）。
 *
 * 在 182 跑（重析含真实 DB/外网访问，本地不跑；串行逐票，180 票约 40-70min）：
 *   node scripts/narrative/case-regression/run-sample.mjs --set <name> [--only top|bottom|random] [--dry]
 *
 * - 跑前备份全部票现行 token_narrative 判读列到 /tmp（重析 upsert 覆盖，备份可对查）
 * - 结果写同目录 data/sample-<name>-result-<ts>.{json,csv}（进 git 的行为快照）
 * - 退出码：0=全部完成；2=存在重析异常（数据源/外网问题，验证未完成）
 * - --dry：只回读现行行不重析不烧 Jev 配额
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../../..'));

const { interpret, csvEscape } = await import('./lib.mjs');
const { NarrativeAnalyzer } = await import('../../../src/narrative/analyzer/NarrativeAnalyzer.mjs');
const { JEV_QUESTIONS_VERSION } = await import('../../../src/narrative/analyzer/llm/jev-questions.mjs');
const { JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../../../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
const { NarrativeRepository } = await import('../../../src/narrative/db/NarrativeRepository.mjs');

const SETS_DIR = resolve(__dirname, 'sample-sets');
const DATA_DIR = resolve(__dirname, 'data');
const ROW_COLS = 'token_address,token_symbol,token_category,analyzed_at,analysis_stage,prestage_result,stage1_result,stage2_result,stage_final_result,pre_check_result';
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const RATINGS = ['low', 'mid', 'high'];

function parseArgs(argv) {
  const out = { set: null, only: null, dry: false, backupDir: '/tmp' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') out.set = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--dry') out.dry = true;
    else if (a === '--backup-dir') out.backupDir = argv[++i];
    else { console.error(`未知参数: ${a}`); process.exit(1); }
  }
  if (!out.set) { console.error('用法: run-sample.mjs --set <name> [--only top|bottom|random] [--dry]'); process.exit(1); }
  return out;
}

function loadAndValidateSampleSet(doc) {
  const errors = [];
  if (!doc || !Array.isArray(doc.samples)) errors.push('samples 数组缺失');
  const seen = new Set();
  for (const s of doc.samples ?? []) {
    for (const [f, v] of [['sampleId', s.sampleId], ['stratum', s.stratum], ['addr', s.addr]]) {
      if (!v) errors.push(`样本缺 ${f}: ${JSON.stringify(s).slice(0, 80)}`);
    }
    if (typeof s.addr === 'string' && !ADDR_RE.test(s.addr)) errors.push(`${s.sampleId} addr 非 0x40hex: ${s.addr}`);
    if (!['top', 'bottom', 'random'].includes(s.stratum)) errors.push(`${s.sampleId} stratum 非法: ${s.stratum}`);
    if (typeof s.maxGainPct !== 'number') errors.push(`${s.sampleId} maxGainPct 缺失（抽样集必须全带涨幅）`);
    if (seen.has(s.addr)) errors.push(`addr 重复: ${s.addr}`);
    seen.add(s.addr);
  }
  return { samples: doc?.samples ?? [], errors };
}

async function fetchRows(addrs) {
  const supabase = NarrativeRepository.getSupabase();
  const rows = [];
  for (let i = 0; i < addrs.length; i += 50) {
    const { data, error } = await supabase.from('token_narrative').select(ROW_COLS).in('token_address', addrs.slice(i, i + 50));
    if (error) throw new Error(`回读失败: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

function toSampleCsv(rows) {
  const HEADERS = ['sampleId', 'stratum', 'addr', 'symbol', '峰值涨幅%', '最终涨幅%', '画像分类', '峰值市值USD', '平台', '来源实验', '基线rating', '当前rating', 'score', 'stage', 'tokenCat', 'ruleName', 'reason', 'error'];
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      r.sampleId, r.stratum, r.addr, r.symbol, r.maxGainPct, r.finalGainPct, r.profileCat, r.peakMcapUsd,
      r.platform, r.srcExps,
      r.baseline?.rating ?? '', r.current?.rating ?? '', r.current?.score ?? '', r.current?.stage ?? '',
      r.current?.tokenCategory ?? '', r.current?.ruleName ?? '', r.current?.reason ?? '', r.error ?? '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function summarize(results) {
  const strata = ['top', 'bottom', 'random'];
  const matrix = {};
  for (const st of strata) {
    matrix[st] = { total: 0 };
    for (const r of RATINGS) matrix[st][r] = 0;
    matrix[st].error = 0;
    matrix[st].noRating = 0;
  }
  for (const r of results) {
    const m = matrix[r.stratum];
    if (!m) continue;
    m.total++;
    if (r.error) m.error++;
    else if (!r.current?.rating) m.noRating++;
    else if (RATINGS.includes(r.current.rating)) m[r.current.rating]++;
  }
  return matrix;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(resolve(SETS_DIR, `${args.set}.json`), 'utf8'));
  const { samples, errors } = loadAndValidateSampleSet(doc);
  if (errors.length) {
    console.error('抽样集校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  const selected = args.only ? samples.filter((s) => s.stratum === args.only) : samples;
  if (!selected.length) { console.error(`--only ${args.only} 过滤后无票`); process.exit(1); }
  console.log(`叙事抽样集 ${args.set}：${selected.length}/${samples.length} 票（题集=${JEV_QUESTIONS_VERSION}+${JEV_PRESTAGE_QUESTIONS_VERSION}${args.dry ? '，dry 模式不重析' : ''}）`);

  // 基线备份（判读列，重析覆盖前的现行行为）
  const baselineRows = await fetchRows(selected.map((s) => s.addr));
  const baselineByAddr = new Map(baselineRows.map((r) => [r.token_address.toLowerCase(), r]));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(args.backupDir, `sample-${args.set}-backup-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), rows: baselineRows }, null, 2));
  console.log(`基线备份 → ${backupPath}（${baselineRows.length} 行）`);

  const results = [];
  let done = 0;
  for (const s of selected) {
    done++;
    const base = interpret(baselineByAddr.get(s.addr) ?? null);
    const row = { sampleId: s.sampleId, stratum: s.stratum, addr: s.addr, symbol: s.symbol ?? '', maxGainPct: s.maxGainPct, finalGainPct: s.finalGainPct ?? null, profileCat: s.profileCat ?? null, peakMcapUsd: s.peakMcapUsd ?? null, platform: s.platform ?? '', srcExps: s.srcExps ?? '', baseline: { rating: base.rating, score: base.score }, current: null, error: null };
    if (args.dry) {
      row.current = { rating: base.rating, score: base.score, stage: base.stage, tokenCategory: base.tokenCategory, ruleName: base.ruleName, reason: base.reason };
      console.log(`[dry ${done}/${selected.length}] ${s.sampleId} ${s.symbol} max=${s.maxGainPct.toFixed(1)}% 现行 rating=${base.rating ?? '无行'} rule=${base.ruleName ?? '-'}`);
      results.push(row);
      continue;
    }
    try {
      await NarrativeAnalyzer.analyze(s.addr, { ignoreCache: true });
      const [cur] = await fetchRows([s.addr]);
      const interp = interpret(cur ?? null);
      row.current = { rating: interp.rating, score: interp.score, stage: interp.stage, tokenCategory: interp.tokenCategory, ruleName: interp.ruleName, reason: interp.reason };
      console.log(`[${done}/${selected.length}] ${s.sampleId} ${s.symbol} max=${s.maxGainPct.toFixed(1)}% 基线${base.rating ?? '无'} → rating=${interp.rating ?? '-'} score=${interp.score ?? '-'} cat=${interp.tokenCategory ?? '-'} rule=${interp.ruleName ?? '-'}`);
      if (interp.reason) console.log(`   reason: ${interp.reason.slice(0, 110)}`);
    } catch (e) {
      row.error = e?.message || String(e);
      console.error(`[${done}/${selected.length}] ${s.sampleId} ${s.addr} 重析异常: ${row.error}`);
    }
    results.push(row);
  }

  const summary = { total: results.length, matrix: summarize(results), errors: results.filter((r) => r.error).length };
  mkdirSync(DATA_DIR, { recursive: true });
  const jsonPath = resolve(DATA_DIR, `sample-${args.set}-result-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify({ ranAt: new Date().toISOString(), setName: args.set, questionSet: `${JEV_QUESTIONS_VERSION}+${JEV_PRESTAGE_QUESTIONS_VERSION}`, summary, results }, null, 2));
  const csvPath = resolve(DATA_DIR, `sample-${args.set}-result-${ts}.csv`);
  writeFileSync(csvPath, '﻿' + toSampleCsv(results), 'utf8');
  console.log(`\n分层 × 评级矩阵（行=层，列=评级）:`);
  for (const st of ['top', 'bottom', 'random']) {
    const m = summary.matrix[st];
    if (!m.total) continue;
    console.log(`  ${st.padEnd(7)} low=${m.low} mid=${m.mid} high=${m.high} 无评级=${m.noRating} 异常=${m.error}（共${m.total}）`);
  }
  console.log(`结果 JSON → ${jsonPath}\n结果 CSV → ${csvPath}`);
  if (summary.errors) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
