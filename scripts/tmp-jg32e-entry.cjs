// JG-32e：B' 臂买入点位检验——买入时刻 vs 峰值时刻/价格位置（只看买入点位）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  ['0x3b2748dfab3c2bc9beab4666cb35af3193be7777', '丁真', -27.7],
  ['0x995b32765ea74ab7b05b57789fb00c96e6407777', '牢大', -22.0],
  ['0x993816917954aa30b634a262f68c15d60db17777', '女大', -19.8],
  ['0x841b41f3f5266e2931fba12f841a2dbeea2d7777', '人生指南', -18.1],
  ['0xebbc6754c85e9af69f8939e77fc7cbc284ca7777', 'MEME', -10.1],
  ['0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777', '麦麦', +129.5],
  ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777', '登天猫', +256.4],
];
(async () => {
  const sb = dbManager.getClient();
  // B' 臂买入行
  const { data: buys } = await sb.from('trades').select('token_address,created_at,input_amount')
    .eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').eq('trade_direction','buy');
  const buyByTok = new Map();
  for (const b of buys||[]) buyByTok.set(b.token_address, b);
  for (const [addr, sym, pnl] of TOKENS) {
    const b = buyByTok.get(addr);
    if (!b) { console.log(`${sym}: B' 未买入`); continue; }
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,trade_type,block_time,block_number,log_index,sender_address,trader_address')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id',{ascending:true}).limit(4000);
    const rows = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_p:Number(r.price_bnb),_b:Number(r.bnb_amount)}))
      .sort((a,b2)=>a.block_number-b2.block_number||a.log_index-b2.log_index);
    const t0 = rows[0]._t;
    const prices = rows.filter(r=>!r.price_outlier&&r._p>0);
    const win = prices.filter(r=>r._t<=t0+900_000);
    let peakP=0, peakT=0; for (const r of win) if (r._p>peakP){peakP=r._p;peakT=r._t;}
    const tBuy = new Date(b.created_at).getTime();
    const buySec = Math.round((tBuy-t0)/1000);
    const pAtBuy = prices.filter(r=>r._t<=tBuy).slice(-1)[0];
    const vsPeak = pAtBuy?(pAtBuy._p/peakP*100):null;
    const firstP = prices[0]._p;
    const vsFirst = pAtBuy?((pAtBuy._p/firstP-1)*100):null;
    // 买入时刻前 60s 新钱包买入额（当时可观测的「新鲜度」）与早期 60s 脉冲额
    const early60 = rows.filter(r=>r._t>=t0&&r._t<t0+60_000&&r.trade_type==='buy').reduce((s,r)=>s+r._b,0);
    console.log(`${sym.padEnd(6)} pnl${String(pnl).padStart(6)}% | B'买入@t0+${buySec}s | 峰值@${Math.round((peakT-t0)/1000)}s | ${buySec>Math.round((peakT-t0)/1000)?'峰后('+vsPeak?.toFixed(0)+'%峰值)':'峰前'} | 买入价较首笔${vsFirst>=0?'+':''}${vsFirst?.toFixed(0)}% | 早期60s脉冲${early60.toFixed(1)}B`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
