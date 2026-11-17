const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('token_address,created_at,signal_type,executed,status,reason,er:metadata->>execution_reason')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .eq('token_symbol', '中国屌会飞')
    .order('created_at', { ascending: true }).limit(8);
  console.log(`v131 symbol=中国屌会飞 信号 ${data ? data.length : 0} 行:`);
  for (const s of data || []) {
    const codes = [...s.token_address.slice(0, 14)].map((ch) => ch.charCodeAt(0)).join(',');
    console.log(`${s.token_address} ${s.created_at.slice(11, 19)} ${s.signal_type} exec=${s.executed} status=${s.status} er=${s.er || '(无)'} 前14码=${codes}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
