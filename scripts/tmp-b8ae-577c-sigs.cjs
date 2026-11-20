const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x577c885d80a2bfc915c1acab3c51dca91c137777';

async function main() {
  const sb = dbManager.getClient();
  // token_create 锚
  const { data: ev } = await sb.from('wss_events')
    .select('block_time,payload')
    .eq('token_address', TOKEN)
    .eq('kind', 'token_create')
    .limit(2);
  if (ev && ev.length) {
    console.log('token_create @', ev[0].block_time, '| payload.name=', ev[0].payload?.name, '| symbol=', ev[0].payload?.symbol);
  } else {
    console.log('token_create 事件未找到');
  }
  // trades
  const { data: trades } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true });
  console.log('\ntrades:', (trades||[]).length);
  for (const t of trades||[]) {
    console.log('TRADE', t.created_at, t.trade_direction, '| status=', t.trade_status, '| in=', t.input_amount, '| out=', t.output_amount, '| unit=', t.unit_price, '| success=', t.success);
    const m = t.metadata || {};
    if (m.pnlBnb != null || m.profitPercent != null) console.log('   meta pnlBnb=', m.pnlBnb, 'pp=', m.profitPercent);
  }
  // signals
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(60);
  if (error) throw error;
  console.log('\n信号行数:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log('\n===', s.created_at, s.signal_type, s.action, '| status=', s.status, '| reason=', s.reason, '| price=', s.price);
    if (s.signal_type === 'BUY') {
      const sg = m.signalGate, fc = m.factorCheck, af = m.actFrontGate, cc = m.cheatCheck, bp = m.buyPoint;
      if (sg) console.log('  signalGate:', JSON.stringify(sg).slice(0, 200));
      if (fc) console.log('  factorCheck:', JSON.stringify(fc).slice(0, 500));
      if (af) console.log('  actFrontGate:', JSON.stringify(af).slice(0, 500));
      if (cc) console.log('  cheatCheck:', JSON.stringify(cc).slice(0, 600));
      if (bp) console.log('  buyPoint:', JSON.stringify(bp).slice(0, 500));
      if (!bp && !cc && !af && !fc && !sg) console.log('  FULL:', JSON.stringify(m).slice(0, 1500));
    } else {
      console.log('  stallClose:', JSON.stringify(m.stallClose), '| pp=', m.profitPercent, '| factorSellFilter=', JSON.stringify(m.factorSellFilter));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
