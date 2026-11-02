// 形状侦察：wss_events token_create payload / rounds.rating / wss_price_ticks 列名（单行小读取）
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const db = dbManager.getClient();

  const { data: tc } = await db.from('wss_events')
    .select('*').eq('kind', 'token_create')
    .order('created_at', { ascending: false }).limit(1);
  if (tc?.[0]) {
    const r = tc[0];
    console.log('token_create 列:', Object.keys(r).join(','));
    console.log('payload keys:', Object.keys(r.payload || {}));
    console.log('payload 样例:', JSON.stringify(r.payload).slice(0, 400));
  }

  const { data: gr } = await db.from('wss_events')
    .select('*').eq('kind', 'graduation')
    .order('created_at', { ascending: false }).limit(1);
  if (gr?.[0]) console.log('\ngraduation 列:', Object.keys(gr[0]).join(','), '| payload:', JSON.stringify(gr[0].payload).slice(0, 200));

  const { data: rd } = await db.from('narrative_analysis_rounds')
    .select('token_address,round_no,rating,completed_at').order('id', { ascending: false }).limit(5);
  console.log('\nrounds.rating 形态:', rd.map(r => `${r.rating}(${typeof r.rating})`).join(' '));

  const { data: tk } = await db.from('wss_price_ticks')
    .select('*').eq('token_address', '0x347dc56f1e54e05c521a459250b4319741897777')
    .order('block_number', { ascending: true }).limit(1);
  if (tk?.[0]) {
    const r = tk[0];
    console.log('\ntick 列:', Object.keys(r).join(','));
    console.log('tick 样例:', JSON.stringify({ price: r.price, bnb: r.bnb_amount, tok: r.token_amount, type: r.trade_type, bt: r.block_time, bn: r.block_number, li: r.log_index, plat: r.platform, sender: r.sender_address, trader: r.trader_address, outlier: r.price_outlier }).slice(0, 400));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
