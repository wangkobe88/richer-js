// JG-32e-2：买入点位时刻的「famous 同块买入占比」判别力检验（B' 臂 15 买入票全量）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => String(w).toLowerCase()));
(async () => {
  const sb = dbManager.getClient();
  // B' 臂买入票+时刻+pnl
  const { data: buys } = await sb.from('trades').select('token_address,created_at').eq('experiment_id','c4e9f11a-9ce9-46f5-969b-9a935cd16789').eq('trade_direction','buy');
  const SYM = { '0xf38f48cfe9e84920e7de4d47823a0fba95a87777':'登天猫','0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777':'麦麦','0x3b2748dfab3c2bc9beab4666cb35af3193be7777':'丁真','0x995b32765ea74ab7b05b57789fb00c96e6407777':'牢大','0xd0451a539ce2d4321f72e7f1e91c65db8ed87777':'大祭司','0xebbc6754c85e9af69f8939e77fc7cbc284ca7777':'MEME','0xcadc767df602ce53d42255cefbd8d8e63a747777':'模拟人生','0x6fe44c149140f7827213fdeb9ca00d0c85397777':'AGI','0x993816917954aa30b634a262f68c15d60db17777':'女大','0x841b41f3f5266e2931fba12f841a2dbeea2d7777':'人生指南','0x2893a7961216a58ce2051dbd9cd4f2d515747777':'万锅共酱会','0x5316e94be2689e4feb4664c79aaf95c01c5d7777':'沫沫','0x995b3276':'X','0xa72df2039229d697abf15da34c515d28f3bb7777':'OON','0x153f8335b1fcda68e459463a5899dd736fd27777':'QAFILA','0xe6765c897daecfecdd4687d49907828a1a2f7777':'黄鲸' };
  const PNL = { '登天猫':256.4,'麦麦':129.5,'AGI':13.2,'QAFILA':15.9,'模拟人生':6.4,'万锅共酱会':4.6,'大祭司':1.4,'沫沫':0.0,'黄鲸':0.0,'OON':-7.8,'MEME':-10.1,'人生指南':-18.1,'女大':-19.8,'牢大':-22.0,'丁真':-27.7 };
  const out = [];
  for (const b of buys||[]) {
    const addr = b.token_address;
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,trade_type,block_time,block_number,log_index,sender_address,trader_address')
      .eq('token_address', addr)
      .gte('block_time','2026-10-02T22:00:00Z').lte('block_time','2026-10-05T12:00:00Z')
      .order('id',{ascending:true}).limit(4000);
    if (!ticks||!ticks.length) continue;
    const rows = ticks.map(r=>({...r,_t:new Date(r.block_time).getTime(),_w:((r.sender_address||r.trader_address)||'').toLowerCase(),_b:Number(r.bnb_amount)}))
      .sort((a,c)=>a.block_number-c.block_number||a.log_index-c.log_index);
    const t0 = rows[0]._t;
    const tBuy = new Date(b.created_at).getTime();
    // 观测窗=[t0, tBuy] 的买入
    const obs = rows.filter(r=>r._t>=t0 && r._t<=tBuy && r.trade_type==='buy');
    const totalB = obs.reduce((s,r)=>s+r._b,0);
    if (totalB <= 0) continue;
    // per-block 聚合
    const byBlk = new Map();
    for (const r of obs) { let a=byBlk.get(r.block_number); if(!a){a={bnb:0,ws:new Set(),fam:false,famBnb:0};byBlk.set(r.block_number,a);} a.bnb+=r._b; a.ws.add(r._w); if(FAM.has(r._w)){a.fam=true;a.famBnb+=r._b;} }
    // famous 参与块占比（famous 所在块的全部买入额——famous 拖带的同块流量）
    let famBlkB = 0;
    // famous 同块捆绑占比（famous 所在块 且 块内 ≥2 钱包）
    let famBlkBundleB = 0, famOwnB = 0;
    for (const [, a] of byBlk) {
      if (a.fam) { famBlkB += a.bnb; if (a.ws.size >= 2) famBlkBundleB += a.bnb; famOwnB += a.famBnb; }
    }
    const sym = SYM[addr] || addr.slice(0,6);
    out.push({ sym, pnl: PNL[sym] ?? 0, buySec: Math.round((tBuy-t0)/1000), totalB,
      famBlkPct: famBlkB/totalB*100, famBunPct: famBlkBundleB/totalB*100, famOwnPct: famOwnB/totalB*100 });
  }
  out.sort((a,b)=>b.pnl-a.pnl);
  console.log('票        pnl%    买@   观测窗买入 | famous所在块占比 | famous同块捆绑占比 | famous自身占比');
  for (const r of out) console.log(`${String(r.sym).padEnd(6)} ${String(r.pnl).padStart(7)}  +${String(r.buySec).padStart(3)}s  ${r.totalB.toFixed(2)}B   |   ${String(r.famBlkPct.toFixed(0)).padStart(4)}%        |     ${String(r.famBunPct.toFixed(0)).padStart(4)}%       |    ${String(r.famOwnPct.toFixed(0)).padStart(4)}%`);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
