// 一次性（本地）：第二层判别——基础五条件命中集（9 强庄+47 误豁）上找再分离锚
const fs = require('fs');
const dig = JSON.parse(fs.readFileSync('/tmp/sbp-digests.json', 'utf8'));
const FIX = require('./cheat-detection/fixtures.json');
const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const grpOf = {};
for (const c of FIX.cases) if (c.expect && c.expect.verdict) grpOf[c.caseId] = c.expect.verdict;
const RANK = { none: 0, weak: 1, moderate: 2, strong: 3 };
const L = (id, q) => (dig[id].levels[q] || 'none');
const base = (id) => L(id, 'wash_pair') === 'none' && RANK[L(id, 'same_block_buy_wave')] >= 2
  && L(id, 'slow_grind_pump') !== 'strong' && L(id, 'burst_spike_concentration') !== 'strong' && L(id, 'activity_level') !== 'low';

const all = Object.keys(dig).filter(id => dig[id].levels && grpOf[id]);
const hitStrong = STRONG.filter(base);
const hitOthers = all.filter(id => !STRONG.includes(id) && base(id));
console.log(`命中强庄 ${hitStrong.length}｜命中对照 ${hitOthers.length}`);

const auc = (A_, B_) => { let w = 0, n = 0; for (const a of A_) for (const b of B_) { n++; if (a > b) w++; else if (a === b) w += 0.5; } return n ? w / n : 0.5; };
const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
const fmt = (v) => v == null ? 'null' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(3);

const numKeys = new Set();
for (const id of [...hitStrong, ...hitOthers]) if (dig[id].anchors) Object.keys(dig[id].anchors).forEach(k => numKeys.add(k));
const rows = [];
for (const k of numKeys) {
  const g = id => { const v = dig[id].anchors && dig[id].anchors[k]; return typeof v === 'number' ? v : null; };
  const sv = hitStrong.map(g).filter(v => v != null), ov = hitOthers.map(g).filter(v => v != null);
  if (sv.length < 5 || ov.length < 5) continue;
  rows.push({ key: k, auc: auc(sv, ov), sMed: med(sv), oMed: med(ov), sN: sv.length, oN: ov.length });
}
rows.sort((x, y) => Math.abs(y.auc - 0.5) - Math.abs(x.auc - 0.5));
console.log('\n== 第二层锚区分度 TOP24（AUC>0.5=强庄更高）==');
for (const r of rows.slice(0, 24)) console.log(`${r.key} | AUC ${r.auc.toFixed(2)} | 强庄 ${r.sN} 中位 ${fmt(r.sMed)} | 误豁 ${r.oN} 中位 ${fmt(r.oMed)}`);

// 档位题在二层上的分布
console.log('\n== 二层档位分布（强庄命中 → 误豁对照）==');
for (const q of ['same_block_buy_wave','holdings_balance','bundled_trade_dominance','abnormal_behavior_ratio','activity_level','insider_supply_sell','equal_amount_split','amount_tiering','stall_burst_wave','creator_front_run','coordinated_sell_back']) {
  const d = ids => { const o = {}; for (const id of ids) { const l = L(id, q); o[l] = (o[l] || 0) + 1; } return JSON.stringify(o); };
  console.log(`${q}: 强庄=${d(hitStrong)} 误豁=${d(hitOthers)}`);
}
