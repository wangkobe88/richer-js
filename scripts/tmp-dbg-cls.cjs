const { buildBuyPointSnapshot, bpTEndOf } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');
const at = (dt) => new Date(1790000000000 + dt * 1000).toISOString();
function row(dt, side, wallet, bnb, price, tok, opts = {}) {
  return { block_time: at(dt), block_number: opts.block ?? 1000 + dt, log_index: opts.li ?? 0,
    trade_type: side === 'BUY' ? 'buy' : 'sell', trader_address: wallet, sender_address: wallet,
    bnb_amount: bnb, token_amount: tok, price_bnb: price, price_outlier: false,
    tx_hash: '0x' + String(1e6 + dt * 10), quote_token: null };
}
const W_Q='0x'+'33'.repeat(20), W_R='0x'+'44'.repeat(20), W_P='0x'+'55'.repeat(20);
const rows = [
  row(10,'BUY',W_Q,0.198,1.0*1e-9,2e8),
  row(50,'BUY',W_R,0.3,1.05*1e-9,2.9e8),
  row(60,'SELL',W_R,0.3,1.05*1e-9,2.9e8),
  row(200,'BUY',W_P,0.2,1.1*1e-9,1.8e8),
  row(215,'BUY',W_P,0.05,1.12*1e-9,4.5e6),
];
const meta = { address:'0xt', symbol:'T', name:null, platform:null, createdAt:null, totalSupply:1e9, creatorAddress:null, quoteToken:null };
const snap = buildBuyPointSnapshot(rows, meta, {});
const tEnd = bpTEndOf(snap.ticks);
console.log('tEnd=', tEnd, 'wallets=', snap.wallets.length);
for (const w of snap.wallets) console.log(w.w.slice(0,8), 'maxBuy', w.maxBuyBnb, 'net', (w.buyBnb-w.sellBnb).toFixed(4), 'lastAct', w.lastActDt, '→', FPC.classifyWallet(w, tEnd));
