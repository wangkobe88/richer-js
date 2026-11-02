const { dbManager } = require('../src/services/dbManager.js');
(async()=>{
  const db=await dbManager.getClient();
  const tr=await db.from('trades').select('token_symbol,trade_direction,input_amount,output_amount').eq('experiment_id','8774583d-dd80-4226-9817-b16347245ee4').limit(50);
  console.log('v57 trades:',tr.data?tr.data.length:JSON.stringify(tr.error));
  const pos={};
  for(const t of tr.data||[]){
    const k=t.token_symbol;
    pos[k]=pos[k]||0;
    pos[k]+=t.trade_direction==='buy'?1:-1;
  }
  console.log(JSON.stringify(pos));
  const e=await db.from('experiments').select('status').eq('id','8774583d-dd80-4226-9817-b16347245ee4');
  console.log('status:',e.data&&e.data[0]&&e.data[0].status);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
