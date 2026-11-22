const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,reason,metadata')
    .eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').eq('signal_type','BUY')
    .in('token_address', ['0x995b32765ea74ab7b05b57789fb00c96e6407777','0x3b2748dfab3c2bc9beab4666cb35af3193be7777'])
    .order('created_at');
  for (const s of sigs||[]) {
    const md = s.metadata||{};
    console.log('---', s.created_at, (s.reason||'').slice(0,30));
    if (md.actFrontGate) console.log(' AF1:', JSON.stringify(md.actFrontGate).slice(0,150));
    if (md.cheatCheck) console.log(' cheat:', JSON.stringify(md.cheatCheck).slice(0,400));
    if (md.buyPoint) console.log(' BP:', JSON.stringify({status:md.buyPoint.status,passed:md.buyPoint.passed}).slice(0,80));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
