const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals').select('signal_type,created_at,metadata')
    .eq('experiment_id','d3453504-03d5-480c-89e0-483db930361c')
    .eq('token_address','0x88edc0d6e4ba98eadf4b6f86b41540a438d67777')
    .order('created_at',{ascending:true}).limit(10);
  if (error) throw error;
  for (const s of data) {
    console.log(`\n===== [${s.created_at}] ${s.signal_type} =====`);
    const m = s.metadata || {};
    console.log('metadata 顶层键:', Object.keys(m).join(','));
    for (const k of ['factors','factorResults','factorSnapshot','preBuyCheckFactors']) {
      if (m[k]) {
        const f = m[k];
        const pick = {};
        for (const kk of ['currentVsLaunchPct','currentPriceBnb','launchPriceBnb','tokenAgeSec','tradeCount','profitPercent']) if (f[kk] != null) pick[kk] = f[kk];
        console.log(`${k} 摘要:`, JSON.stringify(pick));
      }
    }
    for (const k of ['profitPercent','currentVsLaunchPct','currentPriceBnb','buyPriceBnb']) if (m[k] != null) console.log(`  ${k}: ${m[k]}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
