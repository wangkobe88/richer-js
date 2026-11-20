const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x397ada63ce5f5c13885b4893b7f4e01c046a7777';

async function main() {
  const sb = dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(10);
  for (const s of sigs) {
    const m = s.metadata || {};
    const fc = m.factorCheck || {};
    console.log('\n===== signal', s.created_at, 'factorCheck pass=', fc.pass, 'arms=', JSON.stringify(fc.arms));
    for (const g of fc.gates || []) {
      if (/fam/.test(g.id)) console.log('  GATE', g.id, '| hit=', g.hit, '| value=', g.value, '| line=', g.line);
    }
    if (fc.famous) console.log('  famous trace:', JSON.stringify(fc.famous));
    const bp = m.buyPoint || {};
    if (bp.assessment) {
      const a = bp.assessment;
      console.log('  BP buckets:', JSON.stringify({ market_pattern: a.market_pattern, entry_shape: a.entry_shape, activity_level: a.activity_level, holder_concentration: a.holder_concentration }));
    }
    if (bp.digest && bp.digest.qualities) console.log('  BP qualities:', JSON.stringify(bp.digest.qualities));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
