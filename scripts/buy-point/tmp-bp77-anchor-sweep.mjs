/** BP77 锚扫清单（一次性诊断：85 点全量塞单/砸块锚命中——零 Jev 零 DB，set+ticks 自包含） */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { sliceAsOf } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS_DIR = resolve(HERE, 'sets');
const require_ = (await import('module')).createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');

const doc = JSON.parse(readFileSync(resolve(SETS_DIR, 'btv103-r2-trades.json'), 'utf8'));
const tokensMeta = doc.tokens || {};
const cache = new Map();
const loadTicks = (f) => {
  if (!cache.has(f)) cache.set(f, JSON.parse(readFileSync(resolve(SETS_DIR, 'btv103-r2-trades-ticks', f), 'utf8')).rows || []);
  return cache.get(f);
};
const fmt = (x, d = 2) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));

let n = 0;
const eqs = [];
for (const p of doc.points) {
  if (p.anchorZero) continue;
  const rows = sliceAsOf(loadTicks(p.ticksFile), p.anchorTickCount);
  const meta = { ...(tokensMeta[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { capped: p.capped === true, anchorTickCount: p.anchorTickCount });
  const b = snap.buyDerived;
  const eq = b.exactEqualBlockMaxWallets, d1 = b.dumpBlock, d2 = b.dump2Block;
  n++; eqs.push(eq);
  if (eq >= 6 || d1 || d2) {
    console.log(`${p.pointId} ${p.tokenSymbol || '?'} ${p.tokenAddress.slice(0, 8)} | eq=${eq}` +
      (d1 ? ` | dump1 块${d1.block} 卖${fmt(d1.sellBnb)} 跌${d1.dropPct}% 卖方${d1.sellers} top${fmt(d1.topSellerPct, 0)}% 承接${d1.followBuyRatio === null ? '?' : fmt(d1.followBuyRatio)}` : '') +
      (d2 ? ` | dump2 块${d2.block}→${d2.block2} 卖${fmt(d2.sellBnb)} 跌${d2.dropPct}% 卖方${d2.sellers} top${fmt(d2.topSellerPct, 0)}% 承接${d2.followBuyRatio === null ? '?' : fmt(d2.followBuyRatio)}` : '') +
      ` | pnl=${p.trade && p.trade.episode ? fmt(p.trade.episode.pnlBnb, 4) : '-'}`);
  }
}
console.log(`\n扫 ${n} 点 | eq 分布: max=${Math.max(...eqs)} ≥8=${eqs.filter((x) => x >= 8).length} =7 ${eqs.filter((x) => x === 7).length} ∈[6,7] ${eqs.filter((x) => x >= 6 && x < 8).length}`);
