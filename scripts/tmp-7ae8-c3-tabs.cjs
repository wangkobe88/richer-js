require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['bt-v158', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['bt-v150', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
(async () => {
  const sb = dbManager.getClient();
  const out = [];
  for (const [name, id] of EXPS) {
    const { data: trades } = await sb.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
      .eq('experiment_id', id).order('created_at', { ascending: true }).limit(500);
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
    for (const t of tokens) {
      const an = ((metaById.get(t.buySigId) || {}).buyPoint || {}).anchors || {};
      const bhs = Number(an.bigHolderSellBnb60), ath = Number(an.athVsLaunchPct);
      if (bhs >= 0.1 && bhs < 0.3 && ath < 80) out.push({ exp: name, expId: id, token: t.addr, symbol: t.symbol, pnl: +t.pnl.toFixed(4), bhs, ath: +ath });
    }
  }
  out.sort((a, b) => a.pnl - b.pnl);
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
