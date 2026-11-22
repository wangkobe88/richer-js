// JG-32e：四负票 famous/同块捆绑/稀释取证（本地单票小查询）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => String(w).toLowerCase()));
const TOKENS = [
  ['0x3b2748dfab3c2bc9beab4666cb35af3193be7777', '丁真'],
  ['0x995b32765ea74ab7b05b57789fb00c96e6407777', '牢大'],
  ['0x993816917954aa30b634a262f68c15d60db17777', '女大'],
  ['0x841b41f3f5266e2931fba12f841a2dbeea2d7777', '人生指南'],
  // 对照：两张正票
  ['0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777', '麦麦(+129)'],
  ['0xf38f48cfe9e84920e7de4d47823a0fba95a87777', '登天猫(+256)'],
];
(async () => {
  const sb = dbManager.getClient();
  for (const [addr, sym] of TOKENS) {
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,trader_address,sender_address,block_number,log_index,trade_type,block_time')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id', {ascending:true}).limit(3000);
    if (!ticks || !ticks.length) { console.log(`${sym}: 无 ticks`); continue; }
    const rows = ticks.map((r,i)=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:Number(r.bnb_amount)}))
      .sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
    const t0 = rows[0]._t;
    const early = rows.filter(r=>r._t<=t0+60_000 && r.trade_type==='buy');
    const totalEarly = early.reduce((s,r)=>s+r._b,0);
    // famous 占比
    const famBuy = early.filter(r=>FAM.has(r._w)).reduce((s,r)=>s+r._b,0);
    const famWallets = new Set(early.filter(r=>FAM.has(r._w)).map(r=>r._w));
    // 同块捆绑：同 block 买入钱包数≥2 的块，其合计额
    const byBlock = new Map();
    for (const r of early) { let a=byBlock.get(r.block_number); if(!a){a=[];byBlock.set(r.block_number,a);} a.push(r); }
    let bundleBnb = 0, bundleBlocks = [];
    for (const [blk, arr] of byBlock) {
      const ws = new Set(arr.map(r=>r._w));
      if (ws.size >= 2) { const s = arr.reduce((x,r)=>x+r._b,0); if (s >= 0.15) { bundleBnb += s; bundleBlocks.push(`blk${String(blk).slice(-6)}(${ws.size}w/${s.toFixed(2)}B)`); } }
    }
    // famous+捆绑并集占比（粗）：捆绑块内 famous 部分 + 独立 famous 单买——先给两个分项
    // 后续稀释：60s~10min 新钱包（非早期钱包）买入额
    const earlyWs = new Set(early.map(r=>r._w));
    const later = rows.filter(r=>r._t>t0+60_000 && r._t<=t0+600_000 && r.trade_type==='buy');
    const laterNew = later.filter(r=>!earlyWs.has(r._w));
    const laterNewBnb = laterNew.reduce((s,r)=>s+r._b,0);
    const laterNewWs = new Set(laterNew.map(r=>r._w)).size;
    // 涨幅参照
    const prices = rows.filter(r=>!r.price_outlier&&r.price_bnb>0);
    const p0 = prices[0] ? Number(prices[0].price_bnb) : 0;
    const pMax = prices.length ? Math.max(...prices.slice(0,3000).map(r=>Number(r.price_bnb))) : 0;
    console.log(`${sym.padEnd(9)} 早期60s买${totalEarly.toFixed(2)}B/${new Set(early.map(r=>r._w)).size}钱包 | famous:${famWallets.size}家/${(famBuy/totalEarly*100).toFixed(0)}%（${famBuy.toFixed(2)}B）| 捆绑块:${bundleBlocks.length}个 ${(bundleBnb/totalEarly*100).toFixed(0)}%（${bundleBnb.toFixed(2)}B）| ${bundleBlocks.slice(0,3).join(' ')} | 后续9min新钱包${laterNewWs}家买${laterNewBnb.toFixed(2)}B（稀释比${(laterNewBnb/totalEarly).toFixed(2)}）| 峰值+${((pMax/p0-1)*100).toFixed(0)}%`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
