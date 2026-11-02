const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x059019085d8899589e3863d08b284616db8e7777';
(async()=>{
  const db=await dbManager.getClient();
  const sigs=await db.from('strategy_signals').select('id,signal_type,created_at,metadata,price').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at',{ascending:true});
  for(const s of sigs.data||[]){
    if(s.signal_type!=='SELL'&&s.signal_type!=='BUY')continue;
    console.log('===',s.signal_type,s.created_at,'price',s.price,'===');
    const m=s.metadata||{};
    console.log('strategyName:',m.strategyName);
    console.log('executed_at:',m.executed_at);
    if(m.trendFactors)console.log('trendFactors:',JSON.stringify(m.trendFactors,null,1));
    if(m.tradeResult)console.log('tradeResult:',JSON.stringify(m.tradeResult).slice(0,400));
    // 买信号可能有因子快照
    for(const k of Object.keys(m)){
      if(/factor|snapshot|condition/i.test(k)&&k!=='trendFactors')console.log(k,':',JSON.stringify(m[k]).slice(0,600));
    }
  }
  const tr=await db.from('trades').select('metadata,unit_price,input_amount,output_amount,created_at,executed_at').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at');
  for(const t of tr.data){
    console.log('--- trade',t.trade_direction||'',t.created_at,'unit',t.unit_price,'meta keys',Object.keys(t.metadata||{}).join(','));
    if(t.metadata&&t.metadata.cardTrade)console.log('   cardTrade',JSON.stringify(t.metadata.cardTrade));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
