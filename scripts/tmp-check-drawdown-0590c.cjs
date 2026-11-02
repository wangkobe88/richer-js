const { dbManager } = require('../src/services/dbManager.js');
const TOK='0x059019085d8899589e3863d08b284616db8e7777';
(async()=>{
  const db=await dbManager.getClient();
  const t=await db.from('wss_price_ticks').select('block_time,price_bnb,price_outlier,trade_type,bnb_amount,block_number,log_index')
    .eq('token_address',TOK).gte('block_time','2026-10-29T05:02:30').lte('block_time','2026-10-29T05:07:00')
    .order('block_time',{ascending:true}).limit(400);
  if(t.error){console.error(t.error.message);process.exit(1);}
  console.log('ticks:',t.data.length);
  for(const r of t.data){
    console.log(`${r.block_time} blk=${r.block_number}/${r.log_index} px=${Number(r.price_bnb).toExponential(5)} ${r.price_outlier?'OUT':'   '} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
