const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,token_address,metadata')
    .eq('experiment_id','f7344de1-f3eb-407c-8739-8b71dbf68a05').eq('signal_type','BUY')
    .in('token_address', ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777','0x3b2748dfab3c2bc9beab4666cb35af3193be7777','0x995b32765ea74ab7b05b57789fb00c96e6407777'])
    .order('created_at');
  for (const s of sigs||[]) {
    const md = s.metadata||{}; const fc = md.factorCheck||{};
    const g = (fc.gates||[]).find(x=>x.id==='big_buy_defer');
    const sym = s.token_address.slice(0,8);
    console.log(`${s.created_at.slice(11,19)} ${sym} FPpass=${fc.pass} reason=${fc.reason||'-'} bigBuyDefer门: ${g?g.value:'无'}`);
    if (md.actFrontGate) console.log(`   AF1: ${JSON.stringify(md.actFrontGate).slice(0,110)}`);
    if (md.buyPoint) console.log(`   BP: ${JSON.stringify({s:md.buyPoint.status,p:md.buyPoint.passed}).slice(0,50)}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
