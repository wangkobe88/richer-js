require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const HITS = ['0xcbc1b4cb','0x04124a5e','0x6a0a30b2','0x5333dbdb','0xebe437a2','0x6ad118c1','0xf818ac2c','0x784f42c0','0xec6b211b','0xcc0b5894','0xee74e6f1','0xdf8240d5','0x153f8335','0x788fd8a9','0xb1094cde','0x64ed2dab','0x36fe30ff','0x0660ff3a','0xf99a226e','0x5a8d94c6','0x3acb26b1','0x69c35843','0x92711826'];
async function main() {
  const sb = dbManager.getClient();
  const plat = {};
  for (const p of HITS) {
    const { data } = await sb.from('wss_price_ticks').select('platform').like('token_address', p + '%').limit(1);
    const v = (data && data[0] && data[0].platform) || 'null';
    plat[v] = (plat[v] || 0) + 1;
  }
  console.log('T198 23 命中票平台:', JSON.stringify(plat));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
