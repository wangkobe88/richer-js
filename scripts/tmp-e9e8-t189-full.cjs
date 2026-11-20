const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
async function main() {
  const sb = dbManager.getClient();
  const { data: sells, error: eS } = await sb.from('strategy_signals').select('token_address,created_at,metadata,reason')
    .eq('experiment_id', EXP).eq('signal_type', 'SELL').like('reason', 'burst%').order('created_at');
  console.log('T189 sells total:', (sells || []).length);
  if (sells && sells[0]) console.log('sell meta keys:', Object.keys(sells[0].metadata || {}).join(','));
  const toks = [...new Set((sells || []).map(s => s.token_address))];
  const { data: buys } = await sb.from('strategy_signals').select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').in('token_address', toks).order('created_at');
  const buyMeta = new Map();
  for (const b of buys || []) {
    const m = b.metadata || {};
    const lv = m.cheatCheck?.levels || {};
    buyMeta.set(b.token_address, { sbw: lv.stallBurstWave ?? null, afSbw: m.actFrontGate?.sbw ?? null, at: b.created_at });
  }
  // trades 卖出价
  const { data: trs } = await sb.from('trades').select('token_address,trade_direction,unit_price,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).eq('trade_direction', 'sell').in('token_address', toks);
  const sellTrade = new Map();
  for (const t of trs || []) if (!sellTrade.has(t.token_address)) sellTrade.set(t.token_address, t); // 首卖
  const groups = { confirmed: [], unconfirmed: [] };
  for (const s of sells || []) {
    const b = buyMeta.get(s.token_address) || {};
    const st = sellTrade.get(s.token_address);
    const confirmed = b.sbw === 1 || b.afSbw === 'burst';
    (confirmed ? groups.confirmed : groups.unconfirmed).push({ tok: s.token_address, at: s.created_at, unit: st?.unit_price });
  }
  for (const [g, arr] of Object.entries(groups)) {
    console.log(`\n== ${g}: ${arr.length} 笔`);
    for (const r of arr) console.log(' ', r.tok.slice(0, 10), r.at?.slice(5, 19), 'sellUnit=', r.unit);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
