const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('experiments').select('*').eq('id','b8ae9f2e-832f-42db-bbda-8d8701aecb63').single();
  if (error) { console.error('ERR', error.message); process.exit(1); }
  console.log('keys:', Object.keys(data).join(','));
  console.log('name=', data.experiment_name || data.name, '| mode=', data.trading_mode, '| status=', data.status, '| created=', data.created_at, '| start=', data.start_time, 'end=', data.end_time);
  const cfg = data.config || {};
  console.log('stallClose:', JSON.stringify(cfg.stallClose));
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
