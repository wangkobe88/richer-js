// 一次性（本地）：基础五条件 + 二层数值网格验证
const fs = require('fs');
const dig = JSON.parse(fs.readFileSync('/tmp/sbp-digests.json', 'utf8'));
const FIX = require('./cheat-detection/fixtures.json');
const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const grpOf = {};
for (const c of FIX.cases) if (c.expect && c.expect.verdict) grpOf[c.caseId] = c.expect.verdict;
const RANK = { none: 0, weak: 1, moderate: 2, strong: 3 };
const L = (id, q) => (dig[id].levels[q] || 'none');
const A = (id, k) => { const v = dig[id].anchors && dig[id].anchors[k]; return typeof v === 'number' ? v : null; };
const base = (id) => L(id, 'wash_pair') === 'none' && RANK[L(id, 'same_block_buy_wave')] >= 2
  && L(id, 'slow_grind_pump') !== 'strong' && L(id, 'burst_spike_concentration') !== 'strong' && L(id, 'activity_level') !== 'low';
const all = Object.keys(dig).filter(id => dig[id].levels && grpOf[id]);
const grid = [[2.2,4.5,15],[2.5,4.5,15],[2.2,4.0,15],[2.5,5.0,12],[2.8,4.5,12],[2.2,5.5,15]];
for (const [bw, t2, sa] of grid) {
  const f = (id) => base(id) && (A(id, 'burstWaveBuyBnb') ?? 0) >= bw && (A(id, 'top2HoldSupplyPct') ?? 0) >= t2 && (A(id, 'sameAmountWalletPct') ?? 99) < sa;
  const s = STRONG.filter(f);
  const m = all.filter(id => !STRONG.includes(id) && f(id));
  const by = {};
  for (const id of m) by[grpOf[id]] = (by[grpOf[id]] || 0) + 1;
  console.log(`bw>=${bw} t2>=${t2} sameAmt<${sa} ｜ 强庄 ${s.length}/10：${s.join(',')} ｜ 误豁 ${m.length} ${JSON.stringify(by)}：${m.join(',')}`);
}
