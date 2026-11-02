const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8';
const TOKEN = '0x5ca91444c8ab56f50a4117232c06ed4eff7d7777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: exp, error: e1 } = await client.from('experiments')
    .select('id,experiment_name,status,config').eq('id', EXP).single();
  if (e1) { console.error('exp err:', e1.message); process.exit(1); }
  console.log('exp:', exp.experiment_name, exp.status);
  const legs = [
    ...(exp.config?.strategiesConfig?.buyStrategies || []),
    ...(exp.config?.strategiesConfig?.sellStrategies || []),
  ];
  for (const leg of legs) {
    const isBuy = leg.condition !== undefined && (leg.cards === undefined || leg.side === 'buy' || /买/.test(leg.name || ''));
    console.log('LEG:', leg.name, '| buyPhase:', leg.buyPhase ?? null,
      '| maxExecutions:', leg.maxExecutions ?? null, '| enabled:', leg.enabled ?? true);
    if (isBuy) {
      console.log('  trigger:', leg.narrativeTriggerCondition);
      console.log('  cond:', leg.condition);
      console.log('  gmgn:', leg.gmgnCheckCondition);
    } else {
      console.log('  sellCond:', leg.condition);
    }
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
    console.log(' ', s.created_at, s.signal_type, s.action, 'exec:', s.executed, '| reason:', (s.reason || '').slice(0, 160),
      '| strategy:', s.metadata?.strategyName || s.metadata?.strategy || '');
  }
  const { data: rounds, error: e4 } = await client.from('narrative_analysis_rounds')
    .select('round_no,trigger_reason,rating,started_at,completed_at,from_cache,error')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('started_at');
  if (e4) console.error('rounds err:', e4.message);
  console.log('\nnarrative rounds:', (rounds || []).length);
  for (const r of (rounds || [])) console.log(' ', r.started_at, 'r', r.round_no, r.trigger_reason, 'rating:', r.rating, 'cached:', r.from_cache, 'err:', r.error);
  const { data: ticks, error: e5 } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb').eq('token_address', TOKEN)
    .order('block_time', { ascending: false }).limit(50);
  if (e5) console.error('ticks err:', e5.message);
  console.log('\nlatest 50 ticks (asc):');
  for (const tk of (ticks || []).slice().reverse()) {
    console.log(' ', tk.block_time, tk.trade_type, 'bnb:', tk.bnb_amount, 'px:', tk.price_bnb);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
