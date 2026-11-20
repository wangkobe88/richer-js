require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const M = require('../src/market-analysis/factor-pre-buy-check.js');
(async () => {
  const sb = dbManager.getClient();
  const addr = '0xd657ad14ec75dec1882e5a2a8d019079766a7777';
  const { data: sig } = await sb.from('strategy_signals').select('created_at').eq('experiment_id', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f').eq('token_address', addr).eq('signal_type', 'BUY').limit(1);
  const at = sig?.[0]?.created_at;
  console.log('anchor =', at);
  const { data: ev } = await sb.from('wss_events').select('block_time,platform').eq('kind', 'token_create').eq('token_address', addr).limit(1);
  console.log('token_create =', JSON.stringify(ev?.[0]));
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', addr).lte('block_time', at)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
  console.log('ticks =', ticks?.length);
  const snap = buildBuyPointSnapshot(ticks || [], { platform: ev?.[0]?.platform || 'fourmeme', totalSupply: 1e9, createdAt: ev?.[0]?.block_time }, {});
  const bd = snap.buyDerived || {};
  console.log('oversellBnb =', bd.oversellBnb, 'oversellerN =', bd.oversellerN, 'anchorWalletN =', bd.anchorWalletN);
  const r = M.evaluateFactorPreBuy(snap);
  console.log('arms =', JSON.stringify(r.arms));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
