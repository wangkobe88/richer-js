#!/usr/bin/env node
/**
 * bundle* 捆绑簇因子扫描验证（Phase 2，BITCAT 案 2026-10-16）——只在 182 远程跑
 * （本地 VPN 直连 Supabase 必超时红线）；DB 一律 dbManager service key（anon RLS 静默空）。
 *
 * 不是独立检测逻辑——驱动器：拉历史票 ticks → 喂真 FourMemeFactorAggregator
 * （processTick 链序直推，行映射逐字复刻 BacktestEngine._loadWssTicks）→ 采样点
 * buildFactorMap 读 bundle* 6 键 + _bundleClusterFactors(state, now, out) 取簇钱包
 * 明细（可选 out 参数，引擎路径零变化）→ 汇总分布/对拍/阈值建议。检测口径只有
 * FA 一份，零漂移。
 *
 * 五阶段（各自幂等 checkpoint，重跑跳过已完成部分；data/scan-bundle-clusters/）：
 *   1. candidates  近 N 天 wss_events kind='token_create'（token 级全局，去重取最早）
 *                  → 确定性哈希序（无时间偏倚）→ candidates.json
 *   2. samples     逐票拉 ticks（单 token eq + id keyset + ORDER BY id——唯一允许
 *                  ORDER BY 的等值形状）→ 链序回放喂 3 个 FA 实例（bundleWinMs
 *                  10s/30s/60s 窗长对比，tick 内存共享喂 3 次远便宜于拉 3 次）
 *                  → 采样点 = 首 tick+10/30/60s + signal fire 点（喂下一 tick 前
 *                  评估，asOf 防前视）→ samples.jsonl（断点续跑 by token）
 *   3. 对拍 A      token_narrative.gmgn_info（extractGmgnRisk 共享提取零漂移）
 *                  ↔ 票级 maxSharePct 秩相关 + 十分位分层
 *   4. 对拍 B      分层抽 300 票 × GMGN getTokenTopHolders(tag='bundler') 地址库
 *                  （~1 req/s + 断点续跑）→ 簇钱包 precision/recall + 混淆矩阵
 *   5. report      分布/窗长对比/误报面 top20/阈值扫描表 → report.json + 控制台
 *
 * 口径对齐（与 live 管线 bit 一致的红线）：
 *   - 尘 tick（bnb_amount < 0.001，collector minTickBnb）不喂 FA——collector
 *     _feedFa 同款跳过；price_outlier 行照喂（FA 内部自判离群链）
 *   - 行→tick 映射 = BacktestEngine 684-699 逐字段同款（offers/funds_bnb 刻意不传）
 *   - 回放序 = 链上真序 (block_number, log_index, id)——bigserial 分配序≠提交序
 *   - 火点 asOf = signal created_at（fire 后落库，含触发 tick 在内的全部 ts<=asOf
 *     状态——比真 fire 时刻略晚，扫描口径已声明）
 *
 * 已声明局限（非兜底）：
 *   - 候选只来自 token_create 事件（缺 create 行的票不可见——create 丢失=永久
 *     不可见，与生产语义一致）
 *   - 每票 ticks 拉取封顶 --max-rows(6000) 行 / 首 tick+--cap-min(120) 分钟
 *     （超窗 fire 不评估只计数——捆绑门是早期门，晚 fire 簇窗已空天然放行）
 *   - GMGN top holders 只含当前仍持仓的 bundler（清仓离场的不可见）——对拍 B
 *     recall 天然低估，方向已知
 *
 * 用法（182）：
 *   node scripts/scan-bundle-clusters.cjs                       # 全流程
 *   node scripts/scan-bundle-clusters.cjs --skip-api            # 跳过对拍 B（零 API 配额）
 *   node scripts/scan-bundle-clusters.cjs --probe-holders 0x..  # 单票打印 GMGN 原始响应（形状核验）
 *   node scripts/scan-bundle-clusters.cjs --refresh             # 忽略 checkpoint 全重跑
 *   可配：--days 30 --max-tokens 1000 --api-tokens 300 --windows 10000,30000,60000
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });
const FourMemeFactorAggregator = require(path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js'));
const { extractGmgnRisk } = require(path.join(__dirname, '..', 'src', 'core', 'gmgn-api', 'risk-fields.js'));

// ── CLI ──
function parseArgs() {
  const a = { days: 30, maxTokens: 1000, apiTokens: 300, windows: [10000, 30000, 60000],
    capMin: 120, maxRowsPerToken: 6000, skipApi: false, refresh: false, probeHolders: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') a.days = Number(argv[++i]);
    else if (argv[i] === '--max-tokens') a.maxTokens = Number(argv[++i]);
    else if (argv[i] === '--api-tokens') a.apiTokens = Number(argv[++i]);
    else if (argv[i] === '--windows') a.windows = argv[++i].split(',').map(Number);
    else if (argv[i] === '--cap-min') a.capMin = Number(argv[++i]);
    else if (argv[i] === '--max-rows') a.maxRowsPerToken = Number(argv[++i]);
    else if (argv[i] === '--skip-api') a.skipApi = true;
    else if (argv[i] === '--refresh') a.refresh = true;
    else if (argv[i] === '--probe-holders') a.probeHolders = argv[++i];
    else { console.error(`未知参数: ${argv[i]}`); process.exit(2); }
  }
  return a;
}
const ARGS = parseArgs();

// ── 常量 ──
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'scan-bundle-clusters');
const MIN_TICK_BNB = 0.001;          // collector minTickBnb 同默认（fourmeme/flap 两处 ?? 0.001）
const PAGE = 1000;                    // PostgREST max-rows=1000：全量拉取必须 keyset 分页
const PAGE_ATTEMPTS = 3;
const MAX_TOTAL_TICKS = 5000000;      // 全局护栏（build-wallet-profiles 同款防拉错集合）
const FIRE_SAMPLES_PER_TOKEN = 5;     // 每 token 火点评最多评 5 个（复购/多实验去重后）
const WALLETS_STORE_MIN_SIZE = 3;     // size>=3 才存簇钱包明细（对拍 B 原料；小簇无对拍价值）
const WALLETS_STORE_CAP = 50;
const BUNDLE_KEYS = ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
  'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct'];
// 单 token 拉取列（BacktestEngine TICK_SELECT_COLUMNS 同款 + compareByChainOrder 所需）
const TICK_COLS = 'id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform';

// ── 惰性 supabase（service key；anon 被 RLS 过滤 wss_price_ticks/wss_events 成空）──
let _sb = null;
function sb() {
  if (!_sb) {
    const { dbManager } = require(path.join(ROOT, 'src', 'services', 'dbManager'));
    _sb = dbManager.getClient();
  }
  return _sb;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function qRetry(label, fn) {
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    const r = await fn();
    if (!r.error) return r;
    if (attempt === PAGE_ATTEMPTS) throw new Error(`${label} 失败（连续 ${PAGE_ATTEMPTS} 次）: ${r.error.message}`);
    await sleep(1000);
  }
}

// ── 确定性哈希序（地址 31 进制滚动哈希，build-wallet-profiles bucketOf 同款；无时间偏倚）──
function hashOf(addr) {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** 链上真序比较（BacktestEngine compareByChainOrder 同语义） */
function cmpChain(a, b) {
  const ba = a.block_number ?? -1, bb = b.block_number ?? -1;
  if (ba !== bb) return ba - bb;
  const la = a.log_index ?? -1, lb = b.log_index ?? -1;
  if (la !== lb) return la - lb;
  return Number(a.id) - Number(b.id);
}

/** DB 行 → FA tick（BacktestEngine._loadWssTicks 684-699 逐字段同款；offers/funds_bnb 刻意不传） */
function rowToTick(row) {
  return {
    token_address: row.token_address,
    trade_type: row.trade_type,
    trader_address: row.trader_address,
    sender_address: row.sender_address || null,
    price_bnb: Number(row.price_bnb),
    price_usd: row.price_usd === null ? null : Number(row.price_usd),
    bnb_amount: Number(row.bnb_amount || 0),
    token_amount: Number(row.token_amount || 0),
    block_number: row.block_number,
    timestamp: new Date(row.block_time).getTime(),
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    price_outlier: row.price_outlier || false,
    platform: row.platform,
  };
}

// ═══════════════ Phase 1：候选选集 ═══════════════

async function fetchCandidates(cutoffIso) {
  const file = path.join(DATA_DIR, 'candidates.json');
  if (!ARGS.refresh && fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`[candidates] checkpoint 命中：${j.list.length} 票（${j.cutoffIso} 起）`);
    return j.list;
  }
  console.log(`[candidates] 拉取 wss_events token_create（block_time >= ${cutoffIso}）…`);
  // token 级全局通道（无唯一约束，多实验并发重复行可容忍）：token → 最早 block_time
  const byToken = new Map();
  let cursor = 0, pages = 0, total = 0;
  while (true) {
    const r = await qRetry('wss_events token_create', () => sb()
      .from('wss_events')
      .select('id, token_address, platform, block_time, payload')
      .eq('kind', 'token_create')
      .gte('block_time', cutoffIso)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PAGE));
    const data = r.data || [];
    for (const row of data) {
      if (!row.token_address) continue;
      const prev = byToken.get(row.token_address);
      if (!prev || row.block_time < prev.block_time) {
        byToken.set(row.token_address, {
          token: row.token_address,
          platform: row.platform || null,
          block_time: row.block_time,
          totalSupply: row.payload && row.payload.totalSupply > 0 ? row.payload.totalSupply : null,
        });
      }
    }
    total += data.length; pages++;
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
  }
  // 确定性哈希序（重复行去重后）
  const list = [...byToken.values()].sort((x, y) => hashOf(x.token) - hashOf(y.token) || (x.token < y.token ? -1 : 1));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cutoffIso, count: list.length, rawRows: total, list }));
  console.log(`[candidates] ${list.length} 票（${pages} 页 / ${total} 行，去重前）→ ${file}`);
  return list;
}

// ═══════════════ Phase 2：回放 + 采样 ═══════════════

async function fetchHeadTickId() {
  const r = await qRetry('wss_price_ticks 表头锚', () => sb()
    .from('wss_price_ticks').select('id').order('id', { ascending: false }).limit(1));
  return r.data && r.data[0] ? Number(r.data[0].id) : 0;
}

/**
 * 单 token ticks：eq 等值形状 + id keyset（唯一允许 ORDER BY id 的形状）。
 * stopAfterMs 早停（asOf 语义：采样上界后的 tick 不进任何状态）；startId 续拉游标；
 * maxPages 页数上限（首页定锚场景传 1）。行数护栏 maxRowsPerToken。
 */
async function fetchTokenTicks(token, headAnchor, stopAfterMs, startId = 0, maxPages = Infinity) {
  const rows = [];
  let cursor = startId;
  const maxPageCount = Math.min(maxPages, Math.ceil(ARGS.maxRowsPerToken / PAGE));
  for (let page = 0; page < maxPageCount; page++) {
    const r = await qRetry(`wss_price_ticks 单 token 拉取 ${token.slice(0, 10)}…`, () => sb()
      .from('wss_price_ticks')
      .select(TICK_COLS)
      .eq('token_address', token)
      .gt('id', cursor)
      .lte('id', headAnchor)
      .order('id', { ascending: true })
      .limit(PAGE));
    const data = r.data || [];
    if (data.length === 0) break;
    let beyond = 0;
    for (const row of data) {
      if (stopAfterMs !== null && new Date(row.block_time).getTime() > stopAfterMs) { beyond++; continue; }
      rows.push(row);
    }
    if (beyond > 0) break;            // 页内已见越界行：其后行更晚（id 序≈时序），不再需要
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
    if (rows.length >= ARGS.maxRowsPerToken) break;
  }
  return rows;
}

/** signal 火点：全部实验 buy 信号（token → 去重毫秒时间戳数组） */
async function fetchFirePoints(cutoffIso) {
  const file = path.join(DATA_DIR, 'fire-points.json');
  if (!ARGS.refresh && fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`[fires] checkpoint 命中：${j.count} 信号 / ${Object.keys(j.map).length} token`);
    return new Map(Object.entries(j.map).map(([k, v]) => [k, v]));
  }
  console.log(`[fires] 拉取 strategy_signals action=buy（created_at >= ${cutoffIso}）…`);
  const map = new Map();
  let cursor = 0, count = 0;
  while (true) {
    const r = await qRetry('strategy_signals 拉取', () => sb()
      .from('strategy_signals')
      .select('id, token_address, created_at')
      .eq('action', 'buy')
      .gte('created_at', cutoffIso)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PAGE));
    const data = r.data || [];
    for (const row of data) {
      if (!row.token_address) continue;
      const ts = new Date(row.created_at).getTime();
      const arr = map.get(row.token_address) || [];
      if (!arr.includes(ts)) arr.push(ts);   // 同刻多实验去重
      map.set(row.token_address, arr);
      count++;
    }
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cutoffIso, count, map: Object.fromEntries(map) }));
  console.log(`[fires] ${count} 信号 / ${map.size} token → ${file}`);
  return map;
}

/** 逐 token 读 samples.jsonl（断点续跑；容忍撕裂尾行） */
function loadDoneTokens() {
  const done = new Set();
  const file = path.join(DATA_DIR, 'samples.jsonl');
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { done.add(JSON.parse(t).token); } catch (_e) { break; }  // 撕裂尾行=最后一条未写完
  }
  return done;
}

/**
 * 真·单票回放（async）：拉 ticks → 链序 → 3 FA 喂食 → 采样评估。
 * 采样点：firstTick+10/30/60s（固定 age 偏移，与窗长数组解耦）+ 火点
 * （≤FIRE_SAMPLES_PER_TOKEN，越拉取窗的只计数不评估）。
 */
async function scanToken(cand, headAnchor, fires) {
  const fireTsAll = (fires.get(cand.token) || []).slice().sort((a, b) => a - b);
  // 第一段：单页定锚（firstTs 未定，不带上界；一页 1000 行覆盖绝大多数 meme 首 2h）
  const first = await fetchTokenTicks(cand.token, headAnchor, null, 0, 1);
  if (first.length === 0) return { skipped: 'no-ticks' };
  const firstTs = new Date(first[0].block_time).getTime();
  const ageSamples = [10000, 30000, 60000].map(off => ({ kind: `age${off / 1000}`, ts: firstTs + off }));
  const fireIn = fireTsAll.filter(t => t >= firstTs);
  const firesBeyond = fireTsAll.length - fireIn.length;
  const fireUse = fireIn.slice(0, FIRE_SAMPLES_PER_TOKEN);
  // 拉取上界 = 最大采样点（asOf 语义：采样后的 tick 不进任何状态）与 cap 取小
  const maxSampleTs = Math.max(...ageSamples.map(s => s.ts), ...(fireUse.length ? fireUse : [0]));
  const stopAfterMs = Math.min(maxSampleTs, firstTs + ARGS.capMin * 60000);
  // 第二段：首页滤界内行；满页且末行仍界内 → 续拉
  let ticksRaw = first.filter(r => new Date(r.block_time).getTime() <= stopAfterMs);
  const firstLastTs = new Date(first[first.length - 1].block_time).getTime();
  if (first.length >= PAGE && firstLastTs <= stopAfterMs) {
    const more = await fetchTokenTicks(cand.token, headAnchor, stopAfterMs, first[first.length - 1].id);
    for (const row of more) ticksRaw.push(row);
  }
  if (ticksRaw.length < 20) return { skipped: 'lt20' };
  ticksRaw.sort(cmpChain);
  // 行映射 + 尘 tick 剔除（collector _feedFa 同口径：bnb<minTickBnb 不进因子）
  let dust = 0;
  const ticks = [];
  for (const row of ticksRaw) {
    const tk = rowToTick(row);
    if (tk.bnb_amount < MIN_TICK_BNB) { dust++; continue; }
    ticks.push(tk);
  }
  if (ticks.length === 0) return { skipped: 'all-dust' };

  // 3 FA 实例（窗长对比；factorParams.bundleWinMs 覆盖）
  const fas = ARGS.windows.map(w => {
    const fa = new FourMemeFactorAggregator(
      { fourmemeWs: { factorParams: { bundleWinMs: w } } }, { info() {}, warn() {}, error() {} });
    fa.registerToken(cand.token, {
      createdAtMs: new Date(cand.block_time).getTime(),
      totalSupply: cand.totalSupply || undefined,
      platform: cand.platform || undefined,
    });
    return fa;
  });

  // 采样点合并排序；评估在喂 ts<=sample 的全部 tick 之后（asOf 防前视）
  const samples = [...ageSamples, ...fireUse.map(t => ({ kind: 'fire', ts: t }))]
    .sort((a, b) => a.ts - b.ts);
  const lastTickTs = ticks[ticks.length - 1].timestamp;
  const outSamples = [];
  let j = 0;
  for (const s of samples) {
    if (s.ts > lastTickTs) continue;   // 火点晚于已拉末 tick（cap 截断）——不评估
    while (j < ticks.length && ticks[j].timestamp <= s.ts) {
      for (const fa of fas) fa.processTick(ticks[j], {});
      j++;
    }
    const evals = {};
    for (let wi = 0; wi < fas.length; wi++) {
      const fa = fas[wi];
      const f = fa.buildFactorMap(cand.token, s.ts);
      if (!f) throw new Error(`buildFactorMap 返回 null（${cand.token}@${s.ts}）——已 registerToken，不可达，数据形状异常`);
      const detail = {};
      fa._bundleClusterFactors(fa._states.get(cand.token), s.ts, detail);
      const e = { win: ARGS.windows[wi] };
      for (const k of BUNDLE_KEYS) e[k] = f[k];
      e.blk = detail.blk; e.windowBuyBnb = Math.round(detail.windowBuyBnb * 1e6) / 1e6;
      e.circTokens = detail.circTokens;
      if (detail.wallets && detail.wallets.length >= WALLETS_STORE_MIN_SIZE) {
        e.wallets = detail.wallets.slice(0, WALLETS_STORE_CAP);
      }
      evals[`w${ARGS.windows[wi]}`] = e;
    }
    outSamples.push({ kind: s.kind, ts: s.ts, evals });
  }
  return {
    token: cand.token, platform: cand.platform, blockTime: cand.block_time,
    firstTickTs: firstTs, tickRows: ticksRaw.length, dustSkipped: dust,
    fires: fireUse.length, firesBeyondRange: firesBeyond, samples: outSamples,
  };
}

async function phaseSamples(candidates, headAnchor, fires) {
  const file = path.join(DATA_DIR, 'samples.jsonl');
  const skipFile = path.join(DATA_DIR, 'skips.jsonl');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const done = ARGS.refresh ? new Set() : loadDoneTokens();
  const skippedTokens = ARGS.refresh ? new Set()
    : new Set(fs.existsSync(skipFile) ? fs.readFileSync(skipFile, 'utf8').split('\n').filter(t => t.trim()).map(t => JSON.parse(t).token) : []);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const skipStream = fs.createWriteStream(skipFile, { flags: 'a' });
  let scanned = 0, totalTicks = 0, skipped = { 'no-ticks': 0, lt20: 0, 'all-dust': 0 };
  const t0 = Date.now();
  for (const cand of candidates) {
    if (done.size >= ARGS.maxTokens) break;
    if (done.has(cand.token) || skippedTokens.has(cand.token)) continue;
    let rec = null;
    try {
      rec = await scanToken(cand, headAnchor, fires);
    } catch (e) {
      console.error(`[samples] ✗ ${cand.token}: ${e.message}`);
      continue;                        // 单票失败不中断（stderr 留痕，重跑可续）
    }
    scanned++;
    if (rec.skipped) {
      skipped[rec.skipped] = (skipped[rec.skipped] || 0) + 1;
      skipStream.write(JSON.stringify({ token: cand.token, why: rec.skipped }) + '\n');
      skippedTokens.add(cand.token);
      continue;
    }
    totalTicks += rec.tickRows;
    if (totalTicks > MAX_TOTAL_TICKS) throw new Error(`护栏触发：累计 ticks ${totalTicks} > ${MAX_TOTAL_TICKS}`);
    stream.write(JSON.stringify(rec) + '\n');
    done.add(cand.token);
    if (done.size % 50 === 0) {
      console.log(`[samples] 已入选 ${done.size}/${ARGS.maxTokens} 票（扫 ${scanned}，累计 ${totalTicks} ticks，${((Date.now() - t0) / 1000).toFixed(0)}s）…`);
    }
  }
  stream.end(); skipStream.end();
  console.log(`[samples] 完成：入选 ${done.size} 票（扫描 ${scanned}，跳过 ${JSON.stringify(skipped)}），本轮 ${totalTicks} ticks → ${file}`);
  return loadSamples();
}

/** 读回全部 sample 记录 */
function loadSamples() {
  const file = path.join(DATA_DIR, 'samples.jsonl');
  const out = [];
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch (_e) { break; }
  }
  return out;
}

// ═══════════════ Phase 3：对拍 A（token_narrative gmgn_info）═══════════════

async function fetchNarrativeGmgn(tokens) {
  const map = new Map();
  const arr = [...tokens];
  for (let i = 0; i < arr.length; i += 50) {   // .in() URL 上限（批 50 红线）
    const batch = arr.slice(i, i + 50);
    const r = await qRetry('token_narrative 批查', () => sb()
      .from('token_narrative')
      .select('token_address, gmgn_info')
      .in('token_address', batch));
    for (const row of r.data || []) {
      if (!map.has(row.token_address)) map.set(row.token_address, row.gmgn_info || null);
    }
  }
  return map;
}

// ═══════════════ Phase 4：对拍 B（GMGN tag='bundler' 地址库）═══════════════

function gmgnApi() {
  const { GMGNTokenAPI } = require(path.join(ROOT, 'src', 'core', 'gmgn-api'));
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY 未配置（config/.env）——对拍 B 需要，或 --skip-api 跳过');
  return new GMGNTokenAPI({ apiKey, timeout: 15000 });
}

/** 从 top holders 响应提取 bundler 地址集（data.list[].wallet_address——文档形状；miss 即 throw fail-loud） */
function extractHolderAddresses(resp) {
  // 实测形状（2026-10-16 BITCAT --probe-holders 核验）：data.list[].address
  // （文档写 wallet_address 是错的；maker_token_tags 含 'bundler'，amount_percentage 已清仓恒 0）
  const list = resp && resp.list;
  if (!Array.isArray(list)) {
    throw new Error(`token_top_holders 响应形状异常（无 data.list）：${JSON.stringify(resp).slice(0, 200)}`);
  }
  const out = [];
  for (const h of list) {
    if (!h || typeof h.address !== 'string' || !h.address) {
      throw new Error(`token_top_holders 行缺 address 字段（形状漂移）：${JSON.stringify(h).slice(0, 120)}`);
    }
    out.push(h.address.toLowerCase());
  }
  return out;
}

async function phaseGmgnHolders(samples) {
  const file = path.join(DATA_DIR, 'gmgn-bundlers.jsonl');
  const done = new Set();
  if (!ARGS.refresh && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { done.add(JSON.parse(t).token); } catch (_e) { break; }
    }
    console.log(`[gmgn] checkpoint 命中：${done.size} 票`);
  }
  // 分层抽样（确定性哈希序内）：簇富票（任一采样 size>=3）优先 2/3 + 其余 1/3
  const clusterRich = [], rest = [];
  for (const s of samples.slice().sort((a, b) => hashOf(a.token) - hashOf(b.token))) {
    const hasCluster = s.samples.some(sm => Object.values(sm.evals).some(e => e.bundleClusterSize >= 3));
    (hasCluster ? clusterRich : rest).push(s);
  }
  const want = Math.round(ARGS.apiTokens * 2 / 3);
  const targets = [...clusterRich.slice(0, want), ...rest.slice(0, ARGS.apiTokens - Math.min(want, clusterRich.length))]
    .filter(s => !done.has(s.token));
  console.log(`[gmgn] 对拍 B 目标 ${targets.length} 票（簇富 ${Math.min(want, clusterRich.length)} + 其余），~1 req/s`);
  const api = gmgnApi();
  const stream = fs.createWriteStream(file, { flags: 'a' });
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    const t0 = Date.now();
    let rec;
    try {
      const resp = await api.getTokenTopHolders('bsc', s.token, { tag: 'bundler', limit: 100, order_by: 'amount_percentage' });
      const addrs = extractHolderAddresses(resp);
      rec = { token: s.token, ok: true, bundlers: addrs };
    } catch (e) {
      rec = { token: s.token, ok: false, error: String(e.message || e).slice(0, 200) };
    }
    stream.write(JSON.stringify(rec) + '\n');
    done.add(s.token);
    if ((i + 1) % 20 === 0) console.log(`[gmgn] ${i + 1}/${targets.length}…`);
    const el = Date.now() - t0;
    if (el < 1050) await sleep(1050 - el);    // ~1 req/s 限速
  }
  stream.end();
  // 读回全量
  const map = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t);
        map.set(j.token, j);
      } catch (_e) { break; }
    }
  }
  return map;
}

async function probeHolders(token) {
  const api = gmgnApi();
  const resp = await api.getTokenTopHolders('bsc', token, { tag: 'bundler', limit: 100, order_by: 'amount_percentage' });
  console.log(JSON.stringify(resp, null, 2));
}

// ═══════════════ Phase 5：统计与报告 ═══════════════

function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(p / 100 * (s.length - 1))));
  return s[idx];
}
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }

/** Spearman 秩相关（平均秩处理并列） */
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let k = i;
      while (k + 1 < idx.length && idx[k + 1][0] === idx[i][0]) k++;
      const avg = (i + k) / 2 + 1;
      for (let m = i; m <= k; m++) r[idx[m][1]] = avg;
      i = k + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

/** 票级聚合：每 token 每窗 max（跨采样点）与 fire 点值 */
function perTokenWinStats(samples) {
  const stats = new Map(); // token -> {platform, perWin: {w: {maxShare, maxSize, maxCirc, fireShare, fireSize, fireCirc, bestSample}}}
  for (const s of samples) {
    const perWin = {};
    for (const w of ARGS.windows) perWin[`w${w}`] = { maxShare: 0, maxSize: 0, maxCirc: 0, fireShare: null, fireSize: null, fireCirc: null, bestSample: null };
    for (const sm of s.samples) {
      for (const [wk, e] of Object.entries(sm.evals)) {
        const st = perWin[wk];
        if (e.bundleClusterSharePct > st.maxShare) {
          st.maxShare = e.bundleClusterSharePct; st.bestSample = { kind: sm.kind, ts: sm.ts, ...e };
        }
        if (e.bundleClusterSize > st.maxSize) st.maxSize = e.bundleClusterSize;
        if (e.maxBlockBuyCircPct > st.maxCirc) st.maxCirc = e.maxBlockBuyCircPct;
        if (sm.kind === 'fire' && st.fireShare === null) {
          st.fireShare = e.bundleClusterSharePct; st.fireSize = e.bundleClusterSize; st.fireCirc = e.maxBlockBuyCircPct;
        }
      }
    }
    stats.set(s.token, { platform: s.platform, perWin });
  }
  return stats;
}

function buildReport(samples, narrative, gmgn) {
  const stats = perTokenWinStats(samples);
  const report = { generatedAt: new Date().toISOString(), tokens: samples.length, windows: ARGS.windows, sections: {} };

  // ── §1 分布（票级 max + fire 点）──
  report.sections.distribution = {};
  for (const w of ARGS.windows) {
    const key = `w${w}`;
    const shares = [], sizes = [], circs = [], fShares = [], fSizes = [], fCircs = [];
    for (const st of stats.values()) {
      const e = st.perWin[key];
      shares.push(e.maxShare); sizes.push(e.maxSize); circs.push(e.maxCirc);
      if (e.fireShare !== null) { fShares.push(e.fireShare); fSizes.push(e.fireSize); fCircs.push(e.fireCirc); }
    }
    report.sections.distribution[key] = {
      tokenCount: shares.length, fireCount: fShares.length,
      maxSharePct: { p50: pct(shares, 50), p75: pct(shares, 75), p90: pct(shares, 90), p95: pct(shares, 95), p99: pct(shares, 99), max: pct(shares, 100) },
      maxSize: { p50: pct(sizes, 50), p90: pct(sizes, 90), p99: pct(sizes, 99), max: pct(sizes, 100) },
      maxCircPct: { p50: pct(circs, 50), p75: pct(circs, 75), p90: pct(circs, 90), p95: pct(circs, 95), p99: pct(circs, 99), max: pct(circs, 100) },
      fireSharePct: { p50: pct(fShares, 50), p90: pct(fShares, 90), p95: pct(fShares, 95), max: pct(fShares, 100) },
    };
  }

  // ── §2 对拍 A：token_narrative gmgn_info ↔ maxSharePct ──
  const gmgnPairs = []; // {token, share, ratio, bundlers, top}
  for (const [token, st] of stats) {
    const info = narrative.get(token);
    const risk = info ? extractGmgnRisk(info) : null;
    if (!risk || risk.topWallets === null || risk.bundlerWallets === null) continue;
    for (const w of ARGS.windows) {
      gmgnPairs.push({
        token, win: w, share: st.perWin[`w${w}`].maxShare, size: st.perWin[`w${w}`].maxSize,
        ratio: risk.bundlerWallets / risk.topWallets * 100,
        bundlers: risk.bundlerWallets, top: risk.topWallets,
      });
    }
  }
  report.sections.pairingA = { narrativeCoverage: gmgnPairs.length / ARGS.windows.length, windows: {} };
  for (const w of ARGS.windows) {
    const ps = gmgnPairs.filter(p => p.win === w);
    const withRatio = ps.filter(p => p.top > 0);
    const rhoRatio = spearman(ps.map(p => p.share), ps.map(p => p.ratio));
    const rhoCount = spearman(ps.map(p => p.share), ps.map(p => p.bundlers));
    // 十分位分层（按 share 升序分桶）
    const sorted = ps.slice().sort((a, b) => a.share - b.share);
    const deciles = [];
    for (let d = 0; d < 10; d++) {
      const lo = Math.floor(d * sorted.length / 10), hi = Math.floor((d + 1) * sorted.length / 10);
      const bucket = sorted.slice(lo, hi);
      deciles.push({
        d: d + 1, n: bucket.length,
        shareRange: [bucket.length ? bucket[0].share : null, bucket.length ? bucket[bucket.length - 1].share : null],
        meanRatio: mean(bucket.map(p => p.ratio)),
        pbPos: bucket.length ? bucket.filter(p => p.bundlers > 0).length / bucket.length * 100 : null,
        meanSize: mean(bucket.map(p => p.size)),
        pbRatioGe25: bucket.filter(p => p.ratio >= 25).length,
      });
    }
    report.sections.pairingA.windows[w] = { n: ps.length, spearmanVsRatio: rhoRatio, spearmanVsCount: rhoCount, deciles };
  }

  // ── §3 对拍 B：簇钱包 ↔ GMGN bundler 地址库 ──
  if (gmgn && gmgn.size > 0) {
    const okRows = [...gmgn.values()].filter(r => r.ok);
    const perWin = {};
    for (const w of ARGS.windows) {
      const key = `w${w}`;
      const rows = [];
      for (const s of samples) {
        const g = gmgn.get(s.token);
        if (!g || !g.ok) continue;
        const bset = new Set(g.bundlers);
        // 取该窗 maxShare 采样点的簇钱包（size>=3 才存了明细）
        const st = stats.get(s.token).perWin[key];
        const wallets = st.bestSample && st.bestSample.wallets ? st.bestSample.wallets : null;
        if (wallets && wallets.length >= 2) {
          const hits = wallets.filter(x => bset.has(x.toLowerCase())).length;
          rows.push({
            token: s.token, size: wallets.length, hits,
            precision: hits / wallets.length,
            coverage: g.bundlers.length > 0 ? hits / g.bundlers.length : null,
            gmgnCount: g.bundlers.length,
          });
        }
      }
      // 票级混淆矩阵阈值扫描：gate = maxShare>=X AND maxSize>=N vs 真值=GMGN bundler 数>=1 / >=3
      const tokensWithGmgn = samples.filter(s => gmgn.get(s.token) && gmgn.get(s.token).ok)
        .map(s => ({
          token: s.token,
          share: stats.get(s.token).perWin[key].maxShare,
          size: stats.get(s.token).perWin[key].maxSize,
          g: gmgn.get(s.token).bundlers.length,
        }));
      const sweep = [];
      for (const X of [30, 40, 50, 60, 70]) {
        for (const N of [3, 4, 5]) {
          for (const truthMin of [1, 3]) {
            const flagged = tokensWithGmgn.filter(t => t.share >= X && t.size >= N);
            const truthPos = tokensWithGmgn.filter(t => t.g >= truthMin);
            const tp = flagged.filter(t => t.g >= truthMin).length;
            sweep.push({
              X, N, truthMin,
              flagged: flagged.length, truthPos: truthPos.length, tp,
              precision: flagged.length ? tp / flagged.length * 100 : null,
              recall: truthPos.length ? tp / truthPos.length * 100 : null,
            });
          }
        }
      }
      perWin[key] = {
        gmgnOkTokens: tokensWithGmgn.length,
        clusterRows: rows.length,
        meanPrecision: mean(rows.map(r => r.precision)),
        meanCoverage: mean(rows.filter(r => r.coverage !== null).map(r => r.coverage)),
        rows: rows.slice(0, 300),
        thresholdSweep: sweep,
      };
    }
    report.sections.pairingB = { gmgnCalls: gmgn.size, ok: okRows.length, perWin };
  }

  // ── §4 窗长对比（票级 maxShare 跨窗一致性）──
  {
    const cross = {};
    for (let i = 0; i < ARGS.windows.length; i++) {
      for (let k = i + 1; k < ARGS.windows.length; k++) {
        const a = [], b = [];
        for (const st of stats.values()) {
          a.push(st.perWin[`w${ARGS.windows[i]}`].maxShare);
          b.push(st.perWin[`w${ARGS.windows[k]}`].maxShare);
        }
        cross[`${ARGS.windows[i]}vs${ARGS.windows[k]}`] = spearman(a, b);
      }
    }
    report.sections.windowStability = cross;
  }

  // ── §5 误报面：高 share 无 GMGN bundler 标签 top20（人工甄别原料）──
  {
    const defaultKey = `w${ARGS.windows[0]}`;
    const cands = [];
    for (const [token, st] of stats) {
      const bs = st.perWin[defaultKey].bestSample;
      if (!bs) continue;
      const risk = (() => {
        const info = narrative.get(token);
        return info ? extractGmgnRisk(info) : null;
      })();
      const bundlers = risk && risk.bundlerWallets !== null ? risk.bundlerWallets : null;
      if (bundlers === 0) cands.push({  // 有叙事快照且 bundler=0 才是干净误报面
        token, platform: st.platform, share: bs.bundleClusterSharePct, size: bs.bundleClusterSize,
        amountRatio: bs.bundleClusterAmountRatio, evenGap: bs.bundleClusterEvenGap,
        sameTrader: bs.bundleClusterSameTrader, circPct: bs.maxBlockBuyCircPct,
        sampleKind: bs.kind, wallets: (bs.wallets || []).slice(0, 8),
      });
    }
    cands.sort((x, y) => y.share - x.share);
    report.sections.falsePositiveFace = { window: ARGS.windows[0], candidates: cands.length, top20: cands.slice(0, 20) };
  }

  // ── §6 阈值建议（对拍 B sweep 的 pareto 摘要——最终裁定用户做）──
  {
    const recs = [];
    const pb = report.sections.pairingB;
    if (pb) {
      for (const [wk, v] of Object.entries(pb.perWin)) {
        for (const s of v.thresholdSweep) {
          if (s.precision !== null && s.recall !== null && s.precision >= 70 && s.recall >= 50) {
            recs.push({ window: wk, ...s });
          }
        }
      }
    }
    report.sections.thresholdCandidates = recs;
  }
  return report;
}

// ═══════════════ main ═══════════════

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (ARGS.probeHolders) {
    await probeHolders(ARGS.probeHolders);
    return;
  }
  const cutoffIso = new Date(Date.now() - ARGS.days * 86400000).toISOString();
  console.log(`=== bundle* 扫描验证 Phase 2（窗 ${ARGS.windows.join('/')}ms，近 ${ARGS.days} 天，目标 ${ARGS.maxTokens} 票）===`);

  const candidates = await fetchCandidates(cutoffIso);
  const fires = await fetchFirePoints(cutoffIso);
  const headAnchor = await fetchHeadTickId();
  console.log(`[ticks] 表头锚 headId=${headAnchor}`);

  const samples = await phaseSamples(candidates, headAnchor, fires);
  console.log(`[samples] 载入 ${samples.length} 票记录`);

  console.log('[pairingA] 拉取 token_narrative.gmgn_info …');
  const narrative = await fetchNarrativeGmgn(samples.map(s => s.token));
  console.log(`[pairingA] 命中 ${narrative.size}/${samples.length}`);

  let gmgn = null;
  if (!ARGS.skipApi) {
    gmgn = await phaseGmgnHolders(samples);
  } else {
    console.log('[gmgn] --skip-api：对拍 B 跳过（若存在旧 checkpoint 仍会用于报告）');
    const file = path.join(DATA_DIR, 'gmgn-bundlers.jsonl');
    if (fs.existsSync(file)) {
      gmgn = new Map();
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { const j = JSON.parse(t); gmgn.set(j.token, j); } catch (_e) { break; }
      }
    }
  }

  const report = buildReport(samples, narrative, gmgn);
  const reportFile = path.join(DATA_DIR, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n=== 报告 → ${reportFile} ===`);

  // 控制台摘要
  const d = report.sections.distribution;
  for (const w of ARGS.windows) {
    const e = d[`w${w}`];
    console.log(`[分布 w${w}] n=${e.tokenCount} fire=${e.fireCount} | maxShare p50/90/95/99=${e.maxSharePct.p50}/${e.maxSharePct.p90}/${e.maxSharePct.p95}/${e.maxSharePct.p99} | maxSize p90/99/max=${e.maxSize.p90}/${e.maxSize.p99}/${e.maxSize.max} | circ p90/95=${e.maxCircPct.p90}/${e.maxCircPct.p95}`);
  }
  if (report.sections.pairingA) {
    for (const [w, v] of Object.entries(report.sections.pairingA.windows)) {
      console.log(`[对拍A w${w}] n=${v.n} ρ(share,ratio)=${v.spearmanVsRatio && v.spearmanVsRatio.toFixed(3)} ρ(share,count)=${v.spearmanVsCount && v.spearmanVsCount.toFixed(3)}`);
    }
  }
  if (report.sections.pairingB) {
    for (const [wk, v] of Object.entries(report.sections.pairingB.perWin)) {
      console.log(`[对拍B ${wk}] gmgnOk=${report.sections.pairingB.ok} 簇行=${v.clusterRows} meanPrecision=${v.meanPrecision && v.meanPrecision.toFixed(3)} meanCoverage=${v.meanCoverage && v.meanCoverage.toFixed(3)}`);
    }
    console.log(`[阈值候选] ${report.sections.thresholdCandidates.length} 条（precision>=70% 且 recall>=50%）`);
  }
  console.log(`[误报面] w${ARGS.windows[0]} 无标签候选 ${report.sections.falsePositiveFace.candidates} 票（top20 明细见 report.json）`);
  process.exit(0);
}

// 离线单测入口（scripts/_test_scan_bundle_report.cjs 复用；main 仅直跑时执行）
module.exports = { rowToTick, cmpChain, scanToken, buildReport, spearman, pct, mean, extractHolderAddresses, hashOf };

if (require.main === module) {
  main().catch(e => {
    console.error(`\n✗ 扫描失败: ${e.message}\n${e.stack}`);
    process.exit(1);
  });
}
