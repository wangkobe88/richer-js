// 一次性核查：BIBIAIWork 票为何未被扫描命中
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x08be87804707fe0ebc86ef56d4bddb202c627777';
async function main() {
  const { detectIssuerSelfLaunch } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select(`token_address, token_symbol, raw_api_data->>'name' as name,
      twitter_info->>'type' as type, twitter_info->>'text' as text,
      twitter_info->>'author_screen_name' as author_screen_name,
      twitter_info->>'author_name' as author_name,
      twitter_info->>'author_followers_count' as author_followers_count`)
    .eq('token_address', ADDR)
    .maybeSingle();
  if (error) throw error;
  console.log('行:', JSON.stringify({ ...data, text: (data?.text || '').slice(0, 60) }));
  const followers = Number(data.author_followers_count);
  const hit = detectIssuerSelfLaunch(
    { symbol: data.token_symbol, name: data.name, raw_api_data: { name: data.name } },
    { twitterInfo: { ...data, author_followers_count: Number.isFinite(followers) ? followers : null } });
  console.log('detectIssuerSelfLaunch:', JSON.stringify(hit));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
