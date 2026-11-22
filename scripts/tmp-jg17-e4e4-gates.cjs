'use strict';
// JG-17 补查：FP gates 完整数组（位置门/活跃度门 value）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe4e4149ed653e10d45d640f14445ae744ffb7777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const fc = md.factorCheck || {};
    if (!fc.gates) { console.log(`\n=== ${s.created_at} 无 gates ===`); continue; }
    console.log(`\n=== ${s.created_at} arms=${JSON.stringify(fc.arms)} pass=${fc.pass} ===`);
    for (const g of fc.gates) {
      if (g && (g.hit || String(g.id || '').match(/act|entry|position|price/i))) {
        console.log(`  [${g.id}] hit=${g.hit} ${g.line || ''} | ${g.value || ''} ${g.label || ''}`);
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
