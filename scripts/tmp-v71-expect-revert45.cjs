// 一次性：纠正过宽裁定——仅六票漂移 review 票（CD194/201/208/214/217/233）保留用户裁定，
// 其余 45 票（CD185-CD235 减六票）expect 回退 unclear（用户「其它的我还没看呢」，逐批 review 后再落）
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'cheat-detection', 'fixtures.json');

const RULED = new Set(['CD194', 'CD201', 'CD208', 'CD214', 'CD217', 'CD233']);
const doc = JSON.parse(fs.readFileSync(FIX, 'utf8'));
let reverted = 0, kept = 0;
for (const c of doc.cases) {
  const idNum = Number(String(c.caseId).replace('CD', ''));
  if (idNum < 185 || idNum > 235) continue;
  if (RULED.has(c.caseId)) {
    // 六票措辞收紧：标明是六票漂移 review
    const m = /生产 D3\.57 首判 grade=(\w+)/.exec(c.expectBecause || '');
    if (m) {
      const drift = (c.expectBecause.split('；').slice(1).join('；'));
      c.expectBecause = `用户裁定（2026-11-04，六票漂移 review 标签页）认同生产结果=生产 D3.57 首判 grade=${m[1]}；${drift}`;
    }
    kept++;
  } else {
    c.expect = { verdict: 'unclear' };
    c.expectBecause = `--add 基线快照（${c.note}）`;
    reverted++;
  }
}
const tmp = FIX + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FIX);
console.log(`回退 ${reverted} 票 → unclear；保留六票裁定 ${kept} 票`);
