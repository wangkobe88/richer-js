const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x059019085d8899589e3863d08b284616db8e7777';
(async()=>{
  const db=await dbManager.getClient();
  const sigs=await db.from('strategy_signals').select('id,signal_type,action,reason,created_at,metadata').eq('experiment_id',EXP).eq('token_address',TOK).eq('signal_type','SELL').order('created_at',{ascending:true});
  for(const s of sigs.data||[]){
    console.log('=== SELL',s.created_at,'===');
    const m=s.metadata||{};
    const keys=Object.keys(m);
    console.log('metadata keys:',keys.join(','));
    const f=m.factorResults||m.factors||m.factorSnapshot||null;
    if(f){
      const pick=['profitPercent','peakProfitPct','drawdownFromHighestSinceLastBuy','secSincePeak','marketCap','entryMarketCap','realHoldDuration','holdDuration','currentPriceBnb','buyPriceBnb'];
      for(const k of pick) if(k in f) console.log(' ',k,'=',f[k]);
      console.log(' full factor keys:',Object.keys(f).join(','));
    }
    if(m.strategy||m.legName) console.log(' strategy:',JSON.stringify(m.strategy||m.legName));
    if(m.condition) console.log(' condition:',m.condition);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
