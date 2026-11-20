// M4GA 单票锚窗重放（182 跑）：FP15 合并口径下 burstWaveQuality 验证
const { dbManager } = require('../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check.js');
(async () => {
  const c = await dbManager.getClient();
  const ANCHOR = new Date('2026-11-05T07:40:46Z').getTime();
  const { data: ticks } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,sender_address,trader_address,price_bnb,price_outlier')
    .eq('token_address','0xba5ed45b42479e0a75316de7bf990ec90a3e4444')
    .gte('block_time', new Date(ANCHOR-30*60*1000).toISOString())
    .lte('block_time', new Date(ANCHOR+2*60*1000).toISOString())
    .order('block_time').limit(4000);
  const rows=(ticks||[]).map(t=>({
    block_time:t.block_time, block_number:t.block_number, log_index:t.log_index,
    trade_type:t.trade_type, trader_address:t.trader_address, sender_address:t.sender_address,
    bnb_amount:Number(t.bnb_amount), token_amount:0, price_bnb:Number(t.price_bnb),
    price_outlier:t.price_outlier===true, tx_hash:'x'+t.block_number+'_'+t.log_index, quote_token:null,
  }));
  const meta={ address:'0xba5ed45b42479e0a75316de7bf990ec90a3e4444', platform:'fourmeme',
    createdAt:new Date(ANCHOR-30*60*1000).toISOString(), totalSupply:1e9 };
  const snap=buildBuyPointSnapshot(rows, meta, { anchorTickCount:rows.length, capped:false, signalInfo:{} });
  const q=snap.buyDerived.burstWaveQuality;
  console.log('burstWaveQuality:', JSON.stringify(q));
  const r=evaluateFactorPreBuy(snap);
  console.log('FP 判定: pass=', r.pass, 'reason=', r.reason, 'version=', r.version);
  const g=(r.gates||[]).find(x=>x.id==='burst_weak');
  if (g) console.log('burst_weak gate:', JSON.stringify(g));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
