/** BP77 三跑 malicious_dump 拦截面清单（一次性：解析本地 run JSON+set，零 DB 零 Jev） */
const fs = require('fs');
const DIR = '/home/ubuntu/richer-js/scripts/buy-point/';
const runs = [
  'data/bp-run-2026-11-11T23-21-06-756Z.json',
  'data/bp-run-2026-11-11T23-23-02-516Z.json',
  'data/bp-run-2026-11-11T23-23-33-402Z.json',
].map((f) => JSON.parse(fs.readFileSync(DIR + f, 'utf8')));
const set = JSON.parse(fs.readFileSync(DIR + 'sets/btv103-r2-trades.json', 'utf8'));
const byId = new Map((set.points || []).map((p) => [p.pointId, p]));

console.log('三跑文件签名:', runs.map((r) => r.set || r.setName || r.createdAt || '?').join(' / '));
const seen = new Set();
for (const run of runs) {
for (const r of run.results || []) {
  const es = r.dimensions && r.dimensions.entry_shape;
  if (!es || es.bucket !== 'malicious_dump') continue;
  if (seen.has(r.pointId)) continue;
  seen.add(r.pointId);
  const p = byId.get(r.pointId) || {};
  const pnl = p.trade && p.trade.episode ? p.trade.episode.pnlBnb : null;
  const trials = runs.map((run) => {
    const x = (run.results || []).find((y) => y.pointId === r.pointId);
    if (!x) return '缺';
    const b = x.dimensions && x.dimensions.entry_shape ? x.dimensions.entry_shape.bucket : '?';
    const pr = x.dimensions && x.dimensions.entry_shape ? x.dimensions.entry_shape.prob : '?';
    return `${b}(${pr})→${x.assessment.bucket}/${x.assessment.rule}`;
  });
  console.log(
    `${r.pointId} ${p.tokenSymbol || '?'} ${p.tokenAddress} pnl=${pnl === null ? '-' : Number(pnl).toFixed(4)}\n    run1 ${trials[0]}\n    run2 ${trials[1]}\n    run3 ${trials[2]}`
  );
}
}
console.log('共', seen.size, '点');
