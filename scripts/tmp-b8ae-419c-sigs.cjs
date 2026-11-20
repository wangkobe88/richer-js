const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x419c12c85c034f7e9f2d8a6a4de604059db77777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  console.log('该 token 信号行数:', data.length);
  for (const s of data) {
    const m = s.metadata || {};
    const segs = Object.keys(m).join(',');
    console.log('\n===', s.created_at, s.signal_type, s.action, '| status=', s.status, '| reason=', s.reason);
    console.log('  metadata 段:', segs);
    const sg = m.signalGate, fc = m.factorCheck, cc = m.cheatCheck, af = m.actFrontGate, bp = m.buyPoint;
    if (sg) console.log('  signalGate:', JSON.stringify(sg).slice(0, 300));
    if (fc) console.log('  factorCheck:', JSON.stringify(fc).slice(0, 400));
    if (af) console.log('  actFrontGate:', JSON.stringify(af).slice(0, 400));
    if (cc) console.log('  cheatCheck:', JSON.stringify(cc).slice(0, 400));
    if (bp) console.log('  buyPoint:', JSON.stringify(bp).slice(0, 400));
    if (s.status && s.status !== 'executed') {
      console.log('  FULL metadata:', JSON.stringify(m).slice(0, 3000));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
