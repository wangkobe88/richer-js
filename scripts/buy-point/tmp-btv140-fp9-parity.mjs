// btv140 FP9 famous 系突发波臂全量重放对拍（182 跑零 DB）：127 票真重建 snapshot
// → 主案 BP-T048 TYB 被挡 + 其余 126 票 FP 判定零翻动（vs FP8 基线 /tmp/btv140-fp5-replay.json）
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy } = require_('../../src/market-analysis/factor-pre-buy-check.js');
const { sliceAsOf } = await import('./lib.mjs');

const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const r = evaluateFactorPreBuy(snap);
  out.push({ pointId: p.pointId, addr: p.tokenAddress, symbol: p.tokenSymbol, pass: r.pass, reason: r.reason, version: r.version,
    famBurst: snap.buyDerived.famBurstWave, pnl: p.trade?.episode?.pnlBnb ?? null,
    cheatExempt: null, fwd5Max: p.forwardReturns?.byHorizon?.['300']?.maxRisePct ?? null });
}
writeFileSync('/tmp/btv140-fp9-replay.json', JSON.stringify(out, null, 1));

const hits = out.filter((r) => r.reason === 'fam_burst_wave');
console.log(`127 票重放（version=${out[0].version}）→ /tmp/btv140-fp9-replay.json；fam_burst_wave 命中 ${hits.length} 张`);
for (const h of hits) {
  const w = h.famBurst;
  console.log(`  ${h.pointId} ${h.symbol} pnl=${h.pnl} | 静默${w.stallSec}s 波${w.waveBuyN}笔/${w.waveBuyBnb}B famous系${w.famSysSharePct}% 镜像簇${w.mirrorClusters} 首进${w.famousFirstInWave} 贴锚${w.anchorNearWave}`);
}

// 主案细节
const main = out.find((r) => r.addr === '0x21bf04d35b50ca63efcd97b476af98857e307777');
console.log(`\n主案 BP-T048 TYB: pass=${main.pass} reason=${main.reason} famBurst=${JSON.stringify(main.famBurst)}`);

// vs FP8 基线对拍（/tmp/btv140-fp5-replay.json——FP8 时代 evaluateFactorPreBuy 全量跑）
const base = existsSync('/tmp/btv140-fp5-replay.json')
  ? JSON.parse(readFileSync('/tmp/btv140-fp5-replay.json', 'utf8')) : null;
if (base) {
  const byId = new Map(base.map((r) => [r.pointId, r]));
  const flips = out.filter((r) => {
    const b = byId.get(r.pointId);
    return b && (b.pass !== r.pass || (b.fullReason ?? null) !== r.reason);
  });
  console.log(`\nvs FP8 基线翻动 ${flips.length} 张（期望=仅 T048）:`);
  for (const f of flips) console.log(`  ${f.pointId} ${f.symbol}: ${byId.get(f.pointId).pass}/${byId.get(f.pointId).fullReason ?? '-'} → ${f.pass}/${f.reason}`);
} else console.log('\n（无 FP8 基线 json——只看命中面）');

// 波存在面观察（非命中也打印 famBurstWave 非空票的构成——分布参考）
console.log('\n--- famBurstWave 非空票（stall≥30s 波语境在场）---');
for (const r of out) if (r.famBurst && (r.famBurst.famSysSharePct ?? 0) >= 30) {
  console.log(`  ${r.pointId} ${String(r.symbol).padEnd(8)} share=${r.famBurst.famSysSharePct}% 波买=${r.famBurst.waveBuyBnb}B 首进=${r.famBurst.famousFirstInWave} 贴锚=${r.famBurst.anchorNearWave} → ${r.pass ? '放行' : '拒 ' + r.reason}`);
}
