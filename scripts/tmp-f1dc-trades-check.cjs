const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const db = dbManager.getClient();
  const { data: tn } = await db.from('token_narrative')
    .select('token_address,token_symbol')
    .gte('analyzed_at','2026-10-29T06:00').lte('analyzed_at','2026-10-29T12:00')
    .in('token_symbol',['RIKI','RAGU','Ragu','饿鬼','饿','Hungry']);
  const addrs = tn.map(r=>r.token_address);
  const { data: tr, error } = await db.from('trades')
    .select('experiment_id,token_symbol,trade_direction,unit_price,input_amount,output_amount,trade_status,success,created_at')
    .in('token_address', addrs)
    .gte('created_at','2026-10-29');
  if (error) { console.log('trades err:', error.message); process.exit(0); }
  console.log('=== 今日 RIKI/RAGU/饿鬼 簇 trades:', tr.length);
  for (const t of tr) console.log(JSON.stringify(t).slice(0,260));
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
