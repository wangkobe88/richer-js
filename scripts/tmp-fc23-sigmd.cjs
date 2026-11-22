'use strict';
// 0xfc23：两笔信号 metadata 全键扫描（找因子快照段）+ 输出臂详情
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    console.log(`\n===== ${s.created_at} metadata 顶层键: ${Object.keys(md).join(', ')} =====`);
    const fc = md.factorCheck || {};
    if (fc.gates) for (const g of fc.gates) {
      if (g.hit) console.log(`  [HIT] ${g.id} ${g.line} | ${g.value}`);
    }
    if (fc.arms) console.log('  arms:', JSON.stringify(fc.arms));
    for (const k of Object.keys(md)) {
      if (/factor/i.test(k) && k !== 'factorCheck') console.log(`  ${k}: ${JSON.stringify(md[k]).slice(0, 800)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
