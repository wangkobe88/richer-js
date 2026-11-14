// 一次性（本地）：强庄豁免规律分析——强庄组 vs 人工裁定对照组逐锚分离度
const fs = require('fs');
const dig = JSON.parse(fs.readFileSync('/tmp/sbp-digests.json', 'utf8'));
const FIX = require('./cheat-detection/fixtures.json');

const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const V71 = Array.from({length: 52}, (_, i) => 'CD' + (185 + i)); // CD185-CD236（无 CD237；多余项自然 miss）

// 对照组=人工裁定 expect（v71 52 票 + 毕业维持/反例）
const grpOf = {};
for (const c of FIX.cases) if (c.expect && c.expect.verdict) grpOf[c.caseId] = c.expect.verdict;
const G = { cheat: [], unhealthy: [], healthy: [] };
for (const id of Object.keys(grpOf)) {
  if (STRONG.includes(id)) continue; // 强庄组单列（healthy 里的池票剔除）
  if (!dig[id]) continue;
  (G[grpOf[id]] || (G[grpOf[id]] = [])).push(id);
}
const S = STRONG.filter(id => dig[id]);
console.log(`强庄组 ${S.length}｜cheat ${G.cheat.length}｜unhealthy ${G.unhealthy.length}｜healthy(非池) ${G.healthy.length}`);

// 数值键集
const numKeys = new Set();
for (const v of Object.values(dig)) if (v.anchors) Object.keys(v.anchors).forEach(k => numKeys.add(k));

// AUC 近似：随机强庄票值 > 随机对照票值的比例（0.5=无区分；null 当 -Infinity 排最后=低）
function auc(valsA, valsB) {
  let w = 0, n = 0;
  for (const a of valsA) for (const b of valsB) { n++; if (a > b) w += 1; else if (a === b) w += 0.5; }
  return n ? w / n : 0.5;
}
const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
const fmt = (v) => v == null || Number.isNaN(v) ? 'null' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(3);

const rows = [];
for (const k of numKeys) {
  const sv = S.map(id => dig[id].anchors[k]).filter(v => typeof v === 'number');
  if (sv.length < 5) continue;
  for (const [name, list] of [['cheat', G.cheat], ['unhealthy', G.unhealthy]]) {
    const cv = list.map(id => dig[id].anchors[k]).filter(v => typeof v === 'number');
    if (cv.length < 5) continue;
    const a = auc(sv, cv);
    rows.push({ key: k, vs: name, auc: a, sMed: med(sv), cMed: med(cv), sNull: S.length - sv.length, cNull: list.length - cv.length });
  }
}
rows.sort((x, y) => Math.abs(y.auc - 0.5) - Math.abs(x.auc - 0.5));
console.log('\n== 数值锚区分度 TOP20（|AUC-0.5| 降序；强庄>对照方向=AUC>0.5）==');
console.log('锚键 | vs组 | AUC | 强庄中位 | 对照中位 | 强庄null | 对照null');
for (const r of rows.slice(0, 20)) console.log(`${r.key} | ${r.vs} | ${r.auc.toFixed(2)} | ${fmt(r.sMed)} | ${fmt(r.cMed)} | ${r.sNull}/${S.length} | ${r.cNull}`);

// 题档位分布
console.log('\n== 题档位分布（强庄组 → cheat 组）==');
for (const q of ['strong_backer_pressure','holdings_balance','activity_level','bundled_trade_dominance','abnormal_behavior_ratio','same_block_buy_wave','equal_amount_split','slow_grind_pump','burst_spike_concentration','insider_supply_sell','wash_pair','amount_tiering','stall_burst_wave','creator_front_run','coordinated_sell_back','sell_dispersion']) {
  const dist = (ids) => { const d = {}; for (const id of ids) { const l = dig[id] && dig[id].levels && dig[id].levels[q]; if (l) d[l] = (d[l] || 0) + 1; } return d; };
  const sd = dist(S), cd = dist(G.cheat), ud = dist(G.unhealthy);
  console.log(`${q}: 强庄=${JSON.stringify(sd)} cheat=${JSON.stringify(cd)} unhealthy=${JSON.stringify(ud)}`);
}
