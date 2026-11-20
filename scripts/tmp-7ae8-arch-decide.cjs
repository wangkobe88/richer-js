// 架构决定性测试：纯数值版 t5N<2∧w30sel>=5 按 sbw 分组的效果
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
    return { ...t, A: an, sbw: sbw || '?', leg: ((m.signalGate || {}).legId || '?') };
  });
}

(async () => {
  const all = {};
  for (const [name, id] of EXPS) all[name] = await loadSamples(id);
  const num = (s, k) => Number(s.A[k]);
  const pure = s => num(s, 'actNearTail5BuyN') < 2 && num(s, 'win30SellN') >= 5;

  console.log('═══ 纯数值版 t5N<2 ∧ w30sel≥5 按 sbw 分组 ═══');
  for (const sbwV of ['none', 'burst', '?']) {
    let totN = 0, totWin = 0, totPnl = 0;
    const perWin = [];
    for (const [w, ss] of Object.entries(all)) {
      const hit = ss.filter(pure).filter(s => s.sbw === sbwV);
      const pnl = hit.reduce((a, s) => a + s.pnl, 0);
      perWin.push(`${w}:${hit.length}票净${pnl.toFixed(3)}`);
      totN += hit.length; totWin += hit.filter(s => s.pnl > 0.0005).length; totPnl += pnl;
    }
    console.log(`sbw=${sbwV}`.padEnd(12), perWin.join(' '), `| Σ${totN}票 胜${totWin} 净${totPnl.toFixed(3)}`);
  }
  console.log('\n-- sbw=burst ∧ 纯数值命中的票明细（若全负→纯数值版可用挂 FP 门；若有大赢→sbw 腿必要挂 AF1/BP）--');
  for (const [w, ss] of Object.entries(all)) {
    for (const s of ss.filter(pure).filter(s => s.sbw === 'burst')) {
      console.log('  ', w, (s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).padStart(7), 'leg', s.leg.padEnd(10),
        't5N', String(s.A.actNearTail5BuyN).padStart(2), 'w30sel', String(s.A.win30SellN).padStart(3),
        'chg5', String(s.A.chg5Pct).padStart(7), 'w30net', String(num(s, 'win30NetBnb')).padStart(7));
    }
  }
  console.log('\n═══ 阈值敏感性：w30sel 边界 4/5/6/8 × t5N 边界 1/2 ═══');
  for (const selN of [4, 5, 6, 8]) for (const t5 of [1, 2]) {
    const f = s => num(s, 'actNearTail5BuyN') <= t5 - 1 && num(s, 'win30SellN') >= selN && s.sbw !== 'burst';
    let totN = 0, totWin = 0, totPnl = 0, bad = false;
    for (const ss of Object.values(all)) {
      const hit = ss.filter(f); const pnl = hit.reduce((a, s) => a + s.pnl, 0);
      if (pnl > 0.02) bad = true;
      totN += hit.length; totWin += hit.filter(s => s.pnl > 0.0005).length; totPnl += pnl;
    }
    console.log(`t5N<${t5} ∧ w30sel≥${selN} ∧ sbw≠burst`.padEnd(34), `${totN}票 胜${totWin} 净${totPnl.toFixed(3)}`, bad ? '⚠有正窗' : '✅三窗全负/平');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
