const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('created_at,signal_type,metadata')
    .eq('experiment_id', 'd3453504-03d5-480c-89e0-483db930361c')
    .eq('token_address', '0x81bf04448ad0b72258ab5d9e0a1f77e59cdf7777')
    .order('created_at').limit(5);
  if (error) throw error;
  for (const r of data) fs.writeFileSync(`/tmp/tmp-81bf-meta-${r.signal_type}.json`, JSON.stringify(r.metadata, null, 1));
  console.log('dumped', data.map(r => r.signal_type).join(','));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
