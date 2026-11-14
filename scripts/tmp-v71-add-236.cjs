// 一次性：v71 新增票 CD236 AI时代（本地跑）
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'cheat-detection', 'fixtures.json');

const doc = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const ADDR = '0x9b43a52ebb8e1becb96e50ec085200277a407777';
if (doc.cases.some(c => c.addr === ADDR)) { console.log('已收录，跳过'); process.exit(0); }
const note = 'v71 936e1bd9 信号收录（生产首析锚对齐 anchorTicks=99=cheat_detection 首判行；信号数 1；执行 0；D3.57 基线生产首判 grade=unhealthy）；expect 待对拍后裁定';
doc.cases.push({
  caseId: 'CD236', symbol: 'AI时代', addr: ADDR, platform: 'flap',
  anchor: { tickCount: 99 },
  expect: { verdict: 'unclear' },
  note,
  addedAt: '2026-11-04',
  expectSince: '2026-11-04',
  expectBecause: `--add 基线快照（${note}）`,
});
const tmp = FIX + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FIX);
console.log('收录 CD236 AI时代，fixtures 总数', doc.cases.length);
