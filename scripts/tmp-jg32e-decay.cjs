// JG-32e：早期流量衰减（前30s vs 30~60s）+ 买入时刻可观测前兆检验
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
  ['0xcadc767df602ce53d42255cefbd8d8e63a747777', '模拟人生', +6.4],
  ['0x1d7d9f2c5480fe49b919c41d1c3952cd92f07777', '金额AI', +0.3],
  ['0xebbc6754c85e9af69f8939e77fc7cbc284ca7777', 'MEME', -10.1],
  ['0x995b000000000000000000000000000000000000', 'X占位', 0],
].slice(0, 9);
(async () => {
  const sb = dbManager.getClient();
  for (const [addr, sym, pnl] of TOKENS) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('bnb_amount,trader_address,sender_address,block_number,log_index,trade_type,block_time')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id',{ascending:true}).limit(3000);
    if (!ticks || !ticks.length) continue;
    const rows = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:Number(r.bnb_amount)}))
      .sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
    const t0 = rows[0]._t;
    const seg = (a,b) => rows.filter(r=>r._t>=t0+a*1000 && r._t<t0+b*1000 && r.trade_type==='buy');
    const s1 = seg(0,30), s2 = seg(30,60), s3 = seg(60,120);
    const b1 = s1.reduce((s,r)=>s+r._b,0), b2 = s2.reduce((s,r)=>s+r._b,0), b3 = s3.reduce((s,r)=>s+r._b,0);
    const w1 = new Set(s1.map(r=>r._w)).size, w2 = new Set(s2.map(r=>r._w)).size, w3 = new Set(s3.map(r=>r._w)).size;
    const decay = b1 > 0 ? b2/b1 : 0;
    const late1m = b3;
    console.log(`${sym.padEnd(6)} pnl${String(pnl).padStart(6)}% | 0-30s:${b1.toFixed(2)}B/${w1}w | 30-60s:${b2.toFixed(2)}B/${w2}w | 60-120s:${b3.toFixed(2)}B/${w3}w | 后半/前半=${decay.toFixed(2)} | 60-120s 钱包${w3}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
