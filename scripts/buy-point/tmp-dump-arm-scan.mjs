// A 方案命中面扫描：nearDumpWorstSellers>=15 ∧ sellBnb>=1（182 跑）
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const c = await dbManager.getClient();
const data=[];
for(let from=0;;from+=1000){
  const {data:page,error}=await c.from('strategy_signals')
    .select('id,token_address,token_symbol,created_at,metadata')
    .eq('experiment_id','19ef6433-0c92-47ff-a6fd-9f6bea745b8d')
    .eq('signal_type','BUY')
    .order('created_at',{ascending:true}).order('id',{ascending:true})
    .range(from,from+999);
  if(error)throw new Error(error.message);
  data.push(...page); if(page.length<1000)break;
}
const rev=JSON.parse(readFileSync(resolve(HERE,'data/btv134-review.json'),'utf8'));
const revmap={}; for(const r of rev) revmap[r.addr]=r;
const seen={};
for(const s of data){
  if(seen[s.token_address])continue;
  const cc=(s.metadata||{}).cheatCheck; if(!cc)continue;
  seen[s.token_address]={sym:s.token_symbol,addr:s.token_address,an:cc.anchors||{},grade:cc.grade,exempt:cc.exempt?cc.exempt.code:null};
}
const out=[];
for(const [tok,t] of Object.entries(seen)){
  const an=t.an;
  const sellers=an.nearDumpWorstSellers, sell=an.nearDumpWorstSellBnb;
  if(typeof sellers==='number'&&sellers>=15&&typeof sell==='number'&&sell>=1){
    const rr=revmap[tok];
    out.push({sym:t.sym,sellers,sell,absorb:an.nearDumpMinAbsorbBnb,grade:t.grade,exempt:t.exempt,pnl:rr?rr.pnl:null,curVs:rr?rr.curVs:null});
  }
}
console.log(`sellers>=15 ∧ sell>=1 命中 ${out.length} token`);
for(const o of out){
  const pnl=o.pnl!==null&&o.pnl!==undefined?o.pnl.toFixed(4):'非成交';
  console.log(`  ${o.sym.padEnd(12)} sellers=${o.sellers} sell=${o.sell.toFixed(2)} absorb=${o.absorb.toFixed(2)} ratio=${(o.absorb/o.sell).toFixed(2)} | ${o.grade}→${o.exempt||'-'} | curVs=${o.curVs} pnl=${pnl}`);
}
process.exit(0);
