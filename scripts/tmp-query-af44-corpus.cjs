// 一次性查询：0xaf44…7777 语料全文（单行读取）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xaf442b52ccf1df61b5e62ec8c4cc05e9a9447777';

function show(label, v, n = 3000) {
  const s = v == null ? 'null' : (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  console.log(`\n=== ${label} ===`);
  console.log(s.length > n ? s.slice(0, n) + `\n…[截断，共 ${s.length} 字]` : s);
}

async function main() {
  const client = await dbManager.getClient();
  const { data: n, error: e } = await client
    .from('token_narrative')
    .select('token_symbol, twitter_info, classified_urls, extracted_info')
    .eq('token_address', ADDR);
  if (e) throw e;
  if (!n?.length) { console.log('无行'); process.exit(0); }
  const row = n[0];
  console.log(`symbol=${row.token_symbol} name=${row.token_name}`);
  const tw = row.twitter_info || {};
  show('主推（twitter_info 主推摘要）', tw.main_tweet ?? tw.tweets?.[0] ?? tw, 2500);
  const allTweets = tw.tweets || [];
  console.log(`\n推文总数: ${allTweets.length}`);
  for (let i = 0; i < Math.min(allTweets.length, 6); i++) {
    const t = allTweets[i] || {};
    show(`推文[${i}]`, t.text ?? t, 800);
  }
  show('classified_urls', row.classified_urls, 800);
  show('extracted_info', row.extracted_info, 1200);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
