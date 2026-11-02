const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const EXP = 'c53a703a-5b9a-4c03-a874-64e3f65fd6f8';
const TOK = process.argv[2] || '0x5ca9144433333333333333333333333333333333';
(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const c = dbManager.getClient();
  const { data: tr } = await c.from('trades').select('token_address,metadata,executed_at')
    .eq('experiment_id', EXP).eq('trade_direction', 'buy').limit(20);
  const row = tr.find(t => t.token_address.startsWith(TOK.slice(0, 8))) || tr[0];
  const tok = row.token_address;
  const tf = row.metadata?.factors?.trendFactors || {};
  console.log('tok', tok, 'execAt', row.executed_at);
  console.log('snap rating/tokenAgeSec/dp/slope:', tf.narrativeRating, tf.tokenAgeSec, tf.holderTrendDataPoints, tf.holderTrendSlope);
  const { data: ev } = await c.from('wss_events').select('block_time').eq('token_address', tok).eq('kind', 'token_create').limit(1);
  const createMs = ev?.[0] ? Date.parse(ev[0].block_time) : null;
  const { data: ticks } = await c.from('wss_price_ticks')
    .select('trade_type,trader_address,sender_address,price_bnb,price_usd,bnb_amount,token_amount,block_number,log_index,block_time,platform,quote_token')
    .eq('token_address', tok).lte('block_time', new Date(Date.parse(row.executed_at) + 300000).toISOString())
    .order('block_number', { ascending: true }).order('log_index', { ascending: true });
  const rows = (ticks || []).filter(r => (Number(r.bnb_amount) || 0) >= 0.001);
  const fa = new FourMemeFactorAggregator({}, { info(){}, warn(){}, error(){} });
  fa.registerToken(tok, { platform: 'flap', createdAtMs: createMs });
  FourMemeFactorAggregator.setNarrativeFactors(tok, { rating: tf.narrativeRating });
  const ev_ = new ConditionEvaluator();
  const CLAUSES = ['(tokenAgeSec < 90 OR tradeCount >= 25)', 'marketCap > 4.7', 'marketCap < 27',
    '(narrativeRating == 2 OR narrativeRating == 3)', 'holderTrendSlope > 0', 'top2HolderCircPct < 55',
    'top1HolderCircPct < 35', 'maxCopyWalletHolderCircPct < 20', 'famousCopyWalletCircPct < 15',
    '(buyVolumeBnb >= 1.25 AND holdersExDust >= 10)',
    '(tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40)',
    'drawdownFromHighest > -70', 'crashSpeedPctPerSec > -10'];
  const execAt = Date.parse(row.executed_at);
  let fire = null, fi = -1, okCount = 0, lastOkTs = null;
  rows.forEach((r, i) => {
    const ts = Date.parse(r.block_time);
    fa.processTick({ token_address: tok, trade_type: r.trade_type, trader_address: r.trader_address,
      sender_address: r.sender_address, price_bnb: r.price_bnb, price_usd: r.price_usd,
      bnb_amount: r.bnb_amount, token_amount: r.token_amount, block_number: r.block_number,
      log_index: r.log_index, timestamp: ts, platform: r.platform, quote_token: r.quote_token }, { emitFactors: false });
    const f = fa.buildFactorMap(tok, ts);
    if (ts <= execAt) { fire = { f, ts }; fi = i; }
    if (ev_.evaluate(CLAUSES.reduce((a, cl) => a && ev_.evaluate(cl, f), true) && '(tokenAgeSec < 90 OR tradeCount >= 25) AND marketCap > 4.7 AND marketCap < 27 AND (narrativeRating == 2 OR narrativeRating == 3) AND holderTrendSlope > 0 AND top2HolderCircPct < 55 AND top1HolderCircPct < 35 AND maxCopyWalletHolderCircPct < 20 AND famousCopyWalletCircPct < 15 AND (buyVolumeBnb >= 1.25 AND holdersExDust >= 10) AND (tradesNetBuyRatioLongWin >= 0 AND tradesNetBuyRatioShortWin >= 40) AND drawdownFromHighest > -70 AND crashSpeedPctPerSec > -10', f)) { okCount++; lastOkTs = ts; }
  });
  console.log('fire ts<=exec idx', fi, 'oldOk tick count', okCount, 'lastOk at', lastOkTs && new Date(lastOkTs).toISOString());
  if (fire) {
    for (const cl of CLAUSES) {
      const v = ev_.evaluate(cl, fire.f);
      console.log(v ? '  PASS' : '  FAIL', cl);
    }
    const keys = ['tokenAgeSec','tradeCount','marketCap','narrativeRating','holderTrendSlope','top2HolderCircPct','top1HolderCircPct','maxCopyWalletHolderCircPct','famousCopyWalletCircPct','buyVolumeBnb','holdersExDust','tradesNetBuyRatioLongWin','tradesNetBuyRatioShortWin','drawdownFromHighest','crashSpeedPctPerSec'];
    console.log('fire factors:', keys.map(k => `${k}=${fire.f[k]}`).join(' '));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
