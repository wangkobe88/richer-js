const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
  // token_create 锚
  const { data: ev, error: e1 } = await db.from('wss_events')
    .select('block_time,payload').eq('kind', 'token_create').eq('token_address', T)
    .order('block_time', { ascending: true }).limit(1);
  if (e1) { console.log('ev err', e1.message); }
  else console.log('token_create:', JSON.stringify(ev));
  // 最近 case 实验基底
  const { data: exps, error: e2 } = await db.from('experiments')
    .select('id,experiment_name,status,config->backtest->>start_time,config->backtest->>end_time,created_at')
    .ilike('experiment_name', '%bp4%').order('created_at', { ascending: false }).limit(12);
  if (e2) console.log('exp err', e2.message);
  else for (const r of exps) console.log(`${r.experiment_name} ${r.id} ${r.status} win=${r['config->backtest->>start_time']}~${r['config->backtest->>end_time']}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
