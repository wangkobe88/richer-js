const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('experiment_id,created_at,signal_type,executed,status,reason,er:metadata->>execution_reason')
    .ilike('token_address', '0x8cf171df%').order('created_at', { ascending: true }).limit(10);
  console.log(`全库该前缀信号 ${data ? data.length : 0} 行:`);
  for (const r of data || []) console.log(JSON.stringify(r));
  // v131 实验行的存在性
  const { data: e } = await c.from('experiments').select('id,experiment_name').eq('id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a');
  console.log('实验行:', JSON.stringify(e));
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
