#!/usr/bin/env node
// 0x5629 团队·第四步：pair 缓存（纯本地文件）——团队内部配对强度
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const TEAM = JSON.parse(fs.readFileSync('/tmp/tmp-5629-team.json', 'utf8'));
const CACHE = path.join(__dirname, '..', 'data', 'offline-cache', 'copy-trade-pairs.json.gz');

const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(CACHE)).toString('utf8'));
console.log('[meta]', JSON.stringify({ ...parsed.meta, flyBuyers: parsed.meta.flyBuyers?.length + '个' }));
const set = new Set(TEAM);
const hits = [];
for (const p of parsed.pairs) {
  const [a, b] = p.k.split('|');
  if (set.has(a) && set.has(b)) hits.push({ a: a.slice(0, 10), b: b.slice(0, 10), co: p.co, sellSync: p.sellSync, even: p.even });
}
console.log(`\n团队内部 pair 数=${hits.length}（co≥5 的 ${hits.filter(h => h.co >= 5).length} 对）`);
hits.sort((x, y) => y.co - x.co);
for (const h of hits.slice(0, 30)) console.log(`${h.a}~${h.b} 共同票=${h.co} 同步清仓=${h.sellSync} 等额镜像=${h.even}`);
// 团队钱包与外部的最强 pair（团队规模外扩线索）
const ext = new Map();
for (const p of parsed.pairs) {
  const [a, b] = p.k.split('|');
  const inner = set.has(a) ? b : set.has(b) ? a : null;
  if (!inner) continue;
  if (p.co > (ext.get(inner) || 0)) ext.set(inner, p.co);
}
console.log(`\n与团队共同票数最多的外部钱包 top15（团队外扩线索）：`);
[...ext.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).forEach(([w, co]) => console.log(`${w} 共同票=${co}`));
