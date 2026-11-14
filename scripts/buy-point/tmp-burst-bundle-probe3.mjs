// burst 捆绑极端臂取证 v3（182 跑）：用户新线 = 只控极端（波内去尘单块捆绑钱包 >=7）
// + T022 型连续 2 slot 候选。A) named 两案块级明细（两簇是否相邻 slot、波块后是否还有买）
// B) 四基底 sweep：L1 单块去尘钱包>=7 / L2a 连续两块各>=3 / L2b 连续两块合计>=7
import fs from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
import { AGGREGATOR_ROUTER_ADDRS } from '../../src/trading-engine/pre-check/aggregator-routers.js';

const NAMED = [
  { sym: '比格多栋', addr: '0x5fdb483505a6654360191afac176e5ac91997777', anchor: '2026-11-02T19:56:05.180Z' },
  { sym: 'Crypto Winter', addr: '0xa3efddca9d8a138ace3548b8f70118a1c4767777', anchor: '2026-11-03T03:00:35.367Z' },
];
const SETS = ['btv103-r2-trades', 'btv104-trades', 'btv109-trades', 'btv111-trades'];
const DUST = 0.01; // 去尘线：块内单钱包买入合计 >= 0.01 BNB 才计数
const c = await dbManager.getClient();
const ROUTERS = AGGREGATOR_ROUTER_ADDRS;
const ts = (iso) => Date.parse(iso) / 1000;
const fmt = (n) => (n == null ? 'null' : (+n).toFixed(4));

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
function lastGapExit(ticks) {
  let g = null;
  for (let i = 1; i < ticks.length; i++) {
    const d = ticks[i].dt - ticks[i - 1].dt;
    if (d >= 50) g = { sec: d, exitIdx: i };
  }
  return g;
}
// block -> Map(wallet -> 该块内买入合计)，剔 router
function blockBuys(rows) {
  const m = new Map();
  for (const t of rows) {
    if (t.side !== 'buy' || t.block == null || !t.w || ROUTERS.has(t.w)) continue;
    let b = m.get(t.block);
    if (!b) { b = new Map(); m.set(t.block, b); }
    b.set(t.w, (b.get(t.w) || 0) + t.bnb);
  }
  return m;
}
const dustCount = (perWallet, dust) => [...perWallet.values()].filter(v => v >= dust).length;

// ---------- A) named 块级明细 ----------
for (const n of NAMED) {
  const ticks = await pullTicks(n.addr, n.anchor);
  const after = await pullTicks(n.addr, n.anchor, 300);
  const g = lastGapExit(ticks);
  const exitDt = g ? ticks[g.exitIdx].dt : null;
  console.log(`\n===== ${n.sym} ${n.addr.slice(0, 10)} anchor=${n.anchor}`);
  console.log(`锚窗 ${ticks.length} 行；最后静默段 gap=${g ? g.sec.toFixed(0) : '无'}s 出口=${exitDt ? new Date(exitDt * 1000).toISOString() : '-'}`);
  const dtOf = new Map(ticks.map(t => [t.block, t.dt]));
  const bl = [...blockBuys(ticks).entries()].map(([block, w]) => ({
    block, n: w.size, nD: dustCount(w, DUST),
    tot: +[...w.values()].reduce((s, v) => s + v, 0).toFixed(4),
    per: [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, v]) => `${a.slice(0, 6)}:${v.toFixed(4)}`),
    inWave: exitDt != null && (dtOf.get(block) ?? 0) >= exitDt,
  })).sort((a, b) => a.block - b.block);
  console.log('锚窗全部买块（block/钱包数/去尘数/合计/波内/明细）:');
  for (const b of bl) console.log(`  blk=${b.block} w=${b.n} wD=${b.nD} Σ=${b.tot} wave=${b.inWave ? 'Y' : 'n'} [${b.per.join(' ')}] @${new Date((dtOf.get(b.block) || 0) * 1000).toISOString()}`);
  for (let i = 1; i < bl.length; i++) if (bl[i].block - bl[i - 1].block === 1)
    console.log(`  >> 相邻slot: ${bl[i - 1].block}(${bl[i - 1].nD}w去尘) + ${bl[i].block}(${bl[i].nD}w去尘)`);
  const t0 = ts(n.anchor);
  const aBuy = after.filter(t => t.side === 'buy');
  console.log(`锚后300s 买入 ${aBuy.length} 笔: ` + (aBuy.slice(0, 15).map(t => `+${(t.dt - t0).toFixed(0)}s ${fmt(t.bnb)}B blk=${t.block}`).join(' | ') || '(无)'));
}

// ---------- B) 四基底 sweep ----------
console.log('\n\n===== 四基底 sweep（波窗=最后 ≥50s 静默段出口+60s，去尘线 ' + DUST + '）=====');
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
const out = [];
for (const p of points) {
  const buyId = p.trade?.buyTradeId;
  const sigId = buyId ? sigIdOfTrade.get(String(buyId)) : null;
  const sig = sigId ? sigs.get(sigId) : null;
  const cc = sig?.metadata?.cheatCheck;
  if (!cc) continue;
  const ticks = await pullTicks(p.tokenAddress, sig.created_at);
  const g = ticks.length ? lastGapExit(ticks) : null;
  let maxND = 0, maxBlock = null, pairs = [], L1 = false, L2a = false, L2b = false;
  if (g) {
    const exitDt = ticks[g.exitIdx].dt;
    const wave = ticks.filter(t => t.dt >= exitDt && t.dt < exitDt + 60);
    const bl = [...blockBuys(wave).entries()].map(([block, w]) => ({
      block, n: w.size, nD: dustCount(w, DUST),
      tot: +[...w.values()].reduce((s, v) => s + v, 0).toFixed(4),
      per: [...w.values()].sort((a, b) => b - a).slice(0, 8).map(v => v.toFixed(4)),
    })).sort((a, b) => a.block - b.block);
    for (const b of bl) if (b.nD > maxND) { maxND = b.nD; maxBlock = b; }
    for (let i = 1; i < bl.length; i++) if (bl[i].block - bl[i - 1].block === 1) {
      const a = bl[i - 1].nD, b2 = bl[i].nD;
      pairs.push(`${bl[i - 1].block}:${a}+${b2}`);
      if (a >= 3 && b2 >= 3) L2a = true;
      if (a + b2 >= 7) L2b = true;
    }
    L1 = maxND >= 7;
  }
  out.push({
    set: p.set, sym: p.tokenSymbol ?? '?', token: p.tokenAddress.slice(0, 10),
    sbw: cc.levels?.stallBurstWave ?? null, act: cc.levels?.activityLevel ?? null,
    exempt: cc.exempt?.code ?? null, orig: cc.exempt?.originalGrade ?? null,
    waveMaxWD: maxND, waveMaxWRaw: maxBlock?.n ?? null,
    maxBlock: maxBlock ? `blk${maxBlock.block} ${maxBlock.nD}w Σ${maxBlock.tot} per=[${maxBlock.per.join(',')}]` : null,
    pairs: pairs.length ? pairs.slice(0, 3) : null, L1, L2a, L2b,
    pnl: p.trade?.episode?.pnlBnb ?? null,
  });
}
console.log('有 cheat 段点位 ' + out.length);
// 波内最大去尘块 Top15（看分布与 dust 敏感）
for (const r of out.sort((a, b) => b.waveMaxWD - a.waveMaxWD).slice(0, 15))
  console.log(JSON.stringify({ ...r, maxBlock: r.waveMaxWD >= 4 ? r.maxBlock : undefined }));
// 分线汇总（唯一票去重）
const uniq = new Map();
for (const r of out) if (!uniq.has(r.token)) uniq.set(r.token, r);
const U = [...uniq.values()];
const band = (label, f) => {
  const rs = U.filter(f);
  console.log(`[唯一票] ${label}: ${rs.length} 票 / pnlΣ ${+rs.reduce((s, r) => s + (r.pnl ?? 0), 0).toFixed(4)} / ${rs.map(r => `${r.sym}(${r.waveMaxWD}w,${r.pnl ?? 0})`).join(' ')}`);
};
console.log('\n=== 候选线命中面（唯一票口径） ===');
band('L1 单块去尘>=7', r => r.L1);
band('L2a 连续两块各>=3', r => r.L2a);
band('L2b 连续两块合计>=7', r => r.L2b);
band('L1 ∨ L2a', r => r.L1 || r.L2a);
band('L1 ∨ L2b', r => r.L1 || r.L2b);
band('L1 ∨ L2a ∨ L2b', r => r.L1 || r.L2a || r.L2b);
// 相邻对全景（唯一票，>=2+2 以上）
console.log('\n=== 相邻 slot 对全景（唯一票，去尘后 2+2 以上） ===');
for (const r of U.filter(r => (r.pairs || []).some(p => { const m = p.match(/:(\d+)\+(\d+)$/); return +m[1] + +m[2] >= 4; })))
  console.log(`${r.sym} ${r.token} pairs=${JSON.stringify(r.pairs)} sbw=${r.sbw} exempt=${r.exempt} pnl=${r.pnl}`);
process.exit(0);
