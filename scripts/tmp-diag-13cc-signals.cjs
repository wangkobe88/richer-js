const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,strategy_id,created_at,execution_status,metadata')
    .eq('experiment_id', '3916fb15-66a1-45f0-bde1-1c145513817a')
    .eq('token_address', '0x13ccc4b96a0561201211e7d37b1352d03ed37777')
    .order('created_at');
  console.log('SI 票信号数:', (sigs||[]).length);
  for (const s of sigs||[]) console.log(JSON.stringify({t:s.created_at,type:s.signal_type,leg:s.strategy_id,st:s.execution_status,rej:s.metadata?.rejectionReason||s.metadata?.failureReason, fc:s.metadata?.factorCheck?.reason, cc:s.metadata?.cheatCheck?.grade, bp:s.metadata?.buyPoint?.rule}).slice(0,300));
  const { data: tr } = await c.from('trades').select('trade_type,amount_bnb,profit_loss,created_at')
    .eq('experiment_id', '3916fb15-66a1-45f0-bde1-1c145513817a')
    .eq('token_address', '0x13ccc4b96a0561201211e7d37b1352d03ed37777');
  console.log('SI 票成交数:', (tr||[]).length);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
