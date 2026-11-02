require('dotenv').config({ path: './config/.env' });
const { GMGNTokenAPI } = require('../src/core/gmgn-api/token-api.js');
const TOK='0x33196e0763841a198b48507885f6ce46c7877777';
(async()=>{
  const api=new GMGNTokenAPI({apiKey:process.env.GMGN_API_KEY,timeout:15000});
  const info=await api.getTokenInfo('bsc',TOK);
  const dev=info.dev||{};
  console.log('### dev 对象:');
  console.log(JSON.stringify(dev,null,1));
  console.log('### 其它关键字段:');
  console.log('symbol:',info.symbol,'| name:',info.name,'| price:',info.price,'| mcap(usd):',info.market_cap);
  console.log('image_dup_count:',info.image_dup_count,'| visiting_count:',info.visiting_count);
  console.log('open_timestamp:',info.open_timestamp?new Date(info.open_timestamp*1000).toISOString():info.open_timestamp);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
