'use strict';
// JG-19 预查：0x2994 集合行 + bt-v164 信号/成交全链（burst 快卖误伤核验）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0x29946c3421ccebb43ca6d30970629c5a432a7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('case_collection_tokens')
    .select('id,note,token_meta,sync_state').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (rows || [])[0];
  if (!row) console.log('⚠️ 不在金狗集合');
  else {
    console.log('集合行 sync_state:', row.sync_state, '| symbol:', (row.token_meta && (row.token_meta.payload || row.token_meta)).symbol, '| 现note:', JSON.stringify(row.note || ''));
  }
  const { data: sigs, error: sErr } = await sb.from('strategy_signals')
    .select('created_at,signal_type,action,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(40);
  if (sErr) throw new Error(sErr.message);
  console.log('\n信号行数:', (sigs || []).length);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const fc = md.factorCheck || {};
    const sg = md.signalGate || {};
    const parts = [];
    if (sg.legId) parts.push('leg=' + sg.legId);
    if (fc.arms && fc.arms.length) parts.push('FParms=' + JSON.stringify(fc.arms));
    if (md.execution_reason) parts.push('exec=' + md.execution_reason);
    if (md.execution_status) parts.push(md.execution_status);
    console.log(`- ${s.created_at} ${s.signal_type}/${s.action} reason=${s.reason || ''} ${parts.join(' ')}`);
  }
  const { data: trades, error: tErr } = await sb.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,created_at,trade_status,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(40);
  if (tErr) throw new Error(tErr.message);
  console.log('\n成交行数:', (trades || []).length);
  for (const t of (trades || [])) {
    const md = t.metadata || {};
    console.log(`- ${t.created_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} @${t.unit_price} ${t.trade_status}${md.cardTrade ? ' card=' + md.cardTrade : ''}${md.exit ? ' exit=' + JSON.stringify(md.exit).slice(0, 80) : ''}${md.reason ? ' reason=' + md.reason : ''}`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
