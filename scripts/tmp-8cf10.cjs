const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x8cf171df2a7c81b1f7d34bfff56235ba8ad37777';
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('created_at,executed,execution_reason,reason,er:metadata->>execution_reason,fc:metadata->factorCheck,cc_status:metadata->cheatCheck->>status,cc_grade:metadata->cheatCheck->>grade,bp_status:metadata->buyPoint->>status,bp_rule:metadata->buyPoint->assessment->>rule,bp_bucket:metadata->buyPoint->assessment->>bucket')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(4);
  if (error) throw new Error(error.message);
  for (const s of data || []) {
    console.log(`${s.created_at.slice(11, 19)} exec=${s.executed} 列er=${JSON.stringify(s.execution_reason)} meta.er=${s.er}`);
    console.log(`   reason列=${String(s.reason || '').slice(0, 30)} fc=${s.fc ? JSON.stringify({ s: s.fc.status, pass: s.fc.pass, r: s.fc.reason, b: s.fc.pvp && s.fc.pvp.branch }) : '无段'} cc=${s.cc_status}/${s.cc_grade} bp=${s.bp_status}/${s.bp_bucket}/${s.bp_rule}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
