// btv140 全 127 点「famous 系主导 burst 波」影响面扫描（182 跑零 DB）：
// 波=最后 ≥30s 静默出口起 gap<5s 连续簇（CD407 同源）；famous 系=roster 本人 ∪ 同块同额(0.0001)≥2 镜像簇
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { loadFamousRoster } = require_('../../src/market-analysis/cheat-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const rev = JSON.parse(readFileSync('/tmp/btv140-review.json', 'utf8'));
const byId = new Map(rev.map((r) => [r.pointId, r]));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const roster = loadFamousRoster();

const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
  const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });
  const norm = rows.map((r) => ({
    t: new Date(r.block_time).getTime(), wallet: String(r.sender_address || r.trader_address || '').toLowerCase(),
    side: String(r.trade_type).toLowerCase() === 'buy' ? 'B' : 'S', bnb: r.bnb_amount || 0,
    block: r.block_number, log: r.log_index,
  })).sort((a, b) => a.block - b.block || a.log - b.log);
  const T0 = norm[0].t, TA = norm[norm.length - 1].t;
  for (const n of norm) n.dt = (n.t - T0) / 1000;

  // 最后 ≥30s 静默段出口 + gap<5s 波簇
  let exitIdx = null, stallSec = null;
  for (let i = 1; i < norm.length; i++) {
    const g = (norm[i].t - norm[i - 1].t) / 1000;
    if (g >= 30) { exitIdx = i; stallSec = g; }
  }
  let waveEnd = norm.length;
  if (exitIdx !== null) for (let i = exitIdx + 1; i < norm.length; i++) {
    if ((norm[i].t - norm[i - 1].t) / 1000 >= 5) { waveEnd = i; break; }
  }
  const wave = exitIdx === null ? [] : norm.slice(exitIdx, waveEnd);
  const anchorInWave = wave.length > 0 && (TA - wave[wave.length - 1].t) / 1000 <= 5; // 锚贴波尾
  const buys = wave.filter((x) => x.side === 'B');
  const buyBnb = buys.reduce((s, x) => s + x.bnb, 0);
  const famBuyBnb = buys.filter((x) => roster.has(x.wallet)).reduce((s, x) => s + x.bnb, 0);
  // 同块同额镜像簇（≥2 笔含 ≥1 famous → 整簇计 famous 系）
  const mirrorWallets = new Set();
  const byKey = new Map();
  for (const x of buys) {
    if (x.bnb < 0.001) continue;
    const k = `${x.block}|${x.bnb.toFixed(4)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(x);
  }
  const clusters = [];
  for (const [k, xs] of byKey) {
    if (xs.length >= 2 && xs.some((x) => roster.has(x.wallet))) {
      for (const x of xs) mirrorWallets.add(x.wallet);
      clusters.push({ k, n: xs.length, bnb: xs.reduce((s, x) => s + x.bnb, 0), famous: xs.some((x) => roster.has(x.wallet)) });
    }
  }
  let mirrorBnb = 0;
  for (const x of buys) if (mirrorWallets.has(x.wallet)) mirrorBnb += x.bnb;
  // famous 本人是否在波内首次进场（roster 钱包全窗首买落在波内）
  const firstBuyDt = new Map();
  for (const x of norm) if (x.side === 'B' && !firstBuyDt.has(x.wallet)) firstBuyDt.set(x.wallet, x.dt);
  const famousInWave = wave.some((x) => roster.has(x.wallet) && firstBuyDt.get(x.wallet) >= wave[0]?.dt);
  const famNetPct = buyBnb > 0 ? (mirrorBnb / buyBnb) * 100 : null;

  const rr = byId.get(p.pointId);
  const cd = snap.cheatDerived || {};
  out.push({
    pid: p.pointId, sym: rr?.symbol, pnl: rr?.pnl, cheatExempt: rr?.cheat?.exempt?.code ?? null,
    originalGrade: rr?.cheat?.exempt?.originalGrade ?? rr?.cheat?.grade ?? null,
    waveN: wave.length, stallSec, waveBuyBnb: +buyBnb.toFixed(3), anchorInWave,
    famShare: famNetPct === null ? null : +famNetPct.toFixed(1),
    famousInWave, clusters: clusters.length,
    dom: cd.famousDominancePct ?? null, followerPct: cd.famousFollowerPct ?? null,
    groupBuyPct: cd.famousGroupBuyPct ?? null,
    fwd5Max: rr?.fwd5m?.max ?? null,
  });
}

// 排序输出：famShare 降序
out.sort((a, b) => (b.famShare ?? -1) - (a.famShare ?? -1));
console.log('pid        sym        pnl     exempt        waveN stall buyBnb  famShare inW dom   follPct clusters');
for (const o of out) {
  if ((o.famShare ?? 0) < 40 && !o.famousInWave) continue; // 只打有 famous 参与的面
  console.log(`${o.pid.padEnd(10)} ${String(o.sym).padEnd(10)} ${(o.pnl ?? 0).toFixed(3).padStart(7)} ${(o.cheatExempt || '-').padEnd(12)} ${String(o.waveN).padStart(5)} ${String(o.stallSec ?? '-').padStart(5)} ${String(o.waveBuyBnb).padStart(6)} ${String(o.famShare ?? '-').padStart(8)} ${o.famousInWave ? 'Y' : 'n'} ${String(o.dom ?? '-').padStart(5)} ${String(o.followerPct ?? '-').padStart(6)}  c=${o.clusters}`);
}
writeFileSync('/tmp/btv140-famburst-scan.json', JSON.stringify(out, null, 1));
console.log('\n→ /tmp/btv140-famburst-scan.json');

// 候选规则命中面：静默≥30s ∧ 波买≥0.3B ∧ famous系占比≥80% ∧ famous 波内首进
const hits = out.filter((o) => (o.stallSec ?? 0) >= 30 && o.waveBuyBnb >= 0.3 && (o.famShare ?? 0) >= 80 && o.famousInWave);
console.log(`\n候选规则（stall≥30 ∧ waveBuy≥0.3 ∧ famShare≥80 ∧ famousInWave）命中 ${hits.length} 票：`);
let sum = 0;
for (const h of hits) { sum += h.pnl ?? 0; console.log(`  ${h.pid} ${h.sym} pnl=${(h.pnl ?? 0).toFixed(3)} exempt=${h.cheatExempt} stall=${h.stallSec}s buy=${h.waveBuyBnb} famShare=${h.famShare}% dom=${h.dom}`); }
console.log(`拦截面 Σpnl=${sum.toFixed(3)}`);
