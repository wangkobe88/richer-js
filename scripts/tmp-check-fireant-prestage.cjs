// 一次性：火蚁票重析后 prestage 产物细节（30 天流量门判定输入）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address, prestage_result, token_category, final_rating')
    .eq('token_address', '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777')
    .single();
  if (error) throw error;
  const p = data.prestage_result || {};
  console.log('rating=', data.final_rating, 'category=', data.token_category);
  console.log('prestage keys:', Object.keys(p));
  console.log(JSON.stringify(p, null, 1).slice(0, 3000));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
