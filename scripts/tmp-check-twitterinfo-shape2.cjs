// 一次性：twitterInfo.metrics 内容核查
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_symbol, twitter_info')
    .in('token_address', [
      '0x08be87804707fe0ebc86ef56d4bddb202c627777',
      '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777',
    ]);
  if (error) throw error;
  for (const r of data || []) {
    const ti = r.twitter_info || {};
    console.log(`${r.token_symbol}: metrics=${JSON.stringify(ti.metrics)} verified=${ti.author_verified}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
