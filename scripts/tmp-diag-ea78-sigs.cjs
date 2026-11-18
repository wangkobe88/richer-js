// ea78 信号行全量 dump
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const EXP = 'e5941591-df22-4434-ae29-1a93ced0f841';

(async () => {
  const c = await dbManager.getClient();
  const q = await c.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(50);
  if (q.error) { console.error(q.error); process.exit(1); }
  console.log(`信号行数=${(q.data || []).length}`);
  for (const s of q.data || []) {
    console.log(`\n===== ${s.created_at} type=${s.signal_type} =====`);
    for (const [k, v] of Object.entries(s)) {
      if (k === 'metadata' || v === null || v === undefined) continue;
      console.log(`  ${k}=${v}`);
    }
    const md = s.metadata || {};
    // 逐段打印关键判据
    const pick = ['signalGate', 'factorCheck', 'cheatCheck', 'buyPoint', 'gmgnCheck', 'factorResults', 'triggerNo', 'executionReason'];
    for (const key of pick) {
      if (md[key] !== undefined) {
        console.log(`  --- ${key} ---`);
        console.log('  ' + JSON.stringify(md[key], null, 1).split('\n').join('\n  ').slice(0, 2200));
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
