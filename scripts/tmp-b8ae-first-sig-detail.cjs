const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x26a34bb6811cf70a86fc7fe87609b7e3af977777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  // 第 1/2/3 条 BUY：打全 factorCheck + execution_status
  for (const s of data.slice(0, 5)) {
    const m = s.metadata || {};
    console.log('\n==========', s.created_at, s.reason, 'exec_status=', m.execution_status, 'exec_reason=', m.execution_reason);
    if (m.factorCheck) {
      const fc = m.factorCheck;
      console.log('factorCheck.pass =', fc.pass, '| rejected_by =', fc.reason || (fc.arms || []).join(','));
      for (const g of (fc.gates || [])) {
        console.log(`  [${g.hit ? '✗命中' : '· '}] ${g.id} | ${g.label} | ${g.line} | 实测=${g.value}`);
      }
      if (fc.arms && fc.arms.length) console.log('  arms 命中:', JSON.stringify(fc.arms));
      if (fc.tailDipKnife) console.log('  tailDipKnife:', JSON.stringify(fc.tailDipKnife));
    }
    if (m.price) console.log('price =', JSON.stringify(m.price).slice(0, 200));
  }

  // 成交 trades
  const { data: trades } = await sb.from('trades')
    .select('trade_type,amount_bnb,price,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  console.log('\n\n该 token trades:');
  for (const t of (trades || [])) console.log(' ', t.created_at, t.trade_type, 'bnb=', t.amount_bnb, 'price=', t.price);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
