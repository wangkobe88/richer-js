const { dbManager } = require('../src/services/dbManager');

const EXP = 'd3453504-03d5-480c-89e0-483db930361c';
const TOKEN = '0x88edc0d6e4ba98eadf4b6f86b41540a438d67777';

async function main() {
  const sb = dbManager.getClient();

  const { data: exp, error: e1 } = await sb.from('experiments').select('id,experiment_name,trading_mode,status,config,created_at,updated_at').eq('id', EXP).limit(1);
  if (e1) throw e1;
  if (!exp.length) { console.log('实验不存在'); process.exit(1); }
  const e = exp[0];
  console.log('=== 实验 ===');
  console.log('name:', e.experiment_name, '| mode:', e.trading_mode, '| status:', e.status);
  console.log('created_at:', e.created_at, '| updated_at:', e.updated_at);
  const cfg = e.config || {};
  const fw = cfg.fourmemeWs || {};
  console.log('stallClose 段:', JSON.stringify(fw.stallClose ?? cfg.stallClose ?? null));
  console.log('stopLoss 段:', JSON.stringify(fw.stopLoss ?? cfg.stopLoss ?? null));

  console.log('\n=== 该 token 信号(全部) ===');
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('id,signal_type,action,reason,created_at,executed,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e2) throw e2;
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log(`[${s.created_at}] ${s.signal_type} ${s.action} executed=${s.executed} reason=${s.reason || ''}`);
    if (s.signal_type === 'SELL') {
      const brief = {};
      for (const k of ['profitPercent', 'currentVsLaunchPct', 'realHoldDuration', 'holdDuration', 'why', 'legName']) if (m[k] != null) brief[k] = m[k];
      console.log('   metadata 摘要:', JSON.stringify(brief).slice(0, 800));
    }
  }

  console.log('\n=== 该 token 成交 ===');
  const { data: trades, error: e3 } = await sb.from('trades')
    .select('side,amount_bnb,price_bnb,created_at,executed_at,profit_percent,trade_type')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  if (e3) throw e3;
  for (const t of trades) {
    console.log(`[${t.executed_at || t.created_at}] ${t.side} bnb=${t.amount_bnb} price=${t.price_bnb} pnl%=${t.profit_percent} type=${t.trade_type}`);
  }
  process.exit(0);
}
main().catch(err => { console.error(err.message); process.exit(1); });
