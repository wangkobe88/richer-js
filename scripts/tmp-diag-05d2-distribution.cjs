// bt-v140 信号/成交总量分布
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

(async () => {
  const c = await dbManager.getClient();

  const { data: sigs, error: e1 } = await c.from('strategy_signals')
    .select('token_address,signal_type,action,execution_status,created_at,reason')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(400);
  console.log(`信号总数(≤400)=${(sigs||[]).length} err=${e1 ? e1.message : 'none'}`);
  const dist = {};
  for (const s of sigs || []) {
    const k = `${s.signal_type}/${s.action}/${s.execution_status}`;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log('分布:', JSON.stringify(dist, null, 2));
  const toks = [...new Set((sigs || []).map(s => s.token_address))];
  console.log(`去重票数=${toks.length}`);
  for (const t of toks) console.log(`  ${t}`);

  const { data: tr, error: e2 } = await c.from('trades')
    .select('token_address,side,amount_bnb,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(400);
  console.log(`\n成交总数(≤400)=${(tr||[]).length} err=${e2 ? e2.message : 'none'}`);
  for (const t of tr || []) console.log(`  ${t.created_at} ${t.token_address} ${t.side} ${t.amount_bnb}`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
