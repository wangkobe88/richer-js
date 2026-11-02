#!/usr/bin/env node
// 0xa7ef…7777 迟买归因·第二步：trades 真值 + 信号完整 metadata + rounds + token_narrative + tick 时间线
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const c = dbManager.getClient();
const TOKEN = '0xa7ef3d3d483aab96228a331af89321ef38eb7777';
const T0 = 1793232060000; // token_create blockTimeMs

(async () => {
  // [1] trades
  const { data: tr, error: e1 } = await c.from('trades')
    .select('id,experiment_id,token_symbol,trade_direction,input_amount,output_amount,created_at,executed_at,success,metadata')
    .eq('token_address', TOKEN).order('created_at').limit(50);
  if (e1) { console.log('trades ERR:', e1.message); }
  console.log('=== trades ===');
  for (const t of tr || []) {
    console.log(`${t.trade_direction} ${t.success ? 'OK' : 'FAIL'} in=${t.input_amount} out=${t.output_amount} created=${t.created_at} exec=${t.executed_at} (+${((Date.parse(t.executed_at || t.created_at)) - T0) / 1000}s)`);
    const m = t.metadata || {};
    console.log('  meta keys:', Object.keys(m).join(','));
    if (m.tradeResult) console.log('  tradeResult:', JSON.stringify(m.tradeResult).slice(0, 500));
    if (m.cardTrade) console.log('  cardTrade:', JSON.stringify(m.cardTrade));
  }

  // [2] BUY 信号完整 metadata
  const { data: sg, error: e2 } = await c.from('strategy_signals')
    .select('id,signal_type,action,created_at,metadata')
    .eq('token_address', TOKEN).eq('signal_type', 'BUY').order('created_at').limit(10);
  if (e2) console.log('signals ERR:', e2.message);
  console.log('\n=== BUY signal 完整 metadata ===');
  for (const s of sg || []) {
    const m = s.metadata || {};
    console.log(`fire=${s.created_at} (+${(Date.parse(s.created_at) - T0) / 1000}s)`);
    for (const [k, v] of Object.entries(m)) {
      if (k === 'preBuyCheckFactors') { console.log(`  ${k}: (len=${JSON.stringify(v).length}) narrativeRating=${v.narrativeRating} narrativeCorpusLagSec=${v.narrativeCorpusLagSec}`); continue; }
      console.log(`  ${k}: ${JSON.stringify(v).slice(0, 800)}`);
    }
  }

  // [3] rounds
  const { data: rd, error: e3 } = await c.from('narrative_analysis_rounds')
    .select('experiment_id,round_no,started_at,completed_at,rating,from_cache,error')
    .eq('token_address', TOKEN).order('started_at').limit(50);
  if (e3) console.log('rounds ERR:', e3.message);
  console.log('\n=== narrative_analysis_rounds ===');
  for (const r of rd || []) console.log(`round=${r.round_no} started=${r.started_at}(+${(Date.parse(r.started_at) - T0) / 1000}s) completed=${r.completed_at}(+${r.completed_at ? (Date.parse(r.completed_at) - T0) / 1000 : '?'}s) rating=${r.rating} cache=${r.from_cache} err=${(r.error || '').slice(0, 150)}`);

  // [4] token_narrative select *
  const { data: tn, error: e4 } = await c.from('token_narrative').select('*').eq('token_address', TOKEN).limit(5);
  if (e4) console.log('token_narrative ERR:', e4.message);
  console.log('\n=== token_narrative ===');
  for (const r of tn || []) {
    const cols = Object.keys(r);
    console.log('cols:', cols.join(','));
    for (const k of cols) {
      const v = r[k];
      if (v == null || typeof v === 'object') continue;
      console.log(`  ${k}=${String(v).slice(0, 150)}`);
    }
    const raw = r.raw_api_data || {};
    console.log('  raw.created_at:', raw.created_at, ' search_evidence?', !!raw.search_evidence);
    console.log('  raw keys:', Object.keys(raw).join(',').slice(0, 500));
    if (raw.classified_urls) console.log('  classified_urls:', JSON.stringify(raw.classified_urls).slice(0, 400));
  }

  // [5] tick 时间线（前 120s + 买点附近价）——flap 税币票 tick 数少
  const { data: ticks, error: e5 } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_usd')
    .eq('token_address', TOKEN).gte('block_time', new Date(T0 - 5000).toISOString()).lte('block_time', new Date(T0 + 300000).toISOString())
    .order('block_number').order('log_index').limit(800);
  if (e5) console.log('ticks ERR:', e5.message);
  console.log(`\n=== ticks 前 300s（n=${(ticks || []).length}）===`);
  let lastP = null;
  for (const t of ticks || []) {
    const off = (Date.parse(t.block_time) - T0) / 1000;
    if (off > 120 && off < 240) continue;   // 中段折叠，只看头 2min 与其后采样
    console.log(`${off.toFixed(1)}s ${t.trade_type} bnb=${Number(t.bnb_amount).toFixed(4)} price_bnb=${t.price_bnb} usd=${t.price_usd} ${t.price_bnb !== lastP ? '' : '(same)'} blk=${t.block_number}:${t.log_index}`);
    lastP = t.price_bnb;
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
