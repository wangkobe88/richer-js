// btv134 蝴蝶人生2.0/老貓 burst 族锚快查（182 跑，零 DB）
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades.json'), 'utf8'));
for (const pid of ['BP-T095', 'BP-T058']) {
  const p = doc.points.find(x => x.pointId === pid);
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv134-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || {}), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, signalInfo: {} });
  const d = snap.buyDerived;
  const burstKeys = Object.keys(d).filter(k => /burst|stall|postStall/i.test(k));
  console.log(`\n=== ${pid} ${p.tokenSymbol}（锚 ${p.anchorTickCount} 行 age=${d.tokenAgeSec}s）`);
  for (const k of burstKeys) console.log(`  ${k}: ${JSON.stringify(d[k])}`);
}
