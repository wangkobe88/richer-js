// 前期大户卖出比研究（2026-11-16 用户课题）：首 60s 大额钱包（累计买 ≥0.2B）卖出进度
// t*（累计卖/买 ≥70% 首达时刻）→ t* 价位状态 + 前向收益（+60/+300/+900s maxRise/last）
// 数据自包含：btv134-trades 集 149 点 ticks（零 DB）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const rev = Object.fromEntries(JSON.parse(readFileSync(resolve(HERE, 'data', 'btv134-review.json'), 'utf8')).map(r => [r.pointId, r]));

const pxOf = r => (r.price_usd != null && r.price_usd > 0 ? r.price_usd : r.price_bnb);
const out = [];

for (const p of doc.points) {
  const rows = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id));
  if (rows.length < 10) continue;
  const t0 = new Date(rows[0].block_time).getTime();
  const firstPx = pxOf(rows[0]);
  if (!firstPx) continue;

  // 大户：首 60s 累计买 ≥0.2B
  const big = new Map();
  for (const r of rows) {
    if (new Date(r.block_time).getTime() - t0 > 60000) break;
    if (r.trade_type !== 'buy') continue;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!w) continue;
    big.set(w, (big.get(w) || 0) + r.bnb_amount);
  }
  const bigList = [...big.entries()].filter(([, v]) => v >= 0.2);
  const bigBuy = bigList.reduce((s, [, v]) => s + v, 0);
  const rec = { pointId: p.pointId, sym: p.tokenSymbol, pnl: rev[p.pointId]?.pnl ?? null, bigN: bigList.length, bigBuy: +bigBuy.toFixed(2) };

  if (!bigList.length) { rec.shape = 'no_big'; out.push(rec); continue; }
  const bigSet = new Set(bigList.map(([w]) => w));

  // 扫卖出进度：t* = 累计卖/买 ≥0.7 首达
  let sold = 0, tStar = null, tStarPx = null;
  for (const r of rows) {
    if (r.trade_type !== 'sell') { if (tStar === null && pxOf(r)) tStarPx = pxOf(r); continue; }
    if (tStar !== null) break;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (bigSet.has(w)) sold += r.bnb_amount;
    if (pxOf(r)) tStarPx = pxOf(r);
    if (sold / bigBuy >= 0.7) tStar = new Date(r.block_time).getTime();
  }
  if (tStar === null) { rec.shape = 'not_sold70'; rec.soldPctEnd = +(sold / bigBuy * 100).toFixed(0); out.push(rec); continue; }

  // t* 时价格状态 + 前向
  rec.tStarSec = Math.round((tStar - t0) / 1000);
  rec.tStarVsLaunch = +((tStarPx / firstPx - 1) * 100).toFixed(1);
  let fwdMax = 0, fwdLast = null;
  for (const r of rows) {
    const ts = new Date(r.block_time).getTime();
    if (ts <= tStar) continue;
    const px = pxOf(r); if (!px) continue;
    const rise = (px / tStarPx - 1) * 100;
    if (ts - tStar <= 900000) { if (rise > fwdMax) fwdMax = rise; fwdLast = rise; }
    else break;
  }
  rec.fwdMax900 = +fwdMax.toFixed(1);
  rec.fwdLast900 = fwdLast == null ? null : +fwdLast.toFixed(1);
  rec.shape = 'sold70';
  out.push(rec);
}

// 汇总
const sold = out.filter(r => r.shape === 'sold70');
const held = sold.filter(r => r.tStarVsLaunch >= -10);   // 卖完时价格守住（≥首价-10%）
const broke = sold.filter(r => r.tStarVsLaunch < -10);   // 卖完时已崩
const noBig = out.filter(r => r.shape === 'no_big');
const notSold = out.filter(r => r.shape === 'not_sold70');
const stat = (label, arr) => {
  if (!arr.length) return console.log(label, '0 票');
  const avgMax = (arr.reduce((s, r) => s + (r.fwdMax900 ?? 0), 0) / arr.length).toFixed(1);
  const avgLast = (arr.reduce((s, r) => s + (r.fwdLast900 ?? 0), 0) / arr.length).toFixed(1);
  const pos = arr.filter(r => (r.fwdLast900 ?? -1) > 0).length;
  console.log(`${label}: ${arr.length} 票 | t*后900s 平均maxRise ${avgMax}% | 平均last ${avgLast}% | last>0 占 ${pos}/${arr.length}`);
};
console.log(`=== 前期大户卖出比研究（149 点，大户=首60s累计买≥0.2B，t*=卖出70%首达）===`);
stat('A 大户卖完&价格守住(≥-10%)', held);
stat('B 大户卖完&价格已崩(<-10%)', broke);
stat('C 大户未卖到 70%', notSold);
stat('D 无大户(<0.2B)', noBig);
console.log('\n--- A 组明细（好胚子候选）');
for (const r of held.sort((a, b) => (b.fwdLast900 ?? -999) - (a.fwdLast900 ?? -999))) {
  console.log(`  ${r.pointId} ${String(r.sym).slice(0,10).padEnd(10)} 大户${r.bigN}个/${r.bigBuy}B t*=+${r.tStarSec}s 卖完价${r.tStarVsLaunch >= 0 ? '+' : ''}${r.tStarVsLaunch}% → fwd900 max+${r.fwdMax900}% last${r.fwdLast900 ?? '?'}% | 实际pnl=${r.pnl}`);
}
console.log('\n--- B 组明细（崩盘组）');
for (const r of broke.sort((a, b) => (a.fwdLast900 ?? 0) - (b.fwdLast900 ?? 0)).slice(0, 15)) {
  console.log(`  ${r.pointId} ${String(r.sym).slice(0,10).padEnd(10)} 大户${r.bigN}个/${r.bigBuy}B t*=+${r.tStarSec}s 卖完价${r.tStarVsLaunch}% → fwd900 max+${r.fwdMax900}% last${r.fwdLast900 ?? '?'}% | 实际pnl=${r.pnl}`);
}
