const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: t } = await sb.from('trades').select('*').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').order('created_at').limit(3);
  for (const r of t) console.log(r.token_symbol, r.trade_direction, 'in', r.input_amount, String(r.input_currency).slice(0,8), 'out', r.output_amount, String(r.output_currency).slice(0,8), 'unit', r.unit_price, 'pnl?', JSON.stringify(r.metadata||{}).slice(0,120));
  const { data: s } = await sb.from('strategy_signals').select('metadata').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').eq('signal_type','BUY').limit(30);
  let shown = 0;
  for (const r of s) { const c = (r.metadata||{}).cheatCheck; if (c && shown < 2) { console.log('cheatCheck:', JSON.stringify(c).slice(0,200)); shown++; } }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
