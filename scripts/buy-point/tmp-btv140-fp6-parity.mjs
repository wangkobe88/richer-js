// btv140 FP6 全量重放对拍（182 跑零 DB）：pass 面不变（FP5 3 张）+ observe 标记面 + gates 形状抽样
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy, FACTOR_PREBUY_VERSION } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
console.log('FP 版本', FACTOR_PREBUY_VERSION);
let blocked = 0, observed = 0, gateSum = 0;
const obs = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const r = evaluateFactorPreBuy(snap);
  if (!r.pass) { blocked++; console.log(`  拦 ${p.pointId} ${p.tokenSymbol} ${r.reason}`); }
  if (r.observe) { observed++; obs.push(`${p.pointId} ${p.tokenSymbol} dom=${r.observe.domPct}% chg30=${r.observe.chg30Pct}%`); }
  if (r.gates) gateSum += r.gates.length;
}
console.log(`127 票重放：拦 ${blocked} / observe ${observed} / gates 均值 ${(gateSum / doc.points.length).toFixed(1)} 门`);
for (const o of obs) console.log('  👁 ' + o);
// gates 抽样打印一张（BP-T007 小树）
const p7 = doc.points.find((x) => x.tokenAddress === '0x925985909a7fa051f37fcf1d39f3a1f342517777');
const rows7 = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p7.ticksFile), 'utf8')).rows || [], p7.anchorTickCount);
const meta7 = { ...(doc.tokens[p7.tokenAddress] || {}), quoteToken: p7.quoteToken || null };
const snap7 = buildBuyPointSnapshot(rows7, meta7, { anchorTickCount: p7.anchorTickCount, capped: false, signalInfo: {} });
const r7 = evaluateFactorPreBuy(snap7);
console.log('\nBP-T007 小树 gates 抽样:');
for (const g of r7.gates) console.log(`  ${g.hit ? '🚫' : (g.observe ? '👁' : '  ')} ${g.label} | ${g.value} | ${g.line}`);
