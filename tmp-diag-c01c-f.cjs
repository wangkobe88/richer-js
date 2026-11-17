require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');
const ADDR = '0xc01c4f60900a1f7e900f6bb3e7569c9d03647777';
const ANCHOR = new Date('2026-11-03T07:34:54Z').getTime();
(async () => {
  const db = dbManager.getClient();
  const { data: rows, error } = await db
    .from('wss_price_ticks')
    .select('block_time,bnb_amount,trade_type,block_number,sender_address,trader_address')
    .eq('token_address', ADDR)
    .order('block_time', { ascending: true })
    .limit(3000);
  if (error) { console.log('ERR', error.message); process.exit(1); }
  console.log('total ticks:', (rows||[]).length);
  const win = (rows||[]).filter(r => new Date(r.block_time).getTime() <= ANCHOR);
  console.log('ticks <= anchor:', win.length);
  if (!win.length) process.exit(0);
  const t0 = new Date(win[0].block_time).getTime();
  const tEnd = new Date(win[win.length-1].block_time).getTime();
  console.log('window span:', ((tEnd-t0)/1000).toFixed(1) + 's', 'from', win[0].block_time, 'to', win[win.length-1].block_time);
  const spanSec = (tEnd - t0) / 1000;
  // 全窗量级
  let buyBnb=0, sellBnb=0, buys=0, sells=0;
  for (const r of win) { if (r.trade_type === 'buy') { buyBnb += Number(r.bnb_amount); buys++; } else { sellBnb += Number(r.bnb_amount); sells++; } }
  console.log('full window: buy', buyBnb.toFixed(4), 'BNB /', buys, 'txs | sell', sellBnb.toFixed(4), 'BNB /', sells, 'txs |', (buyBnb+sellBnb).toFixed(4), 'total |', (buyBnb+sellBnb)/(spanSec/60+1e-9), 'BNB/min');
  // 尾窗七键口径
  const tail10 = win.filter(r => new Date(r.block_time).getTime() > tEnd - 10000);
  const tail5 = win.filter(r => new Date(r.block_time).getTime() > tEnd - 5000);
  const pre20 = win.filter(r => { const t=new Date(r.block_time).getTime(); return t > tEnd - 25000 && t <= tEnd - 5000; });
  const t10buy = tail10.filter(r=>r.trade_type === 'buy'), t10sell = tail10.filter(r=>(r.trade_type !== 'buy'));
  const t5buy = tail5.filter(r=>r.trade_type === 'buy'), t5sell = tail5.filter(r=>(r.trade_type !== 'buy'));
  const sellWallets = new Set(t10sell.map(r => r.sender_address || r.trader_address));
  const buyWallets = new Set(t10buy.map(r => r.sender_address || r.trader_address));
  console.log('\nnearTail10: tickN=' + tail10.length, '| sellWallets=' + sellWallets.size, '| bnbPerMin=' + (tail10.reduce((a,r)=>a+Number(r.bnb_amount),0)*6).toFixed(3));
  console.log('  tail10 buy:', t10buy.length, 'tx', t10buy.reduce((a,r)=>a+Number(r.bnb_amount),0).toFixed(4), 'BNB (' + buyWallets.size + ' wallets) | sell:', t10sell.length, 'tx', t10sell.reduce((a,r)=>a+Number(r.bnb_amount),0).toFixed(4), 'BNB');
  console.log('nearTail5: tickN=' + tail5.length, '| buyN=' + t5buy.length, '| buyBnb=' + t5buy.reduce((a,r)=>a+Number(r.bnb_amount),0).toFixed(4), '| sell:', t5sell.length, 'tx', t5sell.reduce((a,r)=>a+Number(r.bnb_amount),0).toFixed(4), 'BNB');
  console.log('nearPre20 bnbPerMin=', (pre20.reduce((a,r)=>a+Number(r.bnb_amount),0)*3).toFixed(3));
  // 最后 30s 时间线
  console.log('\n--- last 30s timeline ---');
  const last30 = win.filter(r => new Date(r.block_time).getTime() > tEnd - 30000);
  for (const r of last30) {
    const t = new Date(r.block_time);
    const off = ((t.getTime()-tEnd)/1000).toFixed(1);
    console.log(' t-' + String(off).padStart(6), r.trade_type === 'buy' ? 'BUY ' : 'SELL', Number(r.bnb_amount).toFixed(4), (r.sender_address||r.trader_address||'').slice(0,10));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
