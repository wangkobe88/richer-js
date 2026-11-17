const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,executed,er:metadata->>execution_reason')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .eq('signal_type', 'BUY').eq('executed', true)
    .order('created_at', { ascending: true }).limit(60);
  console.log(`v131 executed BUY 信号 ${data ? data.length : 0} 行（成交票信号）；12:2x-12:4x 段：`);
  for (const s of data || []) {
    if (s.created_at.slice(11, 16) < '12:25' || s.created_at.slice(11, 16) > '12:40') continue;
    console.log(`${s.created_at.slice(11, 19)} ${(s.token_symbol || '?')} ${s.token_address}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
