// btv140 FP5 尾声延伸活跃度门全量重放对拍（182 跑零 DB）：127 票真重建 snapshot
// → judgeTailPhaseActivity 实判；确认主案 BP-T013 1105 被挡 + 命中面/放行面
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { judgeTailPhaseActivity, evaluateFactorPreBuy } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const r = judgeTailPhaseActivity(snap);
  const full = evaluateFactorPreBuy(snap);
  out.push({ pointId: p.pointId, addr: p.tokenAddress, symbol: p.tokenSymbol, branch: r.branch, reason: r.reason ?? null, pass: full.pass, fullReason: full.reason, trace: r.trace, pnl: p.trade?.episode?.pnlBnb ?? null });
}
writeFileSync('/tmp/btv140-fp5-replay.json', JSON.stringify(out));
const hits = out.filter((r) => r.reason);
console.log(`127 票重放 → /tmp/btv140-fp5-replay.json；FP5 命中 ${hits.length} 张`);
for (const h of hits) console.log(`  ${h.pointId} ${h.symbol} ${h.reason} ${h.branch}（ath=${h.trace.athVsLaunchPct} vol=${h.trace.totalVolumeBnb} tpm120=${h.trace.tpm120} extBuy=${h.trace.extBuyBnb} pnl=${h.pnl}）`);
const main = out.find((r) => r.addr === '0x3fe6ec12671ab44484faa3245b3dcf0d84447777');
console.log(`\n主案 BP-T013 1105: branch=${main.branch} reason=${main.reason} pass=${main.pass} fullReason=${main.fullReason} trace=${JSON.stringify(main.trace)}`);
const fully = out.filter((r) => !r.pass);
console.log(`FP 整门拦截面（全因）: ${fully.length} 张——${fully.map((r) => `${r.pointId}:${r.fullReason}`).join(', ') || '无'}`);
