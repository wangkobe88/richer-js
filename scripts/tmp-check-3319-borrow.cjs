const { dbManager } = require('../src/services/dbManager.js');
(async()=>{
  const db=await dbManager.getClient();
  const rows=[];let lastId=null;
  while(true){
    let q=db.from('wss_events').select('id,token_address,platform,created_at,payload->>meta,payload->>symbol')
      .eq('kind','token_create').gt('created_at','2026-10-28T00:00:00Z').order('id',{ascending:true}).limit(1000);
    if(lastId!=null)q=q.gt('id',lastId);
    const {data,error}=await q;
    if(error){console.error('ERR',JSON.stringify(error).slice(0,200));break;}
    rows.push(...data);
    if(data.length<1000)break;
    lastId=data[data.length-1].id;
  }
  console.log('token_create rows since 10-28:',rows.length);
  const hits=rows.filter(r=>{const m=r['payload->>meta']||r.meta||'';return /sproutbnb/i.test(m);});
  console.log('### meta 含 sproutbnb 的 token:',hits.length);
  for(const h of hits) console.log(' ',h.created_at,h.platform,h.token_address,h['payload->>symbol']||h.symbol,'meta:',String(h['payload->>meta']||h.meta).slice(0,150));
  // 对照：Sprout 自己的 meta 形状
  const self=rows.find(r=>r.token_address==='0x33196e0763841a198b48507885f6ce46c7877777');
  if(self) console.log('\nSprout meta:',String(self['payload->>meta']||self.meta).slice(0,300));
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
