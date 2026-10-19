// 一次性查询：token_narrative 里 sslip.io meta 形状的存量行（小结果）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address,token_symbol,analyzed_at,pre_check_result,raw_api_data->>meta,token_category')
    .like('raw_api_data->>meta', '%sslip.io%')
    .order('analyzed_at', { ascending: false })
    .limit(30);
  if (error) { console.error(error.message); return; }
  console.log(`sslip.io meta 存量行（≤30）: ${data.length}`);
  for (const r of data) {
    const pcr = r.pre_check_result || {};
    console.log(`${r.analyzed_at} ${r.token_address} ${r.token_symbol ?? '?'} rule=${pcr.details?.ruleName ?? pcr.details?.ruleName ?? '-'} pass=${pcr.pass} category=${r.token_category ?? '-'}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
