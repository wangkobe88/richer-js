require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0x2a84792c035229c761facd5790e4507f39377777';

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k];
  return out;
}

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(30);
  if (error) throw new Error(JSON.stringify(error));
  console.log('signal count:', data.length);
  for (const row of data) {
    console.log('\n=== sig', row.created_at, row.signal_type, row.action, row.execution_status, row.reason || '');
    const md = row.metadata || {};
    const sg = md.signalGate || {};
    if (Object.keys(sg).length) {
      console.log('signalGate:', JSON.stringify(pick(sg, ['legId', 'legName', 'triggerNo', 'maxTriggers'])));
    }
    const af = md.actFrontGate || {};
    if (Object.keys(af).length) {
      console.log('actFrontGate:', JSON.stringify(af));
    }
    const fc = md.factorCheck || {};
    if (Object.keys(fc).length) {
      console.log('factorCheck.status:', fc.status, fc.reason || '');
    }
    const ch = md.cheatCheck || {};
    if (Object.keys(ch).length) {
      console.log('cheatCheck keys:', Object.keys(ch).join(','));
      if (ch.grade) console.log('cheat grade:', ch.grade, JSON.stringify(ch.levels || {}).slice(0, 400));
    }
    const bp = md.buyPoint || {};
    if (Object.keys(bp).length) {
      console.log('buyPoint keys:', Object.keys(bp).join(','));
      console.log('buyPoint.assessment:', JSON.stringify(bp.assessment || bp).slice(0, 2500));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
