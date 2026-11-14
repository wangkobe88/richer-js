// 一次性（182 跑）：28ad v95 07:16:00 锚窗 ticks 吞吐+famousTraces——BP65 薄盘臂是否语义内吞入。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const ADDR = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const FAMOUS = require('../../config/rosters/famous-copy-wallets.json');
async function main() {
  const sb = await dbManager.getClient();
  const { data: sigs } = await sb.from('strategy_signals')
    .select('created_at').eq('experiment_id', V95).eq('signal_type', 'BUY')
    .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(1);
  const anchorMs = Date.parse(sigs[0].created_at);
  // 锚窗拉数（service 同款：anchorCountAt 行数）
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(3000);
  const rows = (ticks || []).filter((r) => Date.parse(r.block_time) <= anchorMs);
  console.log(`锚=${sigs[0].created_at.slice(11,19)} anchorTickCount=${rows.length}`);
  let buyN = 0, buyBnb = 0, sellBnb = 0;
  const walletBuy = new Map(), walletSell = new Map();
  for (const r of rows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    const b = Number(r.bnb_amount || 0);
    if (r.trade_type === 'buy') { buyN++; buyBnb += b; walletBuy.set(w, (walletBuy.get(w) || 0) + b); }
    else { sellBnb += b; walletSell.set(w, (walletSell.get(w) || 0) + b); }
  }
  console.log(`锚窗买入 ${buyN} 笔 ${buyBnb.toFixed(2)} BNB / 卖出 ${sellBnb.toFixed(2)} BNB —— ${buyBnb < 5 ? '薄盘(<5) → BP65 薄盘臂域' : '厚盘(≥5) → 不该落薄盘臂'}`);
  const famList = Array.isArray(FAMOUS) ? FAMOUS : (FAMOUS.wallets || FAMOUS.addresses || []);
  console.log(`famous roster ${famList.length} 址：`);
  for (const f of famList) {
    const a = String(typeof f === 'string' ? f : (f.address || f.wallet || '')).toLowerCase();
    if (!a) continue;
    const b = walletBuy.get(a) || 0, s = walletSell.get(a) || 0;
    if (b > 0 || s > 0) console.log(`  ${a} 买 ${b.toFixed(4)} 卖 ${s.toFixed(4)} 净 ${(b - s).toFixed(4)} 占买 ${(b / buyBnb * 100).toFixed(1)}%`);
  }
  // 前列买家
  const top = [...walletBuy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  console.log('前列买家：' + top.map(([w, b]) => `${w.slice(0, 8)}…${b.toFixed(2)}B(${(b / buyBnb * 100).toFixed(1)}%)`).join(' '));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
