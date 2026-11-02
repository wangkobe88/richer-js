const { dbManager } = require('../src/services/dbManager.js');
const TOK = '0x80b81993ddac55439fd75cf55c5e0b0b91ca7777';
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('trades')
    .select('experiment_id,created_at,trade_direction,trade_status,input_amount,output_amount')
    .eq('token_address', TOK)
    .gte('created_at', '2026-10-29T00:00:00Z')
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) throw error;
  console.log('0x80b8 今日 trades:', data.length);
  for (const t of data) console.log('---', t.created_at, '| exp:', t.experiment_id, '| dir:', t.trade_direction, '| status:', t.trade_status, '| in:', t.input_amount, '| out:', t.output_amount);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
