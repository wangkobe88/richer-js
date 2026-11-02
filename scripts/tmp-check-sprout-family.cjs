const { dbManager } = require('../src/services/dbManager.js');
(async()=>{
  const db=await dbManager.getClient();
  // 1) Sprout 创建后的名字系蹭名票
  const rows=[];let lastId=null;
  while(true){
    let q=db.from('wss_events').select('id,token_address,platform,created_at,payload->>meta,payload->>symbol,payload->>name')
      .eq('kind','token_create').gt('created_at','2026-10-29T06:08:00Z').order('id',{ascending:true}).limit(1000);
    if(lastId!=null)q=q.gt('id',lastId);
    const {data,error}=await q;
    if(error){console.error('ERR',JSON.stringify(error).slice(0,150));break;}
    rows.push(...data);
    if(data.length<1000)break;
    lastId=data[data.length-1].id;
  }
  console.log('token_create rows since 06:08:',rows.length);
  const fam=rows.filter(r=>/sprout|sapling|sprot|sp Rout/i.test(String(r['payload->>symbol']||r.symbol||'')+' '+String(r['payload->>name']||r.name||'')));
  console.log('### sprout/sapling 名字系票:',fam.length);
  for(const f of fam) console.log(' ',f.created_at,f.platform,f.token_address,String(f['payload->>symbol']||f.symbol),'|',String(f['payload->>name']||f.name).slice(0,40),'| meta:',String(f['payload->>meta']||f.meta||'').slice(0,60));
  // 2) 叙事侧：最近两天 classified_urls 里含 sproutbnb 的其它 token
  const narRows=[];let lastNid=null;
  while(true){
    let q=db.from('token_narrative').select('id,token_address,analyzed_at,classified_urls')
      .gt('analyzed_at','2026-10-28T00:00:00Z').order('id',{ascending:true}).limit(1000);
    if(lastNid!=null)q=q.gt('id',lastNid);
    const {data,error}=await q;
    if(error){console.error('ERR2',JSON.stringify(error).slice(0,150));break;}
    narRows.push(...data);
    if(data.length<1000)break;
    lastNid=data[data.length-1].id;
  }
  console.log('\ntoken_narrative rows since 10-28:',narRows.length);
  const narHits=narRows.filter(r=>/sproutbnb/i.test(JSON.stringify(r.classified_urls||{})));
  console.log('### classified_urls 含 sproutbnb 的票:',narHits.length);
  for(const h of narHits) console.log(' ',h.analyzed_at,h.token_address,JSON.stringify((h.classified_urls||{}).twitter||[]).slice(0,120));
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
