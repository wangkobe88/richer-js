require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const HITS = ['0xf818ac2c5545a3d4b7c643efa18aca7237927777','0x5333dbdbdb3f9a56870d1372c66cfec0601b7777','0x788fd8a9dc0605ab04232d2078b7bb100a577777','0x927118266be3678161223da0ab2c6dbbdc6b7777','0xcc0b5894a513c9d845e054593272a3901a7f7777','0xb1094cde1376b45856d41386095f59c584487777','0xee74e6f1a2ef65ac339f57bd8358a47d7fd37777','0x784f42c0f41b16846d6f02280a4c426987d17777','0x64ed2dab6a566e0077c8922fc73d9ae6ab577777','0xf99a226e423f60a679498bb120736b80dfba7777','0x3acb26b17dabef7b12edfc57ab1145f32eee7777','0x36fe30ff4c0ee682c902041bda94eaecd6127777','0xcbc1b4cb0233e3c5aaba067f8b483e9580887777','0xec6b211bbd9da6f475ab926d21f91e0ffb847777','0x6ad118c1adc42de3e10156c414dc35c790f87777','0x6a0a30b2c4b7b334ffd7aa277f437dc0b2937777','0x04124a5e0f7a35f641884d934c1816c44d207777','0x0660ff3acb401bf8ae965ebadd08d58d62727777','0xdf8240d53a88d38a228a5ef1de131bf84e1e7777','0x69c3584316425705d1b32278f2ee63ee1b9c7777','0xebe437a2b595ec705c21117c2c725a1ab2c47777','0x5a8d94c69998daffcfdc365f1d333dc4ab087777','0x153f8335b1fcda68e459463a5899dd736fd27777'];
(async () => {
  const sb = dbManager.getClient();
  const plat = {};
  for (const a of HITS) {
    const { data } = await sb.from('wss_price_ticks').select('platform').eq('token_address', a).limit(1);
    const v = (data && data[0] && data[0].platform) || 'null';
    plat[v] = (plat[v] || 0) + 1;
    if (v !== 'flap') console.log('非flap:', v, a.slice(0, 10));
  }
  console.log('T198 23 命中票平台:', JSON.stringify(plat));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
