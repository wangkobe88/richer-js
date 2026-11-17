require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const EXP = '38d91153-7758-469e-a376-e748c3b3d63a';
const ADDR = '0x7f2573c137e18bbfcef52d97acedc2be58b67777';
(async () => {
  const db = dbManager.getClient();
  const { data: trades } = await db
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(10);
  for (const t of (trades||[])) {
    console.log('=== trade', t.id, t.created_at, '===');
    const skip = {};
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (v === null || v === undefined) continue;
      const sv = typeof v === 'object' ? JSON.stringify(v).slice(0, 220) : String(v).slice(0, 80);
      console.log(' ', k, '=', sv);
    }
    console.log('');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
