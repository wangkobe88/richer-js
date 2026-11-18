// 一次性诊断：bt-v141 两票 famous 极早进场合迹取证
// 0x288b…7777 (거침없이) + 0x13cc…7777 —— famous 买卖逐笔 + 全场价格拱
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
const path = require('path');

const TOKENS = [
  '0x288b3aad44de17174bb815133355583c7d717777',
  '0x13ccc4b96a0561201211e7d37b1352d03ed37777',
];

function loadFamous() {
  const p = path.resolve(__dirname, '..', 'config', 'rosters', 'famous-copy-wallets.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return new Set((j.wallets || []).map(w => (typeof w === 'string' ? w : w.address).toLowerCase()));
}

(async () => {
  const c = await dbManager.getClient();
  const famous = loadFamous();
  console.log(`famous roster v${JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','config','rosters','famous-copy-wallets.json'),'utf8')).version}: ${famous.size} 址`);

  for (const ADDR of TOKENS) {
    console.log(`\n================= ${ADDR} =================`);
    const { data: creates } = await c.from('wss_events')
      .select('block_time,payload').eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
    const t0 = new Date(creates?.[0]?.block_time).getTime();
    console.log(`出生: ${creates?.[0]?.block_time} name=${(creates?.[0]?.payload||{}).name} symbol=${(creates?.[0]?.payload||{}).symbol}`);

    // 单票全量 ticks（block_time 升序，链上真序近似）
    const { data: ticks, error } = await c.from('wss_price_ticks')
      .select('block_time,trader_address,sender_address,trade_type,bnb_amount,price_bnb,price_outlier')
      .eq('token_address', ADDR)
      .order('block_time', { ascending: true })
      .limit(20000);
    if (error) { console.log('tick err', error.message); continue; }
    console.log(`ticks: ${ticks.length}`);

    const wallet = t => (t.sender_address || t.trader_address || '').toLowerCase();
    let totBuy = 0, totSell = 0;
    let famBuy = 0, famSell = 0;
    const famRows = [];
    let firstPrice = null, maxPrice = 0, maxPriceAt = null, lastPrice = null, lastAt = null;
    for (const t of ticks) {
      const p = t.price_bnb;
      if (p && !t.price_outlier) {
        if (firstPrice == null) firstPrice = p;
        if (p > maxPrice) { maxPrice = p; maxPriceAt = t.block_time; }
        lastPrice = p; lastAt = t.block_time;
      }
      const isBuy = t.trade_type === 'buy';
      if (isBuy) totBuy += t.bnb_amount; else totSell += t.bnb_amount;
      const w = wallet(t);
      if (famous.has(w)) {
        if (isBuy) famBuy += t.bnb_amount; else famSell += t.bnb_amount;
        const rel = ((new Date(t.block_time).getTime() - t0) / 1000).toFixed(0);
        const vsLaunch = firstPrice ? ((p / firstPrice - 1) * 100).toFixed(1) : '?';
        famRows.push({ rel: +rel, side: isBuy ? 'BUY' : 'SELL', bnb: t.bnb_amount, w: w.slice(0, 8), vs: vsLaunch });
      }
    }
    famRows.sort((a, b) => a.rel - b.rel);
    console.log(`全场: 买=${totBuy.toFixed(2)}B 卖=${totSell.toFixed(2)}B | 首价=${firstPrice?.toExponential(3)} 峰=${(maxPrice/firstPrice*100-100).toFixed(0)}% @+${((new Date(maxPriceAt).getTime()-t0)/60000).toFixed(1)}min 尾=${((lastPrice/firstPrice*100-100).toFixed(0))}% @+${((new Date(lastAt).getTime()-t0)/60000).toFixed(1)}min`);
    console.log(`famous 合计: 买=${famBuy.toFixed(3)}B 卖=${famSell.toFixed(3)}B 净=${(famBuy-famSell).toFixed(3)}B`);
    console.log('famous 逐笔（relSec/方向/BNB/钱包/较首价%）:');
    for (const r of famRows.slice(0, 40)) console.log(`  +${r.rel}s ${r.side} ${r.bnb.toFixed(3)}B ${r.w} vs=${r.vs}%`);
    if (famRows.length > 40) console.log(`  …共 ${famRows.length} 笔`);
  }
  process.exit(0);
})().catch(err => { console.error('ERR', err.message); process.exit(1); });
