// btv134 FP3 全量重放对拍（182 跑零 DB）：judgeFamousDanger 实判 vs 预扫分类
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { judgeFamousDanger } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const r = judgeFamousDanger(snap);
  out.push({ pointId: p.pointId, symbol: p.tokenSymbol, branch: r.branch, reason: r.reason ?? null, trace: r.trace });
}
writeFileSync('/tmp/btv134-fp3-replay.json', JSON.stringify(out));
const hits = out.filter(r => r.reason);
console.log(`149 票重放 → /tmp/btv134-fp3-replay.json；FP3 拦截 ${hits.length} 张`);
for (const h of hits) console.log(`  ${h.pointId} ${h.symbol} ${h.reason}（买${h.trace.groupBuyPct} 卖${h.trace.groupSellPct} 自卖比${h.trace.soldRatio} 总买${h.trace.totalBuyBnb} chg30${h.trace.chg30Pct}）`);
