// 一次性：火蚁双票各自 CA 是否在语料内（prestage 地址核验成败预判）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const addrs = [
    '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777', // C240
    '0x988635ef13f78daf7022f6109dbf6b02f35c7777', // C240b
  ];
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address, token_symbol, raw_api_data, twitter_info')
    .in('token_address', addrs);
  if (error) throw error;

  for (const r of data || []) {
    const ti = r.twitter_info || {};
    const lower = r.token_address.toLowerCase();
    const sources = {
      主推text: String(ti.text || '').toLowerCase(),
      简介: String(ti.author_description || '').toLowerCase(),
      extra_tweets: JSON.stringify(ti.extra_tweets || []).toLowerCase(),
      raw_description: String(r.raw_api_data?.description || '').toLowerCase(),
    };
    console.log(`\n${r.token_symbol} ${r.token_address}`);
    for (const [k, v] of Object.entries(sources)) {
      console.log(`  自身CA在场[${k}]: ${v.includes(lower)} (源长=${v.length})`);
      // 顺带列出该源内全部 40 位地址
      const all = [...v.matchAll(/0x[0-9a-f]{40}/g)].map(m => m[0]);
      if (all.length) console.log(`    源内地址: ${[...new Set(all)].join(', ')}`);
    }
    // extra_tweets 概览
    const ex = ti.extra_tweets || [];
    console.log(`  extra_tweets=${ex.length} 条`);
    for (const t of ex.slice(0, 8)) {
      console.log(`    - @${t.author_screen_name || '?'}: ${String(t.text || '').slice(0, 80).replace(/\n/g, ' ')}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
