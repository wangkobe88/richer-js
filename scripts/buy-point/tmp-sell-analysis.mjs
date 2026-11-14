// 卖侧分析 v2（182 跑）：卖出原因分布+峰值兑现率+trailing 提前卖模拟
// 口径修正：价格全用 tick price_bnb 同源（trades token 数量与 tick 价差 ~700x 常数缩放，比率分析不受影响）
// 模拟净 = buyBnb × (simPx / priceAtBuy − 1)；实际净 = trades BNB 绝对值
import { dbManager } from '../../src/services/dbManager.js';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const SRC = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';

const c = await dbManager.getClient();
async function pullTable(table, cols) {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', V107)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}
const trades = await pullTable('trades', 'token_address,trade_direction,input_amount,output_amount,created_at,signal_id');
const sigs = await pullTable('strategy_signals', 'id,metadata');
const sigById = new Map(sigs.map(s => [s.id, s]));

// 实验配置：卖腿名映射（形状探针）
const { data: exp } = await c.from('experiments').select('config').eq('id', V107).single();
const legNames = new Map();
try {
  const sc = exp.config?.strategiesConfig || {};
  console.log('strategiesConfig keys:', Object.keys(sc).join(','), '| strategies n=', (sc.strategies || []).length);
  for (const l of (sc.strategies || [])) {
    if ((l.side || '').toLowerCase() === 'sell') legNames.set(String(l.id ?? l.priority), `${l.name}[${String(l.condition || '').slice(0, 60)}]`);
  }
} catch (e) { console.log('config 探针失败:', e.message); }
console.log(`卖腿 ${legNames.size} 条:`);
for (const [i, n] of legNames) console.log(`  P${i} = ${n}`);

// ---------- per token 持仓轮 ----------
const rounds = new Map();
for (const t of trades) {
  if (!rounds.has(t.token_address)) rounds.set(t.token_address, { addr: t.token_address, buys: [], sells: [] });
  const r = rounds.get(t.token_address);
  (t.trade_direction === 'buy' ? r.buys : r.sells).push(t);
}
for (const r of rounds.values()) {
  r.buyBnb = r.buys.reduce((s, t) => s + Number(t.input_amount || 0), 0);
  r.sellBnb = r.sells.reduce((s, t) => s + Number(t.output_amount || 0), 0);
  r.net = r.sellBnb - r.buyBnb;
  const bTimes = r.buys.map(t => t.created_at).sort(), sTimes = r.sells.map(t => t.created_at).sort();
  r.t0 = bTimes[0]; r.t1 = sTimes.length ? sTimes[sTimes.length - 1] : null;
  const whys = [];
  for (const s of [...r.sells].sort((a, b) => a.created_at < b.created_at ? -1 : 1)) {
    const m = (s.signal_id ? sigById.get(s.signal_id)?.metadata : null) || {};
    const nm = m.strategyName || m.why || '?';
    if (!whys.includes(nm)) whys.push(nm);
  }
  r.whys = whys;
}

// ---------- tick-cache 流式读 ----------
const CACHE = `/home/ubuntu/richer-js/data/tick-cache/backtest/${SRC}`;
const tokenSet = new Set(rounds.keys());
const priceMap = new Map();
for (const plat of ['fourmeme', 'flap']) {
  try {
    const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!tokenSet.has(row.token_address)) continue;
      if (row.price_outlier) continue;
      const p = Number(row.price_bnb);
      if (!(p > 0)) continue;
      if (!priceMap.has(row.token_address)) priceMap.set(row.token_address, []);
      priceMap.get(row.token_address).push({ ts: row.block_time, p });
    }
  } catch (e) { console.log(`(skip ${plat}: ${e.message})`); }
}
for (const arr of priceMap.values()) arr.sort((x, y) => x.ts < y.ts ? -1 : 1);

// priceAt：≤ts 的最近价（含窗前）
function priceAt(series, ts) {
  let lo = null;
  for (const x of series) { if (x.ts <= ts) lo = x; else break; }
  return lo?.p ?? series[0]?.p ?? null;
}

// ---------- per round 指标 ----------
const TRAILS = [0.15, 0.20, 0.25, 0.30, 0.40];
const results = [];
for (const r of rounds.values()) {
  const series = priceMap.get(r.addr) || [];
  if (!series.length || !r.t1) { results.push({ ...r, skip: true }); continue; }
  const win = series.filter(x => x.ts >= r.t0 && x.ts <= r.t1);
  if (win.length < 2) { results.push({ ...r, skip: true }); continue; }
  const pBuy = priceAt(series, r.t0);
  let peak = -1, peakTs = null;
  for (const x of win) if (x.p > peak) { peak = x.p; peakTs = x.ts; }
  // 实际卖出价（tick 源，按每笔卖得 BNB 加权）与峰值兑现率
  let tokEq = 0;
  for (const s of r.sells) {
    const ps = priceAt(series, s.created_at);
    if (ps) tokEq += Number(s.output_amount || 0) / ps;
  }
  const realize = tokEq > 0 ? r.sellBnb / (peak * tokEq) : null;
  // trailing 模拟
  const sim = {};
  for (const ratio of TRAILS) {
    let rp = -1, hit = null;
    for (const x of win) {
      if (x.p > rp) rp = x.p;
      if (rp > 0 && x.p <= rp * (1 - ratio)) { hit = x; break; }
    }
    sim[ratio] = hit
      ? { hitTs: hit.ts, net: r.buyBnb * (hit.p / pBuy - 1) }
      : { hitTs: null, net: r.net }; // 未触发=实际净
  }
  results.push({
    ...r, skip: false, pBuy, peak, peakTs, realize, sim,
    holdSec: (new Date(r.t1) - new Date(r.t0)) / 1000,
    peakLagSec: (new Date(r.t1) - new Date(peakTs)) / 1000,
    peakGainPct: pBuy > 0 ? (peak / pBuy - 1) * 100 : null, // 持仓期内最大浮盈
  });
}

// ---------- 汇总 ----------
const ok = results.filter(r => !r.skip);
console.log(`\n=== 卖出原因分布（${ok.length} 轮，${results.length - ok.length} 跳过）===`);
const byWhy = new Map();
for (const r of ok) {
  const k = r.whys.join('→') || 'none';
  if (!byWhy.has(k)) byWhy.set(k, { n: 0, net: 0, hold: 0, realize: 0, rn: 0, pg: 0 });
  const o = byWhy.get(k);
  o.n++; o.net += r.net; o.hold += r.holdSec; o.pg += r.peakGainPct || 0;
  if (r.realize != null) { o.realize += r.realize; o.rn++; }
}
for (const [k, o] of [...byWhy.entries()].sort((a, b) => b[1].net - a[1].net))
  console.log(`  ${k}: n=${o.n} net=${o.net.toFixed(4)} avgHold=${(o.hold / o.n / 60).toFixed(1)}min 兑现率=${o.rn ? (o.realize / o.rn * 100).toFixed(0) + '%' : '—'} 期内峰浮盈=${(o.pg / o.n).toFixed(0)}%`);

const actNet = ok.reduce((s, r) => s + r.net, 0);
console.log(`\n=== trailing 提前卖模拟（net=Σ buyBnb×(simPx/买价−1)；未触发=实际净）===`);
console.log(`  实际总净额=${actNet.toFixed(4)}  平均期内峰浮盈=${(ok.reduce((s, r) => s + (r.peakGainPct || 0), 0) / ok.length).toFixed(0)}%  平均兑现率=${(ok.reduce((s, r) => s + (r.realize || 0), 0) / ok.filter(r => r.realize != null).length * 100).toFixed(0)}%`);
for (const ratio of TRAILS) {
  const sNet = ok.reduce((s, r) => s + r.sim[ratio].net, 0);
  const hits = ok.filter(r => r.sim[ratio].hitTs).length;
  console.log(`  trailing ${Math.round(ratio * 100)}%: net=${sNet.toFixed(4)} (Δ=${(sNet - actNet).toFixed(4)}, 触发 ${hits}/${ok.length})`);
}

const brief = (r) => `${r.addr} net=${r.net.toFixed(4)} hold=${(r.holdSec / 60).toFixed(1)}min 峰浮盈=${r.peakGainPct.toFixed(0)}% 兑现=${r.realize != null ? (r.realize * 100).toFixed(0) + '%' : '—'} peakLag=${(r.peakLagSec / 60).toFixed(1)}min ${r.whys.join('→')}`;
console.log(`\n=== 亏损 top12 ===`);
for (const r of [...ok].sort((a, b) => a.net - b.net).slice(0, 12)) console.log('  ' + brief(r));
console.log(`\n=== 盈利 top10 ===`);
for (const r of [...ok].sort((a, b) => b.net - a.net).slice(0, 10)) console.log('  ' + brief(r));

console.log(`\n=== 断流票（首因=流动性止损）整体 ===`);
const stall = ok.filter(r => r.whys[0]?.includes('流动性止损'));
console.log(`  n=${stall.length} net=${stall.reduce((s, r) => s + r.net, 0).toFixed(4)} avgHold=${(stall.reduce((s, r) => s + r.holdSec, 0) / stall.length / 60).toFixed(1)}min`);
console.log(`  期内峰浮盈 ≥30% 的断流票（见顶回落没吃到=提前卖最大标的）:`);
for (const r of stall.filter(x => x.peakGainPct >= 30).sort((a, b) => b.peakGainPct - a.peakGainPct))
  console.log(`  ${brief(r)} | trail25 net=${r.sim[0.25].net.toFixed(4)}@${r.sim[0.25].hitTs ? r.sim[0.25].hitTs.slice(11, 19) : 'never'}`);

console.log(`\n=== trailing 25% per 票 Δ 分解（模拟净−实际净）===`);
const deltas = ok.map(r => ({ r, d: r.sim[0.25].net - r.net })).sort((a, b) => b.d - a.d);
for (const { r, d } of deltas.filter(x => Math.abs(x.d) > 0.005))
  console.log(`  ${d >= 0 ? '+' : ''}${d.toFixed(4)} ${r.addr} 实际=${r.net.toFixed(4)}→模拟=${r.sim[0.25].net.toFixed(4)} 峰浮盈=${r.peakGainPct.toFixed(0)}% hold=${(r.holdSec / 60).toFixed(1)}min ${r.sim[0.25].hitTs ? 'trail@' + r.sim[0.25].hitTs.slice(11, 19) : '未触发'} ${r.whys[0]}`);
console.log(`  ΣΔ=${deltas.reduce((s, x) => s + x.d, 0).toFixed(4)}`);

// 断流票 trail25 是否更早离场（触发时刻 vs 实际卖出时刻）
console.log(`\n=== 断流票 trail25 时序对照（触发更早=亏损更小？）===`);
for (const r of stall.slice(0, 40)) {
  const s = r.sim[0.25];
  if (!s.hitTs) continue;
  const earlySec = (new Date(r.t1) - new Date(s.hitTs)) / 1000;
  if (Math.abs(s.net - r.net) > 0.005)
    console.log(`  ${r.addr} Δ=${(s.net - r.net).toFixed(4)} 实际卖@${r.t1.slice(11, 19)} trail@${s.hitTs.slice(11, 19)} (早 ${earlySec.toFixed(0)}s) 峰浮盈=${r.peakGainPct.toFixed(0)}%`);
}
process.exit(0);
