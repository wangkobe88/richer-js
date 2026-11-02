// 深挖：event_score 完整落档 + raw_api_data + token 创建锚
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xcbca7142035dea46ac43f02b398724b27c1f7777';

(async () => {
  const db = dbManager.getClient();
  const { data: tn, error } = await db.from('token_narrative')
    .select('event_score_result,raw_api_data,final_result,twitter_info')
    .eq('token_address', ADDR);
  if (error) throw error;
  const row = tn[0];

  console.log('=== event_score_result 完整:');
  console.log(JSON.stringify(row.event_score_result, null, 1).slice(0, 4000));

  const rad = row.raw_api_data || {};
  console.log('\n=== raw_api_data keys:', Object.keys(rad).join(','));
  for (const k of Object.keys(rad)) {
    const v = rad[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s && s !== 'null' && s !== '{}' && s !== '[]') {
      console.log(`--- ${k}:`, s.slice(0, 500));
    }
  }

  // token 创建锚 + 平台
  const { data: ev } = await db.from('wss_events')
    .select('kind,block_timestamp,created_at,payload')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(5);
  console.log('\n=== wss_events:');
  for (const e of ev || []) {
    console.log(e.kind, '| block_ts:', e.block_timestamp, '| created:', e.created_at);
    if (e.payload?.name || e.payload?.symbol) console.log('   meta:', JSON.stringify({ name: e.payload.name, symbol: e.payload.symbol, twitterUrl: e.payload.twitterUrl, website: e.payload.website }).slice(0, 300));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
