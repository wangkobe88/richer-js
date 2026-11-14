// 一次性（本地）：晚锚命中曲线——数值规则 R(bw≥2.2 ∧ t2≥4.5 ∧ sa<15) 在各截点的命中数
// 分池/对照三组；池票锚轨迹单调性；以及「截点窗耗尽」结构（对照组死票活不到大锚）
const fs = require('fs');
const D = JSON.parse(fs.readFileSync('/tmp/sbp-late.json', 'utf8'));
const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const R = (c) => c && (c.burstWaveBuyBnb ?? 0) >= 2.2 && (c.top2HoldSupplyPct ?? 0) >= 4.5 && ((c.sameAmountWalletPct ?? 99) < 15);

const grp = (id) => STRONG.includes(id) ? '池' : (D[id].verdict === 'cheat' ? 'cheat' : D[id].verdict === 'unhealthy' ? 'unh' : 'healthy');

// 1) 池票逐票轨迹：各截点 R 命中 + 关键锚
console.log('== 池 10 票：截点 → R命中(bw/t2/sa) ==');
for (const id of STRONG) {
  const t = D[id]; if (!t) continue;
  const line = Object.keys(t.cps).map(n => {
    const c = t.cps[n];
    return `${n}${R(c) ? '✓' : '·'}(${(c.burstWaveBuyBnb ?? -1).toFixed(1)}/${(c.top2HoldSupplyPct ?? -1).toFixed(1)}/${(c.sameAmountWalletPct ?? 99).toFixed(0)})`;
  }).join(' ');
  console.log(`${id} ${String(t.symbol).padEnd(10)} 锚${t.anchor} 全量${t.rowsTotal} | ${line}`);
}

// 2) 三组在各「绝对截点档」的 R 命中率（截点按绝对 tick 数分档，跨票可比）
console.log('\n== 各绝对截点档 R 命中（组 命中/有该截点的票数）==');
const BINS = [[50, 100], [100, 200], [200, 400], [400, 700], [700, 3000]];
for (const [lo, hi] of BINS) {
  const stat = { 池: [0, 0], cheat: [0, 0], unh: [0, 0], healthy: [0, 0] };
  for (const [id, t] of Object.entries(D)) {
    const cps = Object.keys(t.cps).map(Number).filter(n => n > lo && n <= hi).sort((a, b) => b - a); // 取窗内最大截点
    if (!cps.length) continue;
    const c = t.cps[cps[0]];
    const g = stat[grp(id)];
    g[1]++;
    if (R(c)) g[0]++;
  }
  console.log(`(${lo},${hi}] ` + Object.entries(stat).map(([k, [h, n]]) => `${k} ${h}/${n}`).join(' | '));
}

// 3) 「最终截点」= 每票最大截点（全窗）R 命中——回答「只是推迟吗」
console.log('\n== 每票最终截点（全窗/近全窗）R 命中 ==');
const fin = { 池: [0, []], cheat: [0, []], unh: [0, []], healthy: [0, []] };
for (const [id, t] of Object.entries(D)) {
  const ns = Object.keys(t.cps).map(Number);
  const c = t.cps[Math.max(...ns)];
  const g = fin[grp(id)];
  if (R(c)) { g[0]++; g[1].push(`${id}@${Math.max(...ns)}`); }
}
for (const [k, [h, l]] of Object.entries(fin)) console.log(`${k} ${h}：${l.join(' ')}`);

// 4) 池票锚轨迹单调性：top2/cluster/burstWave 首末对比
console.log('\n== 池票锚窗内累积（首截点→末截点）==');
for (const id of STRONG) {
  const t = D[id]; if (!t) continue;
  const ns = Object.keys(t.cps).map(Number).sort((a, b) => a - b);
  const a = t.cps[ns[0]], b = t.cps[ns[ns.length - 1]];
  const f = (v) => v == null ? '-' : v >= 10 ? v.toFixed(0) : v.toFixed(1);
  console.log(`${id} t2 ${f(a.top2HoldSupplyPct)}→${f(b.top2HoldSupplyPct)} cluster ${f(a.clusterHoldSupplyPct)}→${f(b.clusterHoldSupplyPct)} bwBnb ${f(a.burstWaveBuyBnb)}→${f(b.burstWaveBuyBnb)} bwW ${f(a.burstWaveWallets)}→${f(b.burstWaveWallets)} wallets ${f(a.walletCount)}→${f(b.walletCount)} 锚后窗 ${ns[ns.length - 1] - t.anchor} 笔`);
}

// 5) 对照组全窗 R 命中票的形状（谁在晚锚也过数值门——污染源）
console.log('\n== 对照组最终截点 R 命中票明细（误豁污染候选）==');
for (const id of [...fin.cheat[1], ...fin.unh[1]]) {
  const t = D[id];
  const ns = Object.keys(t.cps).map(Number);
  const c = t.cps[Math.max(...ns)];
  console.log(`${id} ${String(t.symbol).padEnd(10)} ${grp(id)} @${Math.max(...ns)} washN=${c.washPairCount} act=${c.activityLevel} pumpPts=${c.pumpStablePoints} rise/buy=${c.pumpRisePerBuyBnb == null ? '-' : c.pumpRisePerBuyBnb.toFixed(2)} sellPct=${c.pumpSellTickCountPct == null ? '-' : c.pumpSellTickCountPct.toFixed(0)} spikeAll=${c.spikeHoldPctAll == null ? '-' : c.spikeHoldPctAll.toFixed(0)} sa=${c.sameAmountWalletPct == null ? '-' : c.sameAmountWalletPct.toFixed(0)} t2=${c.top2HoldSupplyPct == null ? '-' : c.top2HoldSupplyPct.toFixed(1)} bw=${c.burstWaveBuyBnb == null ? '-' : c.burstWaveBuyBnb.toFixed(1)}`);
}

// 6) 「曾经命中」语义：每票全部截点任一命中 R（生产=unhealthy 每买信号重判的多截点形状）
console.log('\n== 曾经命中（任一截点 R 命中）==');
const ever = { 池: [], cheat: [], unh: [], healthy: [] };
for (const [id, t] of Object.entries(D)) {
  if (Object.values(t.cps).some(R)) ever[grp(id)].push(id);
}
for (const [k, l] of Object.entries(ever)) console.log(`${k} ${l.length}/${Object.values(D).filter(t => true).length ? '' : ''}${l.join(' ')}`);
const tot = { 池: 0, cheat: 0, unh: 0, healthy: 0 };
for (const id of Object.keys(D)) tot[grp(id)]++;
for (const [k, l] of Object.entries(ever)) console.log(`   ${k}: ${l.length}/${tot[k]}`);

// 曾经命中+只算大锚（≥100）截点：晚锚版曾经命中
console.log('\n== 曾经命中（只算 >100 截点）==');
for (const min of [100, 150]) {
  const ev2 = { 池: [], cheat: [], unh: [], healthy: [] };
  for (const [id, t] of Object.entries(D)) {
    if (Object.entries(t.cps).some(([n, c]) => Number(n) > min && R(c))) ev2[grp(id)].push(id);
  }
  console.log(`min>${min}：` + Object.entries(ev2).map(([k, l]) => `${k} ${l.length}/${tot[k]}${l.length <= 6 ? '(' + l.join(',') + ')' : ''}`).join(' | '));
}

// 7) 曾经命中 ∧ 数值版排除臂（washPairCount==0 ∧ 代码 act≠low）——数值层可得的保守污染下界
console.log('\n== 曾经命中 ∧ washN==0 ∧ act≠low（数值/代码层，Jev 档位未含）==');
const R2 = (c) => R(c) && (c.washPairCount ?? 99) === 0 && c.activityLevel !== 'low';
for (const min of [0, 100]) {
  const ev = { 池: [], cheat: [], unh: [], healthy: [] };
  for (const [id, t] of Object.entries(D)) {
    if (Object.entries(t.cps).some(([n, c]) => Number(n) > min && R2(c))) ev[grp(id)].push(id);
  }
  console.log(`min>${min}：` + Object.entries(ev).map(([k, l]) => `${k} ${l.length}/${tot[k]}${l.length <= 10 ? '(' + l.join(',') + ')' : ''}`).join(' | '));
}

// 修正：washPairCount null=无配对=none 语义（≠99 排除）
const R2b = (c) => R(c) && (c.washPairCount == null || c.washPairCount === 0) && c.activityLevel !== 'low';
console.log('\n== 曾经命中 ∧ (washN null|0) ∧ act≠low ==');
for (const min of [0, 100]) {
  const ev = { 池: [], cheat: [], unh: [], healthy: [] };
  for (const [id, t] of Object.entries(D)) {
    if (Object.entries(t.cps).some(([n, c]) => Number(n) > min && R2b(c))) ev[grp(id)].push(id);
  }
  console.log(`min>${min}：` + Object.entries(ev).map(([k, l]) => `${k} ${l.length}/${tot[k]}${l.length <= 10 ? '(' + l.join(',') + ')' : ''}`).join(' | '));
}
