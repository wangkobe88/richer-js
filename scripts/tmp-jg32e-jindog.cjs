// JG-32e-5：金狗 30 票 × (B 形状 ∧ famBlkBun<15) 重合度验证
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => String(w).toLowerCase()));
const WINS = {
  'w1003': '9e9163de-a677-4d39-9c33-9ec9df05e400',
  'w1019': 'ce102e94-293c-4f8f-af98-cd06f4b0e98c',
  'w1012': 'dddbe79e-480a-402a-aa35-85a72d2f591e',
  'w1103': '2448116a-bebe-457d-9d8a-b4556c9a8e0d',
};
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) { const page = await from.range(offset, offset + pageSize - 1); if (page.error) throw new Error(page.error.message); rows.push(...page.data); if (page.data.length < pageSize) return rows; offset += pageSize; }
}
(async () => {
  const sb = dbManager.getClient();
  const { data: jindog } = await sb.from('case_collection_tokens').select('token_address,note').eq('collection_id','a8414632-7c24-4762-9253-c49bb0f53105');
  // 每窗首信号
  const firstSig = new Map();
  for (const [w, exp] of Object.entries(WINS)) {
    const sigs = await fetchAll(sb.from('strategy_signals').select('token_address,created_at').eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at',{ascending:true}));
    for (const s of sigs) { const a=(s.token_address||'').toLowerCase(); if(!firstSig.has(a)) firstSig.set(a,{w,ts:s.created_at}); }
  }
  let hit = 0, noSig = 0, rows = [];
  for (const t of jindog||[]) {
    const a = t.token_address.toLowerCase();
    const sig = firstSig.get(a);
    if (!sig) { noSig++; rows.push(`${(t.note||'').slice(0,12)} 无信号`); continue; }
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('trade_type,sender_address,trader_address,bnb_amount,price_bnb,price_outlier,block_number,log_index,block_time')
      .eq('token_address', a)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-11-05T12:00:00Z')
      .order('id',{ascending:true}).limit(4000);
    if (!ticks||!ticks.length) { rows.push(`${(t.note||'').slice(0,12)} 无ticks`); continue; }
    const rs = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:num(r.bnb_amount)}))
      .sort((x,y)=>x.block_number-y.block_number||x.log_index-y.log_index);
    const t0=rs[0]._t, tBuy=new Date(sig.ts).getTime();
    const all=rs.filter(r=>r._t<=tBuy);
    const wBuy=new Map(),wSell=new Map(),wFT=new Map();
    for(const r of all){ if(!r._w)continue; if(r.trade_type==='buy'){wBuy.set(r._w,(wBuy.get(r._w)||0)+r._b); if(!wFT.has(r._w))wFT.set(r._w,r._t);} else wSell.set(r._w,(wSell.get(r._w)||0)+r._b); }
    const net=w=>(wBuy.get(w)||0)-(wSell.get(w)||0);
    const ec=t0+10_000, early=[],later=[];
    for(const [w,b] of wBuy){ if(b<0.1)continue; (wFT.get(w)<=ec?early:later).push(w); }
    let B=false;
    if(early.length>=1) B=early.every(w=>net(w)<=wBuy.get(w)*0.1)&&later.filter(w=>net(w)>=wBuy.get(w)*0.5).length>=2;
    const obs=all.filter(r=>r.trade_type==='buy'&&r._t>=t0);
    const tb=obs.reduce((s,r)=>s+r._b,0);
    const byBlk=new Map();
    for(const r of obs){let x=byBlk.get(r.block_number);if(!x){x={bnb:0,ws:new Set(),fam:false};byBlk.set(r.block_number,x);}x.bnb+=r._b;x.ws.add(r._w);if(FAM.has(r._w))x.fam=true;}
    let fb=0; for(const[,x]of byBlk) if(x.fam&&x.ws.size>=2) fb+=x.bnb;
    const pct=tb>0?fb/tb*100:null;
    const ok = B && pct!==null && pct<15;
    if (ok) hit++;
    rows.push(`${(t.note||'').slice(0,14).padEnd(14)} ${sig.w} B=${B?1:0} famBlk=${pct===null?'-':pct.toFixed(0)}% ${ok?'✓命中':''}`);
  }
  console.log(rows.sort().join('\n'));
  console.log(`\n金狗 ${rows.length} 票：B∧fam<15 命中 ${hit} | 无信号 ${noSig}`);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
