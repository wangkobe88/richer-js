// 一次性查询：064f search_evidence 完整形状（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0x064f86075d930544ac655350f8295d1ef04d7777';

async function main() {
  const client = await dbManager.getClient();
  const { data: narr } = await client
    .from('token_narrative')
    .select('raw_api_data, analyzed_at, created_at')
    .eq('token_address', ADDR)
    .maybeSingle();
  const r = typeof narr.raw_api_data === 'string' ? JSON.parse(narr.raw_api_data) : narr.raw_api_data;
  const se = r.search_evidence;
  if (!se) { console.log('无 search_evidence'); process.exit(0); }
  console.log('search_evidence keys:', Object.keys(se).join(','));
  console.log(JSON.stringify(se, null, 2).slice(0, 6000));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
