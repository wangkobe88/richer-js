'use strict';
// JG-17 预查：0xe4e4 票在金狗集合的行 + bt-v164 (9e9163de) 里的信号/门链拦截情况
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xe4e4149ed653e10d45d640f14445ae744ffb7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('case_collection_tokens')
    .select('id,note,token_meta,sync_state').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (rows || [])[0];
  if (!row) { console.log('⚠️ token 不在金狗集合'); }
  else {
    console.log('集合行 id:', row.id, '| sync_state:', row.sync_state);
    console.log('symbol:', row.token_meta && (row.token_meta.payload || row.token_meta).symbol, '| 现note:', JSON.stringify(row.note || ''));
  }
  // 该实验该票的信号行（关注 FP/门链拦截）
  const { data: sigs, error: sigErr } = await sb.from('strategy_signals')
    .select('signal_type,action,reason,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (sigErr) throw new Error(sigErr.message);
  console.log('\n信号行数:', (sigs || []).length);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const fc = md.factorCheck ? (String(md.factorCheck.blocked) + ' arms=' + JSON.stringify(md.factorCheck.arms || md.factorCheck.reason || '')) : '无';
    console.log(`- ${s.created_at} ${s.signal_type}/${s.action} reason=${s.reason || ''} factorGate=${fc}`);
  }
  // 成交与盈亏概览
  const { data: trades, error: tErr } = await sb.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,created_at,trade_status')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(30);
  if (tErr) throw new Error(tErr.message);
  console.log('\n成交行数:', (trades || []).length);
  for (const t of (trades || [])) console.log(`- ${t.created_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} @${t.unit_price} ${t.trade_status}`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
