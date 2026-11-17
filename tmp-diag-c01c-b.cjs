require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const EXP = '38d91153-7758-469e-a376-e748c3b3d63a';
(async () => {
  const db = dbManager.getClient();
  const { data: sigs, error } = await db
    .from('strategy_signals')
    .select('id,created_at,signal_type,token_address')
    .eq('experiment_id', EXP)
    .order('created_at', { ascending: true })
    .limit(3000);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  console.log('total signals:', (sigs||[]).length);
  const byToken = {};
  for (const s of (sigs||[])) {
    byToken[s.token_address] = byToken[s.token_address] || [];
    byToken[s.token_address].push(s);
  }
  const hit = Object.keys(byToken).filter(t => (t||'').toLowerCase().includes('c01c4f60'));
  console.log('matching tokens:', hit);
  for (const t of hit) {
    for (const s of byToken[t]) console.log(s.created_at, s.signal_type, s.id);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
