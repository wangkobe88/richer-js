// btv134 下钻：BP-T145(B) 与 BP-T139(BSI) 首笔买入形状 + BSI 砸块锚（182 跑，零 DB）
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const byId = new Map(doc.points.map(p => [p.pointId, p]));

function rowsOf(p) {
  return JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [];
}
function firstBuys(pointId) {
  const p = byId.get(pointId);
  const rows = sliceAsOf(rowsOf(p), p.anchorTickCount);
  const t0 = new Date((doc.tokens[p.tokenAddress] || {}).createdAt || NaN).getTime() / 1000;
  console.log(`\n=== ${pointId} ${p.tokenSymbol} 锚窗 ${rows.length} 行，前 14 笔：`);
  for (const t of rows.slice(0, 14)) {
    const rel = Number.isFinite(t0) ? Math.round(new Date(t.block_time).getTime() / 1000 - t0) : '?';
    const w = String(t.sender_address || t.trader_address || '');
    console.log(`  t+${rel}s blk=${String(t.block_number).slice(-5)} ${t.trade_type.toUpperCase()} ${Number(t.bnb_amount).toFixed(4)} BNB @${Number(t.price_bnb).toPrecision(3)} ${w.slice(0, 10)}…${w.slice(-4)}`);
  }
  const buys = rows.filter(t => t.trade_type === 'buy');
  const totBuy = buys.reduce((s, t) => s + Number(t.bnb_amount), 0);
  const firstBuy = buys[0];
  const fw = String(firstBuy.sender_address || firstBuy.trader_address || '');
  const fRel = Number.isFinite(t0) ? Math.round(new Date(firstBuy.block_time).getTime() / 1000 - t0) : '?';
  console.log(`  首笔买入 ${Number(firstBuy.bnb_amount).toFixed(4)} BNB（t+${fRel}s ${fw.slice(0, 10)}…${fw.slice(-4)}）/ 锚窗总买 ${totBuy.toFixed(3)} = ${(Number(firstBuy.bnb_amount) / totBuy * 100).toFixed(1)}%`);
  const top = [...buys].sort((a, b) => Number(b.bnb_amount) - Number(a.bnb_amount)).slice(0, 3);
  for (const t of top) {
    const w = String(t.sender_address || t.trader_address || '');
    const rel = Number.isFinite(t0) ? Math.round(new Date(t.block_time).getTime() / 1000 - t0) : '?';
    console.log(`  top买 ${Number(t.bnb_amount).toFixed(4)} @t+${rel}s ${w.slice(0, 10)}…${w.slice(-4)}`);
  }
  return { p, rows };
}

firstBuys('BP-T145');
const { p: bsiP, rows: bsiRows } = firstBuys('BP-T139');

// ---- BSI 砸块锚 + per-block 聚合
{
  const meta = { ...(doc.tokens[bsiP.tokenAddress] || {}), quoteToken: bsiP.quoteToken || null };
  const snap = buildBuyPointSnapshot(bsiRows, meta, { anchorTickCount: bsiP.anchorTickCount, signalInfo: { firePriceBnb: bsiP.signalInfo ? bsiP.signalInfo.price : null } });
  const b = snap.buyDerived;
  const dumpKeys = Object.keys(b).filter(k => /dump/i.test(k));
  console.log(`\n=== BP-T139 砸块锚（键：${dumpKeys.join(',')}）`);
  for (const k of dumpKeys) console.log(`  ${k}: ${JSON.stringify(b[k])}`);
  const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
  const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(s => s.toLowerCase()));
  const byBlock = new Map();
  for (const t of bsiRows) {
    const blk = t.block_number;
    if (!byBlock.has(blk)) byBlock.set(blk, { buys: 0, buyN: 0, sells: 0, sellN: 0, sellers: new Set(), buyers: new Set(), dt: t.block_time });
    const e = byBlock.get(blk);
    const w = String(t.sender_address || t.trader_address || '').toLowerCase();
    if (t.trade_type === 'buy') { e.buys += Number(t.bnb_amount); e.buyN++; e.buyers.add(w); }
    else { e.sells += Number(t.bnb_amount); e.sellN++; if (!routers.has(w)) e.sellers.add(w); }
  }
  console.log('  -- per-block（卖 ≥0.2 或买 ≥1 的块）：');
  for (const [blk, e] of byBlock) {
    if (e.sells >= 0.2 || e.buys >= 1) console.log(`  blk ${blk} @${e.dt} 买${e.buys.toFixed(3)}(${e.buyN}笔/${e.buyers.size}户) 卖${e.sells.toFixed(3)}(${e.sellN}笔/${e.sellers.size}独立卖方剔路由)`);
  }
}
