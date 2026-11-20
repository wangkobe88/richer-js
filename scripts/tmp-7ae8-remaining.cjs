// 优化思路续挖：① FP26 漏掉的断流票形状 ② C1/C2 慢性大户出货收紧腿深挖
// ③ 腿级期望 ④ sbw=none∧act=high 子形状 —— 用已存 samples（182 /tmp/bt158_samples.json 是 w1019）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function loadSamples(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id,created_at,metadata')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null, firstSellAt: null, sells: [] });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else { e.got += Number(t.output_amount || 0); if (!e.firstSellAt) e.firstSellAt = t.created_at; e.sells.push(t); }
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId, firstSellAt: v.firstSellAt, sells: v.sells }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    const s0 = (t.sells[0] && t.sells[0].metadata) || {};
    const exit = s0.stallClose ? ('stall:' + (s0.stallClose.tier || '')) : (s0.burstCooldownInfo ? 'burstCd' : 'sellLeg');
    let sbw = (m.actFrontGate || {}).sbw;
    if (!sbw) { const lv = (m.cheatCheck || {}).levels || {}; if (lv.stallBurstWave != null) sbw = Number(lv.stallBurstWave) === 1 ? 'burst' : 'none'; }
    return { ...t, A: an, sbw: sbw || '?', act: (m.actFrontGate || {}).act || '?', leg: ((m.signalGate || {}).legId || '?'), trig: (m.signalGate || {}).triggerNo, exit };
  });
}

(async () => {
  const all = {};
  for (const [name, id] of EXPS) all[name] = await loadSamples(id);
  const num = (s, k) => Number(s.A[k]);
  const fp26 = s => num(s, 'actNearTail5BuyN') <= 1 && num(s, 'win30SellN') >= 5;

  console.log('═══ ① 断流票漏网面：stall 出场 ∧ 亏 ∧ 非 FP26 命中——两腿各差多少 ═══');
  for (const [w, ss] of Object.entries(all)) {
    const stallLose = ss.filter(s => s.exit.startsWith('stall') && s.pnl < -0.005);
    const covered = stallLose.filter(fp26);
    const leak = stallLose.filter(s => !fp26(s));
    console.log(`[${w}] stall亏损 ${stallLose.length} 票 Σ${stallLose.reduce((a, s) => a + s.pnl, 0).toFixed(3)} | FP26 已接 ${covered.length} | 漏 ${leak.length} Σ${leak.reduce((a, s) => a + s.pnl, 0).toFixed(3)}`);
    for (const s of leak) {
      console.log('   ✗', (s.symbol || '').slice(0, 9).padEnd(10), s.pnl.toFixed(4).padStart(7),
        't5N', String(s.A.actNearTail5BuyN).padStart(2), 't5B', String(s.A.actNearTail5BuyBnb ?? '-').padStart(6),
        'selN', String(s.A.win30SellN).padStart(3), 'selB', String(s.A.win30SellBnb ?? '-').padStart(6),
        't10selW', String(s.A.actNearTail10SellWallets ?? '-').padStart(2), 'w30net', String(num(s, 'win30NetBnb')).padStart(7),
        'chg5', String(s.A.chg5Pct).padStart(6), 'age', String(s.A.tokenAgeSec).padStart(4), 'sbw', s.sbw);
    }
  }

  console.log('\n═══ ② C1/C2 慢性大户出货族·收紧腿深挖（三窗全负候选）═══');
  const base = s => num(s, 'bigHolderSellBnb60') >= 0.1;
  const thirds = [
    ['无第三腿(基线)', s => true],
    ['exitSel>=6', s => num(s, 'exitSellerCount60') >= 6],
    ['exitSel>=8', s => num(s, 'exitSellerCount60') >= 8],
    ['w30selN>=7', s => num(s, 'win30SellN') >= 7],
    ['t10selW>=1', s => num(s, 'actNearTail10SellWallets') >= 1],
    ['chg30<10', s => num(s, 'chg30Pct') < 10],
    ['chg30<0', s => num(s, 'chg30Pct') < 0],
    ['ath<80(未走完大周期)', s => num(s, 'athVsLaunchPct') < 80],
    ['curVs>=20', s => num(s, 'currentVsLaunchPct') >= 20],
    ['curVs<=20', s => num(s, 'currentVsLaunchPct') <= 20],
    ['holders<=12', s => num(s, 'holdersNow') <= 12],
    ['bhs>=0.3(重出货)', s => num(s, 'bigHolderSellBnb60') >= 0.3],
    ['bhs>=0.5', s => num(s, 'bigHolderSellBnb60') >= 0.5],
    ['非FP26已拦', s => !fp26(s)],
    ['非FP26∧w30selN>=5', s => !fp26(s) && num(s, 'win30SellN') >= 5],
  ];
  for (const [tid, tf] of thirds) {
    const g = s => base(s) && tf(s);
    const nets = Object.entries(all).map(([w, ss]) => {
      const hit = ss.filter(g);
      return [w, hit.reduce((a, s) => a + s.pnl, 0), hit.length, hit.filter(s => s.pnl > 0.0005).length];
    });
    const total = nets.reduce((a, x) => a + x[1], 0);
    const allNeg = nets.every(x => x[1] <= 0.02);
    console.log((allNeg ? '✅' : '  ') + ('bhs≥0.1 ∧ ' + tid).padEnd(30), nets.map(x => `${x[0]}:${x[1].toFixed(3)}(${x[2]}票胜${x[3]})`).join(' '), 'Σ' + total.toFixed(3));
  }

  console.log('\n═══ ③ 腿级期望（三窗合计）═══');
  const legAgg = new Map();
  for (const ss of Object.values(all)) for (const s of ss) {
    if (!legAgg.has(s.leg)) legAgg.set(s.leg, { n: 0, pnl: 0, win: 0 });
    const e = legAgg.get(s.leg); e.n++; e.pnl += s.pnl; if (s.pnl > 0.0005) e.win++;
  }
  for (const [leg, e] of [...legAgg.entries()].sort((a, b) => a[1].pnl - b[1].pnl)) {
    console.log(leg.padEnd(11), 'n=' + String(e.n).padStart(3), 'win ' + String(Math.round(e.win / e.n * 100)).padStart(3) + '%', 'Σ' + e.pnl.toFixed(3).padStart(7), 'μ' + (e.pnl / e.n).toFixed(4).padStart(8));
  }

  console.log('\n═══ ④ sbw=none∧act=high 子形状（47 票 w1019 win32% 但 Σ微正——找可分子集）═══');
  const nh = all.w1019.filter(s => s.sbw === 'none' && s.act === 'high');
  console.log('基线: n=' + nh.length, 'win ' + Math.round(nh.filter(s => s.pnl > 0.0005).length / nh.length * 100) + '%', 'Σ' + nh.reduce((a, s) => a + s.pnl, 0).toFixed(3));
  const cuts = [
    ['chg5>=5(反弹中)', s => num(s, 'chg5Pct') >= 5], ['chg5<5', s => num(s, 'chg5Pct') < 5],
    ['t5N>=3(尾段买力在场)', s => num(s, 'actNearTail5BuyN') >= 3], ['t5N<=2', s => num(s, 'actNearTail5BuyN') <= 2],
    ['curVs<=20', s => num(s, 'currentVsLaunchPct') <= 20], ['curVs>20', s => num(s, 'currentVsLaunchPct') > 20],
    ['age>120', s => num(s, 'tokenAgeSec') > 120], ['age<=120', s => num(s, 'tokenAgeSec') <= 120],
  ];
  for (const [cid, f] of cuts) {
    const sub = nh.filter(f);
    if (!sub.length) continue;
    console.log(' ', cid.padEnd(22), 'n=' + String(sub.length).padStart(2), 'win ' + Math.round(sub.filter(s => s.pnl > 0.0005).length / sub.length * 100) + '%', 'Σ' + sub.reduce((a, s) => a + s.pnl, 0).toFixed(3));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
