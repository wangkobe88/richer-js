#!/usr/bin/env node
/**
 * 叙事知识库·蓝筹条目构建管线（C165；只在 182 跑——本地禁重查询/重实验）
 *
 * 口径（用户裁定 2026-10-22）：ATH 市值（历史最高价×流通供应量）> $1M USD 的
 * meme 币为蓝筹。候选来自 GMGN 三榜 24h×{marketcap, renowned_count, volume} 各 100
 * 合并去重（蓝筹验证管线同款口径），逐票 getTokenInfo 取 ATH 值过滤，叙事三源
 * 拼接（token_narrative 已析行 + experiment_tokens intro + AVE 兜底），产出
 * config/knowledge/bluechips.json（进 git 快照，roster 先例：跑→commit→push）。
 *
 * 用法（182，分阶段可断点续跑，进度落 data/knowledge/build-bluechips/）：
 *   node scripts/narrative/build-knowledge-bluechips.mjs --smoke    # Phase 0：确认 ATH 字段名/量纲（打印 ath/high/supply 相关键）
 *   node scripts/narrative/build-knowledge-bluechips.mjs --fetch    # 三榜拉取合并去重 → list.json（榜间 35s + 429 退避）
 *   node scripts/narrative/build-knowledge-bluechips.mjs --verify   # 逐票 getTokenInfo（400ms 节流）ATH 市值>$1M 过滤 → 回写 list.json
 *   node scripts/narrative/build-knowledge-bluechips.mjs --enrich   # 叙事三源拼接（DB 两源 + AVE 兜底 --ave-limit N 默认 0）
 *   node scripts/narrative/build-knowledge-bluechips.mjs --enrich-desc # 叙事补齐：CoinGecko 公开简介（只填占位/缺失，7s 限速+断点续）
 *   node scripts/narrative/build-knowledge-bluechips.mjs --commit   # 写 config/knowledge/bluechips.json（tmp+rename；缺省 dry-run 打印）
 *
 * 429 连续 ban 5 轮 exit(2)（wallet-profiles 脚本同款）；EXCLUDE_ADDRS 稳定币剔除。
 * 纯函数（normalizeRankRow/extractAthMarketCapUsd/buildBluechipEntry/mergeRankRecords/
 * autoCorpusTriggerForEntry）零 DB 零网络，单测 scripts/_test_knowledge_builder_core.cjs 锚定。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { autoCorpusTriggerForEntry } from '../../src/narrative/analyzer/knowledge/knowledge-matcher.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

// 主动加载 config/.env（GMGN_API_KEY / SUPABASE_* / AVE_API_KEY；已设 env 不覆盖）
for (const line of fs.readFileSync(path.join(ROOT, 'config/.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DATA_DIR = path.join(ROOT, 'data', 'knowledge', 'build-bluechips');
const LIST_FILE = path.join(DATA_DIR, 'list.json');
const OUT_FILE = path.join(ROOT, 'config', 'knowledge', 'bluechips.json');

/** 蓝筹口径（用户裁定）：ATH 市值 > $1M */
export const ATH_MARKET_CAP_USD_MIN = 1_000_000;

/**
 * ATH 市值合理性上界（182 冒烟实证 2026-10-22：GMGN ath_price 偶发污染——XRP 克隆票
 * ath_price=2190.06（真 USD 单位，DOGE 0.505 校准）×supply 325.8M=$713B 全球不可能）。
 * BSC meme 历史真实 ATH 市值远低于 $20B；越界=污染 → 降级 current floor（宁取保守真值）。
 */
export const ATH_MCAP_SANITY_CEILING_USD = 2e10;

/** 榜单口径（蓝筹验证管线同款）：三榜各 100 */
export const RANK_DEFS = [
  { key: 'mc24h', interval: '24h', order_by: 'marketcap' },
  { key: 'renowned24h', interval: '24h', order_by: 'renowned_count' },
  { key: 'vol24h', interval: '24h', order_by: 'volume' },
];
export const RANK_LIMIT = 100;

/** 非 meme 计价/基础设施币过滤（进知识库只是噪声） */
export const EXCLUDE_ADDRS = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE
  '0x2170ed0880ac9a755fd29b2688956bd959f93388', // ETH
]);

// ═══════════════════ 纯函数（单测锚定区） ═══════════════════

/** 榜单行 twitter_username 可能是完整 URL 或裸 handle */
/**
 * 榜单/trenches twitter 值 → 账号 URL。182 冒烟实测三形状（2026-10-22）：
 * 裸 handle（'Douyin_girl'）/ status URL（'https://x.com/yinghubnb/status/211...'）/
 * 搜索页（'https://x.com/search?q=...'）——一律归一账号 URL；功能页/非 twitter URL → null
 * （存 status URL 会污染 twitter_exact 匹配位）
 */
export function normalizeTwitterUrl(v) {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const m = s.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (m) {
    const handle = m[1];
    if (/^(search|intent|home|settings|hashtag|explore|i)$/i.test(handle)) return null;
    return `https://x.com/${handle}`;
  }
  if (/^https?:\/\//i.test(s)) return null; // 非 twitter URL 不冒充
  const bare = s.split('/')[0]; // 'handle/status/123?s=20' 形 → 取账号段
  return /^[A-Za-z0-9_]{1,15}$/.test(bare) ? `https://x.com/${bare}` : null;
}

/** 榜单响应 → 行数组（蓝筹验证管线实测：外壳 {code, data:{rank:[...]}}） */
export function extractRankRows(res) {
  const cand = [res?.data?.rank, res?.rank, res?.list, res?.data];
  return cand.find(Array.isArray) || [];
}

/** 榜单行 → 标准化记录（字段名=蓝筹验证 2026-09-30 冒烟实测收敛） */
export function normalizeRankRow(row, rankDef, rankIndex) {
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

/**
 * 三榜合并去重（--fetch 幂等合并的纯函数形态）：
 * 同地址保留首见记录，补录榜单名次与缺失指标字段。
 * @returns {{merged:Map, kept:number}} kept=本次新增条数
 */
export function mergeRankRecords(prevMap, records) {
  const merged = prevMap instanceof Map ? prevMap : new Map([...(prevMap || [])].map((t) => [t.address, t]));
  let kept = 0;
  for (const rec of records) {
    if (!/^0x[0-9a-f]{40}$/.test(rec.address)) continue;
    if (EXCLUDE_ADDRS.has(rec.address)) continue;
    const prev = merged.get(rec.address);
    if (prev) {
      Object.assign(prev.ranks, rec.ranks);
      for (const k of ['symbol', 'name', 'openTimestampSec', 'marketCapUsd', 'volume24hUsd',
        'holderCount', 'renownedCount', 'smartDegenCount', 'swaps24h', 'launchpad', 'twitterUrl', 'websiteUrl']) {
        if (prev[k] == null && rec[k] != null) prev[k] = rec[k];
      }
    } else {
      merged.set(rec.address, rec);
      kept++;
    }
  }
  return { merged, kept };
}

const toNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * getTokenInfo → ATH 市值（两形态 + 当前市值数学下界兜底）：
 *   形态一 直读市值：ath_market_cap / ath_market_cap_usd（冒烟确认后固化）
 *   形态二 ATH 价×供应：ath_price|price_ath|all_time_high × circulating_supply|total_supply
 *   兜底   ATH ≥ 当前市值（数学事实）：info.pool.market_cap / 顶层 market_cap（via='current_floor'）
 * @param {Object} info - getTokenInfo 响应
 * @param {Object} [fallback] - { marketCapUsd } 榜单行市值（兜底二源）
 * @returns {{usd:number, via:string}|null}
 */
export function extractAthMarketCapUsd(info, fallback = {}) {
  if (!info || typeof info !== 'object') return null;
  let insane = false;
  for (const k of ['ath_market_cap', 'ath_market_cap_usd', 'athMarketCapUsd']) {
    const v = toNum(info[k]);
    if (v && v > 0) {
      if (v <= ATH_MCAP_SANITY_CEILING_USD) return { usd: v, via: `info.${k}` };
      insane = true; break; // 直读形态污染 → 降级 floor
    }
  }
  const supply = toNum(info.circulating_supply) ?? toNum(info.total_supply);
  for (const k of ['ath_price', 'price_ath', 'all_time_high', 'ath']) {
    const p = toNum(info[k]);
    if (p && p > 0 && supply && supply > 0) {
      const usd = p * supply;
      if (usd <= ATH_MCAP_SANITY_CEILING_USD) return { usd, via: `info.${k}×supply` };
      insane = true; break; // ×supply 污染（XRP 克隆票现场）→ 降级 floor
    }
  }
  const cur = toNum(info?.pool?.market_cap) ?? toNum(info.market_cap) ?? toNum(fallback.marketCapUsd);
  if (cur && cur > 0) return { usd: cur, via: insane ? 'sanity_floor' : 'current_floor' };
  return null;
}

/**
 * 记录+ATH 验证 → 蓝筹知识条目。narrative 由 --enrich 阶段回填（此处占位 ''）；
 * corpusTrigger 数据侧防线（denylist/短名自动 false，判据与 matcher 单一真相）。
 */
export function buildBluechipEntry(rec, ath, options = {}) {
  const name = rec.name || rec.symbol || rec.address;
  const aliases = [];
  if (rec.symbol && rec.symbol !== name) aliases.push(rec.symbol);
  return {
    id: `b:${rec.address}`,
    kind: 'bluechip',
    name,
    symbol: rec.symbol || '',
    aliases,
    address: rec.address,
    twitter: rec.twitterUrl || null,
    narrative: options.narrative || '',
    narrativeSource: options.narrativeSource || null,
    athMarketCapUsd: ath.usd,
    athSource: ath.via,
    corpusTrigger: options.corpusTrigger ?? autoCorpusTriggerForEntry([name, ...aliases]),
    source: 'gmgn',
    rating: options.rating || null,
    ranks: rec.ranks,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };
}

/**
 * 占位叙事判据（--enrich-desc 只重填占位，不动已有效富化）：
 * 空 / 纯「本系统评 X」（rating 无 reason——评级信息在 narrativeRating 字段，正文零信息量）/ 超短（≤12 字）。
 */
export function isPlaceholderNarrative(narrative) {
  if (!narrative) return true;
  const s = String(narrative).trim();
  if (s === '') return true;
  if (/^本系统评 (low|mid|high)$/.test(s)) return true;
  return s.length <= 12;
}

const normCgName = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * CoinGecko /coins/list 行匹配（宁缺毋冒配）：
 * symbol 归一化全等 ∧ name 归一化全等或词级前缀（"Cardano Token"↔"Cardano"）；
 * 词内包含不算（"NIGHT"↔"Midnight" 拒）——错背景注入的代价大于漏配，漏配条目保持占位。
 */
export function matchCoinGeckoId(entry, cgList) {
  const sym = normCgName(entry.symbol);
  const name = normCgName(entry.name).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sym || !name) return null;
  for (const cg of cgList || []) {
    if (normCgName(cg.symbol) !== sym) continue;
    const cgName = normCgName(cg.name);
    if (!cgName) continue;
    if (cgName === name || cgName.startsWith(`${name} `) || name.startsWith(`${cgName} `)) {
      return { id: cg.id, cgName: cg.name };
    }
  }
  return null;
}

/**
 * CoinGecko description 清洗：剥 HTML 标签/实体/压缩空白 → 句子边界截断 ≤maxLen（schema narrative 上限 320）。
 * 过短（<20 字）视为空简介返回 ''（CG 存在空壳 description）。
 */
export function cleanCoinGeckoDescription(raw, maxLen = 320) {
  if (!raw) return '';
  const s = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 20) return '';
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'));
  return (lastStop > maxLen * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim() + '…';
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

async function getGmgnApis() {
  const { GMGNMarketAPI, GMGNTokenAPI, preResolveGMGNHost } = await import('../../src/core/gmgn-api/index.js');
  await preResolveGMGNHost();
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY 未配置（config/.env）');
  return {
    marketApi: new GMGNMarketAPI({ apiKey, timeout: 30000 }),
    tokenApi: new GMGNTokenAPI({ apiKey, timeout: 30000 }),
  };
}

async function getDb() {
  const { dbManager } = await import('../../src/services/dbManager.js');
  return dbManager.getClient(); // service key 红线（anon RLS 静默空）
}

// ─────────────────────── --smoke ───────────────────────

async function cmdSmoke() {
  const { marketApi, tokenApi } = await getGmgnApis();
  console.log('=== 榜单冒烟: bsc 24h marketcap limit=5 ===');
  const res = await marketApi.getTrendingSwaps('bsc', '24h', { order_by: 'marketcap', limit: 5 });
  const rows = extractRankRows(res);
  console.log(`行数: ${rows.length}`);
  rows.forEach((r, i) => console.log(`  #${i + 1} addr=${r.address} symbol=${r.symbol} name=${r.name} mc=${r.market_cap}`));
  if (!rows.length) return;

  console.log('\n=== token info 冒烟（Phase 0：确认 ATH 字段名/量纲） ===');
  for (const first of rows.slice(0, 2)) {
    if (!first?.address) continue;
    const info = await tokenApi.getTokenInfo('bsc', String(first.address).toLowerCase());
    console.log(`\n--- ${first.symbol} ${first.address} ---`);
    console.log('顶层字段:', Object.keys(info || {}).sort().join(', '));
    const athKeys = Object.entries(info || {})
      .filter(([k, v]) => /ath|high|supply|market_cap/i.test(k) || /ath/i.test(String(JSON.stringify(v)).slice(0, 200)));
    console.log('ATH/供应量相关键:', JSON.stringify(athKeys.filter(([k]) => typeof info[k] !== 'object'), null, 2));
    for (const nested of ['pool', 'price', 'base_token']) {
      if (info?.[nested] && typeof info[nested] === 'object') {
        const sub = Object.entries(info[nested]).filter(([k]) => /ath|high|supply|market_cap/i.test(k));
        if (sub.length) console.log(`  ${nested}.${sub.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`);
      }
    }
    console.log('extractAthMarketCapUsd 判读:', JSON.stringify(extractAthMarketCapUsd(info)));
    await sleep(2000);
  }
}

// ─────────────────────── --fetch ───────────────────────

async function cmdFetch() {
  const { marketApi } = await getGmgnApis();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const prevStore = readJson(LIST_FILE, null);
  const completed = new Set(prevStore?.completedRanks || []);
  const { merged } = mergeRankRecords(prevStore?.tokens || [], []);

  for (const def of RANK_DEFS) {
    if (completed.has(def.key)) { console.log(`榜单 ${def.key} 已完成，跳过`); continue; }
    console.log(`拉榜单 ${def.key} ...`);
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
    const records = (rows || []).map((row, i) => normalizeRankRow(row, def, i));
    const { kept } = mergeRankRecords(merged, records);
    completed.add(def.key);
    writeJson(LIST_FILE, {
      fetchedAt: new Date().toISOString(),
      completedRanks: [...completed],
      tokens: [...merged.values()],
    });
    console.log(`  行数=${rows?.length ?? 0} 新增=${kept}（累计 ${merged.size}，进度已落盘）`);
    if (def !== RANK_DEFS[RANK_DEFS.length - 1]) await sleep(35000);
  }
  console.log(`合并去重 ${merged.size} 票 → ${LIST_FILE}`);
}

// ─────────────────────── --verify ───────────────────────

const VERIFY_THROTTLE_MS = 400;

async function cmdVerify() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch');
  const { tokenApi } = await getGmgnApis();
  let verified = 0, dropped = 0, pending = 0, banStreak = 0;

  for (const t of store.tokens) {
    if (t.athVerified) { verified++; continue; }
    if (banStreak >= 5) { pending = store.tokens.length - verified - dropped; break; }
    let info = null;
    try {
      info = await tokenApi.getTokenInfo('bsc', t.address);
      banStreak = 0;
    } catch (e) {
      if (/429|RATE_LIMIT|BANNED/i.test(String(e?.message) + String(e?.name))) {
        banStreak++;
        console.log(`  429/ban 连击 ${banStreak}/5，等 35s ...`);
        await sleep(35000);
        continue;
      }
      throw e;
    }
    const ath = extractAthMarketCapUsd(info, { marketCapUsd: t.marketCapUsd });
    if (ath && ath.usd > ATH_MARKET_CAP_USD_MIN) {
      t.athMarketCapUsd = ath.usd;
      t.athSource = ath.via;
      t.athVerified = true;
      verified++;
    } else {
      t.athVerified = false;
      t.athRejectReason = ath ? `ATH 市值 $${Math.round(ath.usd)} ≤ $1M` : 'ATH 数据缺失';
      dropped++;
    }
    writeJson(LIST_FILE, store); // 逐票落盘（断点续跑）
    await sleep(VERIFY_THROTTLE_MS);
  }
  console.log(`验证完成：通过=${verified} 拒=${dropped}${pending ? ` 待续=${pending}（重跑 --verify 续）` : ''}`);
  if (banStreak >= 5) {
    console.error('连续 ban 5 轮，退出码 2（稍后重跑 --verify 断点续）');
    process.exit(2);
  }
}

// ─────────────────────── --enrich ───────────────────────

/** token_narrative 已析行 → rating/reason（final_result.category 优先，prestage 兜底） */
function extractNarrativeRating(row) {
  const fin = row?.final_result;
  const rating = fin?.category ?? fin?.rating ?? row?.prestage_result?.rating ?? null;
  const reason = fin?.reason ?? fin?.reasoning ?? row?.prestage_result?.reasoning ?? null;
  return { rating, reason };
}

async function cmdEnrich() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--verify');
  const targets = store.tokens.filter((t) => t.athVerified);
  console.log(`待富化 ${targets.length} 票（ATH 已验证）`);
  const db = await getDb();

  // 源一：token_narrative 已析行（rating/reason；全表 token 级 upsert 唯一）
  const addrs = targets.map((t) => t.address);
  const narrByAddr = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { data, error } = await db.from('token_narrative')
      .select('token_address, final_result, prestage_result, analyzed_at')
      .in('token_address', batch);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const prev = narrByAddr.get(row.token_address);
      const ts = Date.parse(row.analyzed_at || '') || 0;
      if (!prev || ts > prev.ts) narrByAddr.set(row.token_address, { ...extractNarrativeRating(row), ts });
    }
  }

  // 源二：experiment_tokens raw_api_data intro（多实验行取 intro 非空首见）
  const introByAddr = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { data, error } = await db.from('experiment_tokens')
      .select('token_address, raw_api_data')
      .in('token_address', batch);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const raw = row.raw_api_data || {};
      const intro = raw.intro_cn || raw.description || null;
      if (intro && !introByAddr.has(row.token_address)) introByAddr.set(row.token_address, String(intro));
    }
  }

  // 源三（兜底，默认关）：AVE intro——GMGN 无自由文本，intro 全缺时按 --ave-limit 限额拉
  const aveLimit = Number(process.argv.includes('--ave-limit')
    ? process.argv[process.argv.indexOf('--ave-limit') + 1] : 0) || 0;
  let avePulled = 0;
  if (aveLimit > 0) {
    const { default: axios } = await import('axios');
    const missing = targets.filter((t) => !introByAddr.get(t.address) && !narrByAddr.get(t.address)?.reason);
    for (const t of missing) {
      if (avePulled >= aveLimit) break;
      try {
        const res = await axios.get(`https://api.ave.ai/v1/chains/56/token_info`, {
          params: { token: t.address, api_key: process.env.AVE_API_KEY }, timeout: 10000,
        });
        const bio = res.data?.data?.token_info?.brief_chinese || res.data?.data?.token_info?.brief;
        if (bio) { introByAddr.set(t.address, String(bio)); avePulled++; }
        await sleep(300);
      } catch (e) {
        console.log(`  AVE ${t.symbol || t.address} 失败: ${e.message}`);
      }
    }
    console.log(`AVE 兜底拉取 ${avePulled}/${missing.length}`);
  }

  // 拼装：intro 截 120｜本系统评 rating：reason 截 200（与 feedback buildNarrative 同形）
  let enriched = 0;
  for (const t of targets) {
    if (t.narrative) continue;
    const intro = String(introByAddr.get(t.address) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const { rating, reason } = narrByAddr.get(t.address) || {};
    const parts = [];
    if (intro) parts.push(intro);
    if (rating) parts.push(`本系统评 ${rating}${reason ? `：${String(reason).replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`);
    t.narrative = parts.join('｜');
    t.narrativeRating = rating || null;
    enriched++;
  }
  writeJson(LIST_FILE, store);
  console.log(`富化完成 ${enriched} 票（narrative 已有跳过）`);
}

// ─────────────────────── --enrich-desc ───────────────────────

const CG_BASE = 'https://api.coingecko.com/api/v3';
const CG_MAP_FILE = path.join(DATA_DIR, 'cg-map.json');

/** CoinGecko GET：429/5xx 退避（Retry-After 优先，缺省 65s），连续 5 轮 exit 2 断点续 */
async function cgGet(url, params) {
  const { default: axios } = await import('axios');
  const headers = {};
  if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  let banStreak = 0;
  for (;;) {
    try {
      const res = await axios.get(url, { params, headers, timeout: 30000 });
      return res.data;
    } catch (e) {
      const status = e.response?.status;
      if (status !== 429 && status !== 500 && status !== 503) throw e;
      banStreak++;
      if (banStreak >= 5) {
        console.error('CG 连续 429/5xx 5 轮，退出码 2（稍后重跑 --enrich-desc 断点续）');
        process.exit(2);
      }
      const retryAfter = Number(e.response?.headers?.['retry-after']) || 65;
      console.log(`  CG ${status} 退避 ${retryAfter}s（第 ${banStreak} 轮）`);
      await sleep(retryAfter * 1000);
    }
  }
}

async function cmdEnrichDesc() {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--verify');
  const targets = store.tokens.filter((t) => t.athVerified && isPlaceholderNarrative(t.narrative));
  targets.sort((a, b) => (b.athMarketCapUsd || 0) - (a.athMarketCapUsd || 0));
  console.log(`待补叙事 ${targets.length} 票（占位/缺失；已有效富化不动）`);

  const cache = readJson(CG_MAP_FILE, { byAddress: {} });
  cache.byAddress = cache.byAddress || {};

  // 一次性 /coins/list 建 id 映射（~2MB，缓存进 cg-map.json 断点复用）
  let cgList = cache.coinList || null;
  if (!Array.isArray(cgList) || !cgList.length) {
    console.log('拉取 /coins/list …');
    cgList = await cgGet(`${CG_BASE}/coins/list`);
    cache.coinList = cgList;
    writeJson(CG_MAP_FILE, cache);
  }
  console.log(`coins/list ${cgList.length} 行`);

  let pulled = 0, withDesc = 0, remaining = 0;
  for (const t of targets) {
    const c = cache.byAddress[t.address];
    if (c && (c.status === 'done' || c.status === 'no-match')) continue; // 断点续
    remaining++;
    const m = matchCoinGeckoId({ symbol: t.symbol, name: t.name }, cgList);
    if (!m) {
      cache.byAddress[t.address] = { status: 'no-match', ts: Date.now() };
      continue;
    }
    const coin = await cgGet(`${CG_BASE}/coins/${m.id}`, {
      localization: 'false', tickers: 'false', market_data: 'false',
      community_data: 'false', developer_data: 'false', sparkline: 'false',
    });
    const desc = cleanCoinGeckoDescription(coin?.description?.en || '');
    cache.byAddress[t.address] = { status: 'done', cgId: m.id, cgName: m.cgName, desc, ts: Date.now() };
    pulled++; if (desc) withDesc++;
    if (pulled % 10 === 0) {
      writeJson(CG_MAP_FILE, cache);
      console.log(`  进度 拉取=${pulled} 有简介=${withDesc}（最近 ${t.symbol || t.address}）`);
    }
    await sleep(15000); // CG 免费档突发惩罚实测（182：7s 节流仍每请求吃 429，15s 留冷却余量）
  }
  writeJson(CG_MAP_FILE, cache);
  console.log(`CG 拉取完成：本轮拉取=${pulled} 有简介=${withDesc} 剩余=${remaining - pulled}（no-match/断点）`);

  // 回填：占位才写（保留 narrativeRating 评级），narrativeSource 留审计；重跑 --commit 落盘
  let filled = 0;
  for (const t of targets) {
    const c = cache.byAddress[t.address];
    if (!c || c.status !== 'done' || !c.desc) continue;
    if (!isPlaceholderNarrative(t.narrative)) continue; // 并发/中途富化防覆盖
    t.narrative = c.desc;
    t.narrativeSource = 'coingecko';
    filled++;
  }
  writeJson(LIST_FILE, store);
  console.log(`回填 ${filled} 票 narrative（narrativeSource=coingecko；重跑 --commit 落盘 bluechips.json）`);
}

// ─────────────────────── --commit ───────────────────────

async function cmdCommit(dry) {
  const store = readJson(LIST_FILE, null);
  if (!store) throw new Error('list.json 不存在，先跑 --fetch/--verify/--enrich');
  const targets = store.tokens.filter((t) => t.athVerified);
  if (!targets.length) throw new Error('无 ATH 验证通过票，先跑 --verify');

  const entries = [];
  for (const t of targets) {
    entries.push(buildBluechipEntry(t, { usd: t.athMarketCapUsd, via: t.athSource || 'unknown' }, {
      narrative: t.narrative || '',
      rating: t.narrativeRating || null,
      narrativeSource: t.narrativeSource || null,
      updatedAt: new Date().toISOString(),
    }));
  }
  entries.sort((a, b) => (b.athMarketCapUsd || 0) - (a.athMarketCapUsd || 0));
  const out = {
    kind: 'bluechip', version: 1,
    note: 'GMGN 三榜蓝筹快照（builder scripts/narrative/build-knowledge-bluechips.mjs --commit 生成；蓝筹口径=ATH 市值>$1M）；人工补录/掉榜兜底走 config/knowledge/manual-entries.json 同 id 覆盖',
    generatedAt: new Date().toISOString(),
    entries,
  };
  if (dry) {
    console.log(`dry-run：${entries.length} 条蓝筹将写入 ${OUT_FILE}`);
    for (const e of entries.slice(0, 10)) {
      console.log(`  ${e.name} (${e.symbol}) ATH≈$${Math.round((e.athMarketCapUsd || 0) / 1000)}k ${e.twitter || ''} narrative=${e.narrative ? `${e.narrative.length}字` : '无'}`);
    }
    return;
  }
  writeJson(OUT_FILE, out);
  console.log(`已写 ${entries.length} 条 → ${OUT_FILE}（git commit+push 后 182 重启或等 mtime 热载）`);
}

// ─────────────────────── main ───────────────────────

// CLI 派发只在直接执行时跑（被单测 import 时不跑）
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = process.argv[2];
  try {
    if (arg === '--smoke') await cmdSmoke();
    else if (arg === '--fetch') await cmdFetch();
    else if (arg === '--verify') await cmdVerify();
    else if (arg === '--enrich') await cmdEnrich();
    else if (arg === '--enrich-desc') await cmdEnrichDesc();
    else if (arg === '--commit') await cmdCommit(false);
    else {
      console.log('用法：--smoke | --fetch | --verify | --enrich [--ave-limit N] | --enrich-desc | --commit');
      if (!arg) await cmdCommit(true); // 无参=dry-run 打印
    }
  } catch (e) {
    console.error('FATAL', e);
    process.exit(1);
  }
}
