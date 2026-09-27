#!/usr/bin/env node
/**
 * build-wallet-profiles — step4 钱包离线画像构建（wallet_offline_profiles 表）
 * （pumpfun 回迁批 4；母版 pumpfun-wss-trader/scripts/build-wallet-profiles.cjs，结构对齐 + BSC 全表口径改造）
 *
 * 两阶段全表聚合（阈值 threshold=3 笔 tick 以上钱包 = HF）：
 *   阶段1 count：全表流式遍历计数 per-trader {count, maxBt} → 筛 HF 集
 *   阶段2 spill：二遍遍历，HF 钱包 ticks 哈希分 64 磁盘桶（防 byWallet 全内存爆 heap，母版 22GB 教训）
 *   然后批量预查 token_profiles → 逐桶聚合 → buildProfileFromTicks(asOfMs:null 全历史口径)
 *   + 三特性 compute（lowLevelBadAction/goodAction/tinyLevelBadAction，纯观察） → upsert。
 *
 * ★拉数口径（plan 核实裁定）：wss_price_ticks 全表 id 游标（GlobalTickCache，见 lib/tick-data-cache.js）。
 *   不按 experiment_id（watcher 架构后新行 experiment_id=NULL 会全部漏行）、不带 platform 过滤
 *   （钱包画像跨平台全局，与 TPA 实时三路径严格同构）。--days 为内存过滤 block_time ≥ now−days。
 *
 * ⚠️ 红线：重查询只在 182 跑（本地 VPN 连 Supabase 必超时）。脚本须用 service_role
 *   （dbManager.getClient()；SUPABASE_ANON_KEY 会被 RLS 静默过滤成空）。
 * ⚠️ 依赖顺序：必须先跑 node scripts/build-token-profiles.cjs（本脚本消费 token_profiles 的
 *   category/flash_crash_period/first_tick_time/violent_crash_blocks，分类缺行该 token 不计 bad_action）。
 * ⚠️ 内存：NODE_OPTIONS=--max-old-space-size=12288（阶段2 单桶聚合 + 全表遍历 visit 状态）。
 * ⚠️ 部署纪律：先全量跑完本脚本再上读侧（TPA mergeOfflineProfile 的 aggregatedTradeCount 哨兵防错配）。
 *
 * 用法（182）：
 *   NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14
 *   NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3          # 全历史
 *   NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --dry-run             # 只统计不落表
 *   node scripts/build-wallet-profiles.cjs --resume                                                     # 从 checkpoint 重放 upsert
 *
 * 完成后清理：删 data/offline-cache/wallet_offline_profiles.jsonl.gz（TPA preloadOfflineProfiles 的
 *   文件缓存，重建后失效防读旧——TPA 侧 mtime 12h 校验是兜底）+ checkpoint + spill 目录。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { pipeline } = require('stream/promises');
const { Readable, once } = require('stream');

require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const GlobalTickCache = require('./wallet-profiles/lib/tick-data-cache');
const { fetchTicksPageAfter, fetchMaxTickId, queryWithRetry } = require('./wallet-profiles/lib/data-fetcher');
const { buildProfileFromTicks } = require('../src/services/wallet-profile-builder');
const { computeLowLevelBadAction } = require('../src/services/low-level-bad-action');
const { computeGoodAction } = require('../src/services/good-action');
const { computeTinyLevelBadAction } = require('../src/services/tiny-level-bad-action');

// ── 参数 ──
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const THRESHOLD = parseInt(arg('threshold', '3'), 10);
const daysRaw = arg('days', null);
const DAYS = (daysRaw != null && daysRaw !== true) ? parseFloat(daysRaw) : null;
const DRY_RUN = arg('dry-run', false) === true || arg('dry-run', false) === 'true';
const RESUME = arg('resume', false) === true || arg('resume', false) === 'true';
// fail-fast：--threshold/--days 无值时 parseInt(true)=NaN 会静默筛出空 HF 集（count>=NaN 恒 false）
if (!Number.isFinite(THRESHOLD) || THRESHOLD < 1) throw new Error(`--threshold 非法: ${arg('threshold', '3')}`);
if (DAYS != null && (!Number.isFinite(DAYS) || DAYS <= 0)) throw new Error(`--days 非法: ${daysRaw}`);

// ── 常量 ──
const BUCKETS = 64;
const SPILL_DIR = path.join(process.cwd(), 'data', 'offline-cache', '_spill');
const CKPT = path.join(process.cwd(), 'data', 'offline-cache', '_build_rows_checkpoint.jsonl.gz');
const OFFLINE_CACHE = path.join(process.cwd(), 'data', 'offline-cache', 'wallet_offline_profiles.jsonl.gz');
const TOKEN_BATCH = 100;   // token_profiles .in() 批（500 超 URL 上限会 fetch failed 静默吞错，母版实证）
const UPSERT_BATCH = 200;  // upsert 批（母版 500 曾撞 fetch failed 瞬断；200 实证稳）
// 护栏：全表行数上限（读到的原始行，先于一切过滤计数）。超限中止——step4 全表扫描成本线性增长
//   （R2 已文档化：增长后优化 block_time 全局索引/分区，另立项），护栏防失控长跑。
const MAX_TOTAL_TICKS = 20000000;
const PROGRESS_EVERY = 1000000; // 每 100 万行打一行进度（长跑可观测）

// ── 惰性 supabase（service_role；anon 会被 RLS 过滤 wss_price_ticks 成空）──
let _sb = null;
function sb() {
  if (!_sb) {
    const { dbManager } = require('../src/services/dbManager');
    _sb = dbManager.getClient();
  }
  return _sb;
}

// ── spill 桶哈希（母版同款：地址字符 31 进制滚动哈希，EVM hex 地址分布均匀）──
function bucketOf(addr) {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return Math.abs(h) % BUCKETS;
}

/**
 * 遍历包装：护栏计数（读到的原始行）→ 脏行过滤（缺地址/price_outlier）→ days 窗过滤 → onTick(t, btMs)。
 * 母版 forEachTick 同款脏行口径：!trader_address || !token_address || price_outlier 跳过。
 */
function makeVisitor(sinceMs, onTick, label) {
  let seen = 0;
  return function visit(t) {
    seen++;
    if (seen > MAX_TOTAL_TICKS) {
      throw new Error(`护栏触发：${label} 遍历读到 ${seen} 行 > MAX_TOTAL_TICKS=${MAX_TOTAL_TICKS} —— 全表体量超预期，中止（优化方案见脚本头注 R2）`);
    }
    if (seen % PROGRESS_EVERY === 0) console.log(`  [${label}] 已读 ${seen / 10000} 万行…`);
    if (!t.trader_address || !t.token_address || t.price_outlier) return;
    const btMs = new Date(t.block_time).getTime();
    if (sinceMs != null && btMs < sinceMs) return;
    onTick(t, btMs);
  };
}

/**
 * 批量预查 token_profiles → Map<token, {category, flashCrashPeriod, firstTickTime, violentCrashBlocks}|null>。
 * 归一口径与 TokenPositionAnalyzer._normalizeTokenProfile 对齐（snake_case DB 行 → builder 消费的 camelCase；
 * first_tick_time ISO → ms；flash_crash_period 的 peakTime/floorTime 是 token-classifier 产的 ms 数字原样透传）。
 * 无行 → null（builder bad_action 循环 if(!prof) continue，不计 bad_action）。
 */
async function fetchTokenProfiles(client, tokens) {
  const arr = [...tokens];
  const map = new Map();
  for (let i = 0; i < arr.length; i += TOKEN_BATCH) {
    const batch = arr.slice(i, i + TOKEN_BATCH);
    const data = await queryWithRetry(async () => {
      const r = await client.from('token_profiles')
        .select('token_address,category,profile')
        .in('token_address', batch);
      if (r.error) throw new Error(`token_profiles 批量查询失败（offset ${i}, ${batch.length} token）: ${r.error.message}`);
      return r.data;
    });
    for (const r of (data || [])) {
      if (r && !map.has(r.token_address)) map.set(r.token_address, normalizeTokenProfileRow(r));
    }
  }
  for (const t of arr) if (!map.has(t)) map.set(t, null);
  return map;
}

function normalizeTokenProfileRow(r) {
  const p = (r.profile && typeof r.profile === 'object') ? r.profile : {};
  const ftRaw = p.first_tick_time;
  return {
    category: r.category || p.category || null,
    flashCrashPeriod: p.flash_crash_period || null,    // {peakTime,peakPrice,floorTime,floorPrice}（ms 数字）
    violentCrashBlocks: p.violent_crash_blocks || [],  // block number[]（Tier2 用）
    firstTickTime: ftRaw != null ? (typeof ftRaw === 'string' ? Date.parse(ftRaw) : ftRaw) : null,
  };
}

/** upsert wallet_offline_profiles（batch 200 onConflict address，重试 3）。 */
async function upsertProfiles(client, rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    await queryWithRetry(async () => {
      const r = await client.from('wallet_offline_profiles')
        .upsert(batch, { onConflict: 'address' });
      if (r.error) throw new Error(`upsert 失败 batch@${i}: ${r.error.message}`);
      return true;
    }, 3);
    n += batch.length;
    console.log(`  upsert ${n}/${rows.length}`);
  }
  return n;
}

/** checkpoint 写：rows → gzip jsonl（--resume 用；防 fetch/upsert 阶段失败重跑 30min 聚合）。 */
async function writeCheckpoint(rows) {
  fs.mkdirSync(path.dirname(CKPT), { recursive: true });
  // generator 逐行序列化（rows.map 会一次性物化全部 JSON 字符串，百万行=GB 级内存峰值）
  function* rowLines() {
    for (const r of rows) yield JSON.stringify(r) + '\n';
  }
  await pipeline(
    Readable.from(rowLines()),
    zlib.createGzip(),
    fs.createWriteStream(CKPT)
  );
  console.log(`checkpoint 写入: ${CKPT}（${rows.length} 行）`);
}

// ── 主流程 ──
async function main() {
  const sinceMs = DAYS != null ? Date.now() - DAYS * 86400000 : null;
  console.log(`=== build-wallet-profiles === threshold=${THRESHOLD} days=${DAYS != null ? DAYS : '全历史'} dryRun=${DRY_RUN} resume=${RESUME}`);

  // ── --resume：从 checkpoint 重放 upsert（阶段1-4 全跳过）──
  if (RESUME) {
    if (!fs.existsSync(CKPT)) throw new Error(`--resume 但 checkpoint 不存在: ${CKPT}`);
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(CKPT).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) if (line) rows.push(JSON.parse(line));
    console.log(`[resume] checkpoint 读回 ${rows.length} 行 → 直接 upsert`);
    await upsertProfiles(sb(), rows);
    fs.rmSync(OFFLINE_CACHE, { force: true });
    fs.rmSync(CKPT, { force: true });
    console.log(`[resume] 完成：upsert ${rows.length} 行 / offline cache 已失效 / checkpoint 已删`);
    return;
  }

  const tickCache = new GlobalTickCache();

  // ── 阶段1：全表流式 count（per-trader {count,maxBt}）→ 筛 HF ──
  console.log('[阶段1] 全表遍历 count 筛 HF…');
  const t1 = Date.now();
  const traderStat = new Map(); // trader → {count, maxBt}
  const c1 = await tickCache.forEachTick({
    fetchPage: (afterId) => fetchTicksPageAfter(sb(), afterId),
    dbMaxId: () => fetchMaxTickId(sb()),
    visit: makeVisitor(sinceMs, (t, btMs) => {
      let s = traderStat.get(t.trader_address);
      if (!s) { s = { count: 0 }; traderStat.set(t.trader_address, s); }
      s.count++;
    }, 'count'),
  });
  const hfSet = new Set();
  for (const [addr, s] of traderStat) {
    if (s.count >= THRESHOLD) hfSet.add(addr);
  }
  console.log(`[阶段1] ${c1.source} ${c1.rows} 行 / ${(traderStat.size / 10000).toFixed(1)} 万 trader / HF(count≥${THRESHOLD})=${hfSet.size} / ${((Date.now() - t1) / 1000).toFixed(0)}s`);

  // ── 阶段2：二遍遍历 spill HF ticks 到 64 磁盘桶 ──
  console.log('[阶段2] spill HF ticks → 64 桶…');
  const t2 = Date.now();
  fs.rmSync(SPILL_DIR, { recursive: true, force: true });
  fs.mkdirSync(SPILL_DIR, { recursive: true });
  const bucketPaths = [];
  const bucketStreams = [];
  let spillErr = null; // 桶流写错误收集（磁盘满等；无监听的 'error' 事件会 unhandled crash 进程）
  for (let b = 0; b < BUCKETS; b++) {
    const p = path.join(SPILL_DIR, `bucket-${String(b).padStart(2, '0')}.jsonl`);
    bucketPaths.push(p);
    const ws = fs.createWriteStream(p);
    ws.on('error', (e) => { if (!spillErr) spillErr = e; });
    bucketStreams.push(ws);
  }
  // 页间隙背压 + 桶健康检查：FRESH 二遍遍历读本地 cache 可达 ~30 万行/s，桶 write 返回 false
  //   后数据积压在 Node 内存 write queue（最坏 GB 级）——每页尾对积压桶 await drain（onPageGap 钩子）
  async function drainBuckets() {
    if (spillErr) throw spillErr; // fail-loud：桶已坏即中止
    const busy = bucketStreams.filter((ws) => ws.writableLength > (1 << 22)); // 单桶积压 >4MB
    if (busy.length) await Promise.all(busy.map((ws) => once(ws, 'drain')));
  }
  const allTokens = new Set();
  const c2 = await tickCache.forEachTick({
    fetchPage: (afterId) => fetchTicksPageAfter(sb(), afterId),
    dbMaxId: () => fetchMaxTickId(sb()),
    visit: makeVisitor(sinceMs, (t, btMs) => {
      if (!hfSet.has(t.trader_address)) return;
      allTokens.add(t.token_address); // 阶段3 预查集合（曾漏此行：Set 恒空 → tpMap 空 → bad_action 族全按无分类低估）
      // 紧凑数组行（BSC 列名：bnb_amount / block_number；builder 消费 {token_address,bnb_amount,price_usd,trade_type,block_time,block_number,trader_address}）
      bucketStreams[bucketOf(t.trader_address)].write(
        JSON.stringify([t.token_address, t.bnb_amount, t.price_usd, t.trade_type, t.block_time, t.block_number, t.trader_address]) + '\n'
      );
    }, 'spill'),
    onPageGap: drainBuckets,
  });
  // flush 全部桶（end + 等 finish；error 已由上方监听收集）
  await Promise.all(bucketStreams.map((ws) => new Promise((res) => ws.end(() => res()))));
  if (spillErr) throw new Error(`spill 桶写入失败: ${spillErr.message}`);
  const spillBytes = bucketPaths.reduce((acc, p) => { try { return acc + fs.statSync(p).size; } catch (_) { return acc; } }, 0);
  console.log(`[阶段2] ${c2.source} ${c2.rows} 行 / HF ticks spill ${(spillBytes / 1048576).toFixed(1)}MB / tokens=${allTokens.size} / ${((Date.now() - t2) / 1000).toFixed(0)}s`);

  // ── 阶段3：批量预查 token_profiles ──
  console.log('[阶段3] 预查 token_profiles…');
  const t3 = Date.now();
  const tpMap = await fetchTokenProfiles(sb(), allTokens);
  let tpHit = 0;
  for (const v of tpMap.values()) if (v) tpHit++;
  console.log(`[阶段3] ${allTokens.size} token → 有分类行 ${tpHit}（${((tpHit / Math.max(allTokens.size, 1)) * 100).toFixed(1)}%）/ ${((Date.now() - t3) / 1000).toFixed(0)}s`);

  // ── 阶段4：逐桶聚合 → buildProfileFromTicks(asOfMs:null) + 三特性 → rows（桶处理完即删，progressive free）──
  console.log('[阶段4] 逐桶 build…');
  const t4 = Date.now();
  const rows = [];
  for (let b = 0; b < BUCKETS; b++) {
    const rl = readline.createInterface({ input: fs.createReadStream(bucketPaths[b]), crlfDelay: Infinity });
    const byWallet = new Map();
    for await (const line of rl) {
      if (!line) continue;
      const [token_address, bnb_amount, price_usd, trade_type, block_time, block_number, trader_address] = JSON.parse(line);
      let arr = byWallet.get(trader_address);
      if (!arr) { arr = []; byWallet.set(trader_address, arr); }
      arr.push({ token_address, bnb_amount, price_usd, trade_type, block_time, block_number });
    }
    for (const [addr, ticks] of byWallet) {
      // ★data_through 从画像实际消费的 ticks 现算 max bt（非阶段1 count 的窗内 max）：阶段1/2 是两次
      //   独立遍历，DB 活表（watcher 持续写入）下阶段2 会 STALE 增量吸收拉取间隔的新行——若用
      //   count 侧 maxBt 会落后实际数据末端 → TPA stale 增量段 [data_through,asOf) 重复计算这些行。
      let maxBt = 0;
      for (const tk of ticks) {
        const ms = new Date(tk.block_time).getTime();
        if (ms > maxBt) maxBt = ms;
      }
      // asOfMs=null → 不算 badAction24h（离线全历史累积口径）；largeTradeBnb 默认 1.0 对齐 BAD_BUY
      const profile = buildProfileFromTicks(ticks, tpMap, { asOfMs: null });
      // 三特性挂载（纯观察数据不进 scorer；不传 config 走 DEFAULT_CONFIG enabled）
      profile.lowLevelBadAction = computeLowLevelBadAction(ticks, tpMap);
      profile.goodAction = computeGoodAction(ticks, tpMap);
      profile.tinyLevelBadAction = computeTinyLevelBadAction(ticks, tpMap);
      const nowIso = new Date().toISOString();
      rows.push({
        address: addr,
        data_through: new Date(maxBt).toISOString(),
        computed_at: nowIso,
        profile,
        updated_at: nowIso,
      });
    }
    fs.rmSync(bucketPaths[b], { force: true }); // progressive free：桶处理完即删
    if ((b + 1) % 8 === 0 || b === BUCKETS - 1) console.log(`  桶 ${b + 1}/${BUCKETS} 完成（rows=${rows.length}）`);
  }
  console.log(`[阶段4] ${rows.length} 个 HF 钱包 profile / ${((Date.now() - t4) / 1000).toFixed(0)}s`);

  if (rows.length) {
    const s = rows[0];
    console.log(`样例: ${s.address} data_through=${s.data_through} tokenCount=${s.profile.tokenCount} totalBnb=${s.profile.totalBnb.toFixed(2)} bad14d=${s.profile.badCount14d} llBA=${JSON.stringify(s.profile.lowLevelBadAction).slice(0, 80)}`);
  }

  // ── dry-run 出口：不落表不留中间产物（spill 已随阶段4 删空）──
  if (DRY_RUN) {
    fs.rmSync(SPILL_DIR, { recursive: true, force: true });
    console.log(`[dry-run] 完成：HF=${rows.length}，未写表、未写 checkpoint`);
    return;
  }

  // ── 阶段5：checkpoint → upsert → 清理 ──
  await writeCheckpoint(rows);
  await upsertProfiles(sb(), rows);
  fs.rmSync(OFFLINE_CACHE, { force: true }); // TPA preload 文件缓存失效（防实盘机读旧画像）
  fs.rmSync(CKPT, { force: true });
  fs.rmSync(SPILL_DIR, { recursive: true, force: true });
  console.log(`=== 完成 === upsert ${rows.length} 行（threshold=${THRESHOLD} days=${DAYS != null ? DAYS : '全历史'}）/ offline cache 已失效 / checkpoint + spill 已清理`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('build-wallet-profiles 失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
