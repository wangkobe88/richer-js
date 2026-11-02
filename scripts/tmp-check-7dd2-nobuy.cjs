const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '5298b7bd-8374-458d-b9e3-c5fe581e681d'; // v61
const TOKEN = '0x7dd2a5251abd97f2059db318a0b9851786617777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: exp, error: e1 } = await client.from('experiments')
    .select('id,experiment_name,status,config').eq('id', EXP).single();
  if (e1) { console.error('exp err:', e1.message); process.exit(1); }
  console.log('exp:', exp.experiment_name, exp.status);
  const legs = [
    ...(exp.config?.strategiesConfig?.buyStrategies || []),
  ];
  for (const leg of legs) {
    console.log('BUY LEG:', leg.name, '| buyPhase:', leg.buyPhase ?? null, '| maxEx:', leg.maxExecutions ?? null);
    console.log('  trigger:', leg.narrativeTriggerCondition);
    console.log('  cond:', leg.condition);
    console.log('  gmgn:', leg.gmgnCheckCondition);
  }
  const { data: trades, error: e2 } = await client.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  if (e2) console.error('trades err:', e2.message);
  console.log('\ntrades:', (trades || []).length);
  for (const t of (trades || [])) {
    console.log(' ', t.created_at, t.trade_direction, 'in:', t.input_amount, 'out:', t.output_amount,
      'success:', t.success, 'cards:', t.metadata?.cardTrade ? JSON.stringify(t.metadata.cardTrade) : '');
  }
  const { data: sigs, error: e3 } = await client.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  if (e3) console.error('signals err:', e3.message);
  console.log('\nsignals:', (sigs || []).length);
  for (const s of (sigs || [])) {
    console.log(' ', s.created_at, s.signal_type, s.action, 'exec:', s.executed, '| reason:', (s.reason || '').slice(0, 200),
      '| strategy:', s.metadata?.strategyName || s.metadata?.strategy || '');
  }
  const { data: rounds, error: e4 } = await client.from('narrative_analysis_rounds')
    .select('round_no,trigger_reason,rating,started_at,completed_at,from_cache,error')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('started_at');
  if (e4) console.error('rounds err:', e4.message);
  console.log('\nnarrative rounds:', (rounds || []).length);
  for (const r of (rounds || [])) console.log(' ', r.started_at, '→', r.completed_at, 'r', r.round_no, r.trigger_reason, 'rating:', r.rating, 'cached:', r.from_cache, 'err:', r.error);
  const { data: tn, error: e4b } = await client.from('token_narrative')
    .select('updated_at,narrative_rating,rating,pre_check_result,pre_check_reason,token_category,reanalyze_count')
    .eq('token_address', TOKEN).order('updated_at', { ascending: false }).limit(3);
  if (e4b) console.error('tn err:', e4b.message);
  console.log('\ntoken_narrative:', JSON.stringify(tn, null, 1).slice(0, 1200));
  const { data: create } = await client.from('wss_events')
    .select('block_time,payload').eq('token_address', TOKEN).eq('kind', 'token_create').limit(2);
  console.log('\ntoken_create:', JSON.stringify(create, null, 1).slice(0, 800));
  // 早期价格轨迹：前 60 tick + 峰值
  const { data: ticksAsc, error: e5 } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb').eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(60);
  if (e5) console.error('ticks err:', e5.message);
  console.log('\nfirst 60 ticks:');
  for (const tk of (ticksAsc || [])) {
    console.log(' ', tk.block_time, tk.trade_type, 'bnb:', tk.bnb_amount, 'px:', tk.price_bnb);
  }
  const { count: tickCount } = await client.from('wss_price_ticks')
    .select('*', { count: 'exact', head: true }).eq('token_address', TOKEN);
  console.log('total ticks:', tickCount);
  const { data: ticksPeak } = await client.from('wss_price_ticks')
    .select('block_time,price_bnb').eq('token_address', TOKEN)
    .order('price_bnb', { ascending: false }).limit(3);
  console.log('top prices:', JSON.stringify(ticksPeak));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
