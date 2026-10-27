// 一次性：火蚁双票创建时间（判定 30 天流量门翻转是时窗伪影还是真实形状）
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('wss_events')
    .select('token_address, platform, block_time, payload')
    .eq('kind', 'token_create')
    .in('token_address', [
      '0x502592d3c980a25ed52a11d389b0ffe1eb8c7777',
      '0x988635ef13f78daf7022f6109dbf6b02f35c7777',
      '0x403b5240c372ba850233911854ccc5f6f250e2a1', // 语料里那个首发票
    ]);
  if (error) throw error;
  for (const r of data || []) console.log(`${r.platform} ${r.token_address} 创建=${r.block_time}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
