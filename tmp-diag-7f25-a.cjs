require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const EXP = '38d91153-7758-469e-a376-e748c3b3d63a';
const ADDR = '0x7f2573c137e18bbfcef52d97acedc2be58b67777';
(async () => {
  const db = dbManager.getClient();
  const { data: sigs, error } = await db
    .from('strategy_signals')
    .select('id,created_at,signal_type,action,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  console.log('signals:', (sigs||[]).length);
  for (const s of (sigs||[])) {
    console.log('\n===== signal', s.id, s.created_at, s.signal_type, '=====');
    const md = s.metadata || {};
    console.log('execution:', md.execution_status, '|', md.execution_reason);
    console.log('strategyName:', md.strategyName, '| price:', md.price);
    const c = md.cheatCheck;
    if (c) {
      console.log('cheat grade:', c.grade, '| status:', c.status, '| exempt:', JSON.stringify(c.exempt));
      console.log('reasons:', JSON.stringify(c.reasons));
      if (c.buckets) console.log('actLevel:', c.buckets.activityLevel, '| sbw:', c.buckets.stallBurstWave, '| holdings:', c.buckets.holdingsBalance);
      const A = c.anchors || {};
      // 捆绑砸盘相关键：CD400 nearDump 族 / CD403 承接比 / CD405 波窗捆绑
      for (const k of ['nearDumpQualBlocks','nearDumpMinAbsorbBnb','nearDumpWorstSellers','nearDumpWorstSellBnb','nearDumpWorstSecToAnchor','nearDumpWorstSameBlkBuyBnb','burstWaveBundleMaxWallets','burstWaveBundleAdjPairSum','burstMaxGapSec','burstWaveBuyBnb','burstWaveWallets','burstExitVsLaunchPct'])
        console.log('  anchor', k, '=', JSON.stringify(A[k]));
    } else console.log('cheatCheck: (none)');
    const bp = md.buyPoint;
    if (bp) {
      console.log('--- buyPoint ---');
      const as = bp.assessment || bp.info || {};
      console.log('assessment keys:', Object.keys(bp).join(','));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
