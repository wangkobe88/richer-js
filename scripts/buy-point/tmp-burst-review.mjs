// ============================================================================
// 临时工具（182 跑）：近期实验 sbw=burst 放行买入票整理
//   · bt-v140/v141/v142/v143 BUY 信号里 cheatCheck.levels.stallBurstWave==1 的票
//   · per-token 盈亏（buy input BNB vs sell output BNB）
//   · burst 波（最后 ≥30s 静默段出口+60s，CD405 口径）钱包构成
//     × 四名单：famous / 跟单(copy) / 聪明钱(smartmoney) / KOL
//   · 锚后 10min 前向最高涨幅（可靠价）
// 输出 /tmp/burst-review.json + 控制台表格
// ============================================================================
import { dbManager } from '../../src/services/dbManager.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { AGGREGATOR_ROUTER_ADDRS } = require('../../src/trading-engine/pre-check/aggregator-routers.js');

const EXPS = [
  { id: '3916fb15-66a1-45f0-bde1-1c145513817a', name: 'bt-v141' },
  { id: '8a7b6b09-e2bc-4773-8393-a696821ff531', name: 'bt-v142' },
  { id: 'e5941591-df22-4434-ae29-1a93ced0f841', name: 'bt-v143' },
];
const STALL_GAP_SEC = 30;   // BURST_STALL_GAP_SEC（CD406 现行）
const WAVE_WIN_SEC = 60;    // CD405 波窗
const BUNDLE_DUST_BNB = 0.03; // CD420 去尘线
const FWD_SEC = 600;        // 锚后 10min 前向

// ---- 名单 ----
const lower = (a) => (a || '').toLowerCase();
function loadList(path, pick) {
  try { return new Set((pick(JSON.parse(fs.readFileSync(path, 'utf8'))) || []).map(lower)); }
  catch (e) { console.warn(`名单缺失 ${path}: ${e.message}`); return new Set(); }
}
const addrOf = (w) => (typeof w === 'string' ? w : w.address);
const famousSet = loadList('config/rosters/famous-copy-wallets.json', j => (j.wallets || []).map(addrOf));
const copySet = loadList('config/rosters/copy-wallet-roster.json', j => (j.wallets || []).map(addrOf));
let smSet = new Set(), kolSet = new Set();
try {
  const acc = JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8'));
  smSet = new Set(Object.keys(acc.sources.smartmoney || {}).map(lower));
  kolSet = new Set(Object.keys(acc.sources.kol || {}).map(lower));
} catch (e) { console.warn('smartmoney-accum 缺失:', e.message); }
console.log(`名单规模: famous=${famousSet.size} copy=${copySet.size} smartmoney=${smSet.size} kol=${kolSet.size}`);

const c = await dbManager.getClient();
async function page(table, eqExp, cols) {
  const out = []; let from = 0;
  while (true) {
    let q = c.from(table).select(cols).eq('experiment_id', eqExp).order('id', { ascending: true }).range(from, from + 999);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

// ---- 1) BUY 信号筛 sbw=burst ----
const sigRows = []; const bgCount = {};
for (const e of EXPS) {
  const sigs = await page('strategy_signals', e.id, 'id,signal_type,token_address,token_symbol,created_at,executed,metadata');
  let buyN = 0, sbwN = 0, sbwBoughtN = 0;
  for (const s of sigs) {
    if (s.signal_type !== 'BUY' && s.signal_type !== 'buy') continue;
    buyN++;
    const lv = s.metadata?.cheatCheck?.levels || {};
    if (lv.stallBurstWave !== 1) continue;
    sbwN++;
    sigRows.push({ exp: e.name, expId: e.id, token: lower(s.token_address), symbol: s.token_symbol, at: s.created_at, cc: s.metadata.cheatCheck });
  }
  bgCount[e.name] = { buySignals: buyN, sbwBurst: sbwN };
  console.log(`${e.name}: BUY=${buyN} sbw=burst=${sbwN}`);
}

// ---- 2) trades 盈亏 ----
const pnl = new Map(); // key exp|token -> {buy,sell,n}
for (const e of EXPS) {
  const trs = await page('trades', e.id, 'id,token_address,trade_direction,input_amount,output_amount');
  for (const t of trs) {
    const k = `${e.name}|${lower(t.token_address)}`;
    const o = pnl.get(k) || { buy: 0, sell: 0, nBuy: 0, nSell: 0 };
    if (t.trade_direction === 'buy') { o.buy += Number(t.input_amount) || 0; o.nBuy++; }
    else { o.sell += Number(t.output_amount) || 0; o.nSell++; }
    pnl.set(k, o);
  }
}

// ---- 3) 去重：per token 代表行（最新实验的成交）----
const byToken = new Map();
for (const r of sigRows) {
  const cur = byToken.get(r.token);
  if (!cur) { byToken.set(r.token, { ...r, exps: [r.exp] }); continue; }
  cur.exps.push(r.exp);
  const rank = { 'bt-v140': 0, 'bt-v141': 1, 'bt-v142': 2, 'bt-v143': 3 };
  const curHas = pnl.get(`${cur.exp}|${cur.token}`)?.nBuy > 0;
  const newHas = pnl.get(`${r.exp}|${r.token}`)?.nBuy > 0;
  if ((newHas && !curHas) || (newHas === curHas && rank[r.exp] > rank[cur.exp])) {
    byToken.set(r.token, { ...r, exps: cur.exps });
  }
}
console.log(`去重后 burst 票: ${byToken.size}`);

// ---- 4) ticks 重放：波构成 + 前向 ----
const t0 = Date.now();
let done = 0;
for (const [token, row] of byToken) {
  done++;
  const anchor = new Date(row.at).getTime();
  const fromIso = new Date(anchor - 30 * 60 * 1000).toISOString();
  const toIso = new Date(anchor + FWD_SEC * 1000).toISOString();
  const { data: ticks, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,sender_address,trader_address,price_bnb,price_outlier')
    .eq('token_address', token)
    .gte('block_time', fromIso).lte('block_time', toIso)
    .order('block_time', { ascending: true }).limit(4000);
  if (error) { row.tickErr = error.message; continue; }
  row.tickN = (ticks || []).length;

  // 生产口径：波族计算域 = block_time <= 锚 的行（waveTicksAll；锚后行只供 fwd）
  const pre = (ticks || []).filter(t => new Date(t.block_time).getTime() <= anchor);

  // 静默段：相邻 block_time gap ≥30s 的最后一个 → 出口=后行时刻
  let exitIdx = -1;
  for (let i = 0; i + 1 < pre.length; i++) {
    const gap = (new Date(pre[i + 1].block_time) - new Date(pre[i].block_time)) / 1000;
    if (gap >= STALL_GAP_SEC) exitIdx = i + 1;
  }
  if (exitIdx < 0) { row.seg = 'no-seg'; }
  else {
    row.seg = 'ok';
    const exitTs = new Date(ticks[exitIdx].block_time).getTime();
    const waveEnd = exitTs + WAVE_WIN_SEC * 1000;
    // 波内构成
    const perWallet = new Map(); // w -> {buy,sell}
    let waveBuy = 0, waveSell = 0;
    for (const t of pre) {
      const ts = new Date(t.block_time).getTime();
      if (ts < exitTs || ts > waveEnd) continue;
      const w = lower(t.sender_address || t.trader_address);
      const isBuy = String(t.trade_type).toLowerCase() === 'buy';
      const amt = Number(t.bnb_amount) || 0;
      const o = perWallet.get(w) || { buy: 0, sell: 0 };
      if (isBuy) { o.buy += amt; waveBuy += amt; }
      else { o.sell += amt; waveSell += amt; }
      perWallet.set(w, o);
    }
    // 捆绑：同块 per-wallet 买额 ≥0.03 尘门、剔路由
    const blockWallets = new Map();
    for (const t of pre) {
      const ts = new Date(t.block_time).getTime();
      if (ts < exitTs || ts > waveEnd) continue;
      if (String(t.trade_type).toLowerCase() !== 'buy' || t.block_number == null) continue;
      const w = lower(t.sender_address || t.trader_address);
      if (AGGREGATOR_ROUTER_ADDRS.has(w)) continue;
      const k = blockWallets.get(t.block_number) || new Map();
      k.set(w, (k.get(w) || 0) + (Number(t.bnb_amount) || 0));
      blockWallets.set(t.block_number, k);
    }
    let bundleMax = 0, adjMax = 0; const blocks = [...blockWallets.keys()].sort((a, b) => a - b);
    const countDusted = m => [...m.values()].filter(v => v >= BUNDLE_DUST_BNB).length;
    for (const b of blocks) bundleMax = Math.max(bundleMax, countDusted(blockWallets.get(b)));
    for (let i = 0; i + 1 < blocks.length; i++) if (blocks[i + 1] - blocks[i] === 1)
      adjMax = Math.max(adjMax, countDusted(blockWallets.get(blocks[i])) + countDusted(blockWallets.get(blocks[i + 1])));
    // 名单命中
    const hit = (set) => { let n = 0, b = 0; for (const [w, o] of perWallet) if (set.has(w) && o.buy > 0) { n++; b += o.buy; } return { n, bnb: +b.toFixed(3) }; };
    // 波内涨幅：出口首可靠价 → 波窗内最高可靠价（burst 本身拉起来的幅度）
    let exitPrice = null, waveMaxPrice = null;
    for (const t of pre) {
      const ts = new Date(t.block_time).getTime();
      if (ts < exitTs || ts > waveEnd) continue;
      const reliable = t.price_outlier == null ? true : t.price_outlier === false;
      if (!reliable || !t.price_bnb) continue;
      const p = Number(t.price_bnb);
      if (exitPrice === null) exitPrice = p;
      waveMaxPrice = waveMaxPrice === null ? p : Math.max(waveMaxPrice, p);
    }
    // 波内大户：单钱包波窗买额 ≥0.15（2026-11-18 用户裁定自 0.2 收紧）
    let whales = 0, whaleBnb = 0;
    for (const [, o] of perWallet) if (o.buy >= 0.15) { whales++; whaleBnb += o.buy; }
    // 压箱额：出口前（≤30min 窗内）累计买入
    let preWaveBuyBnb = 0;
    for (const t of pre) {
      if (new Date(t.block_time).getTime() >= exitTs) break;
      if (String(t.trade_type).toLowerCase() === 'buy') preWaveBuyBnb += Number(t.bnb_amount) || 0;
    }
    row.wave = {
      exitAt: new Date(exitTs).toISOString(),
      buyBnb: +waveBuy.toFixed(3), sellBnb: +waveSell.toFixed(3),
      wallets: perWallet.size, bundleMax, bundleAdj: adjMax,
      famous: hit(famousSet), copy: hit(copySet), sm: hit(smSet), kol: hit(kolSet),
      risePct: exitPrice && waveMaxPrice ? +(((waveMaxPrice / exitPrice) - 1) * 100).toFixed(1) : null,
      avgBuy: perWallet.size ? +(waveBuy / perWallet.size).toFixed(3) : 0,
      whales, whaleBnb: +whaleBnb.toFixed(3),
      preWaveBuyBnb: +preWaveBuyBnb.toFixed(3),
    };
  }
  // 前向：锚后 10min 可靠价 max / 锚时最后可靠价
  let refPrice = null, fwdMax = null;
  for (const t of ticks) {
    const ts = new Date(t.block_time).getTime();
    const reliable = t.price_outlier == null ? true : t.price_outlier === false;
    if (!reliable || !t.price_bnb) continue;
    if (ts <= anchor) refPrice = Number(t.price_bnb);
    else if (ts <= anchor + FWD_SEC * 1000) fwdMax = fwdMax == null ? Number(t.price_bnb) : Math.max(fwdMax, Number(t.price_bnb));
  }
  row.refPrice = refPrice;
  row.fwd10mPct = refPrice && fwdMax ? +(((fwdMax / refPrice) - 1) * 100).toFixed(1) : null;

  // 盈亏（代表实验 + 其它实验参考）
  const rep = pnl.get(`${row.exp}|${token}`) || { buy: 0, sell: 0, nBuy: 0, nSell: 0 };
  row.bought = rep.nBuy > 0;
  row.pnl = { buyBnb: +rep.buy.toFixed(3), sellBnb: +rep.sell.toFixed(3), net: +(rep.sell - rep.buy).toFixed(4), pct: rep.buy > 0 ? +(((rep.sell - rep.buy) / rep.buy) * 100).toFixed(1) : null };
  row.pnlOthers = {};
  for (const ex of row.exps) if (ex !== row.exp) {
    const o = pnl.get(`${ex}|${token}`);
    if (o && o.nBuy > 0) row.pnlOthers[ex] = +(o.sell - o.buy).toFixed(4);
  }
  if (done % 10 === 0) console.log(`  ticks ${done}/${byToken.size} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// ---- 5) 输出 ----
const rows = [...byToken.values()].sort((a, b) => (b.pnl?.net || 0) - (a.pnl?.net || 0));
fs.writeFileSync('/tmp/burst-review.json', JSON.stringify({ bgCount, rows }, null, 1));

const actName = { 0: 'low', 1: 'mid', 2: 'high', 3: 'ultra' };
const fmtHit = h => h ? `${h.n}户/${h.bnb}B` : '-';
console.log('\n=== sbw=burst 票（按净盈亏降序） ===');
console.log(['票', '实验', 'cheat', 'act', '波买B/户数', '捆绑max|adj', 'famous', '跟单', '聪明钱', 'KOL', '买B', '净B', '%', 'fwd10m'].join(' | '));
for (const r of rows) {
  const cc = r.cc || {}; const w = r.wave || {};
  const cheat = cc.grade + (cc.exempt ? `+${cc.exempt.code}` : '');
  console.log([
    `${r.symbol} ${r.token.slice(0, 8)}`, r.exp, cheat,
    actName[cc.levels?.activityLevel ?? -1] ?? cc.levels?.activityLevel,
    r.seg === 'ok' ? `${w.buyBnb}/${w.wallets}` : r.seg,
    r.seg === 'ok' ? `${w.bundleMax}|${w.bundleAdj}` : '-',
    fmtHit(w.famous), fmtHit(w.copy), fmtHit(w.sm), fmtHit(w.kol),
    r.pnl?.buyBnb, r.pnl?.net, r.pnl?.pct != null ? r.pnl.pct + '%' : null,
    r.fwd10mPct != null ? r.fwd10mPct + '%' : null,
  ].join(' | '));
}
const bought = rows.filter(r => r.bought);
const sums = bought.reduce((s, r) => s + (r.pnl?.net || 0), 0);
console.log(`\n买入成交 ${bought.length}/${rows.length} 票；净盈亏 Σ=${sums.toFixed(4)}；胜=${bought.filter(r => (r.pnl?.net || 0) > 0).length}`);
const grp = (f) => { const g = bought.filter(f); const s = g.reduce((x, r) => x + (r.pnl?.net || 0), 0); return `n=${g.length} Σ=${s.toFixed(4)} 胜=${g.filter(r => (r.pnl?.net || 0) > 0).length}`; };
const hasName = r => { const w = r.wave; return w && ((w.famous?.n || 0) + (w.copy?.n || 0) + (w.sm?.n || 0) > 0); };
console.log(`名单命中(famous∪跟单∪聪明钱): ${grp(hasName)}`);
console.log(`名单未命中: ${grp(r => !hasName(r))}`);
console.log('→ /tmp/burst-review.json');
process.exit(0);
