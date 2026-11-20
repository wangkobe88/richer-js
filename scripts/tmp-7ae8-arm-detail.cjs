// 三窗候选臂命中票明细 + 收紧腿扫描：找能把误伤票剔掉的第三腿
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
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => {
    const m = metaById.get(t.buySigId) || {};
    const an = (m.buyPoint || {}).anchors || {};
    let sbw = (m.actFrontGate || {}).sbw;
    if (!sbw) { const lv = (m.cheatCheck || {}).levels || {}; if (lv.stallBurstWave != null) sbw = Number(lv.stallBurstWave) === 1 ? 'burst' : 'none'; }
    return { ...t, A: an, sbw: sbw || '?', act: (m.actFrontGate || {}).act || '?' };
  });
}

const num = (s, k) => Number(s.A[k]);
const ARMS = {
  'B1 sbw≠burst∧尾5买N<2': s => s.sbw !== 'burst' && num(s, 'actNearTail5BuyN') < 2,
  'B2 sbw≠burst∧尾5买Bnb<0.1': s => s.sbw !== 'burst' && num(s, 'actNearTail5BuyBnb') < 0.1,
  'C1 bhs≥0.1∧无砸块': s => num(s, 'bigHolderSellBnb60') >= 0.1 && !num(s, 'dump2BlockSellers'),
  'C2 bhs≥0.1∧exitSel≥8': s => num(s, 'bigHolderSellBnb60') >= 0.1 && num(s, 'exitSellerCount60') >= 8,
};

(async () => {
  const all = {};
  for (const [name, id] of EXPS) all[name] = await loadSamples(id);

  console.log('═══ 命中票明细（pnl 正票标 ▲=误伤候选）═══');
  for (const [armId, f] of Object.entries(ARMS)) {
    console.log('\n── ' + armId);
    for (const [w, ss] of Object.entries(all)) {
      const hits = ss.filter(f).sort((a, b) => a.pnl - b.pnl);
      const pos = hits.filter(s => s.pnl > 0.0005);
      console.log(`  [${w}] 命中${hits.length} 胜${pos.length}`);
      for (const s of pos) { // 只看误伤票
        const a = s.A;
        console.log('   ▲', (s.symbol || '').slice(0, 10).padEnd(11), ('+' + s.pnl.toFixed(4)).padStart(8),
          'bhs', (a.bigHolderSellBnb60 ?? '?').toString().padEnd(5).slice(0, 5),
          't5N', (a.actNearTail5BuyN ?? '?'), 't5B', (a.actNearTail5BuyBnb ?? '?'),
          'w30net', (a.win30NetBnb ?? '?'), 'w30sel', (a.win30SellN ?? '?'),
          'exSel', (a.exitSellerCount60 ?? '?'), 'chg5', (a.chg5Pct ?? '?'),
          'unrec', (a.recentDip5UnrecoveredPct ?? '-'), 'curVs', (a.currentVsLaunchPct ?? '?'), 'age', (a.tokenAgeSec ?? '?'));
      }
    }
  }

  // 收紧腿扫描：B1/B2/C1/C2 基础上加第三腿，目标三窗全负
  console.log('\n═══ 收紧腿扫描（基础臂 ∧ 第三腿 → 三窗净效果）═══');
  const thirds = [
    ['w30NetBnb<0', s => num(s, 'win30NetBnb') < 0],
    ['w30NetBnb<0.1', s => num(s, 'win30NetBnb') < 0.1],
    ['chg5<0', s => num(s, 'chg5Pct') < 0],
    ['chg5<5', s => num(s, 'chg5Pct') < 5],
    ['chg30<0', s => num(s, 'chg30Pct') < 0],
    ['unrec<=-9', s => num(s, 'recentDip5UnrecoveredPct') <= -9],
    ['curVs>=24', s => num(s, 'currentVsLaunchPct') >= 24],
    ['curVs<=15', s => num(s, 'currentVsLaunchPct') <= 15],
    ['age<=120', s => num(s, 'tokenAgeSec') <= 120],
    ['age>200', s => num(s, 'tokenAgeSec') > 200],
    ['w30SelN>=5', s => num(s, 'win30SellN') >= 5],
    ['exitSel>=10', s => num(s, 'exitSellerCount60') >= 10],
    ['t10SelW>=2', s => num(s, 'actNearTail10SellWallets') >= 2],
    ['holders<=8', s => num(s, 'holdersNow') <= 8],
    ['burst5Bnb<0.5', s => num(s, 'burst5BuyBnb') < 0.5],
    ['tv>=3(过生命周期线)', s => num(s, 'totalVolumeBnb') >= 3],
    ['tv<3(早期票)', s => num(s, 'totalVolumeBnb') < 3],
  ];
  for (const [armId, f] of Object.entries(ARMS)) {
    for (const [tId, tf] of thirds) {
      const g = s => f(s) && tf(s);
      const nets = Object.entries(all).map(([w, ss]) => {
        const hit = ss.filter(g);
        return [w, hit.reduce((a, s) => a + s.pnl, 0), hit.length, hit.filter(s => s.pnl > 0.0005).length];
      });
      const total = nets.reduce((a, x) => a + x[1], 0);
      const allNeg = nets.every(x => x[1] <= 0.02);
      if (allNeg && total < -0.15) {
        console.log(('✅ ' + armId + ' ∧ ' + tId).padEnd(46),
          nets.map(x => `${x[0]}:${x[1].toFixed(3)}(${x[2]}票胜${x[3]})`).join(' '), 'Σ' + total.toFixed(3));
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
