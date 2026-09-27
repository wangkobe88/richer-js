import { dbManager } from './src/services/dbManager.js';
const client = dbManager.getClient();
const { data, error } = await client
  .from('token_narrative')
  .select('token_address, token_symbol, prompt_type, analyzed_at, stage1_result, stage2_result')
  .in('token_symbol', ['天才', '嫦娥'])
  .order('analyzed_at', { ascending: false })
  .limit(8);
if (error) { console.log('err', JSON.stringify(error)); process.exit(1); }
for (const r of data || []) {
  const s1 = JSON.stringify(r.stage1_result);
  console.log(`\n### ${r.token_symbol} ${r.token_address} (${r.prompt_type}, ${r.analyzed_at})`);
  console.log('stage1:', (s1 || 'null').slice(0, 900));
  const s2 = r.stage2_result;
  if (s2) console.log('stage2 score:', s2.score, 'category:', s2.category, 'details.jev keys:', Object.keys(s2.details?.jev || {}));
}
process.exit(0);
