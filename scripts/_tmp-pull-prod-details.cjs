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
      .select('token_address,token_symbol,token_category,prestage_result,stage_final_result')
      .in('token_address',chunk);
    if(error)throw new Error(error.message);
    (data||[]).forEach(r=>{
      const pr=r.prestage_result||{}, fi=r.stage_final_result||{};
      const pd=pr.details||{}, fd=fi.details||{};
      out.push({
        addr:r.token_address, symbol:r.token_symbol, category:r.token_category,
        rating:fi.rating, score:fi.score,
        s1:fd.stage1?{primary:fd.stage1.eventClassification&&fd.stage1.eventClassification.primaryCategory, tier:fd.stage1.magnitudeTier, effTier:fd.stage1.effTier, web3fit:fd.stage1.web3Fit, block:fd.stage1.blockReason, eventScore:fd.stage1.eventScore, dim2:fd.stage1.dimension2Score, dim2Band:fd.stage1.dim2Band}:null,
        full_s2: fd.stage2||null,
        full_s1_keys: fd.stage1?Object.keys(fd.stage1):[],
        s3: fd.stage3?Object.keys(fd.stage3):null,
        audit: fd.stage1&&fd.stage1.jev?fd.stage1.jev:null,
        prestage: pr.rating||null,
        ipInfo: pd.ipInfo?{name:pd.ipInfo.name,tier:pd.ipInfo.tier,type:pd.ipInfo.type}:null,
        prestageVerdict: pd.prestageVerdict||pd.verdict||null,
      });
    });
    console.log('  '+Math.min(i+30,list.length)+'/'+list.length);
  }
  fs.writeFileSync('/tmp/prod-details.json',JSON.stringify(out,null,1));
  console.log('OK',out.length,'rows → /tmp/prod-details.json');
  process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
