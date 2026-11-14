#!/usr/bin/env node
// 一次性：合并 11-07 BP39 run 存档 → 159 点判定表 + good/neutral 通过集（本地纯文件读）
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'buy-point/data');
const files = fs.readdirSync(DIR).filter((f) => f.startsWith('bp-run-2026-11-07')).sort();
const byPoint = new Map();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (j.questionVersion !== 'BP39') continue;
  for (const r of (j.results || [])) byPoint.set(r.pointId, { ...r, ranAt: j.ranAt });
}
console.log('BP39 判定覆盖点数:', byPoint.size);
const dist = {};
for (const r of byPoint.values()) {
  const b = r.assessment ? (r.assessment.bucket || r.assessment.status || 'n/a') : '无assessment';
  dist[b] = (dist[b] || 0) + 1;
}
console.log('判定分布:', JSON.stringify(dist));
const pass = [...byPoint.values()].filter((r) => r.assessment && ['good', 'neutral'].includes(r.assessment.bucket));
console.log('通过点位数:', pass.length);
const byToken = {};
for (const r of pass) {
  (byToken[r.tokenAddress] = byToken[r.tokenAddress] || []).push(`${r.pointId}@${r.signalCreatedAt.slice(11, 19)}`);
}
console.log('通过 token 数:', Object.keys(byToken).length);
for (const [t, ps] of Object.entries(byToken)) console.log(' ', t, ps.join(', '));
const si = byPoint.get('BP-S149');
if (si) {
  console.log('S149 SI 判定:', JSON.stringify(si.assessment), 'qualities:', JSON.stringify(si.qualities).slice(0, 240));
  console.log('S149 signalCreatedAt:', si.signalCreatedAt, 'anchorTickCount:', si.anchorTickCount, 'thin:', si.thin);
}
// 供后续对照：落盘通过集
fs.writeFileSync('/tmp/bp39-pass.json', JSON.stringify(pass.map((r) => ({
  pointId: r.pointId, token: r.tokenAddress, at: r.signalCreatedAt,
  bucket: r.assessment.bucket, rule: r.assessment.rule, ranAt: r.ranAt,
})), null, 1));
console.log('通过集已落 /tmp/bp39-pass.json');
