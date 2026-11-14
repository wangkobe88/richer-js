// 买侧分析（182 跑）：门链漏斗过滤质量 + 成交票买点因子区分度
// 1) BUY 信号按 cheat/BP 门结局分层；2) 被拒票前向收益（锚=信号时刻，tick 源）；3) 成交票盈亏分组 vs 买点锚
import { dbManager } from '../../src/services/dbManager.js';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const SRC = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const c = await dbManager.getClient();
async function pullSignals() {
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals').select('id,token_address,action,signal_type,metadata,created_at')
      .eq('experiment_id', V107).eq('action', 'buy').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const sigs = await pullSignals();
console.log(`BUY 信号=${sigs.length}`);
// 探针
{
  const done = sigs.find(s => s.metadata?.execution_status === 'completed' || s.metadata?.execution_status === 'executed');
  const rej = sigs.find(s => s.metadata?.buyPoint && s.metadata.buyPoint.passed === false);
  if (done?.metadata?.buyPoint) console.log('buyPoint.anchors keys:', Object.keys(done.metadata.buyPoint.anchors || {}).join(','));
  if (rej?.metadata?.buyPoint) console.log('BP拒样例:', JSON.stringify(rej.metadata.buyPoint.assessment || {}).slice(0, 260));
}

// trades 成交票 → net
const trades = []; { let from = 0; while (true) {
  const { data, error } = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,signal_id,created_at')
    .eq('experiment_id', V107).eq('success', true).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  trades.push(...data); if (data.length < 1000) break; from += 1000;
} }
const netByAddr = new Map();
for (const t of trades) {
  if (!netByAddr.has(t.token_address)) netByAddr.set(t.token_address, { buy: 0, sell: 0 });
  const o = netByAddr.get(t.token_address);
  if (t.trade_direction === 'buy') o.buy += Number(t.input_amount || 0); else o.sell += Number(t.output_amount || 0);
}
for (const [k, o] of netByAddr) o.net = o.sell - o.buy;
const buySigByAddr = new Map(); // 成交票的买信号（联 signal_id）
for (const t of trades) if (t.trade_direction === 'buy' && t.signal_id) {
  const sg = sigs.find(s => s.id === t.signal_id);
  if (sg) buySigByAddr.set(t.token_address, sg);
}

// ---------- 信号分层 ----------
function layer(m) {
  const es = m?.execution_status, bp = m?.buyPoint, ch = m?.cheatCheck;
  if (es === 'executed' || es === 'completed') return '成交';
  if (bp && bp.passed === false) {
    const r = bp.assessment?.rule || bp.assessment?.exempt?.code || bp.assessment?.dimension?.rule;
    return `BP拒(${r || bp.status || '?'})`;
  }
  if (bp && bp.passed === true) return 'BP过未成交';
  // 无 BP 段=cheat 门拒（grade 语义）或门链前置拒
  if (ch) {
    const g = ch.grade || ch.status;
    if (g === 'cheat') return 'cheat拒拉黑';
    if (g === 'unhealthy') return 'cheat拒unhealthy';
    return `cheat拒(grade=${g})`;
  }
  return '前置拒(无cheat段)';
}
const stats = new Map();
for (const s of sigs) {
  const k = layer(s.metadata);
  if (!stats.has(k)) stats.set(k, { n: 0 });
  stats.get(k).n++;
}
console.log(`\n=== BUY 信号门链分层 ===`);
for (const [k, o] of [...stats.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}: ${o.n}`);

// ---------- tick-cache ----------
const CACHE = `/home/ubuntu/richer-js/data/tick-cache/backtest/${SRC}`;
const anchorAddrs = new Set(sigs.map(s => s.token_address));
const priceMap = new Map();
for (const plat of ['fourmeme', 'flap']) {
  try {
    const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!anchorAddrs.has(row.token_address) || row.price_outlier) continue;
      const p = Number(row.price_bnb); if (!(p > 0)) continue;
      if (!priceMap.has(row.token_address)) priceMap.set(row.token_address, []);
      priceMap.get(row.token_address).push({ ts: row.block_time, p });
    }
  } catch (e) {}
}
for (const arr of priceMap.values()) arr.sort((a, b) => a.ts < b.ts ? -1 : 1);
function fwd(addr, ts, sec) { // 锚价与 +sec 前向收益
  const s = priceMap.get(addr); if (!s) return null;
  const tgt = new Date(new Date(ts).getTime() + sec * 1000).toISOString();
  let p0 = null, p1 = null;
  for (const x of s) { if (x.ts <= ts) p0 = x.p; else break; }
  for (const x of s) { if (x.ts <= tgt) p1 = x.p; else break; }
  if (p0 == null || p1 == null) return null;
  return (p1 / p0 - 1) * 100;
}

// ---------- 被拒票前向收益（每票取首个被拒信号锚）----------
console.log(`\n=== 被拒票前向收益对照（锚=信号时刻；+2min/+5min；只看每票首个拒信号）===`);
const firstRej = new Map();
for (const s of sigs) {
  const k = layer(s.metadata);
  if (k === '成交' || k === 'BP过未成交') continue;
  if (!firstRej.has(s.token_address)) firstRej.set(s.token_address, { k, ts: s.created_at });
}
const rejGroups = new Map();
for (const [addr, { k, ts }] of firstRej) {
  const f2 = fwd(addr, ts, 120), f5 = fwd(addr, ts, 300);
  const key = k.startsWith('cheat') ? 'cheat拒' : k.startsWith('BP拒') ? k : k;
  if (!rejGroups.has(key)) rejGroups.set(key, { n: 0, f2: [], f5: [] });
  const o = rejGroups.get(key);
  o.n++; if (f2 != null) o.f2.push(f2); if (f5 != null) o.f5.push(f5);
}
const med = (a) => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1) + '%' : '—';
const avg = (a) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) + '%' : '—';
const posRate = (a) => a.length ? (a.filter(x => x > 0).length / a.length * 100).toFixed(0) + '%' : '—';
for (const [k, o] of [...rejGroups.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${k}: n=${o.n} 前向2min 中位=${med(o.f2)} 均值=${avg(o.f2)} 正率=${posRate(o.f2)} | 前向5min 中位=${med(o.f5)} 正率=${posRate(o.f5)}`);

// ---------- 成交票分组对照 ----------
console.log(`\n=== 成交票盈亏分组 vs 买点时刻 anchors（中位数对照）===`);
const KEYS = ['currentVsLaunchPct','actTickCount','win30BuyBnb','win30NetBnb','win30Buyers','win30SellBnb','win60NetBnb','actNearTail10BnbPerMin','actNearTail5BuyN','actNearTail5BuyBnb','holdersNow','routerBuyPct60','top1BuyPct60','athVsLaunchPct','secSinceAth','tokenAgeSec','mcapFromPeakPct','chg5Pct','chg30Pct','nearMaxUp5Pct','actThroughputBnbPerMin','win30NewBuyers','chipTop1HoldCircPct','exactEqualBlockMaxWallets','totalVolumeBnb','openSegBuySharePct'];
const winners = [], losers = [];
for (const [addr, o] of netByAddr) {
  const sg = buySigByAddr.get(addr);
  const a = sg?.metadata?.buyPoint?.anchors || {};
  const leg = sg?.metadata?.signalGate?.legId ?? '?';
  const row = { addr, net: o.net, leg, a };
  (o.net >= 0 ? winners : losers).push(row);
}
const col = (rows, k) => { const v = rows.map(r => r.a[k]).filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const fmt = (x) => x == null ? '—' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
console.log(`  赢家 n=${winners.length} Σnet=+${winners.reduce((s, r) => s + r.net, 0).toFixed(3)} | 输家 n=${losers.length} Σnet=${losers.reduce((s, r) => s + r.net, 0).toFixed(3)}`);
console.log(`  ${'键'.padEnd(28)}赢家中位   输家中位`);
for (const k of KEYS) console.log(`  ${k.padEnd(28)}${fmt(col(winners, k)).padStart(9)}  ${fmt(col(losers, k)).padStart(9)}`);
console.log(`\n  成交票按腿净额：`);
const byLeg = new Map();
for (const r of winners.concat(losers)) {
  if (!byLeg.has(r.leg)) byLeg.set(r.leg, { n: 0, net: 0 });
  byLeg.get(r.leg).n++; byLeg.get(r.leg).net += r.net;
}
for (const [leg, o] of [...byLeg.entries()].sort((a, b) => b[1].net - a[1].net))
  console.log(`    ${leg}: n=${o.n} net=${o.net.toFixed(4)}`);
console.log(`\n  输家明细（net<-0.02）：`);
for (const r of losers.filter(x => x.net < -0.02).sort((a, b) => a.net - b.net))
  console.log(`    ${r.addr} net=${r.net.toFixed(4)} leg=${r.leg} curVs=${fmt(r.a.currentVsLaunchPct)} tail10Bnb/min=${fmt(r.a.actNearTail10BnbPerMin)} win30Net=${fmt(r.a.win30NetBnb)} routers=${fmt(r.a.routerBuyPct60)}`);
console.log(`\n  赢家明细（net>+0.05）：`);
for (const r of winners.filter(x => x.net > 0.05).sort((a, b) => b.net - a.net))
  console.log(`    ${r.addr} net=${r.net.toFixed(4)} leg=${r.leg} curVs=${fmt(r.a.currentVsLaunchPct)} tail10Bnb/min=${fmt(r.a.actNearTail10BnbPerMin)} win30Net=${fmt(r.a.win30NetBnb)} routers=${fmt(r.a.routerBuyPct60)}`);
process.exit(0);
