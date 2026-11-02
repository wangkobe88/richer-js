const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x23f1c4afb4ec09fbde68166bff0adbc5d1d57777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: ev } = await client.from('wss_events').select('kind,block_time,payload').eq('token_address', TOKEN).limit(5);
  for (const e of (ev || [])) console.log('EVENT', e.kind, e.block_time, JSON.stringify(e.payload).slice(0, 300));

  const { data: sigs } = await client.from('strategy_signals')
    .select('created_at,signal_type,reason,strategy_name').eq('token_address', TOKEN).order('created_at').limit(50);
  console.log('\nsignals:', (sigs || []).length);
  for (const s of (sigs || [])) console.log(' ', s.created_at, s.signal_type, s.strategy_name, '|', (s.reason || '').slice(0, 80));

  const { data: trades } = await client.from('trades')
    .select('created_at,side,amount_bnb,status,metadata').eq('token_address', TOKEN).limit(20);
  console.log('\ntrades:', (trades || []).length);
  for (const t of (trades || [])) console.log(' ', t.created_at, t.side, t.amount_bnb, t.status);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
