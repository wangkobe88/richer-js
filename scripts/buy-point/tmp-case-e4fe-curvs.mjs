import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
// 先看列名
const { data: probe, error: pe } = await c.from('wss_price_ticks').select('*')
  .eq('token_address','0xe4fe922f88c09cbe127cebfa25f84d2f00917777').limit(1);
if (pe) throw new Error(pe.message);
console.log('columns:', Object.keys(probe[0]).join(','));
process.exit(0);
