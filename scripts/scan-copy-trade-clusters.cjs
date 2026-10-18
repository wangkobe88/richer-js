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
 *     [--co-token-thr 3] [--min-followers 2] [--commit] \
 *     [--extreme-co 200] [--extreme-ratio 0.8] [--rescue-hops 1] [--no-orphan-rescue]
 * --commit 缺省只打印报告不写名单文件。
 *
 * 孤立强指纹簇救援臂（2026-10-18 0x8e0f6784 镜像对案，默认开）：memberNeedsLeader
 * 剪「双开镜像对」这类无 leader 桥的孤立簇（与 0x77ae5eac 同分钟注资、co=1101 全
 * 等额、96.6% 同步清仓）。救援=无 leader 连通分量含极强指纹边（co>=extreme-co 且
 * even/co 或 sellSync/co >= extreme-ratio）→ 整簇收编。--no-orphan-rescue 关闭
 * （对照臂）。判据实现与单测：scripts/shared/copy-roster-build.js。
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
// 孤立强指纹簇救援臂（2026-10-18 0x8e0f6784 镜像对案）：默认开
const ORPHAN_RESCUE = !argv.includes('--no-orphan-rescue');
const EXTREME_CO = argOf('--extreme-co', 200);
const EXTREME_RATIO = argOf('--extreme-ratio', 0.8);
const RESCUE_HOPS = argOf('--rescue-hops', 1);
const COMMIT = argv.includes('--commit');
const MIN_TICK_BNB = 0.001;   // collector 尘 tick 口径（不进因子域）
const PAGE = 1000;            // PostgREST max-rows 上限（keyset 分页红线）

// 锚钱包（用户指定，未命中=判据失准）+ FLY 镜像（22% 控盘的真跟单者，档位掉它=因子瞎）
const ANCHORS = [
  '0xbf004bff64725914ee36d03b87d6965b0ced4903',
  '0xa83b73f5644cde337b61da79589f10ea15548811',
  '0xd6ab395c3aa21499e50e13bc87d134f2c54e0244',
];
const FLY_TOKEN = '0x4ec2c14230a818fcb8947c3999f7a4a872437777';   // 40 位（trades 原样核验；抄录一位=全空假象 2026-10-16 事故）
const ROSTER_PATH = path.join(__dirname, '..', 'config', 'rosters', 'copy-wallet-roster.json');
// pair 统计缓存（2026-10-16 用户裁定：取数尽量有缓存）——参数无关中间产物，
// dump 一次后调参/矩阵全走本地零网络。含 meta（days/params/tick 数/FLY 买家集）
const PAIRS_CACHE = path.join(__dirname, '..', 'data', 'offline-cache', 'copy-trade-pairs.json.gz');
const FROM_CACHE = argv.includes('--from-cache');

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

// ── 判据 → 名单（scripts/shared/copy-roster-build.js 共享纯函数：边级过滤参数化
//    + 孤立强指纹簇救援臂；2026-10-18 0x8e0f6784 镜像对案抽出，单测锁定真值表）──
const { buildRoster } = require('./shared/copy-roster-build');

// ── pair 统计缓存读写（zlib gzip JSON；meta 携带生成参数与 FLY 买家集）──
function dumpPairs(pairs, rows, meta) {
  const zlib = require('zlib');
  const arr = [];
  for (const [k, st] of pairs) arr.push({ k, ...st });
  const flyBuyers = [...new Set(rows.filter(r => r.t === FLY_TOKEN && r.buy).map(r => r.w))];
  meta.flyBuyers = flyBuyers;   // 回写调用方 meta，fresh 路径与 cache 路径同形
  const payload = JSON.stringify({ meta: { ...meta, pairCount: arr.length }, pairs: arr });
  fs.mkdirSync(path.dirname(PAIRS_CACHE), { recursive: true });
  fs.writeFileSync(PAIRS_CACHE, zlib.gzipSync(payload));
  console.log(`[缓存] pair 统计 dump → ${PAIRS_CACHE}（${arr.length.toLocaleString()} 对，${(fs.statSync(PAIRS_CACHE).size / 1e6).toFixed(1)} MB）`);
}

function loadPairsCache() {
  const zlib = require('zlib');
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAIRS_CACHE)).toString('utf8'));
  const pairs = new Map();
  for (const p of parsed.pairs) {
    const { k, ...st } = p;
    pairs.set(k, st);
  }
  console.log(`[缓存] 读回 pair 统计 ${pairs.size.toLocaleString()} 对（meta=${JSON.stringify({ ...parsed.meta, flyBuyers: parsed.meta.flyBuyers?.length + ' 个 FLY 买家' })}）`);
  return { pairs, meta: parsed.meta };
}

// ── 报告（锚检查 + FLY 簇检查 + top 样本）──
function report(wallets, flyBuyerSet) {
  const inRoster = new Set(wallets.map(w => w.address));
  let anchorOk = true;
  for (const a of ANCHORS) {
    if (!wallets.some(w => w.address === a)) anchorOk = false;
  }
  const flyHits = [...flyBuyerSet].filter(w => inRoster.has(w));
  return { anchorOk, flyBuyers: flyBuyerSet.size, flyHits };
}

function fullReport(wallets, flyBuyerSet) {
  const r = report(wallets, flyBuyerSet);
  console.log(`\n════════ 名单 ${wallets.length} 钱包（leader ${wallets.filter(w => w.role === 'leader').length} / member ${wallets.filter(w => w.role === 'member').length}）════════`);
  console.log('\n[锚检查]（未命中=判据失准，调参重跑，绝不 --commit）');
  for (const a of ANCHORS) {
    const hit = wallets.find(w => w.address === a);
    console.log(`  ${a} ${hit ? '✅ role=' + hit.role + ' followers=' + hit.followers + ' co=' + hit.coTokens + ' 卖同步=' + hit.syncedSells + ' 等额=' + hit.evenBuys : '❌ 未命中'}`);
  }
  console.log(`\n[FLY 簇检查] 买家 ${r.flyBuyers}，名单命中 ${r.flyHits.length}${r.flyHits.length ? '：' + r.flyHits.join(', ') : ''}`);
  console.log('\n[Top 强度样本 20]');
  for (const w of wallets.slice(0, 20)) {
    console.log(`  ${w.role.padEnd(6)} followers=${String(w.followers).padStart(3)} co=${String(w.coTokens).padStart(3)} 卖同步=${String(w.syncedSells).padStart(3)} 等额=${String(w.evenBuys).padStart(3)} ${w.address}`);
  }
  return r;
}

(async () => {
  console.log(`[参数] days=${DAYS} minTokens=${MIN_TOKENS} blockWin=${BLOCK_WIN} sellWin=${SELL_WIN} commit=${COMMIT}${FROM_CACHE ? '（读缓存，取数参数以缓存 meta 为准）' : ''}`);
  let pairs, fetchMeta;
  if (FROM_CACHE) {
    ({ pairs, meta: fetchMeta } = loadPairsCache());
  } else {
    const rows = await fetchAll();
    if (!rows.length) { console.error('空数据，中止'); process.exit(1); }
    const active = pass1(rows);
    ({ pairs } = pass2(rows, active));
    fetchMeta = { days: DAYS, minTokens: MIN_TOKENS, blockWin: BLOCK_WIN, sellWin: SELL_WIN };
    dumpPairs(pairs, rows, fetchMeta);
  }
  const flyBuyerSet = new Set(fetchMeta.flyBuyers);

  // ── 定标矩阵 v3（目标：名单收敛到 10 几~几十「著名钱包+其跟单群」档）。
  //    v1 教训：co>=3 宽判据 11866 名单/FLY 28/34 买家命中=同场抢盘 bot 污染；
  //    v2 教训：member 无挂靠门时 minFollowers 缩不动名单（1565 恒定）；co 500 掉锚
  //    （0xa83b73f5 co=245）。v3=memberNeedsLeader 开 + minFollowers 真正起效。
  //    救援臂列（rescue）= 开/关两跑差值：孤立强指纹簇增量（0x8e0f 镜像对案）──
  const rescueParams = { orphanRescue: ORPHAN_RESCUE, extremeCo: EXTREME_CO, extremeRatio: EXTREME_RATIO, rescueHops: RESCUE_HOPS };
  const MATRIX = [];
  for (const coThr of [50, 100, 200, 240]) {
    for (const [sellSyncThr, evenThr] of [[0, 0], [5, 10], [20, 40], [100, 200]]) {
      for (const minFollowers of [2, 5, 10, 20]) {
        const on = buildRoster(pairs, { coThr, sellSyncThr, evenThr, minFollowers, memberNeedsLeader: true, ...rescueParams });
        const off = buildRoster(pairs, { coThr, sellSyncThr, evenThr, minFollowers, memberNeedsLeader: true, orphanRescue: false });
        const { anchorOk, flyHits } = report(on.wallets, flyBuyerSet);
        MATRIX.push({ coThr, sellSyncThr, evenThr, minFollowers, size: on.wallets.length,
          leaders: on.wallets.filter(w => w.role === 'leader').length, anchorOk, flyHits: flyHits.length,
          rescue: on.wallets.length - off.wallets.length });
      }
    }
  }
  console.log('\n════════ 定标矩阵 v3（memberNeedsLeader=on）════════');
  console.log('coThr  sync/even  minFol  名单   leader  锚   FLY命中  救援+');
  for (const m of MATRIX) {
    console.log(`${String(m.coThr).padStart(5)}  ${String(m.sellSyncThr).padStart(3)}/${String(m.evenThr).padStart(3)}   ${String(m.minFollowers).padStart(5)}  ${String(m.size).padStart(5)}  ${String(m.leaders).padStart(5)}  ${m.anchorOk ? '✅' : '❌'}  ${String(m.flyHits).padStart(5)}  ${m.rescue ? '+' + m.rescue : '  0'}`);
  }

  // ── 终版参数（CLI 覆盖或矩阵选档后写死于此）跑正式名单 ──
  const finalParams = { coThr: CO_TOKEN_THR, sellSyncThr: argOf('--sell-sync-thr', 0), evenThr: argOf('--even-thr', 0),
    minFollowers: MIN_FOLLOWERS, memberNeedsLeader: argv.includes('--member-needs-leader'), ...rescueParams };
  console.log(`\n[终版] coThr=${finalParams.coThr} sellSyncThr=${finalParams.sellSyncThr} evenThr=${finalParams.evenThr} minFollowers=${finalParams.minFollowers} memberNeedsLeader=${finalParams.memberNeedsLeader} orphanRescue=${finalParams.orphanRescue} extremeCo=${finalParams.extremeCo} extremeRatio=${finalParams.extremeRatio}`);
  const { wallets, rescued } = buildRoster(pairs, finalParams);
  if (rescued.size) {
    console.log(`\n[救援臂收编] ${rescued.size} 个（孤立强指纹簇全体成员）：`);
    for (const w of wallets.filter(x => rescued.has(x.address))) {
      console.log(`  co=${String(w.coTokens).padStart(4)} 卖同步=${String(w.syncedSells).padStart(4)} 等额=${String(w.evenBuys).padStart(4)} ${w.address}`);
    }
  }
  const r = fullReport(wallets, flyBuyerSet);
  if (!COMMIT) { console.log('\n（dry-run：未写名单文件。矩阵选档后带参数加 --commit 重跑）'); process.exit(0); }
  if (!r.anchorOk) { console.error('\n锚检查失败——拒绝写名单，调参重跑'); process.exit(1); }
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    params: { days: fetchMeta.days, minTokens: fetchMeta.minTokens, blockWin: fetchMeta.blockWin, sellWin: fetchMeta.sellWin,
      coTokenThr: finalParams.coThr, sellSyncThr: finalParams.sellSyncThr, evenThr: finalParams.evenThr,
      minFollowers: finalParams.minFollowers, memberNeedsLeader: finalParams.memberNeedsLeader,
      orphanRescue: finalParams.orphanRescue, extremeCo: finalParams.extremeCo, extremeRatio: finalParams.extremeRatio },
    wallets,
  };
  fs.mkdirSync(path.dirname(ROSTER_PATH), { recursive: true });
  fs.writeFileSync(ROSTER_PATH, JSON.stringify(out, null, 2));
  console.log(`\n✅ 名单写入 ${ROSTER_PATH}（${wallets.length} 钱包）——git push 后重启实验进程生效`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
