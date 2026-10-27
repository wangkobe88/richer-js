// 一次性：twitterInfo 落库字段形状核查（BIBIAIWork vs 火蚁——影响力豁免判据可用字段）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address, token_symbol, twitter_info')
    .in('token_address', [
      '0x08be87804707fe0ebc86ef56d4bddb202c627777',
      '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777',
    ]);
  if (error) throw error;
  for (const r of data || []) {
    const ti = r.twitter_info || {};
    console.log(`\n${r.token_symbol} ${r.token_address}`);
    console.log('  keys:', Object.keys(ti).join(','));
    for (const k of ['author_followers_count','favorite_count','retweet_count','reply_count','view_count','likes','engagement','author_statuses_count','author_friends_count']) {
      if (ti[k] !== undefined) console.log(`  ${k} = ${ti[k]}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
