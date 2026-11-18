// btv140 D 码∧activity 豁免放行 19 票 famousTraces 重放（182 跑零 DB）：
// FP3 judgeFamousDanger trace（占买/占卖/自卖比）——亏损票为何 FP3 二法没接住
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
const TARGETS = ['BP-T027','BP-T025','BP-T102','BP-T007','BP-T048','BP-T049','BP-T017','BP-T036','BP-T006','BP-T107','BP-T063','BP-T032','BP-T075','BP-T040','BP-T088','BP-T042','BP-T041','BP-T039','BP-T116'];
const byId = new Map(rev.map(r => [r.pointId, r]));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));

const out = [];
for (const pid of TARGETS) {
  const rr = byId.get(pid);
  const p = doc.points.find(x => x.pointId === pid);
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const f = judgeFamousDanger(snap);
  out.push({ pid, sym: rr.symbol, pnl: rr.pnl, hit: f.hit, branch: f.branch, reason: f.reason ?? null, trace: f.trace });
  const t = f.trace;
  console.log(`${pid} ${String(rr.symbol).padEnd(10)} pnl=${(rr.pnl ?? 0).toFixed(3)} | FP3=${f.branch}${f.reason ? '/' + f.reason : ''} | 占买${t.groupBuyPct ?? '-'}% 占卖${t.groupSellPct ?? '-'}% 自卖比${t.soldRatio ?? '-'} 在场净${t.presenceNetBnb ?? '-'} 钱包${t.wallets ?? 0} 总买${t.totalBuyBnb ?? '-'} chg30=${t.chg30Pct ?? '-'}`);
}
writeFileSync('/tmp/btv140-dex-famous.json', JSON.stringify(out, null, 1));
console.log('→ /tmp/btv140-dex-famous.json');
// 追加：cheatDerived.famousDominancePct（筹码口径——FP 门可得）
console.log('\n--- famousDominancePct（cheatDerived 筹码口径）+窄线扫描 ---');
for (const pid of TARGETS) {
  const rr = byId.get(pid);
  const p = doc.points.find(x => x.pointId === pid);
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const dom = snap.cheatDerived ? snap.cheatDerived.famousDominancePct : null;
  const f = out.find(o => o.pid === pid);
  f.dom = dom ?? null;
  console.log(`${pid} ${String(rr.symbol).padEnd(10)} pnl=${(rr.pnl ?? 0).toFixed(3)} dom=${dom ?? '-'}% 自卖比=${f.trace.soldRatio ?? '-'} chg30=${f.trace.chg30Pct ?? '-'} 占卖=${f.trace.groupSellPct ?? '-'}%`);
}
let hit = 0, sum = 0;
console.log('窄线扫描 dom≥90 ∧ chg30≤-20:');
for (const o of out) if ((o.dom ?? 0) >= 90 && (o.trace.chg30Pct ?? 0) <= -20) { hit++; sum += o.pnl ?? 0; console.log(`  拦 ${o.pid} ${o.sym} ${o.pnl.toFixed(3)}`); }
console.log(`拦 ${hit} 票 净=${sum.toFixed(3)}`);
