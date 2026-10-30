#!/usr/bin/env node
/**
 * 作弊盘检测回归 runner（CD1，2026-10-30）——**182 跑**（本地 VPN 直连 Supabase 必
 * 超时=红线 9；本地可跑的只有 --list）。对拍流程与叙事 case-regression 同构，差异：
 *
 * 1. **as-of 锚截窗**：fixtures.anchor.tickCount 必填——按链上真序 (block_number,
 *    log_index) 取前 N 笔重放（绝不全史重析：事后知道是 rug 再看全程=马后炮污染对拍）；
 *    实际行数 < 锚=fail-loud（fixture 过期/数据缺，宁停不冒充）
 * 2. 与实时 CheatCheckService 同源 bit-identical：同 TICK_SELECT_COLUMNS → 同
 *    buildSnapshotFromRows → 同 buildCheatState → 同 JevClient → 同 mapper
 *    （cheat-snapshot/state-builder/mapper 是 CJS 纯函数，经 createRequire 复用）
 * 3. token meta 取 wss_events 最早 token_create 行（payload=collector info 本体：
 *    symbol/name/creator/blockTimeMs）；quoteToken 照 service 口径从 ticks 行尾扫
 *    （flap 非 BNB 计价盘行带 quote_token）
 * 4. jev_prompt 存档 data/prompts/<CD>-<版本>.txt（断代对拍唯一可回放证据）
 *
 * 用法：
 *   node scripts/cheat-detection/run.mjs --list
 *   node scripts/cheat-detection/run.mjs [--only CD1,CD2] [--dry]     # --dry=组装不烧 Jev
 *   node scripts/cheat-detection/run.mjs --add <addr> --case CD2 --note "…" [--observe]
 *                                       [--anchor N]                   # 缺省=收录时刻全量
 *   node scripts/cheat-detection/run.mjs --update-expect CD2 --because "CD<n> 裁定一句话"
 * 退出码：0=全过 1=有失败 2=用法/校验错误（case-regression 同款）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import {
  loadAndValidateFixtures, interpret, assertExpectation, buildCase, updateExpect,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(HERE, 'fixtures.json');
const DATA_DIR = resolve(HERE, 'data');
const PROMPT_DIR = resolve(HERE, 'data', 'prompts');
const PULL_LIMIT = 3000; // 与 CheatCheckService 默认 pullLimit 一致（--add 全量帽）

const require_ = createRequire(import.meta.url);
// 与实时 service 同一组装路径（CJS 纯函数复用=口径单点）
const { buildSnapshotFromRows } = require_('../../src/trading-engine/pre-check/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/trading-engine/pre-check/cheat-state-builder.js');
const { mapCheatAnswers } = require_('../../src/trading-engine/pre-check/cheat-result-mapper.js');

const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

function parseArgs(argv) {
  const args = { only: [], add: null, updateExpect: [], anchor: null, note: '', because: '', dry: false, observe: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--add') args.add = String(argv[++i] || '');
    else if (a === '--case') args.caseId = String(argv[++i] || '');
    else if (a === '--note') args.note = String(argv[++i] || '');
    else if (a === '--because') args.because = String(argv[++i] || '');
    else if (a === '--anchor') args.anchor = Number(argv[++i]);
    else if (a === '--update-expect') args.updateExpect = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry' || a === '--observe') { if (a === '--dry') args.dry = true; else args.observe = true; }
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  return args;
}

function sb() {
  // 红线 3：wss_price_ticks/wss_events 一律 dbManager service key（anon 被 RLS 静默过滤成空）
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

/** 链上真序前 N 笔（锚截窗）；行数不足=fail-loud */
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  if (rows.length < n) {
    throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}（fixture 过期/数据缺——宁停不冒充）`);
  }
  return rows;
}

/** 现全量行数（--add 锚；超帽 capped） */
async function pullFull(token) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(PULL_LIMIT + 1);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  const capped = rows.length > PULL_LIMIT;
  return { rows: capped ? rows.slice(0, PULL_LIMIT) : rows, capped, count: rows.length };
}

/** token meta：wss_events 最早 token_create（payload=collector info 本体） */
async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create')
    .eq('token_address', token)
    .order('id', { ascending: true })
    .limit(5);
  if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const createdAt = p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null);
  return {
    address: token,
    symbol: p.symbol || null,
    name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt,
    creatorAddress: p.creator || null,
  };
}

function quoteTokenOf(rowsAsc) {
  for (let i = rowsAsc.length - 1; i >= 0; i--) {
    if (rowsAsc[i].quote_token) return rowsAsc[i].quote_token;
  }
  return null;
}

/** 单 case 全链（锚截窗→快照→state→[Jev]→mapper→判读） */
async function runCase(c, { dry, version }) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const meta = { ...await loadTokenMeta(c.addr.toLowerCase()), quoteToken: quoteTokenOf(rows) };
  const snapshot = buildSnapshotFromRows(rows, meta, { capped: c.anchor.capped === true, anchorTickCount: c.anchor.tickCount });
  const { state, promptChars } = buildCheatState(snapshot);
  const d = snapshot.derived;
  console.log(`  锚=${snapshot.anchor.tickCount}${c.anchor.capped ? '(capped)' : ''} 笔 | 买 ${d.totalBuyBnb.toFixed(3)}/${d.buyN} 卖 ${d.totalSellBnb.toFixed(3)}/${d.sellN} | 钱包 ${d.walletCount} top1 ${d.top1BuyPct === null ? '-' : d.top1BuyPct.toFixed(1) + '%'} churn ${d.churn60sWalletCount} 同块簇 ${d.sameBlockClusters.length} 等额簇 ${d.equalClusters.length} | state ${promptChars} chars`);
  if (dry) return { interp: null, promptChars, state, snapshot };
  const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
  const q = await import('../../src/narrative/analyzer/llm/cheat-questions.mjs');
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-regression' });
  const mapped = mapCheatAnswers(res.answers);
  return { interp: interpret(mapped), promptChars, state, snapshot, answers: res.answers, model: res.model };
}

function cmdList(cases) {
  console.log(`作弊盘回归集共 ${cases.length} 票：`);
  for (const c of cases) {
    const exp = [c.expect.verdict && `verdict=${c.expect.verdict}`,
      c.expect.cheatProbGte !== undefined && `P≥${c.expect.cheatProbGte}`,
      c.expect.patternsIncludes && `pattern∈[${c.expect.patternsIncludes.join('|')}]`].filter(Boolean).join(' ');
    const obs = c.observe ? ' [observe]' : '';
    const note = (c.note ?? '').slice(0, 40).replace(/\n/g, ' ');
    console.log(`  ${c.caseId.padEnd(5)} ${(c.symbol ?? '').padEnd(12).slice(0, 12)} @${c.anchor.tickCount}${c.anchor.capped ? '+' : ''} ${exp}${obs}  ${note}`);
  }
}

async function cmdAdd(args, doc, cases) {
  if (!args.caseId) { console.error('--add 必须带 --case <CDn>'); process.exit(2); }
  if (!args.note) { console.error('--add 必须带 --note（案由留痕）'); process.exit(2); }
  const addr = args.add.toLowerCase();
  if (cases.some((c) => c.addr === addr)) { console.error(`addr 已收录: ${addr}`); process.exit(2); }
  if (cases.some((c) => c.caseId === args.caseId)) { console.error(`caseId 已存在: ${args.caseId}`); process.exit(2); }
  const { rows, capped, count } = await pullFull(addr);
  if (!rows.length) { console.error('wss_price_ticks 无行（地址错/未采集）'); process.exit(2); }
  const anchorN = Number.isInteger(args.anchor) && args.anchor > 0 ? args.anchor : rows.length;
  console.log(`--add 锚=${anchorN}（现全量 ${count}${capped ? '，超帽截 3000' : ''}${Number.isInteger(args.anchor) && args.anchor > 0 ? '（--anchor 显式指定）' : '（收录时刻全量）'}）→ 分析一次记基线`);
  const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
  const snapshot = buildSnapshotFromRows(
    anchorN === rows.length ? rows : rows.slice(0, anchorN),
    meta, { capped: capped && anchorN === rows.length, anchorTickCount: anchorN });
  const { state } = buildCheatState(snapshot);
  const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
  const q = await import('../../src/narrative/analyzer/llm/cheat-questions.mjs');
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-regression-add' });
  const interp = interpret(mapCheatAnswers(res.answers));
  const today = new Date().toISOString().slice(0, 10);
  const c = buildCase({ caseId: args.caseId, symbol: meta.symbol ?? '', addr, platform: meta.platform, anchorTickCount: anchorN, capped: capped && anchorN === rows.length, interp, note: args.note, observe: args.observe, today });
  console.log('生成 case（请人工复核 expect——机器只记现状，断言意图必须人来定）：');
  console.log(JSON.stringify(c, null, 2));
  const nextDoc = { ...doc, cases: [...doc.cases, c] };
  const { errors } = loadAndValidateFixtures(nextDoc);
  if (errors.length) { console.error('写回前校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n')); process.exit(1); }
  if (args.dry) { console.log('--dry：未写回 fixtures'); return; }
  writeFixturesSafely(nextDoc);
}

function writeFixturesSafely(doc) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FIXTURES_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmp, FIXTURES_PATH);
  console.log(`fixtures 已写回 ${FIXTURES_PATH}`);
}

/** 从最近 run 存档取某 case 现行判读（--update-expect 不重烧 Jev，以已跑结果为准） */
function latestArchivedInterp(caseId) {
  let names;
  try {
    names = readdirSync(DATA_DIR).filter((f) => /^cd-run-.*\.json$/.test(f)).sort();
  } catch (_) {
    return null; // data/ 尚无存档
  }
  for (let i = names.length - 1; i >= 0; i--) {
    try {
      const doc = JSON.parse(readFileSync(resolve(DATA_DIR, names[i]), 'utf8'));
      const hit = (doc.results || []).find((r) => r.caseId === caseId && r.interp && !r.error);
      if (hit) return hit.interp;
    } catch (_) { /* 撕裂/坏档跳过取更旧 */ }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const { cases, errors } = loadAndValidateFixtures(doc);
  if (errors.length) { console.error('fixtures 校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n')); process.exit(2); }

  if (args.list) { cmdList(cases); return; }
  if (args.add) { await cmdAdd(args, doc, cases); return; }

  if (args.updateExpect.length) {
    if (!args.because) { console.error('--update-expect 必须带 --because "<CD 编号> <裁定一句话>"'); process.exit(2); }
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    for (const id of args.updateExpect) {
      const idx = cases.findIndex((x) => x.caseId === id);
      if (idx < 0) { console.error(`caseId 不存在: ${id}`); process.exit(2); }
      const interp = latestArchivedInterp(id);
      if (!interp) { console.error(`${id} 无 run 存档判读——先跑一次 --only ${id} 再更新预期（不重烧 Jev，以已跑结果为准）`); process.exit(1); }
      const next = updateExpect(cases[idx], interp, args.because, today);
      console.log(`${id}: verdict ${JSON.stringify(cases[idx].expect.verdict)} → ${JSON.stringify(next.expect.verdict)}  because=${args.because}`);
      cases[idx] = next;
      changed = true;
    }
    if (changed && !args.dry) writeFixturesSafely({ ...doc, cases });
    else if (changed) console.log('--dry：未写回 fixtures');
    return;
  }

  const qMod = args.dry ? null : await import('../../src/narrative/analyzer/llm/cheat-questions.mjs');
  const version = qMod ? qMod.CHEAT_QUESTIONS_VERSION : '(dry)';
  const targets = args.only.length ? cases.filter((c) => args.only.includes(c.caseId)) : cases;
  const missing = args.only.filter((id) => !cases.some((c) => c.caseId === id));
  if (missing.length) { console.error(`caseId 不存在: ${missing.join(',')}`); process.exit(2); }

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PROMPT_DIR, { recursive: true });
  const results = [];
  let failed = 0;
  for (const c of targets) {
    console.log(`\n▶ ${c.caseId} ${c.symbol} ${c.addr} @${c.anchor.tickCount}${c.anchor.capped ? '+' : ''}`);
    try {
      const r = await runCase(c, { dry: args.dry, version });
      if (args.dry) { console.log(`  --dry：state 已组装（${r.promptChars} chars），未烧 Jev`); continue; }
      writeFileSync(resolve(PROMPT_DIR, `${c.caseId}-${version}.txt`), r.state, 'utf8');
      const { failures } = assertExpectation(r.interp, c.expect);
      const pass = !failures.length;
      if (!pass) failed++;
      console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'} verdict=${r.interp.verdict} cheatP=${r.interp.cheatProb} pattern=${r.interp.patternType} retail=${r.interp.retailParticipation}${failures.length ? '\n  ' + failures.join('\n  ') : ''}`);
      results.push({ caseId: c.caseId, addr: c.addr, anchor: c.anchor, questionVersion: version, interp: r.interp, pass, failures, promptChars: r.promptChars });
    } catch (e) {
      failed++;
      console.error(`  ❌ 异常: ${e.message}`);
      results.push({ caseId: c.caseId, addr: c.addr, anchor: c.anchor, questionVersion: version, error: e.message, pass: false });
    }
  }
  if (results.length) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(resolve(DATA_DIR, `cd-run-${ts}.json`), JSON.stringify({ ranAt: new Date().toISOString(), questionVersion: version, dry: args.dry, results }, null, 2), 'utf8');
  }
  console.log(`\n${args.dry ? 'dry 组装' : '对拍'}完成：${results.filter((r) => r.pass).length}/${results.length} 过${failed ? `，失败 ${failed}` : ''}`);
  if (!args.dry && (failed || !results.length)) process.exit(1);
}

main().catch((e) => {
  console.error(`❌ ${e?.stack || e}`);
  process.exit(1);
});
