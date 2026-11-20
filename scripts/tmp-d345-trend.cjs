const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals').select('signal_type,created_at,metadata')
    .eq('experiment_id','d3453504-03d5-480c-89e0-483db930361c')
    .eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777')
    .order('created_at',{ascending:true}).limit(10);
  if (error) throw error;
  for (const s of data) {
    const tf = (s.metadata || {}).trendFactors || {};
    const pick = {};
    for (const k of ['currentVsLaunchPct','currentPriceBnb','tradeCount','tokenAgeSec','launchPriceBnb','priceBnb','relPriceBnb']) if (tf[k] != null) pick[k] = tf[k];
    console.log(`[${s.created_at}] ${s.signal_type} trendFactors:`, JSON.stringify(pick));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
