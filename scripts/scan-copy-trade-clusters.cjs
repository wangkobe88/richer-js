#!/usr/bin/env node
/**
 * 跟单簇钱包扫描 → config/rosters/copy-wallet-roster.json（2026-10-16 FLY 案用户正式方案）。
 *
 * 识别「持续有跟单、同步买/卖」的钱包（协同簇），供 FA 因子
 * maxCopyWalletHolderCircPct（名单钱包单钱包最大净持仓÷流通，≥20% 拒）消费。
 *
 * 判据（pair 级）：两活跃钱包在 >= co-token-thr 个不同 token 上「首买 block 差
 * <= block-win」= 跟单边；双方在该 token 的清仓卖 block 差 <= sell-win 计同步卖
 * （强度展示）；等额买（金额比 >= 0.8）计镜像对（强度展示）。leader = 跟单边
 * 邻居数 >= min-followers；member = 边对端。名单 = 全部边端点（leader+member
 * 都收——FLY 镜像钱包自身持 22% 流通也必须被因子捕捉，用户裁定「高跟单钱包
 * = 协同簇全体」）。
 *
 * 两遍内存聚合（防 O(k²) 爆炸）：Pass 1 per-wallet distinct token 数预筛活跃
 * 钱包（>= min-tokens，0xbf00 霸榜必过）；Pass 2 只对活跃钱包建首买索引+清仓
 * 索引配对。
 *
 * 在 182 跑（红线：重查询不去本地）：
 *   NODE_OPTIONS=--max-old-space-size=12288 node scripts/scan-copy-trade-clusters.cjs \
 *     [--days 14] [--min-tokens 5] [--block-win 5] [--sell-win 8] \
 *     [--co-token-thr 3] [--min-followers 2] [--commit]
 * --commit 缺省只打印报告不写名单文件。
 *
 * 名单维护口径（sniper 静态快照同款）：182 重跑扫描 --commit → git push →
 * 重启实验进程生效。锚检查失败（0xbf00/0xa83b73f5 未命中）= 判据失准，
 * 调参重跑，绝不 --commit 硬写。
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

// ── 参数 ──
const argv = process.argv.slice(2);
const argOf = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt; };
const DAYS = argOf('--days', 14);
const MIN_TOKENS = argOf('--min-tokens', 5);
const BLOCK_WIN = argOf('--block-win', 5);
const SELL_WIN = argOf('--sell-win', 8);
const CO_TOKEN_THR = argOf('--co-token-thr', 3);
const MIN_FOLLOWERS = argOf('--min-followers', 2);
const COMMIT = argv.includes('--commit');
const MIN_TICK_BNB = 0.001;   // collector 尘 tick 口径（不进因子域）
const PAGE = 1000;            // PostgREST max-rows 上限（keyset 分页红线）

// 锚钱包（用户指定，未命中=判据失准）
const ANCHORS = [
  '0xbf004bff64725914ee36d03b87d6965b0ced4903',
  '0xa83b73f5644cde337b61da79589f10ea15548811',
];
const FLY_TOKEN = '0x4ec2c14230a818fcb8947c3999f7a4a872437777';   // 40 位（trades 原样核验；抄录一位=全空假象 2026-10-16 事故）
const ROSTER_PATH = path.join(__dirname, '..', 'config', 'rosters', 'copy-wallet-roster.json');

const sinceMs = Date.now() - DAYS * 86400e3;
const sinceIso = new Date(sinceMs).toISOString();

// ── 拉取（dbManager service key 红线；id keyset；时间条件形状探测失败退全表内存过滤）──
const COLS = 'id, token_address, trade_type, trader_address, sender_address, bnb_amount, block_number, block_time';
let fetchTotal = 0;

async function fetchPage(lastId, withTimeFilter) {
  let q = dbManager.getClient().from('wss_price_ticks').select(COLS).gt('id', lastId)
    .order('id', { ascending: true }).limit(PAGE);
  if (withTimeFilter) q = q.gte('block_time', sinceIso);
  return q;
}

async function fetchAll() {
  // 探测：带时间条件的形状是否可用（gte+order(id) 可能 planner 弃索引超时——实测为准）
  let withTimeFilter = true;
  try {
    const probe = await Promise.race([
      fetchPage(0, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('shape-probe-timeout')), 30000)),
    ]);
    if (probe.error) throw new Error(probe.error.message);
  } catch (e) {
    console.log(`[形状] gte(block_time) 形状不可用（${e.message}），退全表 id keyset + 内存时间过滤`);
    withTimeFilter = false;
  }
  const rows = [];
  let lastId = 0, pages = 0, t0 = Date.now();
  while (true) {
    const r = await fetchPage(lastId, withTimeFilter);
    if (r.error) throw new Error(r.error.message);
    const data = r.data || [];
    for (const row of data) {
      const bnb = Number(row.bnb_amount);
      if (!(bnb >= MIN_TICK_BNB)) continue;                       // 尘 tick 不进因子域（与 collector 同口径）
      if (!withTimeFilter) {
        const bt = new Date(row.block_time).getTime();
        if (!(bt >= sinceMs)) continue;                           // 内存时间窗
      }
      const wallet = (row.sender_address || row.trader_address || '').toLowerCase();
      if (!wallet) continue;
      rows.push({
        w: wallet, t: row.token_address.toLowerCase(),
        buy: row.trade_type === 'buy' ? 1 : 0,
        bnb, blk: row.block_number,
      });
    }
    pages++; fetchTotal += data.length;
    lastId = data[data.length - 1].id;
    if (pages % 500 === 0) console.log(`[拉取] ${fetchTotal} 行（内存 ${rows.length}），${((Date.now() - t0) / 60000).toFixed(1)} min`);
    if (data.length < PAGE) break;
  }
  console.log(`[拉取] 完成：DB ${fetchTotal} 行 → 内存 ${rows.length} 行（${(rows.length / 1e4).toFixed(1)} 万，${((Date.now() - t0) / 60000).toFixed(1)} min）`);
  return rows;
}

// ── Pass 1：per-wallet distinct token → 活跃钱包预筛 ──
function pass1(rows) {
  const walletTokens = new Map();   // wallet → Set<token>
  for (const r of rows) {
    let s = walletTokens.get(r.w);
    if (!s) { s = new Set(); walletTokens.set(r.w, s); }
    s.add(r.t);
  }
  const active = new Set();
  for (const [w, s] of walletTokens) if (s.size >= MIN_TOKENS) active.add(w);
  console.log(`[Pass1] 钱包 ${walletTokens.size} → 活跃（>= ${MIN_TOKENS} token）${active.size}`);
  return active;
}

// ── Pass 2：活跃钱包的首买索引 + 清仓索引 → pair 共现 ──
function pass2(rows, active) {
  const firstBuy = new Map();   // token → Map<wallet, {blk, bnb}>（每钱包该 token 首笔买）
  const lastSell = new Map();   // token → Map<wallet, blk>（每钱包该 token 末笔卖≈清仓）
  for (const r of rows) {
    if (!active.has(r.w)) continue;
    if (r.buy) {
      let m = firstBuy.get(r.t);
      if (!m) { m = new Map(); firstBuy.set(r.t, m); }
      const cur = m.get(r.w);
      if (!cur || r.blk < cur.blk) m.set(r.w, { blk: r.blk, bnb: r.bnb });
    } else {
      let m = lastSell.get(r.t);
      if (!m) { m = new Map(); lastSell.set(r.t, m); }
      const cur = m.get(r.w);
      if (!cur || r.blk > cur) m.set(r.w, r.blk);
    }
  }
  // pair 共现：per token 首买按 block 排序滑窗两两（窗内 O(k²)，活跃钱包域 k 小）
  const pairs = new Map();      // 'w1|w2'（字典序）→ {co, sellSync, even, first: Map/计数}
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  let pairEval = 0;
  for (const [tok, m] of firstBuy) {
    const evs = [...m.entries()].map(([w, v]) => ({ w, ...v }))
      .sort((a, b) => a.blk - b.blk);
    const sells = lastSell.get(tok);
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length && evs[j].blk - evs[i].blk <= BLOCK_WIN; j++) {
        pairEval++;
        const a = evs[i], b = evs[j];
        const k = pairKey(a.w, b.w);
        let st = pairs.get(k);
        if (!st) { st = { co: 0, sellSync: 0, even: 0, laterA: 0, laterB: 0 }; pairs.set(k, st); }
        st.co++;
        // 方向：a 先买（blk 小）；等 block 同步不计方向
        if (a.blk < b.blk) st.laterB++; else if (b.blk < a.blk) st.laterA++;
        // 等额镜像（金额比 >= 0.8）
        const hi = Math.max(a.bnb, b.bnb), lo = Math.min(a.bnb, b.bnb);
        if (lo > 0 && hi / lo <= 1.25) st.even++;
        // 同步清仓
        if (sells) {
          const sa = sells.get(a.w), sb = sells.get(b.w);
          if (sa != null && sb != null && Math.abs(sa - sb) <= SELL_WIN) st.sellSync++;
        }
      }
    }
  }
  console.log(`[Pass2] token 首买索引 ${firstBuy.size}，配对评估 ${pairEval.toLocaleString()} 次，pair 总数 ${pairs.size.toLocaleString()}`);
  return { pairs, firstBuy };
}

// ── 判据 → 名单 ──
function buildRoster(pairs) {
  const edges = new Map();   // wallet → {neighbors:Set, coMax, sellSyncSum, evenSum, later}
  for (const [k, st] of pairs) {
    if (st.co < CO_TOKEN_THR) continue;
    const [w1, w2] = k.split('|');
    for (const [me, myLater] of [[w1, st.laterA], [w2, st.laterB]]) {
      let e = edges.get(me);
      if (!e) { e = { neighbors: new Set(), coMax: 0, sellSyncSum: 0, evenSum: 0, laterSum: 0 }; edges.set(me, e); }
      e.neighbors.add(w1 === me ? w2 : w1);
      e.coMax = Math.max(e.coMax, st.co);
      e.sellSyncSum += st.sellSync;
      e.evenSum += st.even;
      e.laterSum += myLater;   // 我在该 pair 中后买的 token 数（0=常先手/镜像同步）
    }
  }
  const wallets = [];
  for (const [w, e] of edges) {
    wallets.push({
      address: w,
      role: e.neighbors.size >= MIN_FOLLOWERS ? 'leader' : 'member',
      followers: e.neighbors.size,
      coTokens: e.coMax,
      syncedSells: e.sellSyncSum,
      evenBuys: e.evenSum,
      laterBuys: e.laterSum,
    });
  }
  wallets.sort((a, b) => b.followers - a.followers || b.coTokens - a.coTokens);
  return { edges, wallets };
}

// ── 报告（锚检查 + FLY 簇检查 + top 样本）──
function report(wallets, rows) {
  const inRoster = new Set(wallets.map(w => w.address));
  console.log(`\n════════ 名单 ${wallets.length} 钱包（leader ${wallets.filter(w => w.role === 'leader').length} / member ${wallets.filter(w => w.role === 'member').length}）════════`);
  console.log('\n[锚检查]（未命中=判据失准，调参重跑，绝不 --commit）');
  let anchorOk = true;
  for (const a of ANCHORS) {
    const hit = wallets.find(w => w.address === a);
    console.log(`  ${a} ${hit ? '✅ leader=' + hit.role + ' followers=' + hit.followers + ' co=' + hit.coTokens : '❌ 未命中'}`);
    if (!hit) anchorOk = false;
  }
  console.log('\n[FLY 簇检查]（0x4ec2…37777 买家中名单命中）');
  const flyBuyers = new Set(rows.filter(r => r.t === FLY_TOKEN && r.buy).map(r => r.w));
  const flyHits = [...flyBuyers].filter(w => inRoster.has(w));
  console.log(`  FLY 买家 ${flyBuyers.size}，名单命中 ${flyHits.length}${flyHits.length ? '：' + flyHits.join(', ') : ''}`);
  console.log('\n[Top 强度样本 20]');
  for (const w of wallets.slice(0, 20)) {
    console.log(`  ${w.role.padEnd(6)} followers=${String(w.followers).padStart(3)} co=${String(w.coTokens).padStart(3)} 卖同步=${String(w.syncedSells).padStart(3)} 等额=${String(w.evenBuys).padStart(3)} ${w.address}`);
  }
  return anchorOk;
}

(async () => {
  console.log(`[参数] days=${DAYS} minTokens=${MIN_TOKENS} blockWin=${BLOCK_WIN} sellWin=${SELL_WIN} coTokenThr=${CO_TOKEN_THR} minFollowers=${MIN_FOLLOWERS} commit=${COMMIT}`);
  const rows = await fetchAll();
  if (!rows.length) { console.error('空数据，中止'); process.exit(1); }
  const active = pass1(rows);
  const { pairs } = pass2(rows, active);
  const { wallets } = buildRoster(pairs);
  const anchorOk = report(wallets, rows);
  if (!COMMIT) { console.log('\n（dry-run：未写名单文件。确认报告后加 --commit 重跑）'); process.exit(0); }
  if (!anchorOk) { console.error('\n锚检查失败——拒绝写名单，调参重跑'); process.exit(1); }
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    params: { days: DAYS, minTokens: MIN_TOKENS, blockWin: BLOCK_WIN, sellWin: SELL_WIN, coTokenThr: CO_TOKEN_THR, minFollowers: MIN_FOLLOWERS },
    wallets,
  };
  fs.mkdirSync(path.dirname(ROSTER_PATH), { recursive: true });
  fs.writeFileSync(ROSTER_PATH, JSON.stringify(out, null, 2));
  console.log(`\n✅ 名单写入 ${ROSTER_PATH}（${wallets.length} 钱包）——git push 后重启实验进程生效`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
