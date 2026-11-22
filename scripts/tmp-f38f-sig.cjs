const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const EXP = '4d74f39e-4055-4adb-afa3-de8a22bb9f49';
  const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  console.log('signal rows:', sigs.length);
  for (const s of sigs) {
    console.log('===');
    console.log(s.created_at, s.signal_type, 'action:', s.action, 'executed:', s.executed);
    console.log('reason:', (s.reason||'').slice(0,300));
    const md = s.metadata || {};
    console.log('metadata keys:', Object.keys(md).join(','));
    if (md.factorCheck) console.log('factorCheck:', JSON.stringify(md.factorCheck));
    if (md.cheatCheck) console.log('cheatCheck:', JSON.stringify(md.cheatCheck).slice(0,400));
    if (md.buyPoint) console.log('buyPoint:', JSON.stringify(md.buyPoint).slice(0,400));
    if (md.signalGate) console.log('signalGate:', JSON.stringify(md.signalGate).slice(0,300));
    // 因子快照若在 metadata
    if (md.factors) {
      const fs = md.factors; const keys=['curVs','currentVsLaunchPct','tokenAgeSec','actTotalBnb','actNetBnb','actTraders','tradesNetBuyRatioLongWin','tradesNetBuyRatioShortWin','launchBigBuyBnb','sinceFirstTradeSec','launchMinVsFloorPct','holdersExDust','top2HolderCircPct','athVsLaunchPct','mcapFromPeakPct','chg5Pct','chg30Pct','quietSpanMs','actBuyBnb','actSellBnb'];
      const fk={}; for(const k of keys){ if(fs[k]!==undefined) fk[k]=fs[k]; }
      console.log('factors:', JSON.stringify(fk));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
