// JG-32e：持有期「新钱包流入枯竭」领先性检验——若枯竭早于深回撤，稀释失败卖臂可立
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  ['0x3b2748dfab3c2bc9beab4666cb35af3193be7777', '丁真', -27.7, 4.80e-6],
  ['0x995b32765ea74ab7b05b57789fb00c96e6407777', '牢大', -22.0, 5.44e-6],
  ['0x993816917954aa30b634a262f68c15d60db17777', '女大', -19.8, 4.72e-6],
  ['0x841b41f3f5266e2931fba12f841a2dbeea2d7777', '人生指南', -18.1, 4.71e-6],
  ['0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777', '麦麦', +129.5, 5.43e-6],
  ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777', '登天猫', +256.4, 4.92e-6],
];
(async () => {
  const sb = dbManager.getClient();
  for (const [addr, sym, pnl, buyP] of TOKENS) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,trader_address,sender_address,block_number,log_index,trade_type,block_time')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id',{ascending:true}).limit(4000);
    const rows = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_p:Number(r.price_bnb),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:Number(r.bnb_amount)}))
      .sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
    const t0 = rows[0]._t;
    const prices = rows.filter(r=>!r.price_outlier&&r._p>0);
    // 逐 60s 滚动窗：新钱包（历史未见过）买入额
    const seen = new Set();
    let dryMs = null; // 首个「连续 120s 新钱包买入 < 0.05B」起点
    for (let m = 0; m < 20; m++) {
      const wStart = t0 + m*60_000, wEnd = wStart + 60_000;
      const seg = rows.filter(r=>r._t>=wStart&&r._t<wEnd&&r.trade_type==='buy');
      let newB = 0;
      for (const r of seg) if (!seen.has(r._w)) { newB += r._b; }
      for (const r of seg) seen.add(r._w);
      if (m >= 1 && newB < 0.05) {
        // 检查下一窗也枯竭
        const nSeg = rows.filter(r=>r._t>=wEnd&&r._t<wEnd+60_000&&r.trade_type==='buy');
        let nB = 0; for (const r of nSeg) if (!seen.has(r._w)) nB += r._b;
        if (nB < 0.05) { dryMs = wStart; break; }
      }
    }
    const dryAt = dryMs ? `${Math.round((dryMs-t0)/1000)}s` : '>20min';
    // 从 B' 买入价算的深回撤时刻（-15%）
    const peakP = Math.max(...prices.filter(r=>r._t<=t0+900_000).map(r=>r._p));
    const crash = prices.find(r=>r._t>t0+30_000 && r._p <= buyP*0.85);
    const crashAt = crash ? `${Math.round((crash._t-t0)/1000)}s` : '>15min';
    // 枯竭时刻的现价（若在枯竭点卖）
    let exitP = null;
    if (dryMs) { const c = prices.filter(r=>r._t<=dryMs).slice(-1)[0]; if (c) exitP = c._p; }
    console.log(`${sym.padEnd(6)} pnl${String(pnl).padStart(6)}% | 15min峰值+${((peakP/prices[0]._p-1)*100).toFixed(0)}% | 新钱包枯竭@${dryAt} | 跌破-15%@${crashAt} | 枯竭点卖出=${exitP?((exitP/buyP-1)*100).toFixed(1)+'%':'-'}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
