// 热窗「无人接盘」族跨窗验证：holdersNow≤2 ∧ win30NewBuyers≤1 及变体，四窗对拍
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXPS = [
  ['w0928热', '5b2c1747-959f-42de-a622-f57deb9fb407'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];

async function load(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(600);
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
  return tokens.map(t => ({ ...t, A: ((metaById.get(t.buySigId) || {}).buyPoint || {}).anchors || {} }));
}

(async () => {
  const all = {};
  for (const [name, id] of EXPS) all[name] = await load(id);
  const num = (s, k) => Number(s.A[k]);
  const ARMS = {
    'H1 holders≤2 ∧ w30newBuyers≤1': s => num(s, 'holdersNow') <= 2 && num(s, 'win30NewBuyers') <= 1,
    'H2 holders≤2 单键': s => num(s, 'holdersNow') <= 2,
    'H3 w30newBuyers≤1 单键': s => num(s, 'win30NewBuyers') <= 1,
    'H4 H1 ∧ 尾5买B<0.2': s => num(s, 'holdersNow') <= 2 && num(s, 'win30NewBuyers') <= 1 && num(s, 'actNearTail5BuyBnb') < 0.2,
    'H5 H1 ∧ chipBuyers≤5': s => num(s, 'holdersNow') <= 2 && num(s, 'win30NewBuyers') <= 1 && num(s, 'chipBuyersTotal') <= 5,
    'H6 holders≤3 ∧ w30new≤2': s => num(s, 'holdersNow') <= 3 && num(s, 'win30NewBuyers') <= 2,
    'H7 H1 ∧ chg5<5(无动量)': s => num(s, 'holdersNow') <= 2 && num(s, 'win30NewBuyers') <= 1 && num(s, 'chg5Pct') < 5,
    'H8 w30new≤1 ∧ 尾5买B<0.15': s => num(s, 'win30NewBuyers') <= 1 && num(s, 'actNearTail5BuyBnb') < 0.15,
  };
  for (const [aid, f] of Object.entries(ARMS)) {
    const parts = []; let tot = 0, totn = 0, totw = 0;
    for (const [w, ss] of Object.entries(all)) {
      const hit = ss.filter(f);
      const pnl = hit.reduce((a, s) => a + s.pnl, 0);
      parts.push(`${w}:${pnl.toFixed(3)}(${hit.length}票胜${hit.filter(s => s.pnl > 0.0005).length})`);
      tot += pnl; totn += hit.length; totw += hit.filter(s => s.pnl > 0.0005).length;
    }
    console.log(aid.padEnd(30), parts.join(' '), `| Σ${totn}票 胜${totw} 净${tot.toFixed(3)}`);
  }
  // 热窗 H1 命中的正票（误伤面）+ 其它窗 H1 命中正票
  console.log('\n-- H1 命中正票明细（误伤面）--');
  const h1 = s => num(s, 'holdersNow') <= 2 && num(s, 'win30NewBuyers') <= 1;
  for (const [w, ss] of Object.entries(all)) {
    for (const s of ss.filter(h1).filter(s => s.pnl > 0.0005).sort((a, b) => b.pnl - a.pnl).slice(0, 5)) {
      console.log(' ▲', w, (s.symbol || '').slice(0, 9).padEnd(10), s.pnl.toFixed(4).padStart(7),
        'holders', String(s.A.holdersNow).padStart(2), 'newB', String(s.A.win30NewBuyers).padStart(2),
        't5B', String(s.A.actNearTail5BuyBnb ?? '-').padStart(5), 'chg5', String(s.A.chg5Pct).padStart(6), 'ath', String(s.A.athVsLaunchPct).padStart(6));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
