#!/usr/bin/env node
/**
 * JG-32f-2（182 跑）：用户框架在 FP32 域内验证（豁免腿用途）
 * 锚=首个会被 big_buy_defer 拦的信号时刻（重算镜像 tmp-jg32c-shape.cjs）；
 * 在锚上算 B 形状（首波清仓∧后波持有）+ famBlkBun（famous 所在块≥2w 占比）；
 * 2×2 双口径：fwdPeak（60min 峰）+ stall 出口（50s 断流，JG-32c 同款保守下限）。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => String(w).toLowerCase()));
const BIG = 0.19, LAUNCH_MS = 90_000, STALL_MS = 50_000, SUB_BNB = 0.02;
const WINDOWS = [
  ['w1003', '9e9163de-a677-4d39-9c33-9ec9df05e400', '2026-10-02T23:50:00.000Z', '2026-10-05T06:00:00.000Z'],
  ['w1019', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', '2026-10-19T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
  ['w1012', 'dddbe79e-480a-402a-aa35-85a72d2f591e', '2026-10-12T00:00:00.000Z', '2026-10-13T00:00:00.000Z'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z'],
];
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
async function fetchAll(from, pageSize = 1000) {
  const rows = []; let offset = 0;
  for (;;) { const page = await from.range(offset, offset + pageSize - 1); if (page.error) throw new Error(page.error.message); rows.push(...page.data); if (page.data.length < pageSize) return rows; offset += pageSize; }
}
(async () => {
  const db = dbManager.getClient();
  const grand = [];
  for (const [wname, expId, winStart, winEnd] of WINDOWS) {
    const sigs = await fetchAll(db.from('strategy_signals').select('token_address, token_symbol, created_at').eq('experiment_id', expId).eq('signal_type', 'BUY').order('created_at', { ascending: true }));
    const byTok = new Map();
    for (const s of sigs) { const a=(s.token_address||'').toLowerCase(); if(!a) continue; let e=byTok.get(a); if(!e){e={sym:s.token_symbol||'',times:[]};byTok.set(a,e);} e.times.push(s.created_at); }
    const addrs = [...byTok.keys()];
    const spillEnd = new Date(new Date(winEnd).getTime() + 6*3600_000).toISOString();
    const tickByToken = new Map();
    for (let i=0;i<addrs.length;i+=50) {
      const trows = await fetchAll(db.from('wss_price_ticks')
        .select('token_address, trade_type, sender_address, trader_address, bnb_amount, price_bnb, price_outlier, block_number, log_index, block_time')
        .in('token_address', addrs.slice(i,i+50))
        .gte('block_time', new Date(new Date(winStart).getTime()-600_000).toISOString())
        .lte('block_time', spillEnd));
      for (const r of trows) { const a=r.token_address.toLowerCase(); let arr=tickByToken.get(a); if(!arr){arr=[];tickByToken.set(a,arr);} arr.push(r); }
    }
    const res = [];
    for (const [a,e] of byTok) {
      const ticks = tickByToken.get(a)||[];
      if (!ticks.length) continue;
      const rows = ticks.map((r,i)=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:num(r.bnb_amount),_p:num(r.price_bnb)}))
        .sort((x,y)=>x.block_number-y.block_number||x.log_index-y.log_index);
      const t0=rows[0]._t;
      const rel=rows.filter(r=>!r.price_outlier&&r._p>0);
      const firstRelBuy=rel.find(r=>r.trade_type==='buy')||rel[0];
      if(!firstRelBuy) continue;
      // FP32 锚点重算（big_buy_defer）
      let anchor=null;
      for (const iso of e.times) {
        const ts=new Date(iso).getTime();
        const asof=rows.filter(r=>r._t<=ts&&r._t<=t0+LAUNCH_MS);
        const buy=new Map(),firstBuy=new Map();
        for(const r of asof){ if(!r._w||r.trade_type!=='buy')continue; buy.set(r._w,(buy.get(r._w)||0)+r._b); if(!firstBuy.has(r._w))firstBuy.set(r._w,r); }
        const eq=new Map();
        for(const r of firstBuy.values()){ if(r.block_number===null||r._b<0.01)continue; const k=r.block_number+'|'+(Math.round(r._b*1e4)/1e4); let x=eq.get(k);if(!x){x=new Set();eq.set(k,x);} x.add(r._w); }
        const grouped=new Set();
        for(const x of eq.values()) if(x.size>=2) for(const w of x) grouped.add(w);
        let bigSum=0;
        for(const [w,v] of buy) if(!grouped.has(w)&&v>=BIG) bigSum+=v;
        for(const x of eq.values()){ if(x.size<2)continue; let mb=0;for(const w of x)mb+=buy.get(w)||0; if(mb>=BIG)bigSum+=mb; }
        const since=(ts-firstRelBuy._t)/1000;
        const tier=bigSum>=1?60:bigSum>=0.79?45:null;
        if(tier!==null&&since<=tier){ anchor=ts; break; }
      }
      if(anchor===null) continue;
      const ts=anchor;
      const all=rows.filter(r=>r._t<=ts);
      const wBuy=new Map(),wSell=new Map(),wFT=new Map();
      for(const r of all){ if(!r._w)continue; if(r.trade_type==='buy'){wBuy.set(r._w,(wBuy.get(r._w)||0)+r._b);if(!wFT.has(r._w))wFT.set(r._w,r._t);}else wSell.set(r._w,(wSell.get(r._w)||0)+r._b); }
      const net=w=>(wBuy.get(w)||0)-(wSell.get(w)||0);
      const ec=t0+10_000,early=[],later=[];
      for(const [w,b] of wBuy){ if(b<0.1)continue;(wFT.get(w)<=ec?early:later).push(w); }
      let shapeB=false;
      if(early.length>=1) shapeB=early.every(w=>net(w)<=wBuy.get(w)*0.1)&&later.filter(w=>net(w)>=wBuy.get(w)*0.5).length>=2;
      const obs=all.filter(r=>r.trade_type==='buy'&&r._t>=t0);
      const tb=obs.reduce((s,r)=>s+r._b,0);
      if(tb<0.1) continue;
      const byBlk=new Map();
      for(const r of obs){let x=byBlk.get(r.block_number);if(!x){x={bnb:0,ws:new Set(),fam:false};byBlk.set(r.block_number,x);}x.bnb+=r._b;x.ws.add(r._w);if(FAM.has(r._w))x.fam=true;}
      let fb=0;for(const[,x]of byBlk)if(x.fam&&x.ws.size>=2)fb+=x.bnb;
      const pct=fb/tb*100;
      const pAt=rel.filter(r=>r._t<=ts).slice(-1)[0];
      if(!pAt) continue;
      const seg=rel.filter(r=>r._t>=ts&&r._t<=ts+3600_000);
      const fwd=seg.length?(Math.max(...seg.map(r=>r._p))/pAt._p-1)*100:null;
      const fwdRows=rows.filter(r=>r._t>=ts);
      let lastSub=pAt._t,lastPrice=pAt._p,exitP=null;
      for(const r of fwdRows){ if(r._t-lastSub>STALL_MS){exitP=lastPrice;break;} if(!r.price_outlier&&r._p>0)lastPrice=r._p; if(r._b>=SUB_BNB)lastSub=r._t; }
      if(exitP===null)exitP=lastPrice;
      const stall=(exitP/pAt._p-1)*100;
      res.push({addr:a,sym:e.sym,pct:+pct.toFixed(1),shapeB,fwd:fwd===null?null:+fwd.toFixed(1),stall:+stall.toFixed(1)});
    }
    grand.push({wname,res});
    console.log(`${wname}: FP32 域 ${res.length}`);
  }
  const cell=(list)=>{
    if(!list.length) return 'n=0';
    const f=list.filter(r=>r.fwd!==null).sort((a,b)=>a.fwd-b.fwd);
    const med=f.length?f[Math.floor(f.length/2)].fwd:null;
    const sMed=list.length?list.map(r=>r.stall).sort((a,b)=>a-b)[Math.floor(list.length/2)]:null;
    const sSum=list.reduce((s,r)=>s+r.stall,0);
    const tails=f.filter(r=>r.fwd>=200);
    return `n=${list.length} fwd中位=${med===null?'-':med.toFixed(1)}% 肥尾≥200:${tails.length}${tails.length?'('+tails.slice(-3).map(r=>(r.sym||r.addr.slice(0,6))+'='+r.fwd).join(',')+')':''} | stall中位=${sMed.toFixed(1)}% stall净=${(0.2*sSum/100).toFixed(2)}B`;
  };
  console.log('\n════ FP32 域内 2×2（用户框架=豁免腿用途）════');
  for(const [bl,bf] of [['非B',r=>!r.shapeB],['B(sniper走光+有人接)',r=>r.shapeB]]){
    for(const [fl,ff] of [['fam<15%',r=>r.pct<15],['fam≥15%',r=>r.pct>=15]]){
      const all=grand.flatMap(g=>g.res.filter(r=>bf(r)&&ff(r)));
      console.log(`${bl.padEnd(16)}| ${fl.padEnd(8)}| ${cell(all)}`);
    }
  }
  console.log('\n════ B 域内逐窗 ════');
  for(const g of grand) console.log(`${g.wname}: B∧fam<15 ${cell(g.res.filter(r=>r.shapeB&&r.pct<15))} || B∧fam≥15 ${cell(g.res.filter(r=>r.shapeB&&r.pct>=15))}`);
  process.exit(0);
})().catch(e=>{console.error('失败:',e.message);process.exit(1);});
