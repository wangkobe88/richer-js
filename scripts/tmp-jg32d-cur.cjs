const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: t } = await sb.from('trades').select('trade_direction,input_currency,output_currency,input_amount,output_amount').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').order('created_at').limit(8);
  for (const r of t) console.log(r.trade_direction, '| in', r.input_amount, JSON.stringify(r.input_currency), '| out', r.output_amount, JSON.stringify(r.output_currency));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
