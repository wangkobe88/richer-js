/** BP78 取证 v2：43 点砸块锚票的锚窗总交易额轴（rows 直算）+activity 域对照（零 Jev 零 DB） */
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const DIR = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const runs = [
  'data/bp-run-2026-11-11T23-21-06-756Z.json',
  'data/bp-run-2026-11-11T23-23-02-516Z.json',
  'data/bp-run-2026-11-11T23-23-33-402Z.json',
].map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const bucketOf = new Map();
for (const run of runs) {
  for (const r of run.results || []) {
    const es = r.dimensions && r.dimensions.entry_shape;
    if (!es) continue;
    if (!bucketOf.has(r.pointId)) bucketOf.set(r.pointId, []);
    bucketOf.get(r.pointId).push(`${es.bucket}(${es.prob})`);
  }
}

const set = JSON.parse(readFileSync(join(DIR, 'sets/btv103-r2-trades.json'), 'utf8'));
const { buildBuyPointSnapshot } = require_(resolve(DIR, '../../src/market-analysis/buy-point-snapshot.js'));
const { sliceAsOf } = await import(resolve(DIR, 'lib.mjs'));

const loadTicks = (f) => JSON.parse(readFileSync(join(DIR, 'sets/btv103-r2-trades-ticks', f), 'utf8')).rows || [];
const fmt = (x, d = 2) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));
const g = (o, k) => (o && o[k] !== undefined ? o[k] : null);

let n = 0;
console.log('pointId 符号 pnl | 桶(run1) | 锚窗: 买卖总BNB trades span秒 min吞吐 | dump(卖额/跌%/卖方/top%/承接)');
for (const p of set.points) {
  if (p.anchorZero) continue;
  const rows = sliceAsOf(loadTicks(p.ticksFile), p.anchorTickCount);
  const meta = { ...((set.tokens || {})[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { capped: p.capped === true, anchorTickCount: p.anchorTickCount });
  const b = snap.buyDerived || {};
  const d1 = g(b, 'dumpBlock'), d2 = g(b, 'dump2Block');
  if (!d1 && !d2) continue;
  n++;
  const pnl = p.trade && p.trade.episode ? p.trade.episode.pnlBnb : null;
  // 锚窗 rows 直算总交易额（buy/sell 方向+尘 tick 全计，与 FA tradeCount 同域）
  let buy = 0, sell = 0;
  for (const t of rows) {
    const amt = Number(t.bnb_amount || 0);
    if (t.trade_type === 'buy') buy += amt; else if (t.trade_type === 'sell') sell += amt;
  }
  const es = bucketOf.get(p.pointId);
  const b1 = es ? es[0] : '未跑';
  const dd = (d) => d ? `块${d.block} ${fmt(d.sellBnb)}B/${fmt(d.dropPct)}%/${d.sellers}人/top${fmt(d.topSellerPct, 0)}%/承接${d.followBuyRatio === null ? '?' : fmt(d.followBuyRatio)}` : null;
  console.log(
    `${p.pointId} ${p.tokenSymbol || '?'} pnl=${pnl === null ? '-' : Number(pnl).toFixed(4)} | ${b1} | 买${fmt(buy)} 卖${fmt(sell)} 总${fmt(buy + sell)} ${rows.length}笔 ${g(b, 'spanSec')}s ${fmt((buy + sell) / (g(b, 'spanSec') || 1))}/min` +
    (dd(d1) ? `\n    d1 ${dd(d1)}` : '') + (dd(d2) ? `\n    d2 ${dd(d2)}` : '')
  );
}
console.log(`\n共 ${n} 点`);
