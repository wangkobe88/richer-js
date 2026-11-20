const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x854d4f2f060d01652cf3de7a8cfc1c454cdb7777';

async function main() {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  // 放行的那笔（P2）全量 factorCheck gates
  const passed = sigs.find(s => (s.metadata || {}).factorCheck && s.metadata.factorCheck.pass === true);
  if (passed) {
    console.log('=== 放行信号', passed.created_at, passed.reason, '===');
    const fc = passed.metadata.factorCheck;
    console.log('arms:', JSON.stringify(fc.arms));
    for (const g of (fc.gates || [])) {
      console.log(`  [${g.hit ? '✅HIT' : '  —  '}] ${g.id} | ${g.label} | line=${g.line} | value=${g.value}`);
    }
    console.log('\n--- buyPoint anchors 全量 ---');
    const anchors = passed.metadata.buyPoint && passed.metadata.buyPoint.anchors;
    if (anchors) console.log(JSON.stringify(anchors, null, 1));
  }

  // trades（带错误输出）
  const { data: trades, error: tErr } = await sb.from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(20);
  if (tErr) console.log('trades ERR:', tErr.message);
  console.log('\n成交行数:', (trades || []).length);
  for (const t of (trades || [])) {
    console.log(' ', t.created_at, t.trade_type, 'bnb=', t.bnb_amount ?? t.amount_bnb, 'price=', t.price, 'pnl=', t.profit_loss ?? t.pnl, JSON.stringify((t.metadata||{}).cardTrade||''));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
