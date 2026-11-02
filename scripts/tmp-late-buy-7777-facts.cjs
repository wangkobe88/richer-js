#!/usr/bin/env node
// 0xa7ef…7777 迟买归因·第一步：单票事实拉取（本地小结果读取）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const c = dbManager.getClient();
const TOKEN = '0xa7ef3d3d483aab96228a331af89321ef38eb7777';

(async () => {
  // [2] trades（哪个实验、何时买）——列名对齐 tmp-buy-delay-attribution.cjs
  const { data: tr, error: e2 } = await c.from('trades')
    .select('id,experiment_id,token_symbol,trade_direction,input_amount,output_amount,created_at,executed_at,success,metadata,price_bnb')
    .eq('token_address', TOKEN).order('created_at').limit(50);
  if (e2) console.log('trades ERR:', e2.message);
  console.log('=== trades ===');
  for (const t of tr || []) {
    console.log(`${t.trade_direction} ${t.success ? 'OK' : 'FAIL'} in=${t.input_amount} out=${t.output_amount} price=${t.price_bnb} created=${t.created_at} exec=${t.executed_at} exp=${t.experiment_id}`);
    if (t.trade_direction === 'buy') console.log('  meta:', JSON.stringify((t.metadata || {})).slice(0, 900));
  }

  // [3] signals（fire 时间线）
  const { data: sg, error: e3 } = await c.from('strategy_signals')
    .select('id,experiment_id,signal_type,action,created_at,metadata')
    .eq('token_address', TOKEN).order('created_at').limit(200);
  if (e3) console.log('signals ERR:', e3.message);
  console.log('\n=== strategy_signals ===');
  for (const s of sg || []) {
    console.log(`--- ${s.signal_type} ${s.action} ${s.created_at} exp=${s.experiment_id.slice(0, 8)}`);
    const m = s.metadata || {};
    const pick = {};
    for (const k of ['currentPriceBnb', 'narrativeRating', 'narrativeRounds', 'narrativeRetryDue', 'gmgnCheck', 'preBuyCheckFactors', 'narrativeCall', 'signalDebounce', 'buyEvaluation', 'conditionResults']) {
      if (m[k] !== undefined) pick[k] = m[k];
    }
    if (Object.keys(m).length && Object.keys(pick).length === 0) pick['(allKeys)'] = Object.keys(m);
    console.log('  meta:', JSON.stringify(pick).slice(0, 2000));
  }

  // [4] 叙事 rounds
  const { data: rd, error: e4 } = await c.from('narrative_analysis_rounds')
    .select('experiment_id,round_no,started_at,completed_at,rating,reason,from_cache,error')
    .eq('token_address', TOKEN).order('started_at').limit(50);
  if (e4) console.log('rounds ERR:', e4.message);
  console.log('\n=== narrative_analysis_rounds ===');
  for (const r of rd || []) console.log(`exp=${r.experiment_id.slice(0, 8)} round=${r.round_no} started=${r.started_at} completed=${r.completed_at} rating=${r.rating} cache=${r.from_cache} reason=${(r.reason || '').slice(0, 100)} err=${(r.error || '').slice(0, 150)}`);

  // [5] token_narrative（叙事侧全局缓存）
  const { data: tn, error: e5 } = await c.from('token_narrative')
    .select('rating,reason,created_at,updated_at,raw_api_data')
    .eq('token_address', TOKEN).limit(5);
  if (e5) console.log('token_narrative ERR:', e5.message);
  console.log('\n=== token_narrative ===');
  for (const r of tn || []) {
    console.log(`rating=${r.rating} created=${r.created_at} updated=${r.updated_at}`);
    console.log('  reason:', (r.reason || '').slice(0, 300));
    const raw = r.raw_api_data || {};
    console.log('  raw.created_at:', raw.created_at, ' searchEvidence?', !!raw.search_evidence, ' twitter?', !!raw.twitter_info, ' urls:', JSON.stringify(raw.classified_urls || Object.keys(raw)).slice(0, 400));
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
