// bt-v136(54c045ff) 30s 断流(stallClose) 卖飞时间分析
// 1) trades+signals join 出卖行腿名 → stallClose 卖出清单
// 2) 逐票拉 ticks [卖-60s, 卖+900s] 算卖后 maxRise → 卖飞判定(maxRise≥+20%)
// 3) 输出卖飞发生的时间维度：持有秒数/卖后起飞延迟/票龄
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const EXP = '54c045ff-ab63-4bad-b71e-08b2e224c266';
const WIN_END = '2026-11-03T23:59:59Z'; // 污染行(墙钟11-16)过滤
const c = await dbManager.getClient();

// --- trades ---
const trades = [];
{ let from = 0;
  while (true) {
    const q = await c.from('trades').select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,created_at,metadata')
      .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
    if (q.error) { console.error('ERR trades', q.error.message); process.exit(1); }
    trades.push(...q.data); from += q.data.length;
    if (q.data.length < 1000) break;
  } }
const clean = trades.filter(t => t.created_at <= WIN_END);
console.log(`trades total=${trades.length} clean=${clean.length} (污染丢弃 ${trades.length - clean.length})`);

// --- signals (metadata.strategyId) ---
const sigMap = new Map();
{ let from = 0;
  while (true) {
    const q = await c.from('strategy_signals').select('id,metadata,created_at').eq('experiment_id', EXP).order('created_at', { ascending: true }).range(from, from + 999);
    if (q.error) { console.error('ERR signals', q.error.message); process.exit(1); }
    for (const s of q.data) if (s.created_at <= WIN_END) sigMap.set(s.id, s.metadata?.strategyId || null);
    from += q.data.length;
    if (q.data.length < 1000) break;
  } }

// --- 卖行腿名 ---
const sells = clean.filter(t => t.trade_direction === 'sell').map(t => ({
  tok: t.token_address, sym: t.token_symbol, at: new Date(t.created_at),
  sid: t.metadata?.signalId ? sigMap.get(t.metadata.signalId) : null,
  hold: t.metadata?.holdDuration ?? null, profitPct: t.metadata?.profitPercent ?? null,
}));
const dist = {};
for (const s of sells) dist[s.sid || '(null)'] = (dist[s.sid || '(null)'] || 0) + 1;
console.log('卖行腿分布:', JSON.stringify(dist, null, 1));

const stallSells = sells.filter(s => String(s.sid) === 'stallClose');
console.log('stallClose 卖出行:', stallSells.length, '涉及票数:', new Set(stallSells.map(s => s.tok)).size);

// --- 首买时刻 ---
const firstBuy = new Map();
for (const t of clean) if (t.trade_direction === 'buy') {
  const at = new Date(t.created_at);
  if (!firstBuy.has(t.token_address) || at < firstBuy.get(t.token_address)) firstBuy.set(t.token_address, at);
}

// --- 逐票 ticks（并发 6） ---
async function fetchTicks(tok, t0ms) {
  const rows = [];
  let from = 0;
  while (true) {
    const q = await c.from('wss_price_ticks')
      .select('block_time,price_usd,price_outlier')
      .eq('token_address', tok)
      .gte('block_time', new Date(t0ms - 60_000).toISOString())
      .lte('block_time', new Date(t0ms + 900_000).toISOString())
      .order('id', { ascending: true }).range(from, from + 999);
    if (q.error) throw new Error(q.error.message);
    rows.push(...q.data); from += q.data.length;
    if (q.data.length < 1000) break;
  }
  return rows.map(r => ({ t: new Date(r.block_time).getTime(), p: r.price_usd, ox: r.price_outlier }))
    .filter(x => x.p != null && x.p > 0 && !x.ox);
}
const uniq = [...new Map(stallSells.map(s => [s.tok + '|' + s.at.toISOString(), s])).values()];
const results = [];
const pool = 6; let idx = 0;
async function worker() {
  while (idx < uniq.length) {
    const s = uniq[idx++];
    try {
      const ticks = await fetchTicks(s.tok, s.at.getTime());
      results.push({ ...s, ticks });
    } catch (e) { results.push({ ...s, ticks: null, err: e.message }); }
  }
}
await Promise.all(Array.from({ length: pool }, worker));
console.log('ticks 拉取完成:', results.filter(r => r.ticks).length, '/', results.length, results.filter(r => r.err).length ? 'ERR:' + results.filter(r => r.err).length : '');

// --- 卖后走势 ---
const out = [];
for (const r of results) {
  if (!r.ticks || r.ticks.length === 0) { out.push({ ...r, maxRise: null }); continue; }
  const sellMs = r.at.getTime();
  // 卖价锚=卖出时刻±3s 最近 tick 价（更稳：卖前最近价）
  let anchor = null, bestD = Infinity;
  for (const x of r.ticks) { const d = Math.abs(x.t - sellMs); if (d < bestD && x.t <= sellMs + 3000) { bestD = d; anchor = x.p; } }
  if (!anchor) anchor = r.ticks[0].p;
  let maxP = -Infinity, maxAt = null, t10 = null, t20 = null;
  for (const x of r.ticks) {
    if (x.t < sellMs - 2000) continue; // 卖出时刻起
    if (x.p > maxP) { maxP = x.p; maxAt = x.t; }
    if (t10 === null && x.p >= anchor * 1.10) t10 = x.t;
    if (t20 === null && x.p >= anchor * 1.20) t20 = x.t;
  }
  out.push({ ...r, anchor, maxRise: maxP > -Infinity ? (maxP / anchor - 1) * 100 : null,
    maxAt, t10s: t10 ? (t10 - sellMs) / 1000 : null, t20s: t20 ? (t20 - sellMs) / 1000 : null });
}

// --- 输出 ---
import { writeFileSync } from 'node:fs';
const fbs = firstBuy;
const rows = out.map(r => {
  const fb = fbs.get(r.tok);
  return {
    sym: r.sym, tok: r.tok,
    buyAt: fb ? fb.toISOString() : null,
    stallAt: r.at.toISOString(),
    holdSec: fb ? Math.round((r.at - fb) / 1000) : null,
    holdMd: r.hold, profitPct: r.profitPct != null ? +r.profitPct.toFixed(2) : null,
    maxRise15m: r.maxRise != null ? +r.maxRise.toFixed(1) : null,
    maxAt: r.maxAt ? new Date(r.maxAt).toISOString() : null,
    riseDelaySec: r.maxAt ? Math.round((r.maxAt - r.at.getTime()) / 1000) : null,
    tPlus10: r.t10s != null ? Math.round(r.t10s) : null,
    tPlus20: r.t20s != null ? Math.round(r.t20s) : null,
  };
}).sort((a, b) => (b.maxRise15m ?? -999) - (a.maxRise15m ?? -999));
writeFileSync('/tmp/v136-stall-times.json', JSON.stringify(rows, null, 1));
console.log('\n=== 全部 stallClose 卖出（按卖后 15min maxRise 降序）===');
console.table(rows.slice(0, 20));
const flown = rows.filter(r => (r.maxRise15m ?? -999) >= 20);
console.log(`\n卖飞(maxRise≥+20%): ${flown.length}/${rows.length}`);
console.table(flown);
await dbManager.end?.();
process.exit(0);
