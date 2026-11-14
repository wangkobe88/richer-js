// 一次性（182 跑，小结果读取）③：idx189 四行全明细（2 signals + 2 trades）——BUY 为何页面上看不到。
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const T = '0x8614876e509c18d7be305a39a4a8d9e69c5effff';

async function main() {
  const sb = await dbManager.getClient();
  const { data: sig, error: es } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', T)
    .order('created_at', { ascending: true }).limit(50);
  if (es) throw new Error(es.message);
  for (const s of sig) {
    const md = s.metadata || {};
    console.log('=== SIGNAL', s.created_at, s.signal_type, 'executed=', s.executed, 'exec_status=', md.execution_status, 'reason=', s.reason);
    if (s.signal_type === 'BUY') {
      console.log('  price=', JSON.stringify(md.price), 'strategy=', md.strategyName);
      console.log('  bp=', JSON.stringify(md.buyPoint && { s: md.buyPoint.status, rule: md.buyPoint.rule, bucket: md.buyPoint.bucket, pos: md.buyPoint.position }));
      console.log('  gate=', JSON.stringify(md.signalGate));
    } else {
      console.log('  price=', JSON.stringify(md.price), 'buyPrice=', md.buyPrice, 'pnl%=', md.profitPercent, 'hold=', md.holdDuration, 'strategy=', md.strategyName);
    }
  }
  const { data: tr, error: et } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', T)
    .order('created_at', { ascending: true }).limit(30);
  if (et) throw new Error(et.message);
  for (const t of tr) {
    console.log('=== TRADE', t.created_at, t.trade_direction, 'status=', t.trade_status, 'success=', t.success, 'in=', t.input_amount, t.input_currency, 'out=', t.output_amount, t.unit_price, 'sold_cards=', t.sold_cards, 'signal=', t.signal_id);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
