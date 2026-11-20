require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = [
  ['CI', '0xf818ac2c5545a3d4b7c643efa18aca7237927777'],
  ['MOLLY', '0xd657ad14ec75dec1882e5a2a8d019079766a7777'],
];

function j(x) { return JSON.stringify(x); }

async function main() {
  const sb = dbManager.getClient();
  for (const [sym, t] of TOK) {
    const { data: sigs } = await sb.from('strategy_signals')
      .select('id,signal_type,created_at,metadata')
      .eq('experiment_id', EXP).eq('token_address', t).eq('signal_type', 'BUY').order('created_at').limit(1);
    const md = sigs?.[0]?.metadata || {};
    console.log(`\n########## ${sym} BUY @ ${sigs?.[0]?.created_at} ##########`);
    console.log('-- signalGate:', j(md.signalGate));
    console.log('-- factorCheck:', j(md.factorCheck));
    console.log('-- actFrontGate:', j(md.actFrontGate));
    console.log('-- cheatCheck(status/grade/reasons/exempt):', md.cheatCheck?.status, md.cheatCheck?.grade, j(md.cheatCheck?.reasons), j(md.cheatCheck?.exempt), j(md.cheatCheck?.exemptDenied));
    console.log('-- buyPoint:', j(md.buyPoint));
    // preBuyCheckFactors 全量
    const pf = md.preBuyCheckFactors || {};
    const keys = Object.keys(pf);
    const line = {};
    for (const k of keys) { const v = pf[k]; if (v !== null && v !== undefined && typeof v === 'number') line[k] = Math.round(v * 100) / 100; else if (v !== null && v !== undefined) line[k] = v; }
    console.log('-- preBuyCheckFactors(非null):', j(line));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
