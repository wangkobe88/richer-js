// T167/FP10 对拍（182 跑零 DB）：127 票全量用 FP10 新代码重放 evaluateFactorPreBuy，
// 对照 /tmp/t167-pass2.json（FP9 基线 pass/reason）——差异必须恰为
// T029/T055/T056/T107 四票 pass true→false（reason=fam_low_exit_cooldown），零翻坏。
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy, FACTOR_PREBUY_VERSION } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const rev = JSON.parse(readFileSync('/tmp/btv140-review.json', 'utf8'));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const base = new Map(JSON.parse(readFileSync('/tmp/t167-pass2.json', 'utf8')).map((b) => [b.pid, b]));

console.log(`FP 版本=${FACTOR_PREBUY_VERSION}`);
const diffs = [];
const gateVals = [];
for (const rr of rev) {
  const p = doc.points.find((x) => x.pointId === rr.pointId);
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const fp = evaluateFactorPreBuy(snap);
  const b = base.get(rr.pointId);
  const same = (b.fpPass === fp.pass) && ((b.fpReason || null) === (fp.reason || null));
  if (!same) diffs.push({ pid: rr.pointId, sym: rr.symbol, pnl: rr.pnl, base: { pass: b.fpPass, reason: b.fpReason }, now: { pass: fp.pass, reason: fp.reason } });
  if (fp.arms.includes('fam_low_exit_cooldown')) {
    const ft = snap.buyDerived.famousTraces;
    gateVals.push({ pid: rr.pointId, pnl: rr.pnl, exitVs: ft.lastSellVsLaunchPct, gap: ft.lastSellToAnchorSec, buy: ft.groupBuyBnb, presence: ft.presenceNetBnb });
  }
}
console.log(`\n翻动 ${diffs.length} 票（须恰为 4：T029/T055/T056/T107 → fam_low_exit_cooldown）:`);
for (const d of diffs) console.log(`  ${d.pid} ${d.sym} pnl=${d.pnl} [${d.base.pass}/${d.base.reason}] → [${d.now.pass}/${d.now.reason}]`);
const okDiffs = diffs.length === 4 && diffs.every((d) => d.pid !== 'BP-T029' || true) && diffs.every((d) => d.now.reason === 'fam_low_exit_cooldown' && d.now.pass === false && d.base.pass === true);
console.log(`FP10 新拒票判据值（快照直供四键）:`);
for (const g of gateVals) console.log(`  ${g.pid} pnl=${g.pnl} 末卖@+${g.exitVs}% 距锚${g.gap}s 买${g.buy}B 残仓${g.presence}B`);
const hitSet = gateVals.map((g) => g.pid).sort().join(',');
console.log(`\n对拍结论: 翻动=${diffs.length}（期望 4）命中集=${hitSet}（期望 BP-T029,BP-T055,T056,T107 排序集）${okDiffs && hitSet === ['BP-T029', 'BP-T055', 'BP-T056', 'BP-T107'].sort().join(',') ? '✅ 达成' : '❌ 未达'}`);
writeFileSync('/tmp/t167-fp10-parity.json', JSON.stringify({ diffs, gateVals }, null, 1));
console.log('→ /tmp/t167-fp10-parity.json');
