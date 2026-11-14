// burst 捆绑买入（拉高收割候选）取证：named 票明细 + 四基底 sbw 语境分带扫描（182 跑）
// 形状假设（用户裁定方向）：burst 波内大量捆绑买入（同块多钱包组织性买）=拉高收割不给入场机会 → 候选拒绝臂
import fs from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const NAMED = [
  { sym: '比格多栋', addr: '0x5fdb483505a6654360191afac176e5ac91997777', anchor: '2026-11-02T19:56:05.180Z' },
  { sym: 'Crypto Winter', addr: '0xa3efddca9d8a138ace3548b8f70118a1c4767777', anchor: '2026-11-03T03:00:35.367Z' },
];
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const c = await dbManager.getClient();
const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (n) => (n == null ? 'null' : (+n).toFixed(4));

// 锚窗（lte anchor 最近 3000 行，链上序）；afterIso 给锚后窗
async function pullTicks(token, anchorIso, afterSec = 0) {
  if (!afterSec) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('block_time,block_number,trade_type,bnb_amount,trader_address,sender_address')
      .eq('token_address', token).lte('block_time', anchorIso)
      .order('id', { ascending: false }).limit(3000);
    if (error) throw new Error('ticks: ' + error.message);
    return (data || []).reverse().map(mapRow);
  }
  const to = new Date(ts(anchorIso) * 1000 + afterSec * 1000).toISOString();
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,trader_address,sender_address')
    .eq('token_address', token).gte('block_time', anchorIso).lte('block_time', to)
    .order('id', { ascending: true }).limit(3000);
  if (error) throw new Error('ticks: ' + error.message);
  return (data || []).map(mapRow);
}
function mapRow(r) {
  return {
    dt: ts(r.block_time), block: r.block_number, side: r.trade_type, bnb: r.bnb_amount || 0,
    w: ((r.sender_address || r.trader_address || '')).toLowerCase(),
  };
}

// 最后 ≥50s 静默段（D3.67 同线）→ 出口 idx
function lastStall(ticks) {
  let gap = null;
  for (let i = 1; i < ticks.length; i++) {
    const g = ticks[i].dt - ticks[i - 1].dt;
    if (g >= 50) gap = { sec: g, exitIdx: i };
  }
  return gap;
}
// 波窗=出口后 60s 内行（D3.67 出口波=出口后 60s 内最密 5s 滑窗；这里取整 60s 窗看捆绑结构）
function waveOf(ticks) {
  const g = lastStall(ticks);
  if (!g) return null;
  const exitDt = ticks[g.exitIdx].dt;
  return { gapSec: +g.sec.toFixed(1), exitDt, rows: ticks.filter(t => t.dt >= exitDt && t.dt < exitDt + 60) };
}
// per-block 买簇（剔 router 伪钱包）
function buyClusters(rows) {
  const m = new Map();
  for (const t of rows) {
    if (t.side !== 'buy' || t.block == null || !t.w || ROUTERS.has(t.w)) continue;
    let b = m.get(t.block);
    if (!b) { b = { wallets: new Map() }; m.set(t.block, b); }
    b.wallets.set(t.w, (b.wallets.get(t.w) || 0) + t.bnb);
  }
  return [...m.entries()].map(([block, b]) => ({
    block, wallets: b.wallets.size, buyBnb: +[...b.wallets.values()].reduce((s, v) => s + v, 0).toFixed(4),
    perWallet: [...b.wallets.values()].map(v => +v.toFixed(4)).sort((a, b) => b - a),
  })).sort((a, b) => b.wallets - a.wallets || b.buyBnb - a.buyBnb);
}

// ---------- named 明细 ----------
for (const n of NAMED) {
  const ticks = await pullTicks(n.addr, n.anchor);
  const after = await pullTicks(n.addr, n.anchor, 300);
  console.log(`\n===== ${n.sym} ${n.addr.slice(0, 10)} anchor=${n.anchor}`);
  const span = ticks.length ? ticks[ticks.length - 1].dt - ticks[0].dt : 0;
  const buyBnb = ticks.filter(t => t.side === 'buy').reduce((s, t) => s + t.bnb, 0);
  const sellBnb = ticks.filter(t => t.side === 'sell').reduce((s, t) => s + t.bnb, 0);
  console.log(`锚窗: ${ticks.length} 行 span=${span.toFixed(0)}s 买Σ=${fmt(buyBnb)} 卖Σ=${fmt(sellBnb)}`);
  const wv = waveOf(ticks);
  if (!wv) { console.log('无 ≥50s 静默段（非 burst 语境）'); }
  else {
    console.log(`静默段 gap=${wv.gapSec}s 出口=${new Date(wv.exitDt * 1000).toISOString()} 波窗(出口+60s)=${wv.rows.length} 行`);
    const cl = buyClusters(wv.rows);
    console.log('波内 per-block 买簇（剔 router）:');
    for (const b of cl) console.log(`  block=${b.block} wallets=${b.wallets} buyBnb=${b.buyBnb} perWallet=[${b.perWallet.join(',')}]`);
    const wSell = wv.rows.filter(t => t.side === 'sell');
    console.log(`波内卖: ${wSell.length} 行 卖Σ=${fmt(wSell.reduce((s, t) => s + t.bnb, 0))} 卖家数=${new Set(wSell.map(t => t.w)).size}`);
  }
  // 波外锚窗其余买簇 top3（对照：捆绑是否只在波内）
  if (wv) {
    const outside = ticks.filter(t => t.dt < wv.exitDt);
    const cl = buyClusters(outside);
    console.log('波外锚窗 per-block 买簇 top3:');
    for (const b of cl.slice(0, 3)) console.log(`  block=${b.block} wallets=${b.wallets} buyBnb=${b.buyBnb} perWallet=[${b.perWallet.join(',')}]`);
  } else {
    const cl = buyClusters(ticks);
    console.log('全窗 per-block 买簇 top3:');
    for (const b of cl.slice(0, 3)) console.log(`  block=${b.block} wallets=${b.wallets} buyBnb=${b.buyBnb} perWallet=[${b.perWallet.join(',')}]`);
  }
  // 锚后 5min：拉高收割证据（卖压时间线）
  const aSell = after.filter(t => t.side === 'sell');
  const aBuy = after.filter(t => t.side === 'buy');
  console.log(`锚后300s: ${after.length} 行 买Σ=${fmt(aBuy.reduce((s, t) => s + t.bnb, 0))} 卖Σ=${fmt(aSell.reduce((s, t) => s + t.bnb, 0))} 卖家数=${new Set(aSell.map(t => t.w)).size}`);
  if (aSell.length) {
    const t0 = ts(n.anchor);
    console.log('锚后卖时间线(前12行): ' + aSell.slice(0, 12).map(t => `+${(t.dt - t0).toFixed(0)}s ${fmt(t.bnb)}B`).join(' | '));
  }
}

// ---------- 四基底扫描 ----------
console.log('\n\n===== 四基底 sbw 语境 × 波内捆绑买簇扫描 =====');
const points = [];
for (const name of SETS) {
  const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
  for (const p of set.points) points.push({ set: name.replace('-trades', ''), ...p });
}
console.log('点位共', points.length);
const expIds = [...new Set(points.map(p => p.experimentId))];
const sigIdOfTrade = new Map();
for (const eid of expIds) {
  let from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('id,signal_id').eq('experiment_id', eid).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('trades: ' + error.message);
    for (const t of data) sigIdOfTrade.set(String(t.id), t.signal_id);
    if (data.length < 1000) break; from += 1000;
  }
}
const sigIds = [...new Set(points.map(p => p.trade?.buyTradeId).map(id => id && sigIdOfTrade.get(String(id))).filter(Boolean))];
const sigs = new Map();
for (let i = 0; i < sigIds.length; i += 50) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata').in('id', sigIds.slice(i, i + 50));
  if (error) throw new Error('signals: ' + error.message);
  for (const s of data) sigs.set(s.id, s);
}
const out = [];
for (const p of points) {
  const buyId = p.trade?.buyTradeId;
  const sigId = buyId ? sigIdOfTrade.get(String(buyId)) : null;
  const sig = sigId ? sigs.get(sigId) : null;
  const cc = sig?.metadata?.cheatCheck;
  if (!cc) continue;
  const ticks = await pullTicks(p.tokenAddress, sig.created_at);
  if (!ticks.length) continue;
  const wv = waveOf(ticks);
  let waveMaxW = null, waveMaxBnb = null, waveBuyBnb = 0, waveWallets = 0;
  if (wv) {
    const cl = buyClusters(wv.rows);
    if (cl.length) {
      waveMaxW = cl[0].wallets;
      waveMaxBnb = cl.reduce((m, b) => Math.max(m, b.buyBnb), 0);
      waveBuyBnb = +cl.reduce((s, b) => s + b.buyBnb, 0).toFixed(4);
      waveWallets = new Set(wv.rows.filter(t => t.side === 'buy' && t.w && !ROUTERS.has(t.w)).map(t => t.w)).size;
    }
  }
  out.push({
    set: p.set, sym: p.tokenSymbol ?? '?', token: p.tokenAddress.slice(0, 10),
    sbw: cc.levels?.stallBurstWave ?? null, act: cc.levels?.activityLevel ?? null,
    grade: cc.grade ?? null, exempt: cc.exempt?.code ?? null, orig: cc.exempt?.originalGrade ?? null,
    hasWave: !!wv, waveMaxW, waveMaxBnb, waveBuyBnb, waveWallets,
    pnl: p.trade?.episode?.pnlBnb ?? null,
  });
}
// 波内捆绑分带（不限 sbw 先看全景）
for (const [label, f] of [
  ['W>=8', r => r.waveMaxW >= 8],
  ['W6-7', r => r.waveMaxW >= 6 && r.waveMaxW < 8],
  ['W4-5', r => r.waveMaxW >= 4 && r.waveMaxW < 6],
  ['W2-3', r => r.waveMaxW >= 2 && r.waveMaxW < 4],
  ['W0-1/无波', r => r.waveMaxW == null || r.waveMaxW < 2],
]) {
  const rs = out.filter(f);
  const pnlSum = +rs.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4);
  const exN = rs.filter(r => r.exempt).length;
  console.log(`\n--- ${label}: ${rs.length} 点 / 豁免买入 ${exN} / pnlΣ ${pnlSum}`);
  for (const r of rs.sort((a, b) => (a.waveMaxBnb ?? 0) - (b.waveMaxBnb ?? 0)).slice(0, 25))
    console.log(JSON.stringify(r));
}
// sbw=1 子集分带
const sbw1 = out.filter(r => r.sbw === 1);
console.log(`\n===== sbw=1 子集: ${sbw1.length} 点 =====`);
for (const [label, f] of [
  ['sbw1 W>=8', r => r.waveMaxW >= 8],
  ['sbw1 W6-7', r => r.waveMaxW >= 6 && r.waveMaxW < 8],
  ['sbw1 W4-5', r => r.waveMaxW >= 4 && r.waveMaxW < 6],
]) {
  const rs = sbw1.filter(f);
  const pnlSum = +rs.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4);
  console.log(`--- ${label}: ${rs.length} 点 pnlΣ ${pnlSum}`);
  for (const r of rs) console.log(JSON.stringify(r));
}
fs.writeFileSync('/tmp/burst-bundle-sweep.json', JSON.stringify(out, null, 1));
console.log('\n→ /tmp/burst-bundle-sweep.json');
process.exit(0);
