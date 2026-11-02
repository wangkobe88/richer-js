const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x33196e0763841a198b48507885f6ce46c7877777';
(async()=>{
  const db=await dbManager.getClient();
  const sig=await db.from('strategy_signals').select('created_at,action,metadata').eq('experiment_id',EXP).eq('token_address',TOK).eq('action','buy').order('created_at');
  let n=0;
  for(const s of sig.data){
    const gm=(s.metadata||{}).gmgnCheck;
    if(!gm) continue;
    n++;
    if(n>1 && n<sig.data.length-1) continue; // 只详打第一笔与最后一笔
    console.log('=== buy signal #'+n,s.created_at,'passed:',gm.passed);
    console.log(JSON.stringify(gm,null,1));
  }
  console.log('total buy signals with gmgnCheck:',n);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
