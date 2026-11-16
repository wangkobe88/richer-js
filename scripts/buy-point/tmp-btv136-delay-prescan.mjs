// 推迟买入预扫（182 跑）：前期买入太多票（首60s大户≥0.2B合计 bigBuy）的
// v136 实际入场 vs 推迟到 age>N 后首个 ≤28.5% 时刻的入场价对比
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

// v136 首买时刻/价 + pnl
const c = await dbManager.getClient();
const trades = [];
let from = 0;
while (true) {
  const q = await c.from('trades').select('token_address,input_amount,output_amount,trade_direction,created_at').eq('experiment_id', V136).order('id', { ascending: true }).range(from, from + 999);
  if (!q.data.length) break;
  trades.push(...q.data); from += q.data.length;
  if (q.data.length < 1000) break;
}
const v136 = {};
for (const t of trades) {
  const e = v136[t.token_address] = v136[t.token_address] || { buy: 0, sell: 0, firstBuyTs: null, firstBuyPx: null, firstLeg: null };
  if (t.trade_direction === 'buy') {
    e.buy += t.input_amount;
    if (e.firstBuyTs === null) { e.firstBuyTs = t.created_at; }
  } else e.sell += t.output_amount;
}
for (const e of Object.values(v136)) e.pnl = +(e.sell - e.buy).toFixed(4);

const rows = [];
for (const p of doc.points) {
  const ticks = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  ticks.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id));
  if (ticks.length < 10) continue;
  const t0 = new Date(ticks[0].block_time).getTime();
  const firstPx = pxOf(ticks[0]);
  if (!firstPx) continue;
  // bigBuy: 首 60s 大户（≥0.2B）合计买入
  const big = new Map();
  for (const r of ticks) {
    if (new Date(r.block_time).getTime() - t0 > 60000) break;
    if (r.trade_type !== 'buy') continue;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (w) big.set(w, (big.get(w) || 0) + r.bnb_amount);
  }
  const bigBuy = +[...big.values()].filter(v => v >= 0.2).reduce((s, v) => s + v, 0).toFixed(2);
  const v = v136[p.tokenAddress];
  const entryAge = v?.firstBuyTs ? Math.round((new Date(v.firstBuyTs).getTime() - t0) / 1000) : null;
  // 实际入场价从 ticks 域取（trades.unit_price 四平台口径不一——BNB vs USD 混域）
  let entryPx = null;
  if (v?.firstBuyTs) {
    const fts = new Date(v.firstBuyTs).getTime();
    for (const r of ticks) {
      const px = pxOf(r); if (!px) continue;
      if (new Date(r.block_time).getTime() <= fts) entryPx = px; else break;
    }
  }
  // 推迟入场时刻：age>N 后首个（价 ≤ 首价×1.285）行
  const delayPx = {};
  for (const N of [60, 120, 180, 300]) {
    let found = null;
    for (const r of ticks) {
      const ts = new Date(r.block_time).getTime();
      if (ts - t0 < N * 1000) continue;
      const px = pxOf(r); if (!px) continue;
      if (px <= firstPx * 1.285) { found = { ts: Math.round((ts - t0) / 1000), px }; break; }
    }
    delayPx[N] = found;
  }
  rows.push({ id: p.pointId, sym: p.tokenSymbol, bigBuy, entryAge, entryPx, pnl: v?.pnl ?? null, d60: delayPx[60], d120: delayPx[120], d180: delayPx[180], d300: delayPx[300], firstPx });
}

// N=60 × 阈值扫描
console.log('=== N=60 推迟 × bigBuy 阈值扫描（v136 有入场的 149 集票）===');
for (const th of [1, 1.5, 2, 3]) {
  const g = rows.filter(r => r.bigBuy >= th && r.entryAge != null);
  const moved = g.filter(r => r.entryAge < 60 && r.d60);
  const lower = moved.filter(r => r.d60.px < r.entryPx);
  const higher = moved.filter(r => r.d60.px >= r.entryPx);
  const movedPnl = moved.reduce((x, r) => x + (r.pnl ?? 0), 0);
  const lowerPnl = lower.reduce((x, r) => x + (r.pnl ?? 0), 0);
  const higherPnl = higher.reduce((x, r) => x + (r.pnl ?? 0), 0);
  console.log(`th=${th}B: 覆盖 ${g.length} 张（全部有入场） | <60s 被推迟 ${moved.length} 张 | 推迟后价更低 ${lower.length} 张（这些票现pnlΣ=${lowerPnl.toFixed(3)}=潜在止血面） 价更高 ${higher.length} 张（pnlΣ=${higherPnl.toFixed(3)}=潜在误伤面）`);
  for (const r of moved) console.log(`    ${r.id} ${String(r.sym).slice(0,8).padEnd(8)} bigBuy=${r.bigBuy}B 实际+${r.entryAge}s@${(r.entryPx / r.firstPx).toFixed(2)}x → @+${r.d60.ts}s ${(r.d60.px / r.firstPx).toFixed(2)}x ${r.d60.px < r.entryPx ? '↓' : '↑'} pnl=${r.pnl}`);
}
// 重仓 cohorts
for (const [th, label] of [[3, 'bigBuy≥3B'], [5, 'bigBuy≥5B']]) {
  const g = rows.filter(r => r.bigBuy >= th);
  const moved = g.filter(r => r.entryAge != null && r.entryAge < 180 && r.d180);
  const better = moved.filter(r => r.d180.px < r.entryPx);
  const worse = moved.filter(r => r.d180.px >= r.entryPx);
  console.log(`\n=== ${label}: ${g.length} 张 | v136 有入场 ${g.filter(r => r.entryAge != null).length} 张`);
  console.log(`  实际入场 age<180s（会被 N=180 推迟改写入场的）: ${moved.length} 张`);
  if (moved.length) {
    console.log(`  推迟后入场价更低（避开下跌中继）: ${better.length} 张；更高（错过反弹起点）: ${worse.length} 张`);
    for (const r of moved) console.log(`    ${r.id} ${String(r.sym).slice(0,8).padEnd(8)} bigBuy=${r.bigBuy}B 实际+${r.entryAge}s@${(r.entryPx / r.firstPx - 1).toFixed(2)}x → 推迟@+${r.d180.ts}s ${(r.d180.px / r.firstPx - 1).toFixed(2)}x ${r.d180.px < r.entryPx ? '↓更低' : '↑更高'} pnl=${r.pnl}`);
  }
  // 未入场的（v134-only 被拦）：推迟口径下也永远 ≤28.5 才有入场
  const nobuy = g.filter(r => r.entryAge == null);
  console.log(`  v136 未买入: ${nobuy.length} 张（不受影响）`);
}
// 全体分布对照
const light = rows.filter(r => r.bigBuy < 3 && r.entryAge != null);
console.log(`\n=== 对照 light（bigBuy<3B）: ${light.length} 张有入场 | entryAge 中位 ${median(light.map(r => r.entryAge))}s | 其中 age<180 ${light.filter(r => r.entryAge < 180).length} 张`);
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
