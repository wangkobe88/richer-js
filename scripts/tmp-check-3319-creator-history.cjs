require('dotenv').config({ path: './config/.env' });
const { GMGNTokenAPI } = require('../src/core/gmgn-api/token-api.js');
const { dbManager } = require('../src/services/dbManager.js');
const TOK='0x33196e0763841a198b48507885f6ce46c7877777';
const CREATOR='0x12f619c9be1448c52726d9ecf6480348039057a6';
(async()=>{
  const api=new GMGNTokenAPI({apiKey:process.env.GMGN_API_KEY,timeout:15000});
  const info=await api.getTokenInfo('bsc',TOK);
  // 顶层找推特归因字段
  for(const k of Object.keys(info)){
    if(/twitter|social|link/i.test(k)) console.log('GMGN top-level',k,':',JSON.stringify(info[k]).slice(0,300));
  }
  const db=await dbManager.getClient();
  // 链上对拍：同 creator 的 token_create（payload->>creator 过滤，轻列）
  const ev=await db.from('wss_events').select('token_address,platform,created_at,payload->>symbol,payload->>name')
    .eq('kind','token_create').eq('payload->>creator',CREATOR).order('created_at').limit(50);
  console.log('\n### wss_events 同 creator token_create 行数:',ev.data?ev.data.length:JSON.stringify(ev.error).slice(0,200));
  for(const r of (ev.data||[])) console.log(' ',r.created_at,r.platform,r.token_address,r['payload->>symbol']||r.symbol,'|',r['payload->>name']||r.name);
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
