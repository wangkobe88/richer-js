import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const tok = '0x2591c5cbd66a0a532870f6ceef68f10d25bc7777';
const s = await c.from('strategy_signals').select('created_at,executed,metadata')
  .eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17')
  .ilike('token_address', tok).eq('action','buy').order('created_at',{ascending:true}).limit(5);
for (const row of s.data ?? []) {
  const cc = row.metadata?.cheatCheck ?? {};
  const an = cc.anchors ?? {};
  const bp = row.metadata?.buyPoint ?? {};
  console.log('=== BUY', row.created_at, 'exec=' + row.executed);
  console.log('nearDump: qualBlocks=' + an.nearDumpQualBlocks, 'minAbsorb=' + an.nearDumpMinAbsorbBnb, 'worstSellers=' + an.nearDumpWorstSellers, 'worstSellBnb=' + an.nearDumpWorstSellBnb, 'worstSecToAnchor=' + an.nearDumpWorstSecToAnchor, 'worstSameBlkBuy=' + an.nearDumpWorstSameBlkBuyBnb);
  console.log('burstExitSeg: buy=' + an.burstExitSegBuyBnb, 'sell=' + an.burstExitSegSellBnb, 'sellPct=' + an.burstExitSegSellPct, ' sbw=' + cc.levels?.stallBurstWave);
  console.log('activityLevel=' + cc.levels?.activityLevel, ' slowGrindPump=' + cc.levels?.slowGrindPump, ' burstSpikeConcentration=' + cc.levels?.burstSpikeConcentration);
  console.log('bp.passed=' + bp.passed, ' bp.status=' + bp.status);
  const dims = bp.dimensions ?? {};
  console.log('bp.dimensions:', JSON.stringify(Object.fromEntries(Object.entries(dims).map(([k,v]) => [k, v?.answer ?? v]))).slice(0, 500));
  const asm = bp.assessment ?? {};
  console.log('bp.assessment:', JSON.stringify(asm).slice(0, 400));
}
const one = await c.from('trades').select('*').eq('experiment_id','5390bbfa-0c86-48a2-b9e1-94537c54ac17').ilike('token_address', tok).limit(1);
if (one.error) console.log('trades err:', JSON.stringify(one.error));
else if (one.data?.[0]) {
  console.log('trade columns:', Object.keys(one.data[0]).join(','));
}
await dbManager.close?.();
