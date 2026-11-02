// Ragu 0xf1dc 进场可行性 + 首窗买家构成（反作弊口径）+ 对照 buy-v2 门
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xf1dca9bf42c5f565063f493f693455c86dff7777';
const RATING_AT = Date.parse('2026-10-29T09:42:58Z');
const GMGN_ROUTER = '0x1de460'; // AGGREGATOR_ROUTER_ADDRS 前缀（CLAUDE.md 0x1de460…4bc）
(async () => {
  const db = dbManager.getClient();
  const { data: tk, error } = await db.from('wss_price_ticks')
    .select('price_bnb,block_time,trade_type,trader_address,sender_address,bnb_amount')
    .eq('token_address', ADDR).order('block_time',{ascending:true}).limit(3000);
  if (error) throw error;
  // ① 评级到达后的价轨（+0/+5/+10/+15/+20/+30/+45/+60/+90s）
  console.log('=== 评级到达 09:42:58 后价轨（相对首价 6.50e-9 的倍数）:');
  for (const off of [0,5,10,15,20,30,45,60,90,120]) {
    const t = RATING_AT + off*1000;
    let last = null;
    for (const r of tk) { if (Date.parse(r.block_time) <= t) last = r; else break; }
    if (last) console.log(`  +${off}s: ${Number(last.price_bnb).toExponential(3)} (${(Number(last.price_bnb)/6.5046e-9).toFixed(1)}x) @${last.block_time.slice(11,19)}`);
  }
  // 峰时刻
  let peak=0, peakT=null;
  for (const r of tk){const p=Number(r.price_bnb); if(p>peak){peak=p;peakT=r.block_time;}}
  console.log(`  峰值 ${peak.toExponential(3)} @${peakT.slice(11,19)}`);
  // ② 首窗买家构成（0-60s / 0-120s），wallet=sender||trader
  for (const [label, win] of [['首60s',60],['首120s',120]]) {
    const end = Date.parse(tk[0].block_time) + win*1000;
    const win2 = tk.filter(r=>Date.parse(r.block_time)<=end);
    const buys = win2.filter(r=>r.trade_type==='buy');
    const sells = win2.filter(r=>r.trade_type!=='buy');
    const perWallet = new Map();
    let totBuy=0, totSell=0, gmgnBuy=0;
    for (const r of buys) {
      const w = (r.sender_address||r.trader_address||'').toLowerCase();
      perWallet.set(w,(perWallet.get(w)||0)+Number(r.bnb_amount||0));
      totBuy += Number(r.bnb_amount||0);
      if ((r.trader_address||'').toLowerCase().startsWith(GMGN_ROUTER)) gmgnBuy += Number(r.bnb_amount||0);
    }
    for (const r of sells) totSell += Number(r.bnb_amount||0);
    const sorted=[...perWallet.entries()].sort((a,b)=>b[1]-a[1]);
    const top1=sorted[0]?.[1]||0, top2=(sorted[0]?.[1]||0)+(sorted[1]?.[1]||0);
    console.log(`=== ${label}: 买${buys.length}笔/卖${sells.length}笔 | 买量${totBuy.toFixed(1)} 卖量${totSell.toFixed(1)} BNB | 净买比${(((totBuy-totSell)/(totBuy+totSell))*100).toFixed(0)}%`);
    console.log(`    distinct 钱包 ${perWallet.size} | top1买占比 ${(top1/totBuy*100).toFixed(0)}% | top2 ${(top2/totBuy*100).toFixed(0)}% | GMGN路由占比 ${(gmgnBuy/totBuy*100).toFixed(0)}%`);
    console.log(`    top5 钱包: ${sorted.slice(0,5).map(([w,v])=>`${w.slice(0,8)}:${v.toFixed(1)}B(${(v/totBuy*100).toFixed(0)}%)`).join(' ')}`);
  }
  // ③ 现行 buy-v2 库腿门（threshold 对照）
  const { data: lib, error: e2 } = await db.from('strategy_library')
    .select('name,version,side,legs,updated_at')
    .ilike('name','%buy%').order('updated_at',{ascending:false}).limit(8);
  if (e2) console.log('lib err:', e2.message);
  else for (const l of lib) {
    const legs = Array.isArray(l.legs)?l.legs:[l.legs];
    console.log(`=== 库 ${l.name} v${l.version} (${l.side}) 腿数=${legs.length}`);
    for (const leg of legs) {
      if (!leg || typeof leg!=='object') continue;
      const cond = leg.condition||leg.narrativeTriggerCondition||'';
      if (cond) console.log(`  [${leg.name||leg.strategyName||'?'}] ${(cond).slice(0,400)}`);
    }
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
