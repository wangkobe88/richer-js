const { dbManager } = require('../src/services/dbManager');

async function main() {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('metadata,created_at')
    .eq('experiment_id','b8ae9f2e-832f-42db-bbda-8d8701aecb63')
    .eq('token_address','0x577c885d80a2bfc915c1acab3c51dca91c137777')
    .eq('signal_type','BUY').limit(1);
  const m = sigs?.[0]?.metadata || {};
  const bp = m.buyPoint || {};
  const out = { ...bp };
  delete out.anchors;
  console.log('signal created_at:', sigs[0].created_at);
  console.log(JSON.stringify(out, null, 1));
  // FA fire 时刻因子表（快照）
  const fr = m.factorResults || m.factors || m.factorSnapshot;
  if (fr) {
    const pick = {};
    for (const k of ['currentVsLaunchPct','currentPriceBnb','tradeCount','buyVolumeBnb','actTotalBnb','tokenAgeSec','recentBlockDropPct','mcapFromPeakPct','quietSpanMs','launchMinVsFloorPct','launchBundleClusterSize','launchFirstBlockWallets','launchFirstWaveWallets','tradesNetBuyRatioShortWin','tradesNetBuyRatioLongWin','tradesRouterPct','holdersExDust'])
      if (fr[k] !== undefined) pick[k] = fr[k];
    console.log('\nfire 时刻因子表(挑键):', JSON.stringify(pick));
    console.log('factorResults 全键数:', Object.keys(fr).length);
  } else {
    console.log('\nmetadata 键:', Object.keys(m).join(','));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
