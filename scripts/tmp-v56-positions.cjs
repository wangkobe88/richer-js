const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
(async()=>{
  const db=await dbManager.getClient();
  const tr=await db.from('trades').select('token_symbol,token_address,trade_direction,trade_status,input_amount,output_amount,unit_price,created_at,metadata')
    .eq('experiment_id',EXP).order('created_at',{ascending:true}).limit(200);
  if(tr.error){console.error(tr.error.message);process.exit(1);}
  const pos={};
  for(const t of tr.data){
    const k=t.token_symbol+' '+t.token_address.slice(0,10);
    pos[k]=pos[k]||{qty:0,bnbIn:0,bnbOut:0,buys:0,sells:0};
    const p=pos[k];
    if(t.trade_direction==='buy'){p.qty+=Number(t.output_amount);p.bnbIn+=Number(t.input_amount);p.buys++;}
    else {p.qty-=Number(t.input_amount);p.bnbOut+=Number(t.output_amount);p.sells++;}
  }
  console.log('实验内 trades 总数:',tr.data.length);
  for(const [k,p] of Object.entries(pos)){
    const open=Math.abs(p.qty)>1e-6;
    console.log((open?'[持仓] ':'[已平] '),k,'净量',p.qty.toFixed(2),'买',p.buys,'卖',p.sells,'BNB in/out',p.bnbIn.toFixed(4),'/',p.bnbOut.toFixed(4));
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
