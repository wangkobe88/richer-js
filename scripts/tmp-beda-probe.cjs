'use strict';
// 0xbeda 预查：token_create + 信号时间线 + 集合行（前期无信号原因核验）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xbeda571060f81250615e1031bfea922b23067777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('case_collection_tokens')
    .select('id,note,token_meta,sync_state').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (rows || [])[0];
  console.log(row ? ('集合行 sync=' + row.sync_state + ' symbol=' + ((row.token_meta && (row.token_meta.payload || row.token_meta)).symbol) + ' note=' + JSON.stringify(row.note || '').slice(0, 120)) : '不在集合');
  const { data: ev, error: evErr } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(8);
  if (evErr) throw new Error(evErr.message);
  for (const e of (ev || [])) console.log(`[event] ${e.kind} ${e.block_time} ${(e.payload || {}).symbol || ''}`);
  const { data: sigs, error: sErr } = await sb.from('strategy_signals')
    .select('created_at,signal_type,action,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(50);
  if (sErr) throw new Error(sErr.message);
  console.log('\n信号行数:', (sigs || []).length);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const sg = md.signalGate || {};
    const fc = md.factorCheck || {};
    console.log(`- ${s.created_at} ${s.signal_type}/${s.action} reason=${s.reason || ''} leg=${sg.legId || ''} ${fc.arms && fc.arms.length ? 'FParms=' + JSON.stringify(fc.arms) : ''}${md.execution_reason ? ' exec=' + md.execution_reason : ''}`);
  }
  const { data: trades } = await sb.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,created_at,trade_status')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(10);
  console.log('\n成交行数:', (trades || []).length);
  for (const t of (trades || []).length ? trades : []) console.log(`- ${t.created_at} ${t.trade_direction} ${t.input_amount}->${t.output_amount} @${t.unit_price}`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
