import { dbManager } from './src/services/dbManager.js';
const client = dbManager.getClient();
const { data } = await client
  .from('token_narrative')
  .select('token_address, token_symbol, prompt_type, prompt_version, analyzed_at, is_valid, stage3_result')
  .eq('token_address', '0x110bbbbdc9c0e8bcaeef3cc6dbf94bc1838e7777')
  .maybeSingle();
console.log(JSON.stringify({ ...data, stage3_result: { score: data?.stage3_result?.score, category: data?.stage3_result?.category } }, null, 1));
process.exit(0);
