#!/usr/bin/env node
/**
 * build-gmgn-wallet-profiles — GMGN 钱包画像离线批量回填（gmgn_wallet_profiles 表）
 * （2026-10-18 GMGN wallet_stats 调研接入；2026-11-19 重设计：
 *   ① 计数列 7d→30d——张雪电摩 pump 作弊案定标：56 参与钱包 30d 平均 293 票、
 *     bot 标签浓度 36%、稳定小亏打工形状；7d 对间歇作业号会误判死钱包（案内
 *     对倒主力 11-03 同秒批次停机，7d 窗口零交易）。stats_period 列留痕口径。
 *   ② 活跃度优先：按「近 N 天独立 token 数（跨盘广度）」降序抓取 top --limit
 *     （--rank-by tokens|trades|bnb 可换）——配额烧在未来查表命中率最高的钱包上。
 *   ③ buy+sell 都扫（只卖不买的号如案内 0xee47c2d4 买23/卖551 不漏）。
 *   ④ 修 upsert 不写 fetched_at 的增量失效 bug（冲突更新时 DEFAULT 列不动→
 *     反复烧配额）；fetch_count 由读表维护自增。）
 *
 * 数据源：近 N 天 wss_price_ticks（wallet = sender||trader COALESCE，与 FA/TPA
 * 口径一致；bnb ≥ min-bnb 过滤尘埃）→ 活跃度排序 → GMGNPortfolioAPI.getWalletStats
 * 单钱包端点（数组参数实测只回第一个）→ upsert 表。
 *
 * 增量语义：表内 fetched_at 新于 --refresh-days（默认 7d）跳过——tags/created_at
 * 是不可变字段，动态计数消费侧用容差容忍陈旧。GMGN 无记录的空数据行也落表
 * （tags=[]）——表 miss ≠ 无记录，空行是「已确认无记录」结论，全新钱包反复
 * 出现不重复烧配额（7777 sybil 场景关键）。
 *
 * ⚠️ 红线：重查询只在 182 跑（本地 VPN 连 Supabase 必超时）；service key
 *   （dbManager.getClient()——anon 被 RLS 静默过滤）。
 * ⚠️ 表须先建：migrations/create_gmgn_wallet_profiles.sql（Supabase SQL editor）。
 * ⚠️ 429 感知：base-api 自动重试 ≤5s；重试耗尽仍 429 → 暂停 30s 续跑，
 *   连续 --max-ban（默认 5）轮 → 停机退出非零（人工评估配额）。
 *
 * 用法（182）：
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14                    # dry-run（扫描统计+top 概览，不拉 API）
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14 --commit           # 回填落表（dry-run 概览后逐钱包拉）
 *   node scripts/build-gmgn-wallet-profiles.cjs --days 14 --limit 1000 --rank-by tokens --min-bnb 0.01 --commit
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
const LIMIT = parseInt(arg('limit', '1000'), 10);
const MIN_BNB = parseFloat(arg('min-bnb', '0.01'));
const RANK_BY = String(arg('rank-by', 'tokens'));   // tokens | trades | bnb
const PERIOD = String(arg('period', '30d'));        // GMGN stats 窗口（表 stats_period 留痕）
const INTERVAL_MS = parseInt(arg('interval-ms', '400'), 10);
const REFRESH_DAYS = parseFloat(arg('refresh-days', '7'));
const MAX_BAN = parseInt(arg('max-ban', '5'), 10);
const COMMIT = arg('commit', false) === true || arg('commit', false) === 'true';
for (const [n, v] of [['days', DAYS], ['limit', LIMIT], ['min-bnb', MIN_BNB], ['interval-ms', INTERVAL_MS], ['refresh-days', REFRESH_DAYS]]) {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${n} 非法: ${arg(n)}`);
}
if (!['tokens', 'trades', 'bnb'].includes(RANK_BY)) throw new Error(`--rank-by 非法: ${RANK_BY}`);
if (!['7d', '30d'].includes(PERIOD)) throw new Error(`--period 非法: ${PERIOD}`);
if (!process.env.GMGN_API_KEY) throw new Error('GMGN_API_KEY 缺失（config/.env）');

const { dbManager } = require(path.join(__dirname, '..', 'src', 'services', 'dbManager'));
const { GMGNPortfolioAPI } = require(path.join(__dirname, '..', 'src', 'core', 'gmgn-api'));

const sb = dbManager.getClient();
const api = new GMGNPortfolioAPI({ apiKey: process.env.GMGN_API_KEY, timeout: 8000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const walletOf = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

// ── 阶段 1：近 N 天钱包活跃度统计（id keyset 升序分页全扫；buy+sell 都计）──
// 返回 Map<addr, {trades, bnb, tokens:Set}>（tokens=独立票数=跨盘广度）
async function collectWallets() {
  const since = new Date(Date.now() - DAYS * 86400 * 1000).toISOString();
  const stat = new Map();
  let afterId = null, rows = 0, done = false;
  while (!done) {
    let q = sb.from('wss_price_ticks')
      .select('id,token_address,sender_address,trader_address,bnb_amount')
      .gt('block_time', since)
      .in('trade_type', ['buy', 'sell'])
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
      const tok = String(r.token_address || '').toLowerCase();
      if (!w || !tok) continue;
      let e = stat.get(w);
      if (!e) { e = { trades: 0, bnb: 0, tokens: new Set() }; stat.set(w, e); }
      e.trades++;
      e.bnb += Number(r.bnb_amount);
      e.tokens.add(tok);
      afterId = r.id;
    }
    if (page.length < PAGE_SIZE) done = true;
    await sleep(DB_SLEEP_MS);
    process.stdout.write(`\r[scan] rows=${rows} wallets=${stat.size}   `);
  }
  process.stdout.write('\n');
  return { stat, rowsScanned: rows };
}

// ── 阶段 2：表内既有行（全量读目标行，内存分新鲜/陈旧；顺带读 fetch_count 供自增）──
// 返回 { fresh:Set, prevCount:Map }——fresh=跳过集；prevCount=拉取前 fetch_count（自增用）
async function existingRows(wallets) {
  const freshSince = new Date(Date.now() - REFRESH_DAYS * 86400 * 1000).toISOString();
  const fresh = new Set();
  const prevCount = new Map();
  for (let i = 0; i < wallets.length; i += 50) {
    const batch = wallets.slice(i, i + 50);
    const res = await sb.from('gmgn_wallet_profiles')
      .select('address,fetched_at,fetch_count').in('address', batch);
    if (res.error) {
      if (/relation .* does not exist|Could not find the table/i.test(res.error.message || '')) {
        throw new Error('gmgn_wallet_profiles 表不存在——先在 Supabase SQL editor 执行 migrations/create_gmgn_wallet_profiles.sql');
      }
      throw new Error(`profiles 表读失败: ${res.error.message}`);
    }
    for (const r of res.data || []) {
      const a = String(r.address).toLowerCase();
      prevCount.set(a, r.fetch_count || 0);
      if (r.fetched_at && new Date(r.fetched_at).getTime() > new Date(freshSince).getTime()) fresh.add(a);
    }
  }
  return { fresh, prevCount };
}

// ── 阶段 3：逐钱包拉取 + upsert ──
function apiRow(addr, data, prevCount) {
  const common = (data && typeof data === 'object' ? data.common : null) || {};
  const pnl = (data && typeof data === 'object' ? data.pnl_stat : null) || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    address: addr,
    tags: Array.isArray(common.tags) ? common.tags.map(String) : [],
    created_at_sec: num(common.created_at),
    fund_from_address: common.fund_from_address ? String(common.fund_from_address).toLowerCase() : null,
    stats_period: PERIOD,
    buy_count: num(data?.buy),
    sell_count: num(data?.sell),
    token_num: num(pnl.token_num),
    realized_profit: num(data?.realized_profit),
    winrate: num(pnl.winrate),
    last_active_sec: num(data?.last_timestamp),
    native_balance_bnb: num(data?.native_balance_bnb),
    // ★显式写 fetched_at：upsert 冲突更新不走 DEFAULT，缺列=首插值永不过期（增量失效 bug）
    fetched_at: new Date().toISOString(),
    fetch_count: (prevCount || 0) + 1,
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
    `rank-by=${RANK_BY} period=${PERIOD} refresh-days=${REFRESH_DAYS} interval=${INTERVAL_MS}ms commit=${COMMIT}`);
  const t0 = Date.now();
  const { stat, rowsScanned } = await collectWallets();
  console.log(`[scan] 完成：${rowsScanned} 行 → ${stat.size} 去重钱包（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  if (stat.size === 0) { console.log('无钱包，退出'); return; }

  // 活跃度排序：跨盘广度（tokens）> 笔数 > 成交额
  const rankKey = RANK_BY === 'tokens' ? (e) => e[1].tokens.size
    : RANK_BY === 'trades' ? (e) => e[1].trades
      : (e) => e[1].bnb;
  const ranked = [...stat.entries()].sort((a, b) => rankKey(b) - rankKey(a));
  console.log(`[rank] ${RANK_BY} 降序 top20 概览：`);
  for (const [w, e] of ranked.slice(0, 20)) {
    console.log(`   ${w} 票${e.tokens.size} 笔${e.trades} ${e.bnb.toFixed(1)}B`);
  }
  const targets = ranked.slice(0, LIMIT).map(([w]) => w);
  const covered = targets.reduce((s, w) => s + stat.get(w).bnb, 0);
  const totalBnb = [...stat.values()].reduce((s, e) => s + e.bnb, 0);
  console.log(`[rank] 抓取面=${targets.length}/${stat.size} 钱包，覆盖窗内成交额 ${(covered / totalBnb * 100).toFixed(1)}%`);
  if (!COMMIT) { console.log('[dry-run] 到此为止——加 --commit 逐钱包拉 GMGN 并落表'); return; }

  const { fresh, prevCount } = await existingRows(targets);
  const todo = targets.filter(w => !fresh.has(w));
  console.log(`[inc] 表内新鲜跳过 ${targets.length - todo.length}，待拉 ${todo.length}`);

  let ok = 0, fail = 0, empty = 0, banStreak = 0;
  const pending = [];
  const flush = async (force) => {
    if (pending.length === 0) return;
    if (!force && pending.length < UPSERT_BATCH) return;
    await upsert(pending);
    pending.length = 0;
  };
  for (let i = 0; i < todo.length; i++) {
    const addr = todo[i];
    try {
      const data = await api.getWalletStats('bsc', addr, PERIOD);
      const row = apiRow(addr, data, prevCount.get(addr) || 0);
      if (row.created_at_sec == null && row.tags.length === 0 && row.buy_count == null) empty++;
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
