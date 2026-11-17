const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,signal_type,executed,status,er:metadata->>execution_reason')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .gte('created_at', '2026-11-04T12:31:20Z').lte('created_at', '2026-11-04T12:32:00Z')
    .order('created_at', { ascending: true }).limit(15);
  console.log(`v131 12:31:20→12:32:00 信号 ${data ? data.length : 0} 行:`);
  for (const s of data || []) console.log(`${(s.token_symbol || '?')} ${s.token_address} ${s.created_at.slice(11, 19)} ${s.signal_type} exec=${s.executed} er=${s.er || '(无)'}`);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
