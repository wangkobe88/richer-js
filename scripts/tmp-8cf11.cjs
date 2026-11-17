const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x8cf171df2a7c81b1f7d34bfff56235ba8ad37777';
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('created_at,executed,es:metadata->>execution_status,er:metadata->>execution_reason,fc:metadata->factorCheck,ccS:metadata->cheatCheck->>status,ccG:metadata->cheatCheck->>grade,bpS:metadata->buyPoint->>status,bpB:metadata->buyPoint->assessment->>bucket,bpR:metadata->buyPoint->assessment->>rule')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(4);
  if (error) throw new Error(error.message);
  for (const s of data || []) {
    console.log(`${s.created_at.slice(11, 19)} exec=${s.executed} execution_status=${s.es} er=${s.er}`);
    console.log(`   factorCheck=${s.fc ? JSON.stringify({ status: s.fc.status, pass: s.fc.pass, reason: s.fc.reason, branch: s.fc.pvp && s.fc.pvp.branch, trace: s.fc.trace }) : '无段'}`);
    console.log(`   cheat=${s.ccS}/${s.ccG}  bp=${s.bpS}/${s.bpB}/${s.bpR}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
