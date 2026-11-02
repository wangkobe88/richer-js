// 单票买入失败排查 c：v59/v58 trades 时间线 + 钱包近期成交 nonce 线索
const { dbManager } = require('../src/services/dbManager.js');

const V59 = '260e9339-2a6d-4739-a6e1-90c94a6fe001';
const V58 = '12ef2c48-1f6c-4b1b-8e0f-35693a5f4f8e';

(async () => {
  const db = dbManager.getClient();

  // v59 全部 trades（本实验此前是否有别的票买入）
  const { data: t59, error: e1 } = await db
    .from('trades')
    .select('created_at,token_address,metadata')
    .eq('experiment_id', V59)
    .order('created_at', { ascending: true })
    .limit(50);
  if (e1) throw e1;
  console.log('=== v59 trades 总数(前50):', t59.length);
  for (const t of t59) {
    const m = t.metadata || {};
    console.log('---', t.created_at, '| token:', t.token_address, '| tx:', m.txHash, '| method:', m.method, '| in:', m.amountInBnb, '| out:', m.bnbReceived);
  }

  // v58 最后 5 笔（换车前的最后链上动作）
  const { data: t58, error: e2 } = await db
    .from('trades')
    .select('created_at,token_address,metadata')
    .eq('experiment_id', V58)
    .order('created_at', { ascending: false })
    .limit(5);
  if (e2) throw e2;
  console.log('\n=== v58 最后 5 笔 trades:');
  for (const t of t58) {
    const m = t.metadata || {};
    console.log('---', t.created_at, '| token:', t.token_address, '| tx:', m.txHash, '| method:', m.method, '| in:', m.amountInBnb, '| out:', m.bnbReceived);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
