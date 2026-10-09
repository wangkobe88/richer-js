require('dotenv').config({path:'../config/.env'});
const {dbManager}=require('../src/services/dbManager');
const fs=require('fs');
(async()=>{
  const c=dbManager.getClient();
  const list=JSON.parse(fs.readFileSync('/tmp/prod-cluster.json','utf8'));
  const out=[];
  for(let i=0;i<list.length;i+=30){
    const chunk=list.slice(i,i+30);
    const {data,error}=await c.from('token_narrative')
      .select('token_address,token_symbol,stage1_raw_output,stage_final_result,prestage_result,token_category')
      .in('token_address',chunk);
    if(error)throw new Error(error.message);
    const byAddr=new Map((data||[]).map(r=>[r.token_address,r]));
    chunk.forEach(a=>{
      const r=byAddr.get(a);
      if(!r||!r.stage1_raw_output){out.push({addr:a,err:'no_raw'});return;}
      let o;try{o=JSON.parse(r.stage1_raw_output)}catch(e){out.push({addr:a,err:'parse'});return;}
      const A=o.answers||{};
      const g=k=>({c:A[k]&&A[k].choice,p:A[k]&&A[k].probabilities||null,s:A[k]&&A[k].score!=null?A[k].score:null});
      const fin=r.stage_final_result||{};
      out.push({
        addr:a,symbol:r.token_symbol,category:r.token_category,rating:fin.rating,score:fin.score,
        s2:fin.details?{total:fin.details.stage2TotalScore,evScore:fin.details.eventScore,block:fin.details.blockReason}:null,
        cat:g('event_category'), mag:g('event_magnitude'), dim2:g('dimension2'), fit:g('web3_fit'),
        nr:g('name_referent'), block:g('block_reason'), timing:g('event_timing'),
        rel_type:g('relevance_type'), rel_level:g('relevance_level'),
        prestage:r.prestage_result&&r.prestage_result.rating?r.prestage_result.rating:null,
      });
    });
    console.log('  '+Math.min(i+30,list.length)+'/'+list.length);
  }
  fs.writeFileSync('/tmp/prod-raw.json',JSON.stringify(out,null,1));
  console.log('OK',out.length,'→ /tmp/prod-raw.json');
  process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
