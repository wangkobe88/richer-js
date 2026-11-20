require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('id, created_at, reason, metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(15);
  if (error) throw new Error(JSON.stringify(error));
  for (const row of data) {
    const md = row.metadata || {};
    console.log('=== sig', row.created_at, '|', row.reason, '| exec:', md.execution_status);
    if (md.actFrontGate) console.log('actFrontGate:', JSON.stringify(md.actFrontGate));
    if (md.cheatCheck) console.log('cheatCheck.grade:', md.cheatCheck.grade, '| status:', md.cheatCheck.status, '| reasons:', JSON.stringify(md.cheatCheck.reasons || md.cheatCheck.info || null).slice(0, 400));
    if (md.buyPoint) console.log('buyPoint:', JSON.stringify(md.buyPoint).slice(0, 300));
    if (md.factorCheck) console.log('factorCheck pass:', md.factorCheck.pass, '| arms:', JSON.stringify(md.factorCheck.arms || []), '| reason:', md.factorCheck.reason);
  }
  const { data: ev } = await sb.from('wss_events')
    .select('block_time,payload->symbol,payload->name,platform')
    .eq('kind', 'token_create').eq('token_address', TOKEN).limit(1);
  console.log('token_create:', JSON.stringify(ev));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
