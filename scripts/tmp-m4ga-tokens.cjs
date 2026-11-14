const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
(async () => {
  const E = '977689d2-e381-4f0d-9b08-694a56d50f21';
  const { data, error } = await db.from('strategy_signals')
    .select('token_address,signal_type,created_at,metadata->signalGate->>legId,metadata->signalGate->>triggerNo')
    .eq('experiment_id', E).eq('signal_type', 'BUY').limit(5000);
  if (error) { console.log('err', error.message); process.exit(1); }
  const byTok = {};
  for (const r of data || []) byTok[r.token_address] = (byTok[r.token_address] || 0) + 1;
  console.log('BUY 信号 token 分布:');
  const ent = Object.entries(byTok).sort((a, b) => b[1] - a[1]);
  for (const [t, n] of ent) console.log(`  ${t} ×${n}`);
  // M4GA 首末信号
  const mine = (data || []).filter(r => r.token_address === '0xba5ed45b42479e0a75316de7bf990ec90a3e4444');
  if (mine.length) console.log(`M4GA 首信号=${mine[0].created_at} 末=${mine[mine.length - 1].created_at} 共${mine.length}`);
  else console.log('M4GA 零信号');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
