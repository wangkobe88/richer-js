// 时间衰减加权活跃度函数原型扫描（182 跑零 DB）：w(dt)=exp(-dt/τ) per-tick bnb 加权
// → 等效 BNB/min；双窗对照（180s/τ90 与 120s/τ60——用户「2 分钟窗口也可能就够」）
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { sliceAsOf } = await import('./lib.mjs');

const norm = (rows) => rows.map(r => ({ dt: (Date.parse(r.block_time)) / 1000, bnb: r.bnb_amount || 0, side: String(r.trade_type).toUpperCase() }));
const mkW = (tau, win) => (ticks, tEnd) => {
  let wsum = 0;
  for (const t of ticks) {
    const dt = tEnd - t.dt;
    if (dt < 0 || dt > win) continue;
    wsum += (t.bnb || 0) * Math.exp(-dt / tau);
  }
  const normMin = tau * (1 - Math.exp(-win / tau)) / 60;
  return +(wsum / normMin).toFixed(3);
};
const weightedThroughput = mkW(90, 180);  // 3 分钟窗 τ=90
const weightedThroughput2 = mkW(60, 120); // 2 分钟窗 τ=60

// 6×30s 段吞吐（看时间结构）
function segProfile(ticks, tEnd) {
  const segs = [];
  for (let i = 0; i < 6; i++) {
    let b = 0;
    for (const t of ticks) {
      const dt = tEnd - t.dt;
      if (dt >= i * 30 && dt < (i + 1) * 30) b += t.bnb || 0;
    }
    segs.push(+(b.toFixed(2)));
  }
  return segs; // [0-30s, 30-60, ..., 150-180]
}

const rev = JSON.parse(readFileSync('/tmp/btv140-review.json', 'utf8'));
const byAddr = new Map(rev.map(r => [r.addr, r]));
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));

const out = [];
for (const p of doc.points) {
  const rows = sliceAsOf(JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [], p.anchorTickCount);
  if (!rows.length) continue;
  const nrm = norm(rows);
  const tEnd = nrm[nrm.length - 1].dt;
  const wt = weightedThroughput(nrm, tEnd);
  const wt2 = weightedThroughput2(nrm, tEnd);
  const segs = segProfile(nrm, tEnd);
  const rr = byAddr.get(p.tokenAddress) || {};
  out.push({ pid: p.pointId, sym: rr.symbol, pnl: rr.pnl ?? 0,
    actW: wt, actW2: wt2, segs,
    w30: segs[0] ? +(segs[0] * 2).toFixed(2) : 0,
    cheatAct: rr.cheat && rr.cheat.act, exempt: rr.cheat && rr.cheat.exempt ? rr.cheat.exempt.code : null });
}
writeFileSync('/tmp/btv140-actw.json', JSON.stringify(out));
const highEx = out.filter(x => x.exempt === 'activity_high');
console.log('activity_high 豁免票（' + highEx.length + ' 张）按 actW120 升序前 22——近30s高但加权低=时间结构背离:');
for (const x of highEx.sort((a, b) => a.actW2 - b.actW2).slice(0, 22)) {
  const line = '  ' + x.pid + ' ' + String(x.sym).padEnd(9) + ' pnl=' + x.pnl.toFixed(3)
    + ' actW180=' + String(x.actW).padStart(6) + ' actW120=' + String(x.actW2).padStart(6)
    + ' 近30s=' + String(x.w30).padStart(5) + 'B/min 段=[' + x.segs.join(',') + ']';
  console.log(line);
}
const sorted = [...out].sort((a, b) => a.actW2 - b.actW2);
console.log('actW120 分布分位:', [0.1, 0.25, 0.5, 0.75, 0.9].map(q => 'p' + q * 100 + '=' + sorted[Math.floor(sorted.length * q)].actW2).join(' '));
console.log('actW180 分布分位:', [0.1, 0.25, 0.5, 0.75, 0.9].map(q => 'p' + q * 100 + '=' + [...out].sort((a, b) => a.actW - b.actW)[Math.floor(out.length * q)].actW).join(' '));
