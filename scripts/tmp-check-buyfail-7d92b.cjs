// 单票买入失败排查 b：第一条 BUY 信号 tradeResult 全文
const { dbManager } = require('../src/services/dbManager.js');

const EXP = '260e9339-2a6d-4739-a6e1-90c94a6fe001';
const ADDR = '0x7d922dbfd42e8443c29ba16c8293b4c4ea227777';

(async () => {
  const db = dbManager.getClient();
  const { data: sigs, error } = await db
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const s of sigs) {
    console.log('======', s.created_at, 'id:', s.id);
    console.log('execution_status:', s.metadata?.execution_status);
    console.log('tradeResult:', JSON.stringify(s.metadata?.tradeResult, null, 2));
    console.log('price:', s.metadata?.price);
    console.log('strategyName:', s.metadata?.strategyName);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
