require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const EXP = '38d91153-7758-469e-a376-e748c3b3d63a';
const ADDR = '0x7f2573c137e18bbfcef52d97acedc2be58b67777';
(async () => {
  const db = dbManager.getClient();
  const { data: trades, error } = await db
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  console.log('trades:', (trades||[]).length);
  for (const t of (trades||[])) {
    const md = t.metadata || {};
    console.log(t.created_at, '| side:', t.side, '| bnb:', t.bnb_amount, '| success:', t.success, '| why:', (md.why || md.reason || '').slice(0,60));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
