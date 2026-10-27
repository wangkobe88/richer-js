// 一次性：火蚁双票 C251 改道形状核查（单票小读取）——同一性命中来源/粉丝量级/语料是否含 CA
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const addrs = [
    '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777', // C240 불개미
    '0x988635ef13f78daf7022f6109dbf6b02f35c7777', // C240b 불개미
  ];
  const { detectIssuerSelfLaunch } = await import('../src/narrative/analyzer/utils/narrative-utils.mjs');
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, twitter_info')
    .in('token_address', addrs);
  if (error) throw error;

  for (const r of data || []) {
    const ti = r.twitter_info || {};
    console.log('='.repeat(80));
    console.log(`${r.token_symbol} ${r.token_address}`);
    console.log(`  token name(raw): ${r.raw_api_data?.name}`);
    console.log(`  type=${ti.type} @${ti.author_screen_name} name=${JSON.stringify(ti.author_name)} 粉=${ti.author_followers_count} 认证=${ti.author_verified}`);
    console.log(`  text(前300): ${String(ti.text || '').slice(0, 300)}`);
    // CA 在场判定：主推/简介/extra 语料全扫
    const caRe = /0x[0-9a-fA-F]{40}/;
    const haystack = [
      String(ti.text || ''),
      String(ti.author_description || ''),
      JSON.stringify(ti.extra_tweets || []),
      String(r.raw_api_data?.description || ''),
    ].join('\n');
    const m = haystack.match(caRe);
    console.log(`  语料含 CA: ${m ? m[0] : '无'}`);
    const hit = detectIssuerSelfLaunch(
      { symbol: r.token_symbol, name: r.raw_api_data?.name, raw_api_data: { name: r.raw_api_data?.name } },
      { twitterInfo: { type: ti.type, text: ti.text, author_screen_name: ti.author_screen_name, author_name: ti.author_name, author_followers_count: Number(ti.author_followers_count) || null } });
    console.log(`  detectIssuerSelfLaunch => ${JSON.stringify(hit)}`);
    // 检查 precheck 现行行（走通路径证据）
    const { data: pcr } = await client.from('token_narrative')
      .select('pre_check_result, token_category, rating, block_reason')
      .eq('token_address', r.token_address).single();
    if (pcr) {
      console.log(`  现行 rating=${pcr.rating} category=${pcr.token_category} rule=${pcr.pre_check_result?.ruleName} reason=${String(pcr.pre_check_result?.reason || '').slice(0, 120)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
