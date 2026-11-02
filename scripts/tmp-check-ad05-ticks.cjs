const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0xad05bf6f03a098ae823383fd2e479a4fd3b57777';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: ticks, error } = await client.from('wss_price_ticks')
    .select('block_number,log_index,block_time,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,sender_address,trader_address')
    .eq('token_address', TOKEN).gt('bnb_amount', 0)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(400);
  if (error) { console.error('err:', error.message); process.exit(1); }
  console.log('tick rows:', ticks.length);
  let cumBuy = 0, cumSell = 0, n = 0;
  const walletNet = {}; // sender||trader -> net tokens
  const rows = [];
  for (const t of ticks) {
    n++;
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    const isBuy = t.trade_type === 'buy';
    if (isBuy) cumBuy += t.bnb_amount; else cumSell += t.bnb_amount;
    walletNet[w] = (walletNet[w] || 0) + (isBuy ? t.token_amount : -t.token_amount);
    const price = t.price_bnb;
    // holders with net tokens × price >= 0.015 BNB (dust gate)
    let exDust = 0;
    for (const k in walletNet) if (walletNet[k] * price >= 0.015) exDust++;
    // trailing-20 net ratio (T87/88 口径: (买额-卖额)/(买额+卖额)*100)
    rows.push({ n, bt: t.block_time.slice(11,23), blk: t.block_number, li: t.log_index, type: t.trade_type ? t.trade_type[0].toUpperCase() : '?',
      bnb: +t.bnb_amount.toFixed(4), price: price ? +price.toPrecision(4) : null, cumBuy: +cumBuy.toFixed(3), exDust,
      out: t.price_outlier ? 1 : 0, w: w ? w.slice(0, 8) : '?' });
    if (n > 60) break;
  }
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
