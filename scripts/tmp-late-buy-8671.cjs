const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const c = dbManager.getClient();
const TOKEN = '0x8671d681ee38039892bbad010b89813fb25e7777';
(async () => {
  const { data: ev } = await c.from('wss_events').select('kind,platform,block_time,payload')
    .eq('token_address', TOKEN).order('block_time');
  for (const r of ev || []) {
    const p = r.payload || {};
    console.log(`${r.kind} ${r.platform} ${r.block_time} sym=${p.symbol || ''} name=${p.name || ''}`);
    if (r.kind === 'token_create') { console.log('  T0=', p.blockTimeMs, new Date(p.blockTimeMs).toISOString()); }
  }
  const { data: rd } = await c.from('narrative_analysis_rounds')
    .select('experiment_id,round_no,started_at,completed_at,rating,from_cache,error')
    .eq('token_address', TOKEN).order('started_at');
  console.log('\nrounds:');
  for (const r of rd || []) console.log(`  r${r.round_no} ${r.started_at} → ${r.completed_at} rating=${r.rating} cache=${r.from_cache}`);
  const { data: sg } = await c.from('strategy_signals')
    .select('signal_type,action,created_at,metadata')
    .eq('token_address', TOKEN).order('created_at').limit(30);
  console.log('\nsignals:');
  for (const s of sg || []) {
    const m = s.metadata || {};
    const tf = m.trendFactors || {};
    console.log(`  ${s.signal_type} ${s.created_at} price=${m.price} rating=${tf.narrativeRating ?? ''} buyVol=${tf.buyVolumeBnb} holders=${tf.holders} mcap=${tf.marketCap} top2=${tf.top2BundleClusterHoldCircPct} sybil=${tf.sybilClusterHolderCircPct} nBLW=${tf.tradesNetBuyRatioLongWin} nBSW=${tf.tradesNetBuyRatioShortWin} routerPct=${tf.tradesRouterPct} slope=${tf.holderTrendSlope}`);
  }
  // narrativeRoundsSummary of BUY signals
  const buys = (sg || []).filter(s => s.signal_type === 'BUY');
  for (const b of buys) console.log('\nBUY leadMs:', b.metadata && b.metadata.narrativeRoundsSummary);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
