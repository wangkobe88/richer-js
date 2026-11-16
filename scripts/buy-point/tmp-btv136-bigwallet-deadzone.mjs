// 死区成本面量化：t*价分桶 × v136 实际买入盈亏（182 跑，DB join）
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const pxOf = r => (r.price_usd != null && r.price_usd > 0 ? r.price_usd : r.price_bnb);
const V136 = '54c045ff-ab63-4bad-b71e-08b2e224c266';

const pts = [];
for (const p of doc.points) {
  const rows = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id));
  if (rows.length < 10) continue;
  const t0 = new Date(rows[0].block_time).getTime();
  const firstPx = pxOf(rows[0]);
  if (!firstPx) continue;
  const big = new Map();
  for (const r of rows) {
    if (new Date(r.block_time).getTime() - t0 > 60000) break;
    if (r.trade_type !== 'buy') continue;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (w) big.set(w, (big.get(w) || 0) + r.bnb_amount);
  }
  const bigList = [...big.entries()].filter(([, v]) => v >= 0.2);
  if (!bigList.length) { pts.push({ id: p.pointId, sym: p.tokenSymbol, addr: p.tokenAddress, bucket: 'no_big' }); continue; }
  const bigSet = new Set(bigList.map(([w]) => w));
  const bigBuy = bigList.reduce((s, [, v]) => s + v, 0);
  let sold = 0, tStar = null, tStarPx = null;
  for (const r of rows) {
    if (tStar !== null) break;
    if (r.trade_type === 'sell') { const w = (r.sender_address || r.trader_address || '').toLowerCase(); if (bigSet.has(w)) sold += r.bnb_amount; }
    if (pxOf(r)) tStarPx = pxOf(r);
    if (sold / bigBuy >= 0.7) tStar = new Date(r.block_time).getTime();
  }
  if (tStar === null) { pts.push({ id: p.pointId, sym: p.tokenSymbol, addr: p.tokenAddress, bucket: 'not_sold70' }); continue; }
  const vs = (tStarPx / firstPx - 1) * 100;
  const bucket = vs < 20 ? 'low<20' : vs < 40 ? 'mid20_40' : vs < 80 ? 'dead40_80' : 'high80+';
  pts.push({ id: p.pointId, sym: p.tokenSymbol, addr: p.tokenAddress, tStarVs: +vs.toFixed(1), bucket });
}

const c = await dbManager.getClient();
const trades = [];
let from = 0;
while (true) {
  const q = await c.from('trades').select('token_address,input_amount,output_amount,trade_direction').eq('experiment_id', V136).order('id', { ascending: true }).range(from, from + 999);
  if (!q.data.length) break;
  trades.push(...q.data); from += q.data.length;
  if (q.data.length < 1000) break;
}
const pnl = {};
for (const t of trades) {
  const e = pnl[t.token_address] = pnl[t.token_address] || { buy: 0, sell: 0 };
  if (t.trade_direction === 'buy') e.buy += t.input_amount; else e.sell += t.output_amount;
}
for (const e of Object.values(pnl)) e.pnl = +(e.sell - e.buy).toFixed(4);

const agg = {};
for (const p of pts) {
  const b = agg[p.bucket] = agg[p.bucket] || { total: 0, bought: 0, sum: 0, wins: 0, rows: [] };
  b.total++;
  const e = pnl[p.addr];
  if (e) {
    b.bought++; b.sum = +(b.sum + e.pnl).toFixed(4);
    if (e.pnl > 0) b.wins++;
    b.rows.push({ sym: p.sym, tStarVs: p.tStarVs, pnl: e.pnl });
  }
}
console.log('=== t*价分桶 × v136 实际买入（149 点集内）===');
for (const [k, b] of Object.entries(agg)) {
  console.log(`${k.padEnd(11)} 集${b.total} 张 | v136 买入 ${b.bought} | Σpnl ${b.sum} | 胜 ${b.wins}/${b.bought}`);
}
console.log('\n--- 死区 40~80 v136 买入明细：');
for (const r of (agg['dead40_80'] || {}).rows || []) console.log(`  ${String(r.sym).slice(0,10).padEnd(10)} t*=+${r.tStarVs}% pnl=${r.pnl}`);
console.log('\n--- 高位 ≥80 v136 买入明细：');
for (const r of (agg['high80+'] || {}).rows || []) console.log(`  ${String(r.sym).slice(0,10).padEnd(10)} t*=+${r.tStarVs}% pnl=${r.pnl}`);
console.log('\n--- 低位 <40（对照保留面）v136 买入最差 6：');
const lowRows = [...((agg['low<20'] || {}).rows || []), ...((agg['mid20_40'] || {}).rows || [])].sort((a, b) => a.pnl - b.pnl);
for (const r of lowRows.slice(0, 6)) console.log(`  ${String(r.sym).slice(0,10).padEnd(10)} t*=+${r.tStarVs}% pnl=${r.pnl}`);
console.log('  低位合计:', lowRows.length, '张 Σpnl', +lowRows.reduce((s, r) => s + r.pnl, 0).toFixed(4));
// 死区+高位若全拦的净效果
const deadSum = (agg['dead40_80'] || { sum: 0 }).sum, highSum = (agg['high80+'] || { sum: 0 }).sum;
console.log(`\n若拦「t*≥+40 卖完后的回落买点」：省下 dead40_80 ${-deadSum >= 0 ? '+' : ''}${-deadSum} + high80+ ${-highSum >= 0 ? '+' : ''}${-highSum} = 净 ${+(-deadSum - highSum).toFixed(4)}（负=误伤）`);
