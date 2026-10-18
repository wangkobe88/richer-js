#!/usr/bin/env node
/**
 * build-gmgn-wallet-profiles — GMGN 钱包画像离线批量回填（gmgn_wallet_profiles 表）
 * （2026-10-18 GMGN wallet_stats 调研接入；架构=用户裁定离线建库优先：
 *  live 引擎 fire 时刻查本地表毫秒级，绝不逐钱包实时 API 主路径）
 *
 * 数据源：近 N 天 wss_price_ticks 买入钱包去重（wallet = sender||trader COALESCE，
 * 与 FA/TPA 口径一致；bnb ≥ min-bnb 过滤尘埃）→ GMGNPortfolioAPI.getWalletStats
 * 单钱包端点（数组参数实测只回第一个）→ upsert 表。
 *
 * 增量语义：表内 fetched_at 新于 --refresh-days（默认 7d）跳过——created_at/tags
 * 是不可变字段，动态计数（buy_7d 等）消费侧用容差（镜像键 1%/10%）天然容忍陈旧。
 * GMGN 无记录的空数据行也落表（tags=[]）——表 miss ≠ 无记录，空行是「已确认无记录」
 * 结论，全新钱包反复出现不重复烧配额（7777 sybil 场景关键）。
 *
 * ⚠️ 红线：重查询只在 182 跑（本地 VPN 连 Supabase 必超时）；service key
 *   （dbManager.getClient()——anon 被 RLS 静默过滤）。
 * ⚠️ 429 感知：base-api 自动重试 ≤5s；重试耗尽仍 429 → 暂停 30s 续跑，
 *   连续 --max-ban（默认 5）轮 → 停机退出非零（人工评估配额）。
 *
 * 用法（182）：
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14                    # dry-run（只统计）
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14 --commit           # 回填落表
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14 --limit 5000 --min-bnb 0.05 --commit
 */

'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'config', '.env') });

const PAGE_SIZE = 1000;   // PostgREST max-rows=1000 红线（keyset 分页）
const DB_SLEEP_MS = 200;  // 页间歇
const UPSERT_BATCH = 50;  // upsert 批

// ── 参数 ──
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}
const DAYS = parseFloat(arg('days', '14'));
const LIMIT = parseInt(arg('limit', '3000'), 10);
const MIN_BNB = parseFloat(arg('min-bnb', '0.01'));
const INTERVAL_MS = parseInt(arg('interval-ms', '400'), 10);
const REFRESH_DAYS = parseFloat(arg('refresh-days', '7'));
const MAX_BAN = parseInt(arg('max-ban', '5'), 10);
const COMMIT = arg('commit', false) === true || arg('commit', false) === 'true';
for (const [n, v] of [['days', DAYS], ['limit', LIMIT], ['min-bnb', MIN_BNB], ['interval-ms', INTERVAL_MS], ['refresh-days', REFRESH_DAYS]]) {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${n} 非法: ${arg(n)}`);
}
if (!process.env.GMGN_API_KEY) throw new Error('GMGN_API_KEY 缺失（config/.env）');

const { dbManager } = require(path.join(__dirname, '..', 'src', 'services', 'dbManager'));
const { GMGNPortfolioAPI } = require(path.join(__dirname, '..', 'src', 'core', 'gmgn-api'));

const sb = dbManager.getClient();
const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 8000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const walletOf = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

// ── 阶段 1：近 N 天买入钱包去重（id keyset 升序分页；--limit 封顶即止）──
async function collectWallets() {
  const since = new Date(Date.now() - DAYS * 86400 * 1000).toISOString();
  const seen = new Set();
  let afterId = null, rows = 0, done = false;
  while (!done && seen.size < LIMIT) {
    let q = sb.from('wss_price_ticks')
      .select('id,sender_address,trader_address')
      .gt('block_time', since)
      .ilike('trade_type', '%buy%')
      .gte('bnb_amount', MIN_BNB)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (afterId != null) q = q.gt('id', afterId);
    const res = await q;
    if (res.error) throw new Error(`ticks 拉取失败: ${res.error.message}`);
    const page = res.data || [];
    if (page.length === 0) break;
    rows += page.length;
    for (const r of page) {
      const w = walletOf(r);
      if (w) seen.add(w);
      afterId = r.id;
    }
    if (page.length < PAGE_SIZE) done = true;
    await sleep(DB_SLEEP_MS);
    process.stdout.write(`\r[scan] rows=${rows} wallets=${seen.size}/${LIMIT}   `);
  }
  process.stdout.write('\n');
  return { wallets: [...seen], rowsScanned: rows };
}

// ── 阶段 2：表内新鲜行跳过集 ──
async function freshSet(wallets) {
  const freshSince = new Date(Date.now() - REFRESH_DAYS * 86400 * 1000).toISOString();
  const fresh = new Set();
  for (let i = 0; i < wallets.length; i += 50) {
    const batch = wallets.slice(i, i + 50);
    const res = await sb.from('gmgn_wallet_profiles')
      .select('address,fetched_at').in('address', batch).gt('fetched_at', freshSince);
    if (res.error) throw new Error(`profiles 表读失败: ${res.error.message}`);
    for (const r of res.data || []) fresh.add(String(r.address).toLowerCase());
  }
  return fresh;
}

// ── 阶段 3：逐钱包拉取 + upsert ──
function apiRow(addr, data) {
  const common = (data && typeof data === 'object' ? data.common : null) || {};
  const pnl = (data && typeof data === 'object' ? data.pnl_stat : null) || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    address: addr,
    tags: Array.isArray(common.tags) ? common.tags.map(String) : [],
    created_at_sec: num(common.created_at),
    fund_from_address: common.fund_from_address ? String(common.fund_from_address).toLowerCase() : null,
    buy_7d: num(data?.buy),
    sell_7d: num(data?.sell),
    token_num_7d: num(pnl.token_num),
  };
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const res = await sb.from('gmgn_wallet_profiles')
      .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'address' });
    if (res.error) throw new Error(`upsert 失败: ${res.error.message}`);
  }
}

(async () => {
  console.log(`[build-gmgn-wallet-profiles] days=${DAYS} limit=${LIMIT} min-bnb=${MIN_BNB} ` +
    `refresh-days=${REFRESH_DAYS} interval=${INTERVAL_MS}ms commit=${COMMIT}`);
  const t0 = Date.now();
  const { wallets, rowsScanned } = await collectWallets();
  console.log(`[scan] 完成：${rowsScanned} 行 → ${wallets.length} 去重钱包（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  if (wallets.length === 0) { console.log('无钱包，退出'); return; }

  const fresh = await freshSet(wallets);
  const todo = wallets.filter(w => !fresh.has(w));
  console.log(`[inc] 表内新鲜跳过 ${fresh.size}，待拉 ${todo.length}`);

  let ok = 0, fail = 0, empty = 0, banStreak = 0;
  const pending = [];
  const flush = async (force) => {
    if (pending.length === 0) return;
    if (!force && pending.length < UPSERT_BATCH) return;
    if (COMMIT) { await upsert(pending); }
    pending.length = 0;
  };
  for (let i = 0; i < todo.length; i++) {
    const addr = todo[i];
    try {
      const data = await api.getWalletStats('bsc', addr, '7d');
      const row = apiRow(addr, data);
      if (row.created_at_sec == null && row.tags.length === 0 && row.buy_7d == null) empty++;
      pending.push(row);
      await flush(false);
      ok++; banStreak = 0;
    } catch (e) {
      // base-api 已自动重试 ≤5s；重试耗尽仍限流 → 暂停续跑；连续 MAX_BAN 轮停机
      if (e && (e.apiError === 'RATE_LIMIT_EXCEEDED' || e.apiError === 'RATE_LIMIT_BANNED')) {
        banStreak++;
        console.log(`\n[429] ${addr} ${e.apiError}（第 ${banStreak}/${MAX_BAN} 轮）→ 暂停 30s`);
        if (banStreak >= MAX_BAN) {
          await flush(true);
          console.log(`[stop] 连续 ${MAX_BAN} 轮限流，停机。已落 ${ok} 行（fail=${fail}）；` +
            `配额恢复后重跑（增量语义自动续）`);
          process.exit(2);
        }
        await sleep(30000);
        i--; // 重试本钱包
        continue;
      }
      fail++;
      if (fail <= 5 || fail % 50 === 0) console.log(`\n[fail] ${addr}: ${e?.message || e}`);
    }
    if (i % 10 === 0 || i === todo.length - 1) {
      process.stdout.write(`\r[fetch] ${i + 1}/${todo.length} ok=${ok} empty=${empty} fail=${fail}   `);
    }
    await sleep(INTERVAL_MS);
  }
  await flush(true);
  console.log(`\n[done] ${((Date.now() - t0) / 1000).toFixed(0)}s：ok=${ok}（空数据行 ${empty}）fail=${fail}` +
    `${COMMIT ? '' : '  [dry-run 未落表——加 --commit 生效]'}`);
  if (fail > 0 && fail / Math.max(todo.length, 1) > 0.2) {
    console.log('[warn] 失败率 >20%，建议检查网络/配额后重跑（增量语义自动续）');
    process.exit(1);
  }
})().catch(e => { console.error('[fatal]', e); process.exit(1); });
