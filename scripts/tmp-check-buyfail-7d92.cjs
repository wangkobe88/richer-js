// 单票买入失败排查：trades + strategy_signals 单条读取
const { dbManager } = require('../src/services/dbManager.js');

const EXP = '260e9339-2a6d-4739-a6e1-90c94a6fe001';
const ADDR = '0x7d922dbfd42e8443c29ba16c8293b4c4ea227777';

(async () => {
  const db = dbManager.getClient();

  const { data: trades, error: e1 } = await db
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e1) throw e1;
  console.log('=== trades 行数:', trades.length);
  for (const t of trades) {
    console.log('---', t.created_at, '| side:', t.side, '| status:', t.status, '| qty:', t.quantity, '| bnb:', t.bnb_amount);
    if (t.metadata) {
      const m = t.metadata;
      console.log('    metadata keys:', Object.keys(m).join(','));
      if (m.tradeResult) console.log('    tradeResult:', JSON.stringify(m.tradeResult).slice(0, 3000));
      if (m.failReason) console.log('    failReason:', m.failReason);
      if (m.error) console.log('    error:', JSON.stringify(m.error).slice(0, 2000));
    }
    if (t.transaction_hash) console.log('    tx:', t.transaction_hash);
  }

  const { data: sigs, error: e2 } = await db
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (e2) throw e2;
  console.log('\n=== strategy_signals 行数:', sigs.length);
  for (const s of sigs) {
    console.log('---', s.created_at, '| type:', s.signal_type, '| action:', s.action, '| status:', s.status, '| leg:', s.strategy_name || s.leg_name);
    if (s.metadata) {
      const m = s.metadata;
      const keys = Object.keys(m);
      console.log('    metadata keys:', keys.join(','));
      if (m.execution) console.log('    execution:', JSON.stringify(m.execution).slice(0, 3000));
      if (m.buyError) console.log('    buyError:', JSON.stringify(m.buyError).slice(0, 2000));
      if (m.error) console.log('    error:', JSON.stringify(m.error).slice(0, 2000));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
