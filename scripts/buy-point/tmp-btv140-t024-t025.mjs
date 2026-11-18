// 182 双任务：①T024 ticks 分段取证（慢拉卸货形状）+pump 量价锚；②127 票 famousTraces
// 全量重放（soldRatio/groupBuyPct/presenceNet）× ath/dom 组合 → 落 json 供本地定线
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { judgeFamousDanger } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const rev = JSON.parse(readFileSync('/tmp/btv140-review.json', 'utf8'));
const byAddr = new Map(rev.map(r => [r.addr, r]));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));

const snapOf = (p) => {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  return { snap: buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} }), rows };
};

// ① T024 分段取证：全窗按 5 分钟段剖（买/卖额+末价），+ pump 量价锚
{
  const p = doc.points.find(x => x.tokenAddress === '0x7e99d2d9054d59a1661e33bfa11c0fe248ce7777');
  const { snap, rows } = snapOf(p);
  const t0 = rows[0].dt ?? Date.parse(rows[0].block_time) / 1000;
  const te = rows[rows.length - 1].dt ?? Date.parse(rows[rows.length - 1].block_time) / 1000;
  const SEG = 300; // 5 分钟段
  console.log('=== T024 币安一直都在 分段剖面（窗 ' + (te - t0) + 's / ' + rows.length + ' 行）===');
  for (let s = t0; s < te; s += SEG) {
    let b = 0, sv = 0, n = 0, lastPx = null, buyers = new Set();
    for (const r of rows) {
      const dt = r.dt ?? Date.parse(r.block_time) / 1000;
      if (dt < s || dt >= s + SEG) continue;
      n++;
      if (String(r.trade_type).toUpperCase() === 'BUY') { b += r.bnb_amount || 0; buyers.add((r.sender_address || r.trader_address || '').toLowerCase()); }
      else sv += r.bnb_amount || 0;
      if (r.price_bnb && !r.price_outlier) lastPx = r.price_bnb;
    }
    const segIdx = Math.round((s - t0) / SEG);
    console.log(`  段${String(segIdx).padStart(2)} [${(s - t0) / 60 | 0}~${((s - t0) + SEG) / 60 | 0}min] ${n}笔 买${b.toFixed(2)}B(${buyers.size}户) 卖${sv.toFixed(2)}B 末价${lastPx ? (lastPx.toExponential(2)) : '-'}`);
  }
  const cd = snap.cheatDerived || {};
  console.log('pump 量价锚:', JSON.stringify({ pumpRisePerBuyBnb: cd.pumpRisePerBuyBnb, pumpStablePoints: cd.pumpStablePoints, pumpStableSpanSec: cd.pumpStableSpanSec, pumpStableR2: cd.pumpStableR2, pumpSlope: cd.pumpStableSlopePctPerMin, pumpSellTickPct: cd.pumpSellTickCountPct }));
}

// ② 127 票 famousTraces × ath/dom 全量
const out = [];
for (const p of doc.points) {
  const { snap } = snapOf(p);
  const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {};
  const f = judgeFamousDanger(snap).trace;
  out.push({ pid: p.pointId, sym: (byAddr.get(p.tokenAddress) || {}).symbol, pnl: (byAddr.get(p.tokenAddress) || {}).pnl ?? 0,
    ath: bd.athVsLaunchPct ?? null, vol: bd.totalVolumeBnb ?? null, chg30: bd.chg30Pct ?? null,
    dom: cd.famousDominancePct ?? null,
    soldRatio: f.soldRatio ?? null, groupBuyPct: f.groupBuyPct ?? null, groupSellPct: f.groupSellPct ?? null, presenceNetBnb: f.presenceNetBnb ?? null, wallets: f.wallets ?? 0 });
}
writeFileSync('/tmp/btv140-famous-all.json', JSON.stringify(out));
console.log('\n127 票 famousTraces 全量 → /tmp/btv140-famous-all.json');
