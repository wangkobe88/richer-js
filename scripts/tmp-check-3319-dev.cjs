const { dbManager } = require('../src/services/dbManager.js');
const TOK='0x33196e0763841a198b48507885f6ce46c7877777';
(async()=>{
  const db=await dbManager.getClient();
  const ev=await db.from('wss_events').select('created_at,platform,payload').eq('token_address',TOK).eq('kind','token_create').limit(1);
  console.log('token_create rows:',ev.data?ev.data.length:String(JSON.stringify(ev.error)).slice(0,150));
  if(ev.data&&ev.data.length){
    const p=ev.data[0].payload||{};
    console.log('@',ev.data[0].created_at,'platform',ev.data[0].platform,'| creator:',p.creator,'| name:',p.name,'/',p.symbol);
    console.log('payload keys:',Object.keys(p).join(','));
    if(p.urls) console.log('urls:',JSON.stringify(p.urls).slice(0,400));
  }
  const nar=await db.from('token_narrative').select('analyzed_at,classified_urls,pre_check_result,token_category').eq('token_address',TOK).order('analyzed_at',{ascending:false,nullsFirst:false}).limit(1);
  console.log('token_narrative rows:',nar.data?nar.data.length:String(JSON.stringify(nar.error)).slice(0,150));
  if(nar.data&&nar.data.length){
    const n=nar.data[0];
    console.log('analyzed_at:',n.analyzed_at,'| category:',n.token_category);
    console.log('classified_urls:',JSON.stringify(n.classified_urls).slice(0,600));
    const pc=n.pre_check_result||{};
    console.log('precheck ruleName:',pc.ruleName,'| details keys:',pc.details?Object.keys(pc.details).join(','):'-');
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
