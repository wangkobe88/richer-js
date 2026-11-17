require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

const EXP = '38d91153-7758-469e-a376-e748c3b3d63a';
const ADDR = '0xc01c4f60900a1f7e900f6bb3e7569c9d0364777';

(async () => {
  const db = dbManager.getClient();

  const { data: sigs, error } = await db
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  if (!sigs || !sigs.length) { console.log('(no signals)'); process.exit(0); }

  console.log('signal count (first 5):', sigs.length);
  for (const s of sigs) {
    console.log('\n===== signal', s.id, s.created_at, s.signal_type, s.action, 'strategy=', s.strategy_name || s.strategy_id || '', '=====');
    const md = s.metadata || {};
    const keys = Object.keys(md);
    console.log('metadata keys:', keys.join(','));
    const cheat = md.cheatCheck;
    if (cheat) {
      console.log('\n--- cheatCheck ---');
      const slim = { ...cheat };
      delete slim.observation; // 可能超大，单独打
      console.log(JSON.stringify(slim, null, 2).slice(0, 6000));
      if (cheat.observation) {
        console.log('\n--- cheatCheck.observation (anchors/levels) ---');
        const obs = cheat.observation;
        console.log('obs keys:', Object.keys(obs).join(','));
        console.log('activityLevel:', obs.activityLevel);
        console.log('anchors:', JSON.stringify(obs.anchors, null, 2));
      }
    }
    const bp = md.buyPoint;
    if (bp) {
      console.log('\n--- buyPoint ---');
      const slim = { ...bp };
      if (slim.digest) delete slim.digest;
      if (slim.state) delete slim.state;
      console.log(JSON.stringify(slim, null, 2).slice(0, 5000));
      if (bp.assessment || md.signalGate) {
        console.log('signalGate:', JSON.stringify(md.signalGate, null, 2).slice(0, 3000));
      }
    }
    if (!cheat && !bp) {
      console.log(JSON.stringify(md, null, 2).slice(0, 4000));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
