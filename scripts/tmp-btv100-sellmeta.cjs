// 一次性（182 跑）：验 bt-v100 卖出 trades metadata 形状（单行×2）校准卖臂归因
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data } = await c.from('trades').select('token_symbol,trade_direction,input_amount,output_amount,metadata')
    .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334').neq('trade_direction', 'buy').limit(2);
  if (!data.length) { console.log('无卖出行'); process.exit(0); }
  for (const t of data) {
    console.log(`--- ${t.token_symbol} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount}`);
    const m = typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata || {};
    console.log('META:', JSON.stringify(m).slice(0, 400));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
