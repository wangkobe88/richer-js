const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const q1 = sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,input_currency').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789');
  const { data: noOrder } = await q1;
  const { data: withOrder } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,input_currency,executed_at').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').order('executed_at');
  console.log('noOrder rows:', noOrder.length, 'sells:', noOrder.filter(r=>r.trade_direction==='sell').length);
  console.log('withOrder rows:', withOrder.length, 'sells:', withOrder.filter(r=>r.trade_direction==='sell').length);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
