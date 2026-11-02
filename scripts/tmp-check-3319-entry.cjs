const { dbManager } = require('../src/services/dbManager.js');
const EXP='4ac10e23-83a7-4177-80f1-c3e7ed3bdddd';
const TOK='0x33196e0763841a198b48507885f6ce46c7877777';
(async()=>{
  const db=await dbManager.getClient();
  const sig=await db.from('strategy_signals').select('*').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at');
  console.log('### signals:',sig.data.length);
  for(const s of sig.data){
    const md=s.metadata||{};
    console.log('---',s.created_at,s.status,'strategy:',s.strategy_name||md.strategyName,'action:',s.action||md.action);
    const nc=md.narrativeCall;
    if(nc) console.log('  narrativeCall:',JSON.stringify({rating:nc.rating,numericRating:nc.numericRating,reason:(nc.reason||'').slice(0,120),timing:nc.timing}));
    const gm=md.gmgnCheck;
    if(gm) console.log('  gmgnCheck:',JSON.stringify(gm).slice(0,300));
    const pb=md.preBuyCheckFactors;
    if(pb) console.log('  preBuyCheckFactors:',JSON.stringify(pb).slice(0,400));
    if(md.reason) console.log('  md.reason:',String(md.reason).slice(0,200));
    if(md.rejectedReason) console.log('  md.rejectedReason:',String(md.rejectedReason).slice(0,200));
    const extra=Object.keys(md).filter(k=>!['narrativeCall','gmgnCheck','preBuyCheckFactors','factors'].includes(k));
    if(extra.length) console.log('  md keys:',extra.join(','));
  }
  const tr=await db.from('trades').select('trade_direction,created_at,unit_price,amount,metadata').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at');
  console.log('### trades:',tr.data.length);
  for(const t of tr.data) console.log(' ',t.trade_direction,t.created_at,'unit',t.unit_price,'amount',t.amount);
  const nar=await db.from('token_narrative').select('rating,reason,updated_at,raw_api_data->created_at,analysis_version').eq('token_address',TOK).order('updated_at');
  console.log('### token_narrative rows:',nar.data.length);
  for(const n of nar.data) console.log(' ',n.updated_at,'rating',n.rating,'ver',n.analysis_version,'reason:',String(n.reason||'').slice(0,160));
  const rounds=await db.from('narrative_analysis_rounds').select('*').eq('experiment_id',EXP).eq('token_address',TOK).order('created_at');
  console.log('### narrative_analysis_rounds:',rounds.data.length);
  for(const r of rounds.data) console.log(' ',JSON.stringify(r).slice(0,300));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
