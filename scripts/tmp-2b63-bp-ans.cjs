// 0x2b63 BP 完整 answers + 砸块时序细查
const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x2b63c82ed1eb65e6298031c8cf5c307c26307777';

async function main() {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).eq('signal_type', 'BUY').order('created_at');
  const s = (sigs || [])[0];
  const bp = s?.metadata?.buyPoint || {};
  console.log('=== buyPoint full keys:', Object.keys(bp).join(','));
  console.log('passed=', bp.passed, 'status=', bp.status, 'rule=', bp.rule);
  if (bp.assessment) console.log('\nassessment:', JSON.stringify(bp.assessment, null, 1).slice(0, 3000));
  if (bp.answers) console.log('\nanswers:', JSON.stringify(bp.answers, null, 1).slice(0, 5000));
  if (bp.qualities) console.log('\nqualities:', JSON.stringify(bp.qualities, null, 1).slice(0, 2000));
  const a = bp.anchors || {};
  const dumpKeys = Object.keys(a).filter(k => /dump|follow|nearDump|phaseSplit|openSeg|totalVolume/i.test(k));
  console.log('\ndump-related anchors:');
  for (const k of dumpKeys) console.log(' ', k, '=', JSON.stringify(a[k]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
