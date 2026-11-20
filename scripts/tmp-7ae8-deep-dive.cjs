// bt-v158 深挖四条线：① stallClose:almost 20 票 0 胜的买点特征 ② recentDip5 未收复深负桶
// ③ bigHolderSellBnb60/dump2 卖方族与现有门阈值的差距 ④ AF.act×sbw 交叉
const samples = require('/tmp/bt158_samples.json');

const fmt = x => x == null ? 'null' : (typeof x === 'number' ? x.toFixed(2) : x);
function grp(label, ss) {
  const n = ss.length; if (!n) return console.log(label.padEnd(46), 'n=0');
  const sum = ss.reduce((a, s) => a + s.pnl, 0);
  const win = ss.filter(s => s.pnl > 0.0005).length;
  console.log(label.padEnd(46), 'n=' + String(n).padEnd(3), 'win ' + String(Math.round(win / n * 100)) + '%', 'Σ' + sum.toFixed(3).padStart(7), 'μ' + (sum / n).toFixed(4).padStart(8));
}

console.log('═══ ① stallClose:almost 20 票（全亏族）vs 其余 ═══');
const sc = samples.filter(s => s.exit.startsWith('stallClose:almost'));
const rest = samples.filter(s => !s.exit.startsWith('stallClose:almost'));
grp('stallClose:almost', sc); grp('其余', rest);
const KEYS1 = ['tokenAgeSec', 'currentVsLaunchPct', 'athVsLaunchPct', 'chg5Pct', 'chg30Pct',
  'actNearTail5BuyN', 'actNearTail5BuyBnb', 'actNearTail5TickN', 'actNearTail10SellWallets', 'actNearTail10BnbPerMin',
  'win30NetBnb', 'win30SellN', 'win30BuyN', 'holdersNow', 'burst5BuyBnb', 'burst5Wallets', 'burst5N',
  'bigHolderSellBnb60', 'exitSellerCount60', 'totalVolumeBnb', 'spanSec', 'actThroughputBnbPerMin',
  'recentDip5UnrecoveredPct', 'dumpBlockBnb', 'dump2BlockSellers', 'chipPosHolderCount', 'win30NewBuyers'];
console.log('key'.padEnd(26), 'sc组(μ/中位)'.padEnd(22), '其余组(μ/中位)');
for (const k of KEYS1) {
  const med = a => { const v = a.map(s => Number(s.A[k])).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
  const mu = a => { const v = a.map(s => Number(s.A[k])).filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
  console.log(k.padEnd(26), (fmt(mu(sc)) + ' / ' + fmt(med(sc))).padEnd(22), fmt(mu(rest)) + ' / ' + fmt(med(rest)));
}
// sbw/act 交叉
console.log('\n-- sc 组内 sbw/act 分布 --');
for (const r of ['burst', 'none']) for (const a of ['high', 'mid', 'low']) {
  const ss = sc.filter(s => s.af.sbw === r && s.af.act === a);
  if (ss.length) grp(`sc ∧ sbw=${r} ∧ act=${a}`, ss);
}
for (const r of ['burst', 'none']) grp(`全体 sbw=${r}`, samples.filter(s => s.af.sbw === r));
grp('sbw=none ∧ actNearTail5BuyN<2', samples.filter(s => s.af.sbw !== 'burst' && Number(s.A.actNearTail5BuyN) < 2));
grp('sbw=none ∧ actNearTail5BuyN>=2', samples.filter(s => s.af.sbw !== 'burst' && Number(s.A.actNearTail5BuyN) >= 2));

console.log('\n═══ ② recentDip5UnrecoveredPct 分档 × BP 桶判定 ═══');
const edges = [[-1e9, -25], [-25, -15], [-15, -9], [-9, 0], [0, 1e9]];
for (const [lo, hi] of edges) {
  const ss = samples.filter(s => { const x = Number(s.A.recentDip5UnrecoveredPct); return Number.isFinite(x) && x >= lo && x < hi; });
  grp(`unrecovered [${lo},${hi})`, ss);
}
console.log('-- 深负桶(<-9) 的票明细 --');
for (const s of samples.filter(s => Number(s.A.recentDip5UnrecoveredPct) < -9).sort((a, b) => a.pnl - b.pnl)) {
  console.log((s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).padStart(7),
    'dip5', fmt(s.A.recentDip5Pct).padStart(7), 'secAgo', fmt(s.A.recentDip5SecAgo).padStart(5),
    'unrec', fmt(s.A.recentDip5UnrecoveredPct).padStart(7), 'chg5', fmt(s.A.chg5Pct).padStart(6),
    'tail5buyN', fmt(s.A.actNearTail5BuyN).padStart(4), 'exit=' + s.exit.slice(0, 16));
}

console.log('\n═══ ③ 大户卖压族：bigHolderSellBnb60 × dump2 卖方 细分 ═══');
grp('bhs60=0 ∧ dump2S=0（干净）', samples.filter(s => !Number(s.A.bigHolderSellBnb60) && !Number(s.A.dump2BlockSellers)));
grp('bhs60∈(0,0.1]', samples.filter(s => { const x = Number(s.A.bigHolderSellBnb60); return x > 0 && x <= 0.1; }));
grp('bhs60>0.1', samples.filter(s => Number(s.A.bigHolderSellBnb60) > 0.1));
grp('dump2S∈[2,4)', samples.filter(s => { const x = Number(s.A.dump2BlockSellers); return x >= 2 && x < 4; }));
grp('dump2S>=4', samples.filter(s => Number(s.A.dump2BlockSellers) >= 4));
grp('bhs60>0.1 ∧ dump2S=0', samples.filter(s => Number(s.A.bigHolderSellBnb60) > 0.1 && !Number(s.A.dump2BlockSellers)));
// T190 臂六腿复现：age≤600 ∧ sellers≥8 ∧ 卖≥0.5 ∧ 跌≤-10% ∧ 距锚≤60 ∧ 承接<0.3
console.log('-- T190 六腿近似复现（本窗口被买入的票） --');
for (const s of samples) {
  const a = s.A;
  const hit = Number(a.tokenAgeSec) <= 600 && Number(a.dump2BlockSellers) >= 8 && Number(a.dump2BlockBnb) >= 0.5
    && Number(a.dump2BlockDropPct) <= -10 && Number(a.dump2BlockSecToAnchor) <= 60;
  if (hit || (Number(a.dump2BlockSellers) >= 5 && Number(a.dump2BlockBnb) >= 0.4)) {
    console.log((hit ? '★T190命中 ' : '◇近线    ') + (s.symbol || '').slice(0, 10).padEnd(11), 'pnl', s.pnl.toFixed(4).padStart(7),
      'd2S', fmt(a.dump2BlockSellers).padStart(4), 'd2B', fmt(a.dump2BlockBnb).padStart(5), 'drop', fmt(a.dump2BlockDropPct).padStart(7),
      'sec2A', fmt(a.dump2BlockSecToAnchor).padStart(5), 'follRatio', fmt(a.dump2BlockFollowBuyRatio).padStart(6), 'tv', fmt(a.totalVolumeBnb).padStart(5));
  }
}

console.log('\n═══ ④ AF.act × sbw 全交叉 ═══');
for (const r of ['burst', 'none']) for (const a of ['high', 'mid', 'low']) {
  const ss = samples.filter(s => s.af.sbw === r && s.af.act === a);
  if (ss.length) grp(`sbw=${r} act=${a}`, ss);
}
console.log('\n═══ ⑤ 触发腿号 × 盈亏（buy_2_3 腿 0/6 全亏）═══');
for (const s of samples.filter(s => s.sg.legId === 'buy_2_3' || s.sg.legId === 'buy_9_10' || s.sg.legId === 'buy_11_12' || s.sg.legId === 'buy_12_13')) {
  console.log((s.symbol || '').slice(0, 10).padEnd(11), s.sg.legId, 'pnl', s.pnl.toFixed(4).padStart(7), 'trig', s.sg.triggerNo,
    'age', fmt(s.A.tokenAgeSec).padStart(5), 'curVs', fmt(s.A.currentVsLaunchPct).padStart(6), 'chg5', fmt(s.A.chg5Pct).padStart(7),
    'tail5bn', fmt(s.A.actNearTail5BuyBnb).padStart(5), 'sbw=' + s.af.sbw, 'exit=' + s.exit.slice(0, 14));
}
console.log('\n═══ ⑥ 补充：尾段买力薄 ∧ 无 dip 的「干涸型」票 ═══');
grp('tail5BuyN<2 ∧ dip不存在(即无急跌)', samples.filter(s => Number(s.A.actNearTail5BuyN) < 2 && !Number.isFinite(Number(s.A.recentDip5Pct))));
grp('tail5BuyN<2 ∧ dip在场', samples.filter(s => Number(s.A.actNearTail5BuyN) < 2 && Number.isFinite(Number(s.A.recentDip5Pct))));
grp('对照 tail5BuyN>=3', samples.filter(s => Number(s.A.actNearTail5BuyN) >= 3));
