const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x397ada63ce5f5c13885b4893b7f4e01c046a7777';
const WALLET = '0x41ccc209d3ba4e81ef0c1fcb6d191127fb5b42f5';

async function main() {
  const sb = dbManager.getClient();

  // 0) 实验本体
  const { data: expRow, error: expErr } = await sb.from('experiments').select('*').eq('id', EXP).single();
  if (expErr) { console.log('experiment not found:', expErr.message); return; }
  const cfg = expRow.config || {};
  console.log('EXP:', expRow.experiment_name || expRow.name, '| mode=', expRow.trading_mode, '| status=', expRow.status);
  const fm = cfg.fourmemeWs || {};
  console.log('gates: cheatCheck=', JSON.stringify(fm.cheatCheck && { enabled: fm.cheatCheck.enabled, gate: fm.cheatCheck.gate, actFrontGate: fm.cheatCheck.actFrontGate }),
    '| buyPointCheck=', JSON.stringify(fm.buyPointCheck),
    '| signalGate 腿?');
  const libRefs = (cfg.strategiesConfig && cfg.strategiesConfig.libraryRefs) || [];
  console.log('libraryRefs:', JSON.stringify(libRefs));

  // 1) token_create 锚
  const { data: ev } = await sb.from('wss_events')
    .select('block_time,payload,platform')
    .eq('token_address', TOKEN)
    .eq('kind', 'token_create')
    .limit(2);
  if (ev && ev.length) {
    console.log('\ntoken_create @', ev[0].block_time, '| name=', ev[0].payload?.name, '| symbol=', ev[0].payload?.symbol, '| platform=', ev[0].payload?.platform || ev[0].platform);
  } else { console.log('\ntoken_create 事件未找到'); }

  // 2) 信号
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true }).limit(80);
  if (error) throw error;
  console.log('\n信号行数:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log('\n===', s.created_at, s.signal_type, s.action, '| status=', s.status, '| reason=', s.reason, '| price=', s.price);
    if (s.signal_type === 'BUY') {
      const sg = m.signalGate, fc = m.factorCheck, af = m.actFrontGate, cc = m.cheatCheck, bp = m.buyPoint;
      if (sg) console.log('  signalGate:', JSON.stringify(sg).slice(0, 240));
      if (fc) console.log('  factorCheck:', JSON.stringify(fc).slice(0, 700));
      if (af) console.log('  actFrontGate:', JSON.stringify(af).slice(0, 500));
      if (cc) console.log('  cheatCheck:', JSON.stringify(cc).slice(0, 800));
      if (bp) console.log('  buyPoint:', JSON.stringify(bp).slice(0, 900));
    }
  }

  // 3) trades
  const { data: trades } = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).order('created_at', { ascending: true });
  console.log('\ntrades:', (trades || []).length);
  for (const t of trades || []) {
    const m = t.metadata || {};
    console.log('TRADE', t.created_at, t.trade_direction, '| success=', t.success, '| in=', t.input_amount, '| out=', t.output_amount,
      m.pnlBnb != null ? '| pnlBnb=' + m.pnlBnb : '', m.profitPercent != null ? '| pp=' + m.profitPercent : '');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
