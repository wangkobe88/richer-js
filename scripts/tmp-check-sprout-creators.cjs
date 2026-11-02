const { dbManager } = require('../src/services/dbManager.js');
const TOKS=['0x33196e0763841a198b48507885f6ce46c7877777','0x6bcbf18e8fa051ba44c0b233000c604582d67777','0x29e3d500d469f07448f217fdc10009a2bc317777','0x9f2cea4232250e8e58e10b093cda97bbda897777','0xc838c0cbd8cab3b4d1292df1e40d7ea319097777'];
(async()=>{
  const db=await dbManager.getClient();
  const ev=await db.from('wss_events').select('token_address,created_at,payload').in('token_address',TOKS).eq('kind','token_create');
  for(const r of (ev.data||[]).sort((a,b)=>a.created_at<b.created_at?-1:1)){
    const p=r.payload||{};
    console.log(r.token_address,'@',String(r.created_at).slice(11,23),'creator:',p.creator,'nonce:',p.nonce,'meta:',String(p.meta||'').slice(0,24));
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
