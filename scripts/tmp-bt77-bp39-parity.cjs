// 全量扫 buy-point/data 找 5 锚票最近判定（BP39 版）
const fs = require('fs');
const dir = __dirname + '/buy-point/data';
const targets = ['0x92aac04f', '0xb97d5772', '0x24436292', '0xc88bf785', '0xbcb27c14'];
const files = fs.readdirSync(dir).filter(f => f.startsWith('bp-run-2026-11-0')).sort().reverse();
const found = {};
for (const f of files) {
  if (Object.keys(found).length >= targets.length) break;
  let j; try { j = JSON.parse(fs.readFileSync(dir + '/' + f)); } catch { continue; }
  for (const p of (j.results || [])) {
    const a = (p.tokenAddress || '').toLowerCase();
    const hit = targets.find(t => a.startsWith(t));
    if (!hit || found[hit + ':' + p.pointId]) continue;
    const asm = p.assessment || {};
    const pat = ((p.dimensions || {}).market_pattern || {}).bucket;
    found[hit + ':' + p.pointId] = 1;
    console.log(f.slice(7, 22), 'ver=' + (p.questionVersion || j.questionVersion), a.slice(0, 10), p.pointId, 'bucket=' + asm.bucket, 'rule=' + asm.rule, 'pattern=' + pat, 'anchor=' + (p.signalCreatedAt || '?'), 'anchorTicks=' + p.anchorTickCount);
  }
}
