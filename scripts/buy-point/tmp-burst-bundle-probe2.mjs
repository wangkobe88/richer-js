// burst 捆绑买入取证 v2：sbw=1 全体 + named/Callcat 的等额簇/捆绑集中度/anchors 维度（182 跑）
import fs from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const NAMED = ['0x5fdb483505a6654360191afac176e5ac91997777', '0xa3efddca9d8a138ace3548b8f70118a1c4767777'];
const NAMED_PREFIXES = ['0x77a835b4']; // Callcat 前缀（防手敲长地址）
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const c = await dbManager.getClient();
const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (n) => (n == null ? 'null' : (+n).toFixed(4));

const points = [];
for (const name of SETS) {
  const set = JSON.parse(fs.readFileSync(`scripts/buy-point/sets/${name}.json`, 'utf8'));
  for (const p of set.points) points.push({ set: name.replace('-trades', ''), ...p });
}
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

async function pullTicks(token, anchorIso) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,trader_address,sender_address')
    .eq('token_address', token).lte('block_time', anchorIso)
    .order('id', { ascending: false }).limit(3000);
  if (error) throw new Error('ticks: ' + error.message);
  return (data || []).reverse().map(r => ({
    dt: ts(r.block_time), block: r.block_number, side: r.trade_type, bnb: r.bnb_amount || 0,
    w: ((r.sender_address || r.trader_address || '')).toLowerCase(),
  }));
}
function waveRows(ticks) {
  let g = null;
  for (let i = 1; i < ticks.length; i++) {
    const d = ticks[i].dt - ticks[i - 1].dt;
    if (d >= 50) g = i;
  }
  if (!g) return null;
  const exitDt = ticks[g].dt;
  return ticks.filter(t => t.dt >= exitDt && t.dt < exitDt + 60);
}
// 波内买簇：wallets/block、等额形状、捆绑占比
function waveBuyStats(rows) {
  const m = new Map();
  for (const t of rows) {
    if (t.side !== 'buy' || t.block == null || !t.w || ROUTERS.has(t.w)) continue;
    let b = m.get(t.block);
    if (!b) { b = new Map(); m.set(t.block, b); }
    b.set(t.w, (b.get(t.w) || 0) + t.bnb);
  }
  let waveBuyBnb = 0, bundledBnb = 0, maxW = 0, maxWBnb = 0, eqMaxW = 0, eqClusters = [];
  for (const [block, wallets] of m) {
    const vals = [...wallets.values()];
    const tot = vals.reduce((s, v) => s + v, 0);
    waveBuyBnb += tot;
    if (wallets.size >= 2) bundledBnb += tot;
    if (wallets.size > maxW) { maxW = wallets.size; maxWBnb = tot; }
    // 精确等额子簇（toFixed(4) 全等，≥2 钱包）
    const byAmt = new Map();
    for (const v of vals) { const k = v.toFixed(4); byAmt.set(k, (byAmt.get(k) || 0) + 1); }
    for (const [k, n] of byAmt) if (n >= 2) {
      if (n > eqMaxW) eqMaxW = n;
      eqClusters.push({ block, n, amt: k, tot: +(n * +k).toFixed(4) });
    }
  }
  return {
    waveBuyBnb: +waveBuyBnb.toFixed(4), waveMaxW: maxW, waveMaxWBnb: +maxWBnb.toFixed(4),
    bundledShare: waveBuyBnb > 0 ? +(bundledBnb / waveBuyBnb * 100).toFixed(1) : null,
    eqMaxW, eqClusters: eqClusters.sort((a, b) => b.n - a.n).slice(0, 3),
    waveWallets: new Set([...m.values()].flatMap(w => [...w.keys()])).size,
  };
}

const out = [];
for (const p of points) {
  const buyId = p.trade?.buyTradeId;
  const sigId = buyId ? sigIdOfTrade.get(String(buyId)) : null;
  const sig = sigId ? sigs.get(sigId) : null;
  const cc = sig?.metadata?.cheatCheck;
  if (!cc) continue;
  const sbw = cc.levels?.stallBurstWave ?? null;
  const isNamed = NAMED.includes(p.tokenAddress) || NAMED_PREFIXES.some(px => p.tokenAddress.startsWith(px));
  if (sbw !== 1 && !isNamed) continue;
  const ticks = await pullTicks(p.tokenAddress, sig.created_at);
  const wv = ticks.length ? waveRows(ticks) : null;
  const st = wv ? waveBuyStats(wv) : null;
  const an = cc.anchors || {};
  out.push({
    set: p.set, sym: p.tokenSymbol ?? '?', token: p.tokenAddress.slice(0, 10), named: isNamed,
    sbw, act: cc.levels?.activityLevel ?? null, exempt: cc.exempt?.code ?? null, orig: cc.exempt?.originalGrade ?? null,
    ...(st || {}),
    aEEW: an.exactEqualBlockMaxWallets ?? null, aEEC: an.exactEqualBlockClusterCount ?? null,
    aPulse: an.pulseBlockCount ?? null, aBundlePct: an.bundleBuyPct ?? null, aFamousPct: an.famousGroupBuyPct ?? null,
    pnl: p.trade?.episode?.pnlBnb ?? null,
  });
}
// 输出：按 waveMaxW 降序全量
console.log(`sbw=1 ∪ named 共 ${out.length} 点（同票多基底各一行）`);
for (const r of out.sort((a, b) => (b.waveMaxW ?? 0) - (a.waveMaxW ?? 0) || (b.eqMaxW ?? 0) - (a.eqMaxW ?? 0)))
  console.log(JSON.stringify({ ...r, eqClusters: r.eqClusters?.length ? r.eqClusters : undefined }));
// 分组摘要（唯一票去重）
const uniq = new Map();
for (const r of out) if (!uniq.has(r.token)) uniq.set(r.token, r);
const U = [...uniq.values()];
const band = (label, f) => {
  const rs = U.filter(f);
  console.log(`[唯一票] ${label}: ${rs.length} 票 / pnlΣ ${+rs.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4)} / ${rs.map(r => `${r.sym}(${r.waveMaxW}w,${r.eqMaxW}eq,${r.pnl ?? 0})`).join(' ')}`);
};
console.log('\n=== 候选分带（唯一票口径） ===');
band('W>=8', r => r.waveMaxW >= 8);
band('W>=6', r => r.waveMaxW >= 6);
band('W>=5', r => r.waveMaxW >= 5);
band('W>=4', r => r.waveMaxW >= 4);
band('eqMaxW>=4', r => r.eqMaxW >= 4);
band('eqMaxW>=3', r => r.eqMaxW >= 3);
band('eqMaxW>=2', r => r.eqMaxW >= 2);
band('bundledShare>=80 且 W>=2', r => (r.bundledShare ?? 0) >= 80 && r.waveMaxW >= 2);
band('bundledShare>=60 且 W>=2', r => (r.bundledShare ?? 0) >= 60 && r.waveMaxW >= 2);
process.exit(0);
