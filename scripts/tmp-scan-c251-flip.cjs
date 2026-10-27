// 一次性扫描：C251 改道影响面——回归集票落库语料跑 detectIssuerSelfLaunch（窄列小结果）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const fixtures = require('./narrative/case-regression/fixtures.json');
  const addrs = fixtures.cases.map(t => t.addr.toLowerCase());
  const { detectIssuerSelfLaunch } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const client = await dbManager.getClient();

  const rows = [];
  for (let i = 0; i < addrs.length; i += 50) {
    const { data, error } = await client
      .from('token_narrative')
      .select('token_address, token_symbol, raw_api_data, twitter_info')
      .in('token_address', addrs.slice(i, i + 50));
    if (error) throw error;
    rows.push(...(data || []));
  }
  console.log(`拉到 ${rows.length}/${addrs.length} 行`);

  let hits = 0;
  for (const r of rows) {
    const ti = r.twitter_info || {};
    const followers = Number(ti.author_followers_count);
    const tw = {
      type: ti.type, text: ti.text,
      author_screen_name: ti.author_screen_name,
      author_name: ti.author_name,
      author_followers_count: Number.isFinite(followers) ? followers : null,
    };
    const name = r.raw_api_data?.name;
    const hit = detectIssuerSelfLaunch(
      { symbol: r.token_symbol, name, raw_api_data: { name } },
      { twitterInfo: tw });
    if (hit) {
      hits++;
      const fx = fixtures.cases.find(t => t.addr === r.token_address);
      console.log(`改道命中: ${fx?.caseId} ${r.token_symbol} ${r.token_address} @${hit.screenName} 粉=${r.author_followers_count} 现expect=${JSON.stringify(fx?.expect?.rating)}`);
    }
  }
  console.log(`\n共 ${hits} 票会被 C251 改道 prestage`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
