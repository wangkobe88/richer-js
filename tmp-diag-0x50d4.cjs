require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

const ADDR = '0x50d48ae54f1d806aa6ff15faab4027d5dbcf7777';

(async () => {
  const db = dbManager.getClient();

  console.log('=== experiments (recent) ===');
  const { data: exps } = await db
    .from('experiments')
    .select('id,name,status,platform,strategy_config,created_at,updated_at,started_at,stopped_at')
    .order('created_at', { ascending: false })
    .limit(5);
  for (const e of (exps || [])) {
    console.log(e.id, '|', e.name, '|', e.status, '|', e.platform, '|', e.created_at, '->', e.stopped_at || e.updated_at);
  }

  console.log('\n=== experiment_tokens ===');
  const { data: ets, error: etErr } = await db
    .from('experiment_tokens')
    .select('*')
    .ilike('token_address', ADDR)
    .limit(20);
  if (etErr) console.log('ERR', etErr.message);
  for (const t of (ets || [])) {
    console.log(JSON.stringify(t, null, 2));
  }
  if (!ets || ets.length === 0) console.log('(none)');

  console.log('\n=== token_monitoring_pool ===');
  const { data: pool, error: poolErr } = await db
    .from('token_monitoring_pool')
    .select('*')
    .ilike('token_address', ADDR)
    .limit(20);
  if (poolErr) console.log('ERR', poolErr.message);
  for (const p of (pool || [])) console.log(JSON.stringify(p));

  console.log('\n=== strategy_signals ===');
  const { data: sigs, error: sigErr } = await db
    .from('strategy_signals')
    .select('id,experiment_id,token_address,signal_type,strategy_id,strategy_name,price_bnb,created_at,executed,executed_at,metadata')
    .ilike('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(50);
  if (sigErr) console.log('ERR', sigErr.message);
  for (const s of (sigs || [])) {
    console.log(`${s.created_at} | ${s.signal_type} | ${s.strategy_name} | price=${s.price_bnb} | executed=${s.executed} @${s.executed_at} | id=${s.id}`);
  }
  if (!sigs || sigs.length === 0) console.log('(none)');

  console.log('\n=== trades ===');
  const { data: trades, error: trErr } = await db
    .from('trades')
    .select('*')
    .ilike('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(50);
  if (trErr) console.log('ERR', trErr.message);
  for (const t of (trades || [])) console.log(JSON.stringify(t));

  console.log('\n=== wss_price_ticks (first/last few) ===');
  const { data: firstTicks } = await db
    .from('wss_price_ticks')
    .select('block_number,log_index,block_time,price_bnb,event_type,source,experiment_id,tx_hash')
    .ilike('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3);
  for (const t of (firstTicks || [])) console.log('FIRST', JSON.stringify(t));
  const { data: lastTicks } = await db
    .from('wss_price_ticks')
    .select('block_number,log_index,block_time,price_bnb,event_type,source,experiment_id,tx_hash')
    .ilike('token_address', ADDR)
    .order('block_number', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(3);
  for (const t of (lastTicks || [])) console.log('LAST ', JSON.stringify(t));

  console.log('\n=== wss_events ===');
  const { data: evs } = await db
    .from('wss_events')
    .select('*')
    .ilike('token_address', ADDR)
    .order('block_number', { ascending: true })
    .limit(20);
  for (const e of (evs || [])) console.log(JSON.stringify(e));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
