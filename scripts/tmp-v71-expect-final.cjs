// 一次性：v71 review 46 票终裁落档（第 2-9 批；第 1 批六票漂移已在 3b0af207 落）
// 用户逐批标签页裁定：3 张人工翻案 healthy（CD190/CD191/CD223）、CD211 认同生产+漂移留档、其余认同生产
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'cheat-detection', 'fixtures.json');

// 用户翻案票（人工≠机器）特殊文案
const OVERRULE = {
  CD190: '用户裁定（2026-11-04 v71 review 第 2 批标签页）grade=healthy——人工×机器分歧票：生产 D3.57 与 D3.59 对拍均 unhealthy[R_abnormal_dominant]，用户判 healthy（expect 落人工值）',
  CD191: '用户裁定（2026-11-04 v71 review 第 3 批标签页）grade=healthy+收录强庄币组（CD159 池第 9 张）——人工×机器分歧票：两版均 unhealthy[D_famous_dominance,R_abnormal_dominant,M_hyper_activity]；组织集团拉盘形状（sbHold 40.4%/eqHold 46.0%/top1 仅 8.1%/churn 21/act ultra）',
  CD223: '用户裁定（2026-11-04 v71 review 第 7 批标签页）grade=healthy+收录强庄币组（CD159 池第 10 张，攒批目标达成）——人工×机器最重分歧票：两版均 cheat[A_strong:same_block_buy_wave,J_holdings_strong,R_abnormal_dominant,M_hyper_activity] 拉黑，用户判强庄（集团同块持续吸筹+筹码锁定：71 笔/50 钱包/top1 12.9%/sbHold 74.9%/eqHold 59.1%）',
};
// CD211 认同生产但 D3.59 漂移留档（review 中补录的第六票真漂移）
const SPECIAL = {
  CD211: '用户裁定（2026-11-04 v71 review 第 5 批标签页）认同生产 cheat；D3.59 对拍两掷 unhealthy[J_holdings_strong,R_abnormal_dominant]=第六票真漂移降档（拉黑→拒买）分歧留档（review 中补录，五批汇总初判漏检）',
};
function batchOf(id) {
  const n = Number(id.replace('CD', ''));
  if (n >= 185 && n <= 190) return 2;
  if (n === 191 || n === 192 || n === 193 || (n >= 195 && n <= 197)) return 3;
  if (n === 198 || n === 199 || n === 200 || (n >= 202 && n <= 204)) return 4;
  if (n >= 205 && n <= 211) return 5;
  if (n === 212 || n === 213 || (n >= 215 && n <= 219)) return 6;
  if (n >= 220 && n <= 225) return 7;
  if (n >= 226 && n <= 231) return 8;
  if (n === 232 || n === 234 || n === 235) return 9;
  return null;
}

const doc = JSON.parse(fs.readFileSync(FIX, 'utf8'));
let n = 0;
for (const c of doc.cases) {
  if (c.caseId === 'CD236') {
    c.expect = { verdict: 'unhealthy' };
    c.expectBecause = '用户裁定（2026-11-04 v71 review 第 9 批标签页）认同生产 unhealthy；D3.59 对拍同向 unhealthy[E_low_activity]';
    n++; continue;
  }
  const b = batchOf(c.caseId);
  if (!b) continue;
  if (OVERRULE[c.caseId]) {
    c.expect = { verdict: 'healthy' };
    c.expectBecause = OVERRULE[c.caseId];
  } else if (SPECIAL[c.caseId]) {
    const m = /生产首判 grade=(\w+)/.exec(c.note || '');
    c.expect = { verdict: m[1] };
    c.expectBecause = SPECIAL[c.caseId];
  } else {
    const m = /生产首判 grade=(\w+)/.exec(c.note || '');
    if (!m) { console.log('!! 无基线，跳过', c.caseId); continue; }
    c.expect = { verdict: m[1] };
    c.expectBecause = `用户裁定（2026-11-04 v71 review 第 ${b} 批标签页）认同生产 D3.57 首判 grade=${m[1]}；D3.59 对拍同向`;
  }
  n++;
}
const tmp = FIX + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FIX);
console.log(`终裁落档 ${n} 票（CD185-CD235 余 45 票 + CD236）`);
