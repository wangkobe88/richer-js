// btv134 任意批 famous 占比重算（182 跑，零 DB）：roster famousTraces + 0xa142 名单外补扫
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const IDS = process.argv.slice(2);
if (!IDS.length) { console.error('用法: tmp-btv134-famous-batch.mjs BP-T001,BP-T002,…'); process.exit(2); }
const want = new Set(IDS[0].split(','));
const EXTRA = ['0xa1426c6f65fe804e05ce3c07a42412d735ef78bc']; // 名单外 famous 候选（用户核对中）

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const tokensMeta = doc.tokens || {};

for (const p of doc.points) {
  if (!want.has(p.pointId)) continue;
  const rowsAll = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
  const rows = sliceAsOf(rowsAll, p.anchorTickCount);
  const meta = { ...(tokensMeta[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, {
    capped: p.capped === true, anchorTickCount: p.anchorTickCount,
    signalInfo: { firePriceBnb: p.signalInfo ? p.signalInfo.price : null },
  });
  const ft = snap.buyDerived.famousTraces;
  const parts = [];
  if (ft && ft.wallets.length) {
    parts.push(`roster: 占买 ${ft.groupBuyPct}%（${ft.groupBuyBnb} BNB）在场持有 ${ft.inCustodyCount} 人/净 ${ft.presenceNetBnb} | ` + ft.wallets.map(w => `${w.w.slice(0, 8)}…${w.w.slice(-4)} 买${w.buyBnb}@t+${w.firstBuyDt !== null ? Math.round(w.firstBuyDt) : '?'}s${w.sellN ? ' 卖' + w.sellBnb : ' 未卖'}`).join('；'));
  } else parts.push('roster: 无 famous');
  // 名单外候选补扫（锚窗内）
  for (const addr of EXTRA) {
    const mine = rows.filter(t => String(t.sender_address || t.trader_address || '').toLowerCase() === addr);
    if (!mine.length) continue;
    let buy = 0, sell = 0, first = null, last = null;
    const t0 = new Date((tokensMeta[p.tokenAddress] || {}).createdAt || NaN).getTime() / 1000;
    for (const t of mine) {
      const rel = Number.isFinite(t0) ? Math.round(new Date(t.block_time).getTime() / 1000 - t0) : null;
      if (t.trade_type === 'buy') buy += Number(t.bnb_amount); else sell += Number(t.bnb_amount);
      if (first === null || (rel !== null && rel < first)) first = rel;
      if (last === null || (rel !== null && rel > last)) last = rel;
    }
    const totBuy = rows.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.bnb_amount), 0);
    parts.push(`名单外 ${addr.slice(0, 8)}…：锚窗买 ${buy.toFixed(4)}（占 ${totBuy > 0 ? (buy / totBuy * 100).toFixed(1) : '?'}%）卖 ${sell.toFixed(4)} 区间 t+${first}~t+${last}s`);
  }
  console.log(`${p.pointId} ${p.tokenSymbol}: ${parts.join(' || ')}`);
}
