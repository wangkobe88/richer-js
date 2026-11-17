// btv134 全量 149 票 famous 判别数据（182 跑零 DB）→ /tmp/btv134-famous-full.json
// 维度：锚窗吞吐（行数/总买）× famousTraces（占买/已卖比/在场净/人数）× 盘面状态（curVs/chg30/age）× 结局
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const tokensMeta = doc.tokens || {};
const out = [];

for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(tokensMeta[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const d = snap.buyDerived;
  const ft = d.famousTraces;
  const fwd = p.forwardReturns?.byHorizon || {};
  const rec = {
    pointId: p.pointId, symbol: p.tokenSymbol, addr: p.tokenAddress,
    pnl: p.trade?.episode?.pnlBnb ?? null,
    // 盘面热度
    ticks: p.anchorTickCount, totalBuy: +(rows.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.bnb_amount), 0)).toFixed(3),
    ageSec: d.tokenAgeSec, curVs: d.currentVsLaunchPct, chg30: d.chg30Pct, mcap: d.mcapBnb,
    // famous
    famPct: ft?.groupBuyPct ?? 0, famBuy: ft?.groupBuyBnb ?? 0,
    famSoldPct: ft && ft.groupBuyBnb > 0 ? +((ft.groupSellBnb / ft.groupBuyBnb) * 100).toFixed(1) : 0,
    famSellPct: ft?.groupSellPct ?? 0, famSell: ft?.groupSellBnb ?? 0,
    totalSell: +(rows.filter(t => t.trade_type === 'sell').reduce((s, t) => s + Number(t.bnb_amount), 0)).toFixed(3),
    presenceNet: ft?.presenceNetBnb ?? 0, inCustody: ft?.inCustodyCount ?? 0, walletsN: ft?.wallets?.length ?? 0,
    fwd1mMax: fwd['60']?.maxRisePct ?? null, fwd5mMax: fwd['300']?.maxRisePct ?? null,
  };
  out.push(rec);
}
writeFileSync('/tmp/btv134-famous-full.json', JSON.stringify(out));
const withFam = out.filter(r => r.walletsN > 0);
console.log(`149 票全量 → /tmp/btv134-famous-full.json；famous 在场票 ${withFam.length} 张`);
