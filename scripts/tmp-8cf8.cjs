const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x8cf171df2a7c81b1f7d34bfff56235ba8ad37777';
async function main() {
  const c = await dbManager.getClient();
  // A. eq 完整地址+实验
  const q1 = await c.from('strategy_signals').select('created_at,executed,er:metadata->>execution_reason')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(3);
  console.log('A eq 地址+实验:', q1.data ? q1.data.length : 'err', q1.error ? q1.error.message : '');
  for (const r of q1.data || []) console.log('   ', r.created_at, 'exec=' + r.executed, r.er || '(买)');
  // B. 全库 eq 地址
  const q2 = await c.from('strategy_signals').select('experiment_id,created_at,executed')
    .eq('token_address', ADDR).limit(3);
  console.log('B 全库 eq 地址:', q2.data ? q2.data.length : 'err');
  // C. 或条件：or(token_address.eq.…)
  const q3 = await c.from('strategy_signals').select('created_at,executed')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a')
    .or(`token_address.eq.${ADDR}`).limit(3);
  console.log('C or() 形状:', q3.data ? q3.data.length : 'err', q3.error ? q3.error.message : '');
  for (const r of q3.data || []) console.log('   ', r.created_at, 'exec=' + r.executed);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
