// 真口径分析：①首块 ②首波 ③单笔最大 ④第二波承接（全部本地 JSON）
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(__dirname + '/../data/tmp-launch-real.json', 'utf8')).filter((r) => r.firstBlockBnb != null);
console.log(`样本 ${rows.length} 票\n`);
const bucket = (label, keyFn, edges, subset) => {
  const rs = subset || rows;
  const out = edges.map(() => ({ n: 0, sum: 0, win: 0 })); const miss = { n: 0, sum: 0, win: 0 };
  for (const f of rs) {
    const v = keyFn(f);
    if (v == null || !Number.isFinite(v)) { miss.n++; miss.sum += f.net; if (f.net > 0) miss.win++; continue; }
    let bi = edges.findIndex((e) => v < e);
    if (bi < 0) bi = edges.length - 1;
    const o = out[bi]; o.n++; o.sum += f.net; if (f.net > 0) o.win++;
  }
  console.log(`${label}: ` + out.map((o, i) => `${i === 0 ? '<' + edges[0] : (i === edges.length - 1 ? '>=' + edges[edges.length - 2] : '[' + edges[i - 1] + ',' + edges[i] + ')')}:${o.n}票 ${o.sum >= 0 ? '+' : ''}${o.sum.toFixed(2)} 胜${o.win}/${o.n}${o.n ? '均' + (o.sum / o.n * 1000).toFixed(1) : ''}`).join(' | ') + ` | null:${miss.n}`);
};
console.log('== ① 首块买入额（真口径，BNB）==');
bucket('首块额 ', (f) => f.firstBlockBnb, [0.3, 0.8, 2, 1e9]);
console.log('\n== ② 首波买入额（首块+≤2s 下一块）==');
bucket('首波额 ', (f) => f.waveBnb, [0.5, 1.2, 2.5, 1e9]);
console.log('\n== ③ 首波单笔最大（大户注档位）==');
bucket('单笔max', (f) => f.waveMaxSingle, [0.2, 0.4, 0.8, 1e9]);
console.log('\n== ④ 新旧口径漂移（近似 oldAmt vs 真 firstBlockBnb）==');
const both = rows.filter((r) => r.oldAmt != null);
const drift = both.map((r) => r.oldAmt - r.firstBlockBnb);
drift.sort((a, b) => a - b);
console.log(`有旧值 ${both.length} 票：漂移中位 ${drift[Math.floor(drift.length / 2)].toFixed(2)}，p25 ${drift[Math.floor(drift.length * .25)].toFixed(2)}，p75 ${drift[Math.floor(drift.length * .75)].toFixed(2)}`);
const oldG2 = both.filter((r) => r.oldAmt >= 2), newG2 = rows.filter((r) => r.firstBlockBnb >= 2);
console.log(`旧口径 ≥2：${oldG2.length} 票 净${oldG2.reduce((s, r) => s + r.net, 0).toFixed(3)} | 真口径 ≥2：${newG2.length} 票 净${newG2.reduce((s, r) => s + r.net, 0).toFixed(3)}（胜${newG2.filter((r) => r.net > 0).length}/${newG2.length}）`);
// 逐窗：真口径首块 >=0.8 方向
console.log('\n== 真口径首块 0.8 线逐窗 ==');
for (const w of ['v109', 'v121', 'v123', 'v129', 'v132', 'v133', 'v134']) {
  const sub = rows.filter((r) => r.win === w);
  const lo = sub.filter((r) => r.firstBlockBnb < 0.8), hi = sub.filter((r) => r.firstBlockBnb >= 0.8);
  const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
  console.log(`${w}: <0.8 ${s(lo)} | >=0.8 ${s(hi)}`);
}
console.log('\n== 真口径首块 2.0 线逐窗 ==');
for (const w of ['v109', 'v121', 'v123', 'v129', 'v132', 'v133', 'v134']) {
  const sub = rows.filter((r) => r.win === w);
  const lo = sub.filter((r) => r.firstBlockBnb < 2), hi = sub.filter((r) => r.firstBlockBnb >= 2);
  const s = (a) => `${a.length}票 ${(a.reduce((x, y) => x + y.net, 0) >= 0 ? '+' : '')}${a.reduce((x, y) => x + y.net, 0).toFixed(3)}`;
  console.log(`${w}: <2 ${s(lo)} | >=2 ${s(hi)}`);
}
// ⑤ 来财在新口径的位置
const lc = rows.find((r) => r.addr && r.addr.startsWith('0xc84a0ff2'));
if (lc) console.log(`\n来财新口径: 首块 ${lc.firstBlockBnb} 波 ${lc.waveBnb} 单笔max ${lc.waveMaxSingle} 首波钱包60s卖 ${lc.waveWalletSell60} 后续60s新买 ${lc.followBuy60}（${lc.followNewWallets} 新钱包）净 ${lc.net.toFixed(4)}`);
