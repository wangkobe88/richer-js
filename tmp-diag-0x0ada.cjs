require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const ADDR = '0x0adad648d69fa916fb5f30a380b9d3eaf2ac7777';
const EXP = '05222b30-0272-4278-975e-169964683987';
(async () => {
  const db = dbManager.getClient();
  const { data: ets } = await db.from('experiment_tokens').select('*').ilike('token_address', ADDR).limit(10);
  console.log('=== experiment_tokens ===');
  for (const t of (ets||[])) console.log(JSON.stringify(t, null, 2));
  const { data: sigs } = await db.from('strategy_signals').select('*').ilike('token_address', ADDR).order('created_at', {ascending:true}).limit(50);
  console.log('\n=== signals ===', (sigs||[]).length);
  for (const s of (sigs||[])) {
    console.log(JSON.stringify({id:s.id, exp:s.experiment_id, side:s.side, type:s.signal_type, status:s.status, ts:s.created_at, strat:s.strategy_name, md:s.metadata}, null, 2).slice(0, 6000));
  }
  const { data: trades } = await db.from('trades').select('*').ilike('token_address', ADDR).order('created_at', {ascending:true}).limit(50);
  console.log('\n=== trades ===', (trades||[]).length);
  for (const t of (trades||[])) console.log(JSON.stringify(t, null, 2).slice(0,3000));
  const { data: evs } = await db.from('wss_events').select('*').ilike('token_address', ADDR).order('block_number',{ascending:true}).limit(10);
  console.log('\n=== wss_events ===', (evs||[]).length);
  for (const e of (evs||[])) console.log(JSON.stringify(e).slice(0,800));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
