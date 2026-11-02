// 单票门链细节 v2：event_score_result.details.jev 全量 + raw 语料形状
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x47f0fafc3e6dc70d96e3cad6530a87ab0bee7777';
(async () => {
  const db = dbManager.getClient();
  const { data: tn, error } = await db.from('token_narrative')
    .select('event_score_result, prestage_result, raw_api_data, pre_check_result')
    .eq('token_address', ADDR).single();
  if (error) throw error;
  const esr = tn.event_score_result;
  console.log('=== esr.reason:', esr.reason);
  const jev = esr?.details?.jev;
  if (jev) console.log(JSON.stringify(jev, null, 1));
  console.log('\n=== pre_check_result:', JSON.stringify(tn.pre_check_result).slice(0, 500));
  console.log('\n=== prestage_result:', JSON.stringify(tn.prestage_result).slice(0, 500));
  const raw = tn.raw_api_data || {};
  console.log('\n=== raw.meta:', JSON.stringify(raw.meta).slice(0, 300));
  console.log('=== raw.symbol:', raw.symbol, '| name:', raw.name, '| creator:', raw.creator, '| source:', raw.source, '| eventTs:', raw.eventTs);
  console.log('=== knowledge_matches:', JSON.stringify(raw.knowledge_matches).slice(0, 200));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
