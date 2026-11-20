const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals').select('signal_type,action,reason,created_at,executed,metadata')
    .eq('experiment_id','d3453504-03d5-480c-89e0-483db930361c')
    .eq('token_address','0x86a6d63dba16bc0edca3124edfdcaa738a227777')
    .order('created_at',{ascending:true}).limit(20);
  if (error) throw error;
  for (const s of data) {
    const m = s.metadata || {};
    console.log(`[${s.created_at}] ${s.signal_type} ${s.action} executed=${s.executed} reason=${s.reason}`);
    console.log('  metadata 键:', Object.keys(m).join(','));
    if (s.signal_type === 'SELL') {
      const tf = m.trendFactors || {};
      console.log('  trendFactors curVs/floorPct:', tf.currentVsLaunchPct, '/', tf.currentVsFloorPct, '| profit%:', m.profitPercent, '| holdDur:', m.holdDuration);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
