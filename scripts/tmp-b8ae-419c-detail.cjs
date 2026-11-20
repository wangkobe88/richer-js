const { dbManager } = require('../src/services/dbManager');
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x419c12c85c034f7e9f2d8a6a4de604059db77777';
async function main() {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true });
  for (const t of trades||[]) {
    console.log('TRADE', t.created_at, t.trade_direction, '| status=', t.trade_status, '| in=', t.input_amount, t.input_currency, '| out=', t.output_amount, t.output_currency, '| unit=', t.unit_price, '| success=', t.success, '| cards=', t.sold_cards);
    const m = t.metadata || {};
    if (m.pnlBnb != null || m.profitPercent != null) console.log('   meta pnlBnb=', m.pnlBnb, 'profitPercent=', m.profitPercent);
  }
  const { data: sigs } = await sb.from('strategy_signals').select('created_at,signal_type,reason,price,metadata').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at');
  for (const s of sigs||[]) {
    const m = s.metadata || {};
    if (s.signal_type === 'SELL') {
      console.log('\nSIG SELL', s.created_at, s.reason, '| price=', s.price);
      console.log('  stallClose:', JSON.stringify(m.stallClose), '| profitPercent=', m.profitPercent, '| buyPrice=', m.buyPrice, '| holdDuration=', m.holdDuration);
    } else {
      console.log('\nSIG BUY', s.created_at, s.reason, '| price=', s.price, '| bp.passed=', m.buyPoint?.passed, '| cheat=', m.cheatCheck?.grade, '| act=', m.actFrontGate?.act, '| triggerNo=', m.signalGate?.triggerNo);
    }
  }
  const { data: ticks, error: e2 } = await sb.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T07:45:00')
    .lte('block_time', '2026-10-19T08:30:00')
    .order('block_time', { ascending: true })
    .limit(1000);
  if (e2) throw e2;
  const ts = ticks||[];
  console.log('\nticks 07:45~08:30:', ts.length);
  if (ts.length) {
    // 关键节点打印：买前5笔、买后每笔（前20）、卖后前15笔
    const firstIdx = ts.findIndex(t => t.block_time >= '2026-10-19T07:49:00');
    console.log('-- 买前(07:49 起):');
    for (const t of ts.slice(Math.max(0,firstIdx-6), firstIdx+3)) console.log('  ', t.block_time, t.trade_type, Number(t.price_bnb).toExponential(4), 'bnb=', t.bnb_amount, t.price_outlier ? '[outlier]' : '');
    const sellIdx = ts.findIndex(t => t.block_time >= '2026-10-19T07:51:07');
    console.log('-- 卖出时刻前后:');
    for (const t of ts.slice(Math.max(0,sellIdx-8), sellIdx+2)) console.log('  ', t.block_time, t.trade_type, Number(t.price_bnb).toExponential(4), 'bnb=', t.bnb_amount, t.price_outlier ? '[outlier]' : '');
    console.log('-- 卖出后:');
    for (const t of ts.slice(sellIdx+1, sellIdx+16)) console.log('  ', t.block_time, t.trade_type, Number(t.price_bnb).toExponential(4), 'bnb=', t.bnb_amount, t.price_outlier ? '[outlier]' : '');
    const after = ts.slice(sellIdx+1);
    if (after.length) {
      let mx = 0, mn = Infinity, mxT = null;
      for (const t of after) { const p = Number(t.price_bnb); if (p>mx) { mx=p; mxT=t.block_time; } mn = Math.min(mn,p); }
      const sellPx = Number(ts[sellIdx]?.price_bnb || ts[sellIdx-1]?.price_bnb);
      console.log(`卖后窗内 max=${mx.toExponential(4)}@${mxT} min=${mn.toExponential(4)} 卖价≈${sellPx?.toExponential(4)} 最大回撤后涨幅=${((mx/sellPx-1)*100).toFixed(1)}%`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
