'use strict';
// 拉 trading-standard-v1 最新版买腿定义（id/name/condition 摘要/maxTriggers）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_library')
    .select('name,version,definition').eq('name', 'trading-standard-v1').order('version', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = (data || [])[0];
  if (!row) throw new Error('库无此包');
  const def = row.definition || {};
  console.log(`包=${row.name} v${row.version} 买腿 ${((def.buyLegs || [])).length} 条`);
  for (const l of (def.buyLegs || [])) {
    const sg = l.signalGate || {};
    console.log(`\n[leg] name=${l.name || ''} signalGate=${JSON.stringify(sg)}`);
    console.log(`  condition: ${l.condition || ''}`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
