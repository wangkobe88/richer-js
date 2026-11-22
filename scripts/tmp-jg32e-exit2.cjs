// JG-32e：枯竭时刻价格占峰值比例（无量纲）+ 峰值时刻对照
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  ['0x3b2748dfab3c2bc9beab4666cb35af3193be7777', '丁真', -27.7],
  ['0x995b32765ea74ab7b05b57789fb00c96e6407777', '牢大', -22.0],
  ['0x993816917954aa30b634a262f68c15d60db17777', '女大', -19.8],
  ['0x841b41f3f5266e2931fba12f841a2dbeea2d7777', '人生指南', -18.1],
  ['0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777', '麦麦', +129.5],
  ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777', '登天猫', +256.4],
];
(async () => {
  const sb = dbManager.getClient();
  for (const [addr, sym, pnl] of TOKENS) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,trader_address,sender_address,block_number,log_index,trade_type,block_time')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id',{ascending:true}).limit(4000);
    const rows = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_p:Number(r.price_bnb),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:Number(r.bnb_amount)}))
      .sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
    const t0 = rows[0]._t;
    const prices = rows.filter(r=>!r.price_outlier&&r._p>0);
    const win = prices.filter(r=>r._t<=t0+900_000);
    let peakP=0, peakT=0;
    for (const r of win) if (r._p>peakP) { peakP=r._p; peakT=r._t; }
    // 枯竭（滚动 60s 新钱包买入，连续两窗 <0.05B）
    const seen = new Set(); let dryMs=null, dryP=null;
    for (let m=0;m<20;m++){
      const wS=t0+m*60_000, wE=wS+60_000;
      const seg=rows.filter(r=>r._t>=wS&&r._t<wE&&r.trade_type==='buy');
      let nB=0; for(const r of seg) if(!seen.has(r._w)) nB+=r._b;
      for(const r of seg) seen.add(r._w);
      if(m>=1&&nB<0.05){
        const n2=rows.filter(r=>r._t>=wE&&r._t<wE+60_000&&r.trade_type==='buy');
        let nB2=0; for(const r of n2) if(!seen.has(r._w)) nB2+=r._b;
        if(nB2<0.05){ dryMs=wS; const c=prices.filter(r=>r._t<=wS).slice(-1)[0]; if(c) dryP=c._p; break; }
      }
    }
    const dryAtS = dryMs?Math.round((dryMs-t0)/1000):null;
    const peakAtS = Math.round((peakT-t0)/1000);
    const dryVsPeak = dryP?(dryP/peakP*100):null;
    // 峰后价格轨迹：峰值后 60s/180s 价格占峰值比（持有不动会回吐多少）
    const at = (sec)=>{const c=prices.filter(r=>r._t<=peakT+sec*1000).slice(-1)[0];return c?c._p/peakP*100:null;};
    console.log(`${sym.padEnd(6)} pnl${String(pnl).padStart(6)}% | 峰值@${peakAtS}s | 枯竭@${dryAtS??'>20m'}s 枯竭价/峰值=${dryVsPeak?dryVsPeak.toFixed(0)+'%':'-'} | 峰后60s=${at(60)?.toFixed(0)}% 峰后180s=${at(180)?.toFixed(0)}% 峰后600s=${at(600)?.toFixed(0)}%`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
