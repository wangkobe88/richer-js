const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();
  const { data: trades, error: eT } = await client.from('trades')
    .select('*').eq('experiment_id', EXP).order('created_at', { ascending: true });
  if (eT) { console.error('trades err:', eT.message); process.exit(1); }
  const byToken = new Map();
  for (const t of (trades || [])) {
    if (!byToken.has(t.token_address)) byToken.set(t.token_address, []);
    byToken.get(t.token_address).push(t);
  }
  const summary = [];
  for (const [tok, list] of byToken) {
    let buyBnb = 0, sellBnb = 0, nBuy = 0, nSell = 0;
    for (const t of list) {
      if (t.trade_direction === 'buy') { buyBnb += Number(t.input_amount || 0); nBuy++; }
      else if (t.trade_direction === 'sell') {
        const amt = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.metadata?.amountInBnb || 0);
        sellBnb += amt; nSell++;
      }
    }
    const firstBuy = list.find(t => t.trade_direction === 'buy');
    const f = firstBuy?.metadata?.factors || {};
    summary.push({
      token: tok, sym: firstBuy?.token_symbol, nBuy, nSell,
      buyBnb: +buyBnb.toFixed(6), sellBnb: +sellBnb.toFixed(6),
      pnl: +(sellBnb - buyBnb).toFixed(6),
      buyAt: firstBuy?.executed_at || firstBuy?.created_at,
      ageSec: f.tokenAgeSec, dp: f.holderTrendDataPoints, slope: f.holderTrendSlope,
      holders: f.holderCount, price: f.currentPriceBnb, mcapUsd: f.marketCapUsd ?? f.marketCap,
      buyExecPrice: firstBuy?.unit_price,
    });
  }
  summary.sort((a, b) => a.pnl - b.pnl);
  for (const r of summary) console.log(JSON.stringify(r));
  // 首笔买 signal 的 metadata 形状（腿名/条件）
  const { data: sigs, error: eS } = await client.from('strategy_signals')
    .select('id,token_address,action,reason,metadata,created_at').eq('experiment_id', EXP).limit(200);
  if (eS) { console.error('signals err:', eS.message); process.exit(1); }
  const seen = new Set();
  for (const s of (sigs || [])) {
    if (s.action !== 'buy' || seen.has(s.token_address)) continue;
    seen.add(s.token_address);
    const md = s.metadata || {};
    console.log('SIGMD', s.token_address, JSON.stringify({ reason: s.reason, mdKeys: Object.keys(md), strategy: md.strategyName ?? md.strategy ?? md.legName, leg: md.leg ?? md.strategyLeg, cond: (md.condition || '').slice(0, 200) }));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
