const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x059019085d8899589e3863d08b284616db8e7777';
(async()=>{
  const db=await dbManager.getClient();
  const tr=await db.from('trades').select('trade_direction,created_at,unit_price,metadata').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at');
  for(const t of tr.data){
    const m=t.metadata||{};
    console.log('=== trade',t.trade_direction,t.created_at,'unit',t.unit_price,'===');
    const f=m.factors||{};
    const pick=['profitPercent','peakProfitPct','drawdownFromHighestSinceLastBuy','secSincePeak','marketCap','entryMarketCap','realHoldDuration','holdDuration','currentPriceBnb','buyPriceBnb','buyPriceUsd'];
    for(const k of pick) if(k in f) console.log(' ',k,'=',f[k]);
    console.log(' factors keys:',Object.keys(f).join(','));
    console.log(' timestamp:',m.timestamp,'txHash:',(m.txHash||'').slice(0,20));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
