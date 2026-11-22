const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('metadata')
    .eq('experiment_id','f7344de1-f3eb-407c-8739-8b71dbf68a05').eq('signal_type','BUY')
    .eq('token_address','0xf38f48cfe9e84920e7de4d47823a0fba95a87777');
  for (const s of sigs||[]) {
    const fc=(s.metadata||{}).factorCheck||{};
    const g=(fc.gates||[]).find(x=>x.id==='arb_bot_holdings');
    console.log('arms:', (fc.arms||[]).join(','));
    if (g) console.log('arb_bot_holdings 门:', g.value, '| line:', g.line);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
