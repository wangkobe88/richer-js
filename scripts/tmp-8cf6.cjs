const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,signal_type,executed,er:metadata->>execution_reason')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(5);
  console.log('v131 BUY 信号前 5 行:');
  for (const s of data || []) console.log(`${s.created_at.slice(11, 19)} ${(s.token_symbol || '?')} ${s.token_address.slice(0, 16)}… exec=${s.executed} er=${s.er || '(买/无)'}`);
  // created_at 范围
  const { data: last } = await c.from('strategy_signals')
    .select('created_at').eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .order('created_at', { ascending: false }).limit(1);
  console.log('created_at 范围末行:', last && last[0] && last[0].created_at);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
