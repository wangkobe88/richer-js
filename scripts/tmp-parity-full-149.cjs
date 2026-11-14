// 全量 149 票机器×人工对拍（182 跑）：最新 cd-run 存档 vs fixtures expect
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/home/ubuntu/richer-js/scripts/cheat-detection/data';
const fixtures = JSON.parse(fs.readFileSync('/home/ubuntu/richer-js/scripts/cheat-detection/fixtures.json', 'utf8'));

// 最新 cd-run 存档
const runs = fs.readdirSync(DATA_DIR).filter(f => /^cd-run-.*\.json$/.test(f)).sort();
const runFile = runs[runs.length - 1];
const run = JSON.parse(fs.readFileSync(path.join(DATA_DIR, runFile), 'utf8'));
console.log('存档=' + runFile, 'questionVersion=' + run.questionVersion, 'results=' + run.results.length);

const byCase = new Map(run.results.map(r => [r.caseId, r]));
const expectByCase = new Map(fixtures.cases.map(c => [c.caseId, c]));

let agree = 0;
const diffs = [];
const missing = [];
for (const c of fixtures.cases) {
  const r = byCase.get(c.caseId);
  if (!r) { missing.push(c.caseId); continue; }
  const exp = c.expect && c.expect.verdict;
  const got = r.grade;
  if (exp === got) agree++;
  else diffs.push({ caseId: c.caseId, symbol: c.symbol, addr: c.addr, exp, got, reasons: (r.gradeReasons || []).map(g => g.level + ':' + g.code).join('+') });
}

console.log('对拍：' + agree + '/' + fixtures.cases.length + ' 一致，分歧 ' + diffs.length + '，缺结果 ' + missing.length);
if (missing.length) console.log('MISSING:', missing.join(','));

// 方向分组
const dirs = {};
for (const d of diffs) {
  const k = d.exp + '→' + d.got;
  (dirs[k] = dirs[k] || []).push(d.caseId);
}
console.log('\n== 方向分组 ==');
for (const [k, ids] of Object.entries(dirs)) console.log(k + ': ' + ids.length + ' 票 = ' + ids.join(','));

console.log('\n== 分歧明细 ==');
for (const d of diffs) console.log(`${d.caseId} ${d.symbol} ${d.addr} 人工=${d.exp} 机器=${d.got} [${d.reasons}]`);

// grade 总分布
const dist = {};
for (const r of run.results) dist[r.grade] = (dist[r.grade] || 0) + 1;
console.log('\n== 机器 grade 分布 ==', JSON.stringify(dist));
