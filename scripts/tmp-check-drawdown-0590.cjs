const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x059019085d8899589e3863d08b284616db8e7777';
(async()=>{
  const db=await dbManager.getClient();
  const trades=await db.from('trades').select('id,trade_direction,trade_status,input_amount,output_amount,unit_price,success,created_at,executed_at,sold_cards,metadata').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at',{ascending:true});
  console.log('== trades ==', trades.data? trades.data.length : JSON.stringify(trades.error));
  for(const t of trades.data||[]){
    const m=t.metadata||{};
    console.log(t.created_at, t.trade_direction, t.trade_status, 'in',t.input_amount,'out',t.output_amount,'unit',t.unit_price, 'ok',t.success,'sold',t.sold_cards, 'cond', (m.condition||m.reason||'').slice(0,80), 'card', JSON.stringify(m.cardTrade||''), 'peak', m.peakProfitPcb ?? m.peakProfitPct ?? '');
  }
  const sigs=await db.from('strategy_signals').select('id,signal_type,action,reason,created_at,metadata').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at',{ascending:true}).limit(60);
  console.log('== signals ==', sigs.data? sigs.data.length : JSON.stringify(sigs.error));
  for(const s of sigs.data||[]){
    console.log(s.created_at, s.signal_type, s.action, (s.reason||'').slice(0,100));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
