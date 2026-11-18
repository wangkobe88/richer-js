// 展开 05d2 票 trendFactors 快照
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x05d26fcacc92500d1de680ee3b428cd2dbe17777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

(async () => {
  const c = await dbManager.getClient();
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,reason,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`\n===== ${s.created_at} ${s.signal_type} ${s.reason} =====`);
    console.log(`  price=${md.price} buyPrice=${md.buyPrice} pp=${md.profitPercent}`);
    const tf = md.trendFactors || {};
    const keys = ['sinceEntryNetBuyRatio','sinceEntryBuyBnb','sinceEntrySellBnb',
      'realHoldDuration','holdDuration','profitPercent','peakProfitPct','drawdownFromHighestSinceLastBuy',
      'actTotalBnb','actBuyBnb','actSellBnb','currentVsLaunchPct','tradeCount','currentPriceBnb',
      'sinceLastFamousBigBuySec','recentFamousSellBnb','sinceEntryFamousNearLaunchBuyBnb'];
    for (const k of keys) if (k in tf) console.log(`  tf.${k} = ${tf[k]}`);
    // 全量 dump 第一条 SELL 的 trendFactors 键
    if (s.signal_type === 'SELL') {
      console.log('  tf keys:', Object.keys(tf).join(','));
    }
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
