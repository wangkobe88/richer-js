// 一次性：CD185-CD235 用户裁定落档——expect=生产 D3.57 首判 grade（note 正则解析，单一真相源）
// 2026-11-04 用户：「这一批生产的结果我都赞同」——含 5 票真漂移（D3.59 判定分歧留档不改 expect）
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'cheat-detection', 'fixtures.json');

// D3.59 对拍两掷稳定值（漂移票）+方差票（台账 CD185-CD235 段）
const DRIFT = {
  CD194: 'D3.59 对拍两掷 healthy[clean]（E 通道不再触发）=放松方向分歧留档',
  CD201: 'D3.59 对拍两掷 cheat[A_strong:insider_supply_sell,E,L_insider_sell47,R_abnormal_dominant]=升拉黑级分歧留档',
  CD214: 'D3.59 对拍两掷 unhealthy[E_low_activity]=收紧方向分歧留档（生产已买入 1 笔=漏拦候选案，用户仍赞同生产 healthy）',
  CD217: 'D3.59 对拍两掷 unhealthy[J_holdings_strong]=降档分歧留档',
  CD233: 'D3.59 对拍两掷 unhealthy[M_hyper_activity]=降档分歧留档',
  CD208: '首跑 unhealthy 系 Jev 抽样方差，重掷回落 cheat 与生产同向（cd-run-2026-11-04T11-28-17-246Z）',
};

const doc = JSON.parse(fs.readFileSync(FIX, 'utf8'));
let n = 0;
for (const c of doc.cases) {
  const idNum = Number(String(c.caseId).replace('CD', ''));
  if (idNum < 185 || idNum > 235) continue;
  const m = /生产首判 grade=(\w+)/.exec(c.note || '');
  if (!m) { console.log('!! note 无基线，跳过', c.caseId); continue; }
  const prod = m[1];
  c.expect = { verdict: prod };
  const drift = DRIFT[c.caseId] ? `；${DRIFT[c.caseId]}` : '；对拍同向';
  c.expectBecause = `用户裁定（2026-11-04）「这一批生产的结果我都赞同」=生产 D3.57 首判 grade=${prod}${drift}`;
  n++;
}
const tmp = FIX + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FIX);
console.log(`落档 ${n} 票 expect=生产基线（CD185-CD235）`);
