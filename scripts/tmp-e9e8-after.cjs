// 卖出后走势：卖价 vs 后续最高可靠价
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';
const SELL_AT = '2026-10-19T17:21:06';
async function main() {
  const sb = dbManager.getClient();
  const { data: cols } = await sb.from('wss_price_ticks').select('*').eq('token_address', TOKEN).limit(1);
  if (cols && cols[0]) console.log('cols:', Object.keys(cols[0]).join(','));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
