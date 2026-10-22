#!/usr/bin/env node
/**
 * 叙事知识库·准蓝筹（近期毕业票）构建管线（C165；只在 182 跑）
 *
 * 主路 GMGN trenches completed（fourmeme/flap 两平台各拉一批，避开 wss_events kind
 * 全局扫的 8s 超时坑），7d 窗过滤 + 上限 300；毕业时间富化优先 wss_events graduation
 * 批 .in(50) 点查（token_address 过滤走索引；GMGN created_timestamp 是索引时间晚链上
 * ~9min，只作窗口粗滤不作毕业时间真相）。叙事富化走 DB 两源（token_narrative 已析行
 * + experiment_tokens intro；零 AVE）。产物 data/knowledge/quasi-graduations.json
 * （不进 git；loader mtime 热载免重启）。
 *
 * 用法（182）：
 *   node scripts/narrative/build-knowledge-quasi.mjs --smoke    # 冒烟：completed 行字段形状
 *   node scripts/narrative/build-knowledge-quasi.mjs --fetch    # 拉两平台 completed → data/knowledge/build-quasi/list.json
 *   node scripts/narrative/build-knowledge-quasi.mjs --commit   # 窗口过滤+毕业点查+叙事富化 → quasi-graduations.json（缺省 dry-run）
 *
 * 纯函数（normalizeTrenchRow/filterQuasiByWindow/buildQuasiEntry）零 DB 零网络，
 * 单测 scripts/_test_knowledge_builder_core.cjs 锚定。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { autoCorpusTriggerForEntry } from '../../src/narrative/analyzer/knowledge/knowledge-matcher.mjs';
import { normalizeTwitterUrl } from './build-knowledge-bluechips.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

for (const line of fs.readFileSync(path.join(ROOT, 'config/.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DATA_DIR = path.join(ROOT, 'data', 'knowledge', 'build-quasi');
const LIST_FILE = path.join(DATA_DIR, 'list.json');
const OUT_FILE = path.join(ROOT, 'data', 'knowledge', 'quasi-graduations.json');

export const QUASI_WINDOW_SEC = 7 * 24 * 3600; // 「近期毕业」= 7d 窗
export const QUASI_MAX_ENTRIES = 300;
const TRENCH_LIMIT = 100; // getTrenches 每类上限（两平台各一拉）
const PLATFORMS = ['fourmeme', 'flap'];
const BATCH = 50; // Supabase .in() URL 8KB 红线内

// ═══════════════════ 纯函数（单测锚定区） ═══════════════════

const pickPosFrom = (row, ...keys) => {
  for (const k of keys) {
    if (typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] > 0) return row[k];
  }
  return null;
};

/**
 * trenches completed 行 → 标准化记录（字段名 182 --smoke 2026-10-22 收敛：twitter 键=
 * twitter_handle（twitter 键是 status URL 杂烩）；openTimestampSec 读毕业时间
 * （complete_timestamp==open_timestamp，窗口语义=距毕业 7d）；market_cap=USD（price×supply 对拍吻合）
 */
export function normalizeTrenchRow(row, platform) {
  const addr = String(row.address || '').toLowerCase();
  return {
    address: addr,
    symbol: row.symbol || null,
    name: row.name || null,
    platform,
    openTimestampSec: pickPosFrom(row, 'complete_timestamp', 'open_timestamp'),
    marketCapUsd: pickPosFrom(row, 'market_cap', 'marketCap'),
    volume24hUsd: pickPosFrom(row, 'volume'),
    holderCount: pickPosFrom(row, 'holder_count'),
    twitterUrl: normalizeTwitterUrl(row.twitter_handle),
    websiteUrl: (typeof row.website === 'string' && /^https?:\/\//i.test(row.website)) ? row.website : null,
  };
}

/**
 * 7d 窗过滤（含缺时间戳行的处理策略：openTimestampSec 缺失 → 保留由毕业点查兜底
 * 判窗——GMGN 索引时间缺失不代表非近期，宁保留待点查；返回 {kept, dropped} 分流）
 */
export function filterQuasiByWindow(records, nowSec, windowSec = QUASI_WINDOW_SEC) {
  const kept = [];
  const noTs = [];
  for (const r of records) {
    if (!/^0x[0-9a-f]{40}$/.test(r.address)) continue;
    if (r.openTimestampSec == null) { noTs.push(r); continue; }
    if (nowSec - r.openTimestampSec <= windowSec) kept.push(r);
  }
  return { kept, noTs };
}

/** 记录 → 准蓝筹知识条目（id=q:<addr>，与 feedback 同 id 域——后写覆盖=feedback 沉淀优先） */
export function buildQuasiEntry(rec, options = {}) {
  const name = rec.name || rec.symbol || rec.address;
  const aliases = [];
  if (rec.symbol && rec.symbol !== name) aliases.push(rec.symbol);
  return {
    id: `q:${rec.address}`,
    kind: 'quasi',
    name,
    symbol: rec.symbol || '',
    aliases,
    address: rec.address,
    twitter: rec.twitterUrl || null,
    narrative: options.narrative || '',
    graduatedAt: options.graduatedAt || null,
    marketCapUsd: rec.marketCapUsd || null,
    corpusTrigger: options.corpusTrigger ?? autoCorpusTriggerForEntry([name, ...aliases]),
    source: 'graduations',
    rating: options.rating || null,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };
}

// ═══════════════════ IO/命令区（只在 182 跑） ═══════════════════

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractTrenchRows(res, type) {
  const cand = [res?.data?.[type], res?.[type], res?.data?.rank, res?.data];
  return cand.find(Array.isArray) || [];
}

async function getGmgn() {
  const { GMGNMarketAPI, preResolveGMGNHost } = await import('../../src/core/gmgn-api/index.js');
  await preResolveGMGNHost();
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY 未配置（config/.env）');
  return new GMGNMarketAPI({ apiKey, timeout: 30000 });
}

async function getDb() {
  const { dbManager } = await import('../../src/services/dbManager.js');
  return dbManager.getClient(); // service key 红线
}

// ─────────────────────── --smoke ───────────────────────

async function cmdSmoke() {
  const api = await getGmgn();
  console.log('=== trenches completed 冒烟: bsc fourmeme limit=5 ===');
  const res = await api.getTrenches('bsc', ['completed'], ['fourmeme'], 5);
  console.log('响应顶层键:', Object.keys(res?.data || res || {}).join(', '));
  const rows = extractTrenchRows(res, 'completed');
  console.log(`completed 行数: ${rows.length}`);
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`  #${i + 1}`, JSON.stringify(r).slice(0, 400));
  });
  console.log('normalizeTrenchRow 判读:', JSON.stringify(rows.slice(0, 3).map((r) => normalizeTrenchRow(r, 'fourmeme'))));
}

// ─────────────────────── --fetch ───────────────────────

async function cmdFetch() {
  const api = await getGmgn();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const byAddr = new Map();
  for (const platform of PLATFORMS) {
    console.log(`拉 trenches completed: ${platform} limit=${TRENCH_LIMIT} ...`);
    let rows = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await api.getTrenches('bsc', ['completed'], [platform], TRENCH_LIMIT);
        rows = extractTrenchRows(res, 'completed');
        break;
      } catch (e) {
        if (attempt >= 3 || !/429|RATE_LIMIT/i.test(String(e?.message) + String(e?.name))) throw e;
        console.log(`  429 限速，等 35s 重试（第 ${attempt} 次）...`);
        await sleep(35000);
      }
    }
    for (const row of rows || []) {
      const rec = normalizeTrenchRow(row, platform);
      if (!byAddr.has(rec.address)) byAddr.set(rec.address, rec);
    }
    console.log(`  行数=${rows?.length ?? 0} 累计=${byAddr.size}`);
    if (platform !== PLATFORMS[PLATFORMS.length - 1]) await sleep(35000);
  }
  writeJson(LIST_FILE, { fetchedAt: new Date().toISOString(), tokens: [...byAddr.values()] });
  console.log(`${byAddr.size} 票 → ${LIST_FILE}`);
}

// ─────────────────────── --commit ───────────────────────

/** wss_events graduation 批点查 → Map<addr, block_time 最早行>（token_address 过滤走索引） */
async function fetchGraduationTimes(db, addresses) {
  const found = new Map();
  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH);
    const { data, error } = await db.from('wss_events')
      .select('token_address, block_time, created_at')
      .eq('kind', 'graduation')
      .in('token_address', batch);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const prev = found.get(row.token_address);
      if (!prev || (row.block_time && row.block_time < prev)) {
        found.set(row.token_address, row.block_time || row.created_at || null);
      }
    }
  }
  return found;
}

async function cmdCommit(dry) {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch');
  const nowSec = Math.floor(Date.now() / 1000);
  const { kept, noTs } = filterQuasiByWindow(store.tokens, nowSec);
  console.log(`7d 窗：窗内=${kept.length} 缺时间戳=${noTs.length}（点查兜底判窗）`);

  const db = await getDb();
  // 毕业时间点查（窗内+缺 ts 两路都查：缺 ts 行靠真毕业时间判窗）
  const candidates = [...kept, ...noTs];
  const gradByAddr = await fetchGraduationTimes(db, candidates.map((r) => r.address));
  const gradChecked = [];
  for (const rec of candidates) {
    const grad = gradByAddr.get(rec.address) || null;
    if (rec.openTimestampSec == null && !grad) continue; // 双缺无法判窗，宁缺勿滥
    if (grad) {
      const gradSec = Date.parse(grad) / 1000;
      if (Number.isFinite(gradSec) && nowSec - gradSec > QUASI_WINDOW_SEC) continue; // 真毕业时间出窗
    }
    gradChecked.push({ rec, graduatedAt: grad });
  }
  if (gradChecked.length > QUASI_MAX_ENTRIES) gradChecked.length = QUASI_MAX_ENTRIES;

  // 叙事富化（DB 两源，与蓝筹 --enrich 同形轻量版）
  const addrs = gradChecked.map((g) => g.rec.address);
  const narrByAddr = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { data: narrRows, error: e1 } = await db.from('token_narrative')
      .select('token_address, stage_final_result, prestage_result, analyzed_at')
      .in('token_address', batch);
    if (e1) throw new Error(e1.message);
    for (const row of narrRows || []) {
      const fin = row.stage_final_result || {};
      const rating = fin.category ?? fin.rating ?? row.prestage_result?.rating ?? null;
      const reason = fin.reason ?? fin.reasoning ?? row.prestage_result?.reasoning ?? null;
      const prev = narrByAddr.get(row.token_address);
      const ts = Date.parse(row.analyzed_at || '') || 0;
      if (!prev || ts > prev.ts) narrByAddr.set(row.token_address, { rating, reason, ts });
    }
    const { data: tokRows, error: e2 } = await db.from('experiment_tokens')
      .select('token_address, raw_api_data')
      .in('token_address', batch);
    if (e2) throw new Error(e2.message);
    for (const row of tokRows || []) {
      const raw = row.raw_api_data || {};
      const intro = raw.intro_cn || raw.description || null;
      const prev = narrByAddr.get(row.token_address);
      if (intro && !prev?.intro) narrByAddr.set(row.token_address, { ...(prev || { rating: null, reason: null, ts: 0 }), intro: String(intro) });
    }
  }

  const entries = gradChecked.map(({ rec, graduatedAt }) => {
    const n = narrByAddr.get(rec.address) || {};
    const intro = String(n.intro || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const parts = [];
    if (intro) parts.push(intro);
    if (n.rating) parts.push(`本系统评 ${n.rating}${n.reason ? `：${String(n.reason).replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`);
    return buildQuasiEntry(rec, {
      graduatedAt, narrative: parts.join('｜'), rating: n.rating || null,
      updatedAt: new Date().toISOString(),
    });
  });
  const out = {
    kind: 'quasi', version: 1,
    note: '近期毕业准蓝筹快照（builder scripts/narrative/build-knowledge-quasi.mjs --commit 生成，7d 窗上限 300）；不进 git，loader mtime 热载',
    generatedAt: new Date().toISOString(),
    entries,
  };
  if (dry) {
    console.log(`dry-run：${entries.length} 条准蓝筹将写入 ${OUT_FILE}`);
    for (const e of entries.slice(0, 10)) {
      console.log(`  ${e.name} (${e.symbol}) ${e.graduatedAt || '毕业时间缺'} ${e.twitter || ''} narrative=${e.narrative ? `${e.narrative.length}字` : '无'}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeJson(OUT_FILE, out);
  console.log(`已写 ${entries.length} 条 → ${OUT_FILE}`);
}

// ─────────────────────── main ───────────────────────

// CLI 派发只在直接执行时跑（被单测 import 时不跑）
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = process.argv[2];
  try {
    if (arg === '--smoke') await cmdSmoke();
    else if (arg === '--fetch') await cmdFetch();
    else if (arg === '--commit') await cmdCommit(false);
    else {
      console.log('用法：--smoke | --fetch | --commit');
      if (!arg) await cmdCommit(true); // 无参=dry-run 打印
    }
  } catch (e) {
    console.error('FATAL', e);
    process.exit(1);
  }
}
