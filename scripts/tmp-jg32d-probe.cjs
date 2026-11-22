const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data: t } = await sb.from('trades').select('*').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').limit(1);
  console.log('trades cols:', t && t[0] ? Object.keys(t[0]).join(',') : 'EMPTY');
  const { data: s } = await sb.from('strategy_signals').select('metadata').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').eq('signal_type','BUY').limit(20);
  for (const r of s) {
    const md = r.metadata || {};
    if (md.actFrontGate) { console.log('actFrontGate 形状:', JSON.stringify(md.actFrontGate).slice(0,300)); break; }
  }
  for (const r of s) {
    const md = r.metadata || {};
    if (md.buyPoint) { console.log('buyPoint 形状:', JSON.stringify(md.buyPoint).slice(0,300)); break; }
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
