const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x26a34bb6811cf70a86fc7fe87609b7e3af977777';

async function main() {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('trades').select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  if (error) { console.log('trades err:', error.message); }
  console.log('trades 行数:', (data || []).length);
  for (const t of (data || [])) {
    console.log(' ', t.created_at, t.action || t.trade_type || t.side, 'bnb=', t.bnb_amount ?? t.amount_bnb, 'price=', t.price, 'profit=', t.profit_bnb ?? '');
  }
  // P4 信号的最终执行状态
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  for (const s of (sigs || [])) {
    const m = s.metadata || {};
    if (m.execution_status !== undefined || m.execution_reason) {
      console.log(`\n[${s.created_at}] ${s.reason} → exec_status=${m.execution_status} exec_reason=${m.execution_reason || '(空)'}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
