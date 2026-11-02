// 单票门链细节：final.details.jev 全量 + 语料头
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x47f0fafc3e6dc70d96e3cad6530a87ab0bee7777';
(async () => {
  const db = dbManager.getClient();
  const { data: tn, error } = await db.from('token_narrative')
    .select('final_result, raw_api_data')
    .eq('token_address', ADDR).single();
  if (error) throw error;
  const fin = tn.final_result;
  console.log('=== category:', fin.category, '| rating:', fin.rating, '| score:', fin.score);
  console.log('=== details keys:', Object.keys(fin.details).join(','));
  console.log(JSON.stringify(fin.details.jev, null, 1));
  const raw = tn.raw_api_data || {};
  console.log('\n=== raw keys:', Object.keys(raw).join(','));
  const ti = raw.twitter_info || raw.twitterInfo;
  if (ti) console.log('twitter handle:', ti.screen_name || ti.handle, '| name:', ti.name, '| followers:', ti.followers_count, '| created_at:', ti.created_at);
  if (raw.token_info) console.log('token_info:', JSON.stringify(raw.token_info).slice(0, 200));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
