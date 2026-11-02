const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
async function main() {
  const client = dbManager.getClient();
  const q1 = await client.from('cheat_detection').select('id, token_address, created_at').limit(3);
  console.log('cheat_detection select id: rows=' + ((q1.data || []).length) + ' error=' + (q1.error ? JSON.stringify(q1.error).slice(0, 200) : 'null'));
  for (const r of q1.data || []) console.log('  ' + r.token_address.slice(0, 10) + ' ' + r.created_at);
  const q2 = await client.from('cheat_detection').select('*', { count: 'exact', head: true });
  console.log('count exact head: count=' + q2.count + ' error=' + (q2.error ? q2.error.message : 'null'));
  const ex = await client.from('experiments').select('id, name, status, created_at').ilike('id', 'e3d00085%').limit(5);
  console.log('\nexperiments e3d00085: ' + ((ex.data || []).length) + ' 行 error=' + (ex.error ? ex.error.message : 'null'));
  for (const r of ex.data || []) console.log('  ' + r.id + ' status=' + r.status + ' created=' + r.created_at);
  if ((ex.data || []).length) {
    const eid = ex.data[0].id;
    const s = await client.from('strategy_signals').select('id, created_at, signal_type, token_address')
      .eq('experiment_id', eid).order('created_at', { ascending: false }).limit(5);
    console.log('\n最新 signals: ' + ((s.data || []).length) + ' 行 error=' + (s.error ? s.error.message : 'null'));
    for (const r of s.data || []) console.log('  ' + r.created_at + ' ' + r.signal_type + ' ' + r.token_address.slice(0, 10));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
