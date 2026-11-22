'use strict';
// JG-18 前置核验（本地小结果读取）：0xc0e8（쿠우타）在 bt-v164（旧配置拦截）与 FP34 对拍臂（豁免开）的信号对照
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xc0e896ddec43881055a25786c17fa5d5d6337777';

(async () => {
  const sb = dbManager.getClient();
  // 1) 找 jg6/fp34 对拍实验 + bt-v164
  const { data: exps, error: eErr } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,created_at')
    .or('experiment_name.ilike.*jg6*,experiment_name.ilike.*fp34*,experiment_name.ilike.*taildip*,experiment_name.ilike.*fp33*,id.eq.9e9163de-a677-4d39-9c33-9ec9df05e400')
    .order('created_at', { ascending: false }).limit(25);
  if (eErr) throw new Error(eErr.message);
  for (const e of exps) console.log(`[exp] ${e.id.slice(0, 8)} ${e.experiment_name} mode=${e.trading_mode} status=${e.status}`);

  // 2) 逐实验查该票信号（小结果）
  for (const e of exps) {
    const { data: sigs, error: sErr } = await sb.from('strategy_signals')
      .select('created_at,signal_type,action,reason,metadata')
      .eq('experiment_id', e.id).eq('token_address', TOKEN)
      .order('created_at', { ascending: true }).limit(30);
    if (sErr) { console.log(`  ${e.id.slice(0, 8)} 查询失败: ${sErr.message}`); continue; }
    if (!sigs || !sigs.length) { console.log(`  --- ${e.id.slice(0, 8)} ${e.experiment_name}: 该票零信号行 ---`); continue; }
    console.log(`  === ${e.id.slice(0, 8)} ${e.experiment_name}: ${sigs.length} 行 ===`);
    for (const s of sigs) {
      const md = s.metadata || {};
      const fc = md.factorCheck || null;
      const armStr = fc ? JSON.stringify(fc.arms || fc.reason || '') : '无段';
      const verdict = fc && fc.verdict ? JSON.stringify(fc.verdict) : '';
      const trace = fc && fc.trace ? JSON.stringify(fc.trace) : '';
      console.log(`  ${s.created_at} ${s.signal_type}/${s.action || ''} reason=${s.reason || '?'}` +
        ` exec=${md.execution_status || (md.signalGate && md.signalGate.execution_status) || '?'}${md.execution_reason || (md.signalGate && md.signalGate.execution_reason) ? '/' + (md.execution_reason || md.signalGate.execution_reason) : ''}` +
        ` | fcPass=${fc ? fc.pass : '-'} arms=${armStr}${verdict} ${trace}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
