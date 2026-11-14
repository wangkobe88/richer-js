// 本轮 D3.51 全量 vs D3.39 基线 逐票 grade 对照 + 载体透视（182 跑）
const fs = require('fs');
const path = require('path');
const DATA_DIR = '/home/ubuntu/richer-js/scripts/cheat-detection/data';

const fixtures = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/fixtures.json', 'utf8'));
const cur = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cd-run-2026-11-03T13-38-03-338Z.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cd-run-2026-11-03T00-58-40-508Z.json'), 'utf8'));

const curBy = new Map(cur.results.map(r => [r.caseId, r]));
const baseBy = new Map(base.results.map(r => [r.caseId, r]));
const expBy = new Map(fixtures.cases.map(c => [c.caseId, c]));

// 基线票集（128）与新增票集
let both = 0, onlyCur = [];
for (const c of fixtures.cases) {
  if (baseBy.has(c.caseId)) both++; else onlyCur.push(c.caseId);
}
console.log('基线在册=' + both + ' 新增票=' + onlyCur.length + '（' + onlyCur.slice(0, 5).join(',') + '…）');

// 1) 本轮 vs 基线 grade 位移（同票集）
const shifts = [];
for (const [cid, r] of curBy) {
  const b = baseBy.get(cid);
  if (!b) continue;
  if (b.grade !== r.grade) shifts.push({ cid, from: b.grade, to: r.grade, reasons: (r.gradeReasons || []).map(g => g.level + ':' + g.code).join('+') });
}
const shiftDirs = {};
for (const s of shifts) { const k = s.from + '→' + s.to; (shiftDirs[k] = shiftDirs[k] || []).push(s.cid); }
console.log('\n== 本轮 vs D3.39 基线 grade 位移 ' + shifts.length + ' 票 ==');
for (const [k, ids] of Object.entries(shiftDirs)) console.log(k + ': ' + ids.length + ' = ' + ids.join(','));

// 2) 位移票里尖刺题作 A 载体的（D3.51 直接效应）
const spikeCarriers = shifts.filter(s => /burst_spike_concentration/.test(s.reasons));
console.log('\n== 位移票中 D3.51 尖刺题参与 A 载体：' + spikeCarriers.length + ' 票 ==');
for (const s of spikeCarriers) {
  const c = expBy.get(s.cid);
  console.log(`${s.cid} ${c ? c.symbol : '?'} 基线=${s.from} 本轮=${s.to} expect=${c && c.expect ? c.expect.verdict : '?'} [${s.reasons}]`);
}

// 3) 未位移但与 expect 分歧的=基线期既有分歧
let baseDiff = 0;
for (const [cid, r] of curBy) {
  const b = baseBy.get(cid); if (!b) continue;
  const c = expBy.get(cid); if (!c || !c.expect) continue;
  if (b.grade !== c.expect.verdict && r.grade === b.grade) baseDiff++;
}
console.log('\n基线期既有分歧（本轮未位移仍≠expect）≈ ' + baseDiff + ' 票');
