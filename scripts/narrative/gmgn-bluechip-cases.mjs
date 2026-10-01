#!/usr/bin/env node
/**
 * GMGN 榜单蓝筹验证·第二轮（2026-10-01 用户发起）——case-by-case 逐票模式
 *
 * 09-30 批量轮（gmgn-bluechip-validation.mjs）整体跑完再归因效果不佳，本轮换方式：
 * 逐 token 喂叙事引擎，跑一个看一个，不通过就停下来深挖（Jev 逐题答案/precheck
 * 规则细节/语料获取全量落盘 cases/<addr>.json 供逐 case 分析）。
 *
 * 数据目录 data/gmgn-bluechip-cases/（与批量轮 data/gmgn-bluechip-validation/ 分离，
 * 不碰 09-30 快照）。复用批量轮的榜单口径（三榜各 100 合并去重）与 B 类造行挂靠
 * （同一验证实验行 2609e300，status='stopped' 纯数据挂靠）。
 *
 * 用法：
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --fetch       # 拉三榜 → list.json
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --classify    # A/B 类标记（含 provenance）
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --order       # 打印处理顺序预览
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --next        # 跑下一个未处理 case
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --case <addr> # 指定地址跑一个 case
 *   node scripts/narrative/gmgn-bluechip-cases.mjs --status      # 进度总览
 *
 * --next/--case 语义：analyze(ignoreCache:true, enrichSocialByGmgn:true)（与批量轮同
 * 口径，验证的是当前引擎）；全量结果 JSON 落盘；rating high/mid=PASS（exit 0），
 * low/unrated/null/异常=FAIL（exit 2）。B 类无行先自动造行再分析。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

// 主动加载 config/.env（GMGN_API_KEY 等在 dbManager require 链之外也要用；不覆盖已设 env）
for (const line of fs.readFileSync(path.join(ROOT, 'config/.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DATA_DIR = path.join(ROOT, 'data', 'gmgn-bluechip-cases');
const LIST_FILE = path.join(DATA_DIR, 'list.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.jsonl');
const CASES_DIR = path.join(DATA_DIR, 'cases');

/** 与批量轮同一验证实验行（幂等 upsert；status='stopped' 纯数据挂靠不启引擎） */
const VALIDATION_EXPERIMENT = {
  id: '2609e300-b17e-4c1a-9a30-0e6e617a1d00',
  name: 'gmgn-bluechip-validation',
};

/** 榜单口径（批量轮用户裁定沿用）：三榜各 100 */
const RANK_DEFS = [
  { key: 'mc24h', interval: '24h', order_by: 'marketcap' },
  { key: 'renowned24h', interval: '24h', order_by: 'renowned_count' },
  { key: 'vol24h', interval: '24h', order_by: 'volume' },
];
const RANK_LIMIT = 100;

/** 非 meme 计价/基础设施币过滤（GMGN rank 偶混入，进叙事验证只是噪声） */
const EXCLUDE_ADDRS = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE
  '0x2170ed0880ac9a755fd29b2688956bd959f93388', // ETH
]);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CASES_DIR, { recursive: true });
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

function extractRankRows(res) {
  const cand = [res?.data?.rank, res?.rank, res?.list, res?.data];
  return cand.find(Array.isArray) || [];
}

function normalizeTwitterUrl(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return s ? `https://x.com/${s}` : null;
}

/** 榜单行 → 标准化记录（字段名 2026-09-30 批量轮冒烟实测收敛） */
function normalizeRankRow(row, rankDef, rankIndex) {
  const addr = String(row.address || '').toLowerCase();
  const pickPos = (...keys) => {
    for (const k of keys) {
      if (typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] > 0) return row[k];
    }
    return null;
  };
  return {
    address: addr,
    symbol: row.symbol || null,
    name: row.name || null,
    openTimestampSec: pickPos('creation_timestamp', 'open_timestamp'),
    marketCapUsd: pickPos('market_cap', 'marketCap'),
    volume24hUsd: pickPos('volume'),
    holderCount: pickPos('holder_count'),
    renownedCount: pickPos('renowned_count'),
    smartDegenCount: pickPos('smart_degen_count'),
    swaps24h: pickPos('swaps'),
    launchpad: row.launchpad_platform || row.launchpad || null,
    twitterUrl: normalizeTwitterUrl(row.twitter_username),
    websiteUrl: (typeof row.website === 'string' && /^https?:\/\//i.test(row.website)) ? row.website : null,
    ranks: { [rankDef.key]: rankIndex + 1 },
  };
}

function isValidBscAddr(a) {
  return /^0x[0-9a-f]{40}$/.test(a);
}

async function getDb() {
  const { dbManager } = await import('../../src/services/dbManager.js');
  return dbManager.getClient();
}

async function getGmgnApis() {
  const { GMGNMarketAPI, GMGNTokenAPI } = await import('../../src/core/gmgn-api/index.js');
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY 未配置（config/.env）');
  return {
    marketApi: new GMGNMarketAPI({ apiKey, timeout: 30000 }),
    tokenApi: new GMGNTokenAPI({ apiKey, timeout: 30000 }),
  };
}

function mapPlatform(launchpad) {
  if (!launchpad) return 'unknown';
  const s = String(launchpad).toLowerCase();
  if (s.includes('four')) return 'fourmeme';
  if (s.includes('flap')) return 'flap';
  return s.replace(/[^a-z0-9_.-]/g, '') || 'unknown';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────── --fetch ───────────────────────

async function cmdFetch() {
  const { marketApi } = await getGmgnApis();
  // 断点续跑（GMGN 榜单接口连续两榜即 429 ban ~30s——逐榜落盘 + 榜间间隔 + 429 退避）
  const prevStore = readJson(LIST_FILE, null);
  const completed = new Set(prevStore?.completedRanks || []);
  const merged = new Map((prevStore?.tokens || []).map(t => [t.address, t]));

  for (const def of RANK_DEFS) {
    if (completed.has(def.key)) { console.log(`榜单 ${def.key} 已完成，跳过`); continue; }
    console.log(`拉榜单 ${def.key} (interval=${def.interval} order_by=${def.order_by} limit=${RANK_LIMIT}) ...`);
    let rows = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await marketApi.getTrendingSwaps('bsc', def.interval, { order_by: def.order_by, limit: RANK_LIMIT });
        rows = extractRankRows(res);
        break;
      } catch (e) {
        if (attempt >= 3 || !/429|RATE_LIMIT/i.test(String(e?.message) + String(e?.name))) throw e;
        console.log(`  429 限速，等 35s 重试（第 ${attempt} 次）...`);
        await sleep(35000);
      }
    }
    let kept = 0;
    (rows || []).forEach((row, i) => {
      const rec = normalizeRankRow(row, def, i);
      if (!isValidBscAddr(rec.address)) return;
      if (EXCLUDE_ADDRS.has(rec.address)) return;
      const prev = merged.get(rec.address);
      if (prev) {
        prev.ranks[def.key] = i + 1;
        for (const k of ['symbol', 'name', 'openTimestampSec', 'marketCapUsd', 'volume24hUsd', 'holderCount', 'renownedCount', 'smartDegenCount', 'swaps24h', 'launchpad', 'twitterUrl', 'websiteUrl']) {
          if (prev[k] == null && rec[k] != null) prev[k] = rec[k];
        }
      } else {
        merged.set(rec.address, rec);
        kept++;
      }
    });
    completed.add(def.key);
    writeJson(LIST_FILE, {
      fetchedAt: new Date().toISOString(),
      ranks: RANK_DEFS.map(d => d.key),
      completedRanks: [...completed],
      tokens: [...merged.values()],
    });
    console.log(`  行数=${rows?.length ?? 0} 新增=${kept}（累计 ${merged.size}，进度已落盘）`);
    if (def !== RANK_DEFS[RANK_DEFS.length - 1]) await sleep(35000);
  }
  console.log(`合并去重 ${merged.size} 票 → ${LIST_FILE}`);
}

// ─────────────────────── --classify ───────────────────────

/**
 * provenance 三档：
 *   A     = 有 watcher/其他实验行（data_source 非 gmgn_rank_validation）——引擎真实数据，最忠实
 *   prevB = 只有 09-30 批量轮注入行（gmgn_rank_validation）
 *   newB  = 无任何行，本轮需造行
 */
async function cmdClassify() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch');
  const db = await getDb();
  const rowsByAddr = new Map();
  const addrs = store.tokens.map(t => t.address);
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { data, error } = await db.from('experiment_tokens')
      .select('token_address, data_source').in('token_address', batch);
    if (error) throw error;
    for (const r of data || []) {
      const a = String(r.token_address).toLowerCase();
      if (!rowsByAddr.has(a)) rowsByAddr.set(a, []);
      rowsByAddr.get(a).push(String(r.data_source || ''));
    }
  }
  const cnt = { A: 0, prevB: 0, newB: 0 };
  for (const t of store.tokens) {
    const sources = rowsByAddr.get(t.address) || [];
    if (sources.length === 0) t.provenance = 'newB';
    else if (sources.some(s => s !== 'gmgn_rank_validation')) t.provenance = 'A';
    else t.provenance = 'prevB';
    cnt[t.provenance]++;
  }
  store.classifiedAt = new Date().toISOString();
  writeJson(LIST_FILE, store);
  console.log(`A(引擎真实数据)=${cnt.A}，prevB(09-30 注入过)=${cnt.prevB}，newB(需造行)=${cnt.newB}`);
}

// ─────────────────────── 造行（B 类单票，--next 内联用 + --inject 批量用） ───────────────────────

async function ensureValidationExperiment(db) {
  const { error } = await db.from('experiments').upsert({
    id: VALIDATION_EXPERIMENT.id,
    experiment_name: VALIDATION_EXPERIMENT.name,
    experiment_description: 'GMGN 榜单蓝筹叙事验证：B 类无行币造行挂靠，纯数据挂靠不启动引擎，去留由用户裁定（09-30 批量轮 + 10-01 case-by-case 轮共用）',
    status: 'stopped',
    trading_mode: 'virtual',
    config: {
      name: VALIDATION_EXPERIMENT.name,
      blockchain: 'bsc',
      platform: 'fourmeme',
      virtual: { initialBalance: 100, tradeAmount: 0.1 },
      validationOnly: true,
    },
  }, { onConflict: 'id' });
  if (error) throw error;
}

async function injectToken(db, t) {
  const { fetchGmgnSocialLinks } = await import('../../src/narrative/utils/gmgn-social-fetcher.mjs');
  const { GMGNTokenAPI } = await import('../../src/core/gmgn-api/index.js');
  const tokenApi = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 30000 });

  let twitterUrl = t.twitterUrl || null;
  let websiteUrl = t.websiteUrl || null;
  let symbol = t.symbol, name = t.name, openTs = t.openTimestampSec, launchpad = t.launchpad;
  if ((!twitterUrl && !websiteUrl) || openTs == null || !name || !symbol) {
    const socials = await fetchGmgnSocialLinks('bsc', t.address).catch(() => null);
    twitterUrl = twitterUrl || socials?.twitterUrl || null;
    websiteUrl = websiteUrl || socials?.websiteUrl || null;
  }
  if (openTs == null || !name || !symbol) {
    const info = await tokenApi.getTokenInfo('bsc', t.address);
    symbol = symbol || info?.symbol || '';
    name = name || info?.name || '';
    openTs = openTs ?? (typeof info?.creation_timestamp === 'number' && info.creation_timestamp > 0
      ? info.creation_timestamp
      : (typeof info?.open_timestamp === 'number' && info.open_timestamp > 0 ? info.open_timestamp : null));
    launchpad = launchpad || info?.launchpad || null;
  }
  const raw = {
    symbol, name,
    twitterUrl,
    websiteUrl,
    created_at: openTs, // 秒；null → precheck 时效规则跳过 + Jev 回退墙钟（报告标注）
    source: 'gmgn_rank_validation',
  };
  const { error } = await db.from('experiment_tokens').insert({
    experiment_id: VALIDATION_EXPERIMENT.id,
    token_address: t.address,
    token_symbol: symbol || '',
    blockchain: 'bsc',
    platform: mapPlatform(launchpad),
    data_source: 'gmgn_rank_validation',
    discovered_at: new Date((openTs ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    status: 'monitoring',
    raw_api_data: raw,
  });
  // 23505 = 并发/重复注入唯一冲突，视为已存在
  if (error && error.code !== '23505') throw new Error(error.message);
  return { hasTwitter: !!raw.twitterUrl, hasWebsite: !!raw.websiteUrl, hasCreatedAt: openTs != null };
}

async function cmdInject() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--classify');
  const targets = store.tokens.filter(t => t.provenance === 'newB');
  if (!targets.length) { console.log('无 newB 票，跳过'); return; }
  const db = await getDb();
  await ensureValidationExperiment(db);
  console.log(`验证实验行就绪: ${VALIDATION_EXPERIMENT.id}；待造行 ${targets.length} 票`);
  let ok = 0, fail = 0;
  for (const t of targets) {
    try {
      await injectToken(db, t);
      t.provenance = 'prevB';
      ok++;
    } catch (e) {
      fail++;
      console.log(`inject 失败 ${t.symbol || t.address}: ${e?.message || e}`);
    }
    console.log(`inject [${ok + fail}/${targets.length}] ${t.symbol || t.address}`);
  }
  writeJson(LIST_FILE, store);
  console.log(`造行完成: ok=${ok} fail=${fail}`);
}

// ─────────────────────── case 顺序与执行 ───────────────────────

/** 处理顺序：A（引擎真实数据）优先 → prevB → newB；组内按市值降序（越大越蓝筹，失败越刺眼） */
function caseOrder(store) {
  const w = { A: 0, prevB: 1, newB: 2 };
  return [...store.tokens].sort((a, b) =>
    (w[a.provenance ?? 'newB'] - w[b.provenance ?? 'newB']) ||
    ((b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0)));
}

function cmdOrder() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在');
  const done = new Set(readJsonl(RESULTS_FILE).map(r => r.address));
  const rows = caseOrder(store);
  rows.forEach((t, i) => {
    const mark = done.has(t.address) ? '✓' : ' ';
    const mc = t.marketCapUsd != null ? `$${Math.round(t.marketCapUsd / 1e6)}M` : '-';
    console.log(`${mark} ${String(i + 1).padStart(3)} [${t.provenance ?? '?'}] ${mc.padStart(7)} ${t.symbol || t.address} ${Object.entries(t.ranks || {}).map(([k, v]) => `${k}#${v}`).join(',')}`);
  });
}

function cmdStatus() {
  const store = readJson(LIST_FILE, null);
  if (!store) { console.log('list.json 不存在（先 --fetch）'); return; }
  const results = readJsonl(RESULTS_FILE);
  const byRating = {};
  for (const r of results) {
    if (r.error) { byRating['error'] = (byRating['error'] || 0) + 1; continue; }
    byRating[r.rating ?? 'null'] = (byRating[r.rating ?? 'null'] || 0) + 1;
  }
  console.log(`榜单 ${store.tokens.length} 票（fetchedAt=${store.fetchedAt}）；已处理 ${results.length}`);
  console.log('评级分布:', JSON.stringify(byRating));
  results.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(3)} ${r.symbol || r.address} [${r.provenance}] ${r.rating ?? 'null'}${r.numericRating != null ? `(${r.numericRating})` : ''} ${r.preCheckRuleName ? `preCheck=${r.preCheckRuleName}` : ''}${r.error ? ` error=${String(r.error).slice(0, 60)}` : ''}`);
  });
}

/** dump 用：截断超长字符串（Jev state 等大字段防 JSON 文件爆炸）。
 * 循环检测走祖先路径（WeakSet 会把 DAG 共享引用误判成 circular——同一 answers
 * 对象被多个 stage 引用是常态，不能丢） */
function sanitizeForDump(value, maxStr = 3000) {
  const walk = (v, ancestors) => {
    if (typeof v === 'string') return v.length > maxStr ? v.slice(0, maxStr) + `…[truncated ${v.length}]` : v;
    if (v === null || typeof v !== 'object' || typeof v === 'function') return v;
    if (ancestors.has(v)) return '[Circular]';
    const next = new Set(ancestors);
    next.add(v);
    if (Array.isArray(v)) return v.map(x => walk(x, next));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val, next);
    return out;
  };
  return walk(value, new Set());
}

async function runCase(t) {
  const db = await getDb();
  // newB 先造行（analyze 全链路需要 experiment_tokens 行）
  if (t.provenance === 'newB') {
    await ensureValidationExperiment(db);
    const info = await injectToken(db, t);
    t.provenance = 'prevB';
    console.log(`[inject] ${t.symbol || t.address} 造行完成 twitter=${info.hasTwitter} web=${info.hasWebsite} createdAt=${info.hasCreatedAt}`);
  }

  const { NarrativeAnalyzer } = await import('../../src/narrative/analyzer/NarrativeAnalyzer.mjs');
  const startedAt = Date.now();
  const r = await NarrativeAnalyzer.analyze(t.address, { ignoreCache: true, enrichSocialByGmgn: true });
  const durationMs = Date.now() - startedAt;

  const twitterUrls = r?.classifiedUrls?.twitter;
  const row = {
    address: t.address,
    symbol: r?.token?.symbol || t.symbol,
    provenance: t.provenance,
    marketCapUsd: t.marketCapUsd ?? null,
    ranks: t.ranks || {},
    rating: r?.rating ?? null,
    numericRating: r?.numericRating ?? null,
    reason: (r?.reason || '').slice(0, 400) || null,
    score: r?.score ?? null,
    preCheckRuleName: r?.llmAnalysis?.preCheck?.details?.ruleName
      ?? r?.meta?.preCheckReason ?? null,
    analysisStage: r?.debugInfo?.analysisStage ?? r?.analysis_stage ?? null,
    hasTwitterCorpus: Array.isArray(twitterUrls) ? twitterUrls.length > 0 : !!twitterUrls,
    twitterHandle: r?.twitter?.screen_name ?? null,
    fetchErrorCount: r?.fetchErrors ? Object.values(r.fetchErrors)
      .filter(v => v && (typeof v !== 'object' || Object.keys(v).length > 0)).length : 0,
    promptVersion: r?.meta?.promptVersion ?? null,
    promptType: r?.meta?.promptType ?? null,
    durationMs,
    caseFile: path.join('data/gmgn-bluechip-cases/cases', `${t.address}.json`),
    analyzedAt: new Date().toISOString(),
  };
  appendJsonl(RESULTS_FILE, row);
  // 全量结果落盘（深挖用：Jev 逐题答案/precheck 细节/URL 提取/抓取错误）
  writeJson(path.join(CASES_DIR, `${t.address}.json`), sanitizeForDump(r));

  const pass = r?.rating === 'high' || r?.rating === 'mid';
  console.log('────────────────────────────────────────');
  console.log(`CASE ${t.symbol || t.address} (${t.address})`);
  console.log(`  provenance=${row.provenance} mc=${t.marketCapUsd != null ? '$' + (t.marketCapUsd / 1e6).toFixed(1) + 'M' : '-'} ranks=${Object.entries(t.ranks || {}).map(([k, v]) => `${k}#${v}`).join(',')}`);
  console.log(`  rating=${row.rating}${row.numericRating != null ? `(${row.numericRating})` : ''} score=${row.score ?? '-'} preCheck=${row.preCheckRuleName ?? '-'} stage=${row.analysisStage ?? '-'} ${row.promptVersion ?? ''}`);
  console.log(`  twitter=${row.hasTwitterCorpus}(${row.twitterHandle ?? '-'}) fetchErrors=${row.fetchErrorCount} ${durationMs}ms`);
  console.log(`  reason: ${row.reason || '-'}`);
  console.log(`  dump: ${row.caseFile}`);
  console.log(`RESULT: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  return pass;
}

async function cmdNext() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--classify');
  const done = new Set(readJsonl(RESULTS_FILE).map(r => r.address));
  const t = caseOrder(store).find(x => !done.has(x.address));
  if (!t) { console.log('全部 case 已处理完'); return 0; }
  const pass = await runCase(t);
  process.exitCode = pass ? 0 : 2;
}

async function cmdCase(addr) {
  const a = String(addr).toLowerCase();
  const store = readJson(LIST_FILE, null);
  const t = store?.tokens.find(x => x.address === a);
  if (!t) throw new Error(`地址不在 list.json: ${a}（--case 只跑榜单内票）`);
  const pass = await runCase(t);
  process.exitCode = pass ? 0 : 2;
}

// ─────────────────────── main ───────────────────────

const arg = process.argv[2];
const cmds = {
  '--fetch': cmdFetch, '--classify': cmdClassify, '--inject': cmdInject,
  '--order': cmdOrder, '--next': cmdNext, '--status': cmdStatus,
};
const fn = cmds[arg];
if (!fn) {
  if (arg === '--case') {
    const addr = process.argv[3];
    if (!addr) { console.error('用法: --case <address>'); process.exit(1); }
    ensureDataDir();
    cmdCase(addr).catch(e => { console.error('失败:', e?.stack || e); process.exit(1); });
  } else {
    console.error('用法: node scripts/narrative/gmgn-bluechip-cases.mjs --fetch|--classify|--inject|--order|--next|--case <addr>|--status');
    process.exit(1);
  }
} else {
  ensureDataDir();
  Promise.resolve(fn()).catch(e => { console.error('失败:', e?.stack || e); process.exit(1); });
}
