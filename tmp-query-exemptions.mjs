import { dbManager } from './src/services/dbManager.js';
const client = dbManager.getClient();
const { data, error } = await client
  .from('token_narrative')
  .select('token_address, token_symbol, prompt_type, stage1_result')
  .in('token_symbol', ['天才', '嫦娥', '绣春刀3'])
  .order('analyzed_at', { ascending: false })
  .limit(20);
if (error) { console.log('err', JSON.stringify(error)); process.exit(1); }
for (const r of data || []) {
  const j = r.stage1_result?.details?.jev || {};
  const mag = j.event_magnitude; const nr = j.name_referent;
  console.log(`${r.token_symbol} ${r.token_address}\n  prompt_type=${r.prompt_type}\n  name_referent=${JSON.stringify(nr)}\n  event_magnitude=${JSON.stringify(mag)}`);
}
process.exit(0);
