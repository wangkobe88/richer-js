const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const TOKEN = '0x854d4f2f060d01652cf3de7a8cfc1c454cdb7777';

async function main() {
  const sb = dbManager.getClient();
  // 实验配置：factorCheck 是否开启
  const { data: exp, error: expErr } = await sb.from('experiments').select('*').eq('id', EXP).single();
  if (expErr || !exp) { console.log('实验不存在:', expErr && expErr.message); process.exit(1); }
  const cfg = exp.config || {};
  const fmWs = cfg.fourmemeWs || {};
  console.log('实验:', exp.experiment_name, '| mode=', exp.trading_mode, '| status=', exp.status);
  console.log('buyPointCheck 段:', JSON.stringify(fmWs.buyPointCheck || null));
  console.log('cheatCheck.enabled:', JSON.stringify(fmWs.cheatCheck && fmWs.cheatCheck.enabled));
  console.log('factorSellFilter:', JSON.stringify(fmWs.factorSellFilter || null));

  // 该 token 全部信号
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  console.log('\n该 token 信号行数:', sigs.length);
  for (const s of sigs) {
    const m = s.metadata || {};
    console.log('\n===', s.created_at, s.signal_type, s.action, '| status=', s.status, '| reason=', s.reason);
    const sg = m.signalGate, fc = m.factorCheck, cc = m.cheatCheck, af = m.actFrontGate, bp = m.buyPoint;
    if (sg) console.log('  signalGate:', JSON.stringify(sg).slice(0, 400));
    if (fc) console.log('  factorCheck:', JSON.stringify(fc).slice(0, 1200));
    if (af) console.log('  actFrontGate:', JSON.stringify(af).slice(0, 600));
    if (cc) console.log('  cheatCheck:', JSON.stringify(cc).slice(0, 600));
    if (bp) console.log('  buyPoint:', JSON.stringify(bp).slice(0, 600));
  }

  // 成交
  const { data: trades } = await sb.from('trades')
    .select('id,trade_type,amount_bnb,price_usd,created_at,status,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(20);
  console.log('\n成交行数:', (trades || []).length);
  for (const t of (trades || [])) {
    console.log(' ', t.created_at, t.trade_type, 'bnb=', t.amount_bnb, 'usd=', t.price_usd, 'status=', t.status);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
