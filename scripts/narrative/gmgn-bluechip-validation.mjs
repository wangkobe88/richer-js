#!/usr/bin/env node
/**
 * GMGN 榜单蓝筹验证叙事引擎（假阴性扫描，2026-09-30 用户发起）
 *
 * 思路：GMGN 热门榜单币相对绝大多数代币算蓝筹/小蓝筹，批量喂给叙事分析引擎，
 * 未通过的票系统性整理归因，暴露引擎假阴性。榜单口径（用户裁定）：24h×marketcap
 * + 24h×renowned_count + 24h×volume 三榜各 100 合并去重（约 150-200 票）。
 *
 * A 类（experiment_tokens 已有行）直接 analyze；B 类（无行，老蓝筹为主）先造行：
 * GMGN token info 组装 raw_api_data 插到专用验证实验（固定 uuid，status='stopped'
 * 纯数据挂靠不启引擎）名下，再走 analyze 全链路零改动。造行/分析都传
 * enrichSocialByGmgn（社媒补源是 B 类币的唯一语料入口，用户已批准本次验证消耗 GMGN 配额）。
 *
 * 用法（在 182 跑；分阶段可断点续跑，进度落盘 data/gmgn-bluechip-validation/）：
 *   node scripts/narrative/gmgn-bluechip-validation.mjs --smoke     # 冒烟：打印榜单/token info 真实字段
 *   node scripts/narrative/gmgn-bluechip-validation.mjs --fetch     # 拉三榜合并去重 → list.json
 *   node scripts/narrative/gmgn-bluechip-validation.mjs --classify  # 标记 existing（A/B 类）并入 list.json
 *   node scripts/narrative/gmgn-bluechip-validation.mjs --inject    # B 类造行（验证实验行 + experiment_tokens）
 *   nohup node scripts/narrative/gmgn-bluechip-validation.mjs --analyze >> data/gmgn-bluechip-validation/run.log 2>&1 &
 *   node scripts/narrative/gmgn-bluechip-validation.mjs --report    # 汇总 → report.md
 *
 * 注意：analyze 用 ignoreCache:true——token_narrative 全局表旧行被 J1.21 口径覆盖
 * （版本刷新，§六-11 既定现状）；验证实验行与注入行不删（去留由用户裁定）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

// 主动加载 config/.env（GMGN_API_KEY 等在 dbManager require 链之外也要用；
// 已设的 env 不覆盖）
for (const line of fs.readFileSync(path.join(ROOT, 'config/.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DATA_DIR = path.join(ROOT, 'data', 'gmgn-bluechip-validation');
const LIST_FILE = path.join(DATA_DIR, 'list.json');
const INJECTED_FILE = path.join(DATA_DIR, 'injected.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.jsonl');
const REPORT_FILE = path.join(DATA_DIR, 'report.md');

/** 专用验证实验（固定 uuid 幂等；status='stopped' 防被当成待启动实验） */
const VALIDATION_EXPERIMENT = {
  id: '2609e300-b17e-4c1a-9a30-0e6e617a1d00',
  name: 'gmgn-bluechip-validation',
};

/** 榜单口径（用户裁定 2026-09-30）：三榜各 100 */
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

/** 榜单响应 → 行数组（冒烟实测：_normalRequest 返回完整 {code, data:{rank:[...]}} 外壳） */
function extractRankRows(res) {
  const cand = [res?.data?.rank, res?.rank, res?.list, res?.data];
  return cand.find(Array.isArray) || [];
}

/** 榜单行 twitter_username 实测可能是完整 URL（"https://x.com/Ripple"）或裸 handle */
function normalizeTwitterUrl(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return s ? `https://x.com/${s}` : null;
}

/**
 * GMGN 榜单行 → 标准化记录。字段名已按 2026-09-30 冒烟实测收敛：
 * market_cap/volume/swaps/holder_count/smart_degen_count/renowned_count 扁平数字；
 * 创建时间 creation_timestamp（open_timestamp 实测常为 0 占位——0 视为无效）；
 * launchpad_platform 是平台口径（launchpad 常空串）；社媒 twitter_username/website
 * 榜单行直接带出（B 类造行零额外 GMGN 调用）。
 */
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
  // dbManager require 链加载 config/.env（chdir 后相对路径成立）；getClient = service key
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

/** B 类造行的 platform 映射：experiment_tokens.platform 与引擎口径一致 */
function mapPlatform(launchpad) {
  if (!launchpad) return 'unknown';
  const s = String(launchpad).toLowerCase();
  if (s.includes('four')) return 'fourmeme';
  if (s.includes('flap')) return 'flap';
  return s.replace(/[^a-z0-9_.-]/g, '') || 'unknown';
}

// ─────────────────────── --smoke ───────────────────────

async function cmdSmoke() {
  const { marketApi, tokenApi } = await getGmgnApis();
  console.log('=== 榜单冒烟: bsc 24h marketcap limit=5 ===');
  const res = await marketApi.getTrendingSwaps('bsc', '24h', { order_by: 'marketcap', limit: 5 });
  const rows = extractRankRows(res);
  console.log(`行数: ${rows.length}`);
  if (!rows.length) {
    console.log('响应全文:', JSON.stringify(res, null, 2).slice(0, 3000));
    return;
  }
  console.log('逐行（核对 normalizeRankRow 映射）:');
  rows.forEach((r, i) => {
    console.log(`  #${i + 1} addr=${r.address} symbol=${r.symbol} name=${r.name} mc=${r.market_cap} vol=${r.volume} renowned=${r.renowned_count} created=${r.creation_timestamp} launchpad=${r.launchpad_platform} tw=${r.twitter_username}`);
  });

  console.log('\n=== token info 冒烟: 榜一 ===');
  const first = rows[0];
  if (first?.address) {
    const info = await tokenApi.getTokenInfo('bsc', first.address);
    console.log('顶层字段:', Object.keys(info || {}).sort().join(', '));
    console.log('link:', JSON.stringify(info?.link));
    console.log('时间类字段:', JSON.stringify({
      open_timestamp: info?.open_timestamp,
      creation_timestamp: info?.creation_timestamp,
    }));
    console.log('基础字段:', JSON.stringify({ symbol: info?.symbol, name: info?.name, launchpad: info?.launchpad }));
  }
}

// ─────────────────────── --fetch ───────────────────────

async function cmdFetch() {
  const { marketApi } = await getGmgnApis();
  const merged = new Map();
  for (const def of RANK_DEFS) {
    console.log(`拉榜单 ${def.key} (interval=${def.interval} order_by=${def.order_by} limit=${RANK_LIMIT}) ...`);
    const res = await marketApi.getTrendingSwaps('bsc', def.interval, { order_by: def.order_by, limit: RANK_LIMIT });
    const rows = extractRankRows(res);
    let kept = 0;
    rows.forEach((row, i) => {
      const rec = normalizeRankRow(row, def, i);
      if (!isValidBscAddr(rec.address)) return;
      if (EXCLUDE_ADDRS.has(rec.address)) return;
      const prev = merged.get(rec.address);
      if (prev) {
        prev.ranks[def.key] = i + 1;
        // 指标字段留首次非空值（三榜口径同源，字段一致）
        for (const k of ['symbol', 'name', 'openTimestampSec', 'marketCapUsd', 'volume24hUsd', 'holderCount', 'renownedCount', 'smartDegenCount', 'swaps24h', 'launchpad', 'twitterUrl', 'websiteUrl']) {
          if (prev[k] == null && rec[k] != null) prev[k] = rec[k];
        }
      } else {
        merged.set(rec.address, rec);
        kept++;
      }
    });
    console.log(`  行数=${rows.length} 新增=${kept}`);
  }
  const list = [...merged.values()];
  writeJson(LIST_FILE, { fetchedAt: new Date().toISOString(), ranks: RANK_DEFS.map(d => d.key), tokens: list });
  console.log(`合并去重 ${list.length} 票 → ${LIST_FILE}`);
}

// ─────────────────────── --classify ───────────────────────

async function cmdClassify() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch');
  const db = await getDb();
  const seen = new Set();
  const addrs = store.tokens.map(t => t.address);
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { data, error } = await db.from('experiment_tokens').select('token_address').in('token_address', batch);
    if (error) throw error;
    (data || []).forEach(r => seen.add(String(r.token_address).toLowerCase()));
  }
  let a = 0, b = 0;
  for (const t of store.tokens) {
    t.existing = seen.has(t.address);
    t.existing ? a++ : b++;
  }
  store.classifiedAt = new Date().toISOString();
  writeJson(LIST_FILE, store);
  console.log(`A 类（库内已有行）=${a}，B 类（需造行）=${b}`);
}

// ─────────────────────── --inject ───────────────────────

async function cmdInject() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--classify');
  const targets = store.tokens.filter(t => t.existing === false);
  if (!targets.length) { console.log('无 B 类票，跳过'); return; }

  const db = await getDb();
  // 1. 验证实验行（幂等 upsert；status='stopped'——纯数据挂靠，永不启动引擎）
  const { error: expErr } = await db.from('experiments').upsert({
    id: VALIDATION_EXPERIMENT.id,
    experiment_name: VALIDATION_EXPERIMENT.name,
    experiment_description: 'GMGN 榜单蓝筹叙事验证（2026-09-30）：B 类无行币造行挂靠，纯数据挂靠不启动引擎，去留由用户裁定',
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
  if (expErr) throw expErr;
  console.log(`验证实验行就绪: ${VALIDATION_EXPERIMENT.id}`);

  // 2. B 类逐票造行。社媒优先用榜单行自带 twitter_username/website（冒烟实测直接
  //    带出，零 GMGN 调用）；榜单行缺失才走 fetchGmgnSocialLinks（CachedFetcher 顺手
  //    写 1d 缓存，analyze 阶段 enrichSocialByGmgn 复用同缓存零二次配额）；
  //    name/creation_timestamp 也缺时才补打 getTokenInfo
  const { fetchGmgnSocialLinks } = await import('../../src/narrative/utils/gmgn-social-fetcher.mjs');
  const { GMGNTokenAPI } = await import('../../src/core/gmgn-api/index.js');
  const tokenApi = new GMGNTokenAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 30000 });

  const injected = readJsonl(INJECTED_FILE);
  const done = new Set(injected.map(r => r.address));
  let ok = 0, fail = 0;
  for (const t of targets) {
    if (done.has(t.address)) continue;
    try {
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
      if (error && error.code !== '23505') throw new Error(error.message);
      appendJsonl(INJECTED_FILE, {
        address: t.address, symbol, ok: true,
        hasTwitter: !!raw.twitterUrl, hasWebsite: !!raw.websiteUrl, hasCreatedAt: openTs != null,
        platform: mapPlatform(launchpad),
      });
      ok++;
    } catch (e) {
      appendJsonl(INJECTED_FILE, { address: t.address, symbol: t.symbol, ok: false, error: e?.message || String(e) });
      fail++;
    }
    console.log(`inject [${ok + fail}/${targets.length}] ${t.symbol || t.address}`);
  }
  console.log(`造行完成: ok=${ok} fail=${fail} → ${INJECTED_FILE}`);
}

// ─────────────────────── --analyze ───────────────────────

async function cmdAnalyze() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在');
  const { NarrativeAnalyzer } = await import('../../src/narrative/analyzer/NarrativeAnalyzer.mjs');

  const done = new Set(readJsonl(RESULTS_FILE).map(r => r.address));
  const todo = store.tokens.filter(t => !done.has(t.address));
  console.log(`待分析 ${todo.length} 票（已完成 ${done.size}）`);
  let i = 0;
  for (const t of todo) {
    i++;
    const startedAt = Date.now();
    try {
      const r = await NarrativeAnalyzer.analyze(t.address, { ignoreCache: true, enrichSocialByGmgn: true });
      const twitterUrls = r?.classifiedUrls?.twitter;
      const row = {
        address: t.address,
        symbol: r?.token?.symbol || t.symbol,
        injected: t.existing === false,
        rating: r?.rating ?? null,
        numericRating: r?.numericRating ?? null,
        reason: (r?.reason || '').slice(0, 300) || null,
        score: r?.score ?? null,
        preCheckRuleName: r?.llmAnalysis?.preCheck?.details?.ruleName ?? null,
        analysisStage: r?.debugInfo?.analysisStage ?? r?.analysis_stage ?? null,
        hasTwitterCorpus: Array.isArray(twitterUrls) ? twitterUrls.length > 0 : !!twitterUrls,
        twitterHandle: r?.twitter?.screen_name ?? null,
        fetchErrorCount: r?.fetchErrors ? Object.keys(r.fetchErrors).filter(k => r.fetchErrors[k]).length : 0,
        durationMs: Date.now() - startedAt,
      };
      appendJsonl(RESULTS_FILE, row);
      console.log(`[${i}/${todo.length}] ${row.symbol} rating=${row.rating}(${row.numericRating}) preCheck=${row.preCheckRuleName ?? '-'} twitter=${row.hasTwitterCorpus} ${row.durationMs}ms`);
    } catch (e) {
      appendJsonl(RESULTS_FILE, {
        address: t.address, symbol: t.symbol, injected: t.existing === false,
        error: e?.message || String(e), durationMs: Date.now() - startedAt,
      });
      console.log(`[${i}/${todo.length}] ${t.symbol || t.address} 异常: ${e?.message || e}`);
    }
  }
  console.log('分析完成');
}

// ─────────────────────── --report ───────────────────────

async function cmdReport() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在');
  const results = readJsonl(RESULTS_FILE);
  const byAddr = new Map(store.tokens.map(t => [t.address, t]));
  const injectedByAddr = new Map(readJsonl(INJECTED_FILE).map(r => [r.address, r]));

  // token_narrative 批查（token_category / prompt_version——只读，service key）
  const db = await getDb();
  const metaByAddr = new Map();
  const addrs = results.map(r => r.address);
  for (let i = 0; i < addrs.length; i += 100) {
    const { data, error } = await db.from('token_narrative')
      .select('token_address, token_category, prompt_version, analysis_stage')
      .in('token_address', addrs.slice(i, i + 100));
    if (error) throw error;
    (data || []).forEach(r2 => metaByAddr.set(String(r2.token_address).toLowerCase(), r2));
  }

  const n = store.tokens.length;
  const buckets = { high: [], mid: [], low: [], unrated: [], error: [] };
  const preCheckRules = {};
  for (const r of results) {
    if (r.error) { buckets.error.push(r); continue; }
    const b = buckets[r.rating] || buckets.unrated;
    b.push(r);
    if (r.preCheckRuleName) preCheckRules[r.preCheckRuleName] = (preCheckRules[r.preCheckRuleName] || 0) + 1;
  }
  const pass = buckets.high.length + buckets.mid.length;
  const failRows = [...buckets.low, ...buckets.unrated, ...buckets.error];
  const splitByClass = rows => {
    const a = rows.filter(r => !r.injected).length, b = rows.filter(r => r.injected).length;
    return `A(库内)=${a} / B(注入)=${b}`;
  };

  const fmtUsd = v => v == null ? '-' : (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
  const rankStr = t => Object.entries(t?.ranks || {}).map(([k, v]) => `${k}#${v}`).join(',');

  const lines = [];
  lines.push('# GMGN 榜单蓝筹验证报告（叙事引擎假阴性扫描）');
  lines.push('');
  lines.push(`- 快照时间: ${store.fetchedAt}；榜单: ${store.ranks.join(' + ')}，去重 ${n} 票`);
  lines.push(`- 分析口径: J1.21（ignoreCache 强制重析，enrichSocialByGmgn 社媒补源）`);
  lines.push('');
  lines.push('## 总体分布');
  lines.push('');
  lines.push('| 结果 | 数量 | 占比 | A/B 分布 |');
  lines.push('|---|---|---|---|');
  const pct = c => n ? (c / n * 100).toFixed(1) + '%' : '-';
  lines.push(`| high(3) 通过 | ${buckets.high.length} | ${pct(buckets.high.length)} | ${splitByClass(buckets.high)} |`);
  lines.push(`| mid(2) 通过 | ${buckets.mid.length} | ${pct(buckets.mid.length)} | ${splitByClass(buckets.mid)} |`);
  lines.push(`| low(1) 拦截 | ${buckets.low.length} | ${pct(buckets.low.length)} | ${splitByClass(buckets.low)} |`);
  lines.push(`| unrated(9) 未知 | ${buckets.unrated.length} | ${pct(buckets.unrated.length)} | ${splitByClass(buckets.unrated)} |`);
  lines.push(`| 异常 | ${buckets.error.length} | ${pct(buckets.error.length)} | ${splitByClass(buckets.error)} |`);
  lines.push(`| **通过率(high+mid)** | **${pass}** | **${pct(pass)}** | |`);
  lines.push('');
  if (Object.keys(preCheckRules).length) {
    lines.push(`**precheck 拦截规则分布**: ${Object.entries(preCheckRules).map(([k, v]) => `${k}=${v}`).join('，')}`);
    lines.push('');
  }

  lines.push('## 未通过票明细（low / unrated / 异常）');
  lines.push('');
  lines.push('| symbol | mc | 榜单 | 类 | 语料 | 拦截点 | stage | category | reason 摘要 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of failRows) {
    const t = byAddr.get(r.address) || {};
    const meta = metaByAddr.get(r.address) || {};
    const corpus = r.error ? '-' : (r.hasTwitterCorpus ? 'tw✓' : (injectedByAddr.get(r.address)?.hasWebsite ? 'web✓' : '无'));
    const block = r.error ? `异常: ${String(r.error).slice(0, 60)}` : (r.preCheckRuleName || `${r.rating}(score=${r.score ?? '-'})`);
    const reason = (r.reason || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 80);
    lines.push(`| ${r.symbol || '-'} | ${fmtUsd(t.marketCapUsd)} | ${rankStr(t)} | ${r.injected ? 'B' : 'A'} | ${corpus} | ${block} | ${meta.analysis_stage || r.analysisStage || '-'} | ${meta.token_category || '-'} | ${reason} |`);
  }
  lines.push('');

  lines.push('## 通过票速览（high/mid）');
  lines.push('');
  lines.push('| symbol | mc | 榜单 | 类 | rating | score | category |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of [...buckets.high, ...buckets.mid]) {
    const t = byAddr.get(r.address) || {};
    const meta = metaByAddr.get(r.address) || {};
    lines.push(`| ${r.symbol || '-'} | ${fmtUsd(t.marketCapUsd)} | ${rankStr(t)} | ${r.injected ? 'B' : 'A'} | ${r.rating} | ${r.score ?? '-'} | ${meta.token_category || '-'} |`);
  }
  lines.push('');

  // 分层归因：数据链路 / precheck 规则 / Jev 判定 / 时间口径
  const noCorpus = failRows.filter(r => !r.error && !r.hasTwitterCorpus && !(injectedByAddr.get(r.address)?.hasWebsite));
  const ruleBlocked = failRows.filter(r => r.preCheckRuleName);
  const jevLow = buckets.low.filter(r => !r.preCheckRuleName);
  const noCreatedAt = failRows.filter(r => byAddr.get(r.address)?.openTimestampSec == null);

  lines.push('## 分层归因');
  lines.push('');
  lines.push(`1. **数据链路层**: 无语料票 ${noCorpus.length} 张（${noCorpus.map(r => r.symbol).slice(0, 20).join(', ')}${noCorpus.length > 20 ? ' …' : ''}）`);
  lines.push(`2. **precheck 规则层**: 规则拦截 ${ruleBlocked.length} 张——${Object.entries(preCheckRules).map(([k, v]) => `${k} ${v} 张`).join('，')}`);
  lines.push(`3. **Jev 判定层**: 走完判定给 low ${jevLow.length} 张（有语料被压分，重点逐票看维度）`);
  lines.push(`4. **时间口径层**: 无创建时间锚 ${noCreatedAt.length} 张（时效规则跳过 + Jev 回退墙钟，语义天然偏移，单独核对）`);
  lines.push('');
  lines.push('> 未通过票逐票人工核对清单见明细表；已知问题对照与新增问题结论在对话报告中给出（台账同步另做）。');

  fs.writeFileSync(REPORT_FILE, lines.join('\n'));
  console.log(`报告已生成: ${REPORT_FILE}`);
  console.log(`分布: high=${buckets.high.length} mid=${buckets.mid.length} low=${buckets.low.length} unrated=${buckets.unrated.length} error=${buckets.error.length}；通过率=${pct(pass)}`);
}

// ─────────────────────── main ───────────────────────

const arg = process.argv[2];
const cmds = {
  '--smoke': cmdSmoke, '--fetch': cmdFetch, '--classify': cmdClassify,
  '--inject': cmdInject, '--analyze': cmdAnalyze, '--report': cmdReport,
};
const fn = cmds[arg];
if (!fn) {
  console.error('用法: node scripts/narrative/gmgn-bluechip-validation.mjs --smoke|--fetch|--classify|--inject|--analyze|--report');
  process.exit(1);
}
ensureDataDir();
fn().catch(e => { console.error('失败:', e?.stack || e); process.exit(1); });
