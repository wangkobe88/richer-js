const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x8cf171df2a7c81b1f7d34bfff56235ba8ad37777';
async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('strategy_signals')
    .select('id,created_at,executed,status,execution_reason,reason,metadata')
    .eq('experiment_id', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(4);
  for (const s of data || []) {
    const m = s.metadata || {};
    console.log(`\n=== ${s.created_at.slice(11, 19)} executed=${s.executed} status=${s.status} ===`);
    console.log('execution_reason 列:', JSON.stringify(s.execution_reason), '/ reason 列:', JSON.stringify(String(s.reason || '').slice(0, 40)));
    console.log('metadata.execution_reason:', m.execution_reason);
    console.log('metadata 顶层键:', Object.keys(m).join(','));
    if (m.factorCheck) console.log('factorCheck:', JSON.stringify({ s: m.factorCheck.status, pass: m.factorCheck.pass, r: m.factorCheck.reason, b: m.factorCheck.pvp && m.factorCheck.pvp.branch }));
    if (m.cheatCheck) console.log('cheatCheck:', JSON.stringify({ status: m.cheatCheck.status, grade: m.cheatCheck.grade }));
    if (m.buyPoint) console.log('buyPoint:', JSON.stringify({ status: m.buyPoint.status, bucket: m.buyPoint.assessment && m.buyPoint.assessment.bucket, rule: m.buyPoint.assessment && m.buyPoint.assessment.rule, dims: m.buyPoint.dimensions && Object.entries(m.buyPoint.dimensions).map(([k, v]) => k + ':' + (v && v.bucket)).join(' ') }));
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err); process.exit(1); });
