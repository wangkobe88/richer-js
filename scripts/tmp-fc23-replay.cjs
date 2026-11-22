'use strict';
// 0xfc23 一姐 FA 真重放：链上真序喂食，逐 tick 评 P1/P2/P9 条件，定位 15:43:02 无信号真凶
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
(async () => {
  const sb = dbManager.getClient();
  const [{ data: ticks, error }, { data: pack }] = await Promise.all([
    sb.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,block_number,tx_hash,log_index,price_outlier')
      .eq('token_address', TOKEN)
      .gte('block_time', '2026-10-04T15:40:40Z').lte('block_time', '2026-10-04T15:43:40Z')
      .order('block_time', { ascending: true }).limit(3000),
    sb.from('strategy_library').select('definition')
      .eq('name', 'trading-standard-v1').order('version', { ascending: false }).limit(1),
  ]);
  if (error) throw new Error(error.message);
  const legs = ((pack || [])[0].definition || {}).buyLegs || [];
  const COND = { P1: legs[0].condition, P2: legs[1].condition, P9: legs[9].condition };
  const ev = new ConditionEvaluator();
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(TOKEN, { createdAtMs: Date.parse('2026-10-04T15:40:48Z'), totalSupply: 1e9, symbol: '一姐', platform: 'flap', creatorAddress: null });
  const rows = (ticks || []).slice().sort((a, b) =>
    (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
  console.log(`喂食 ${rows.length} 行（链上真序）`);
  const marks = ['15:42:04', '15:42:32', '15:43:02', '15:43:03', '15:43:05', '15:43:08', '15:43:12', '15:43:18', '15:43:25'];
  let i = 0;
  for (const r of rows) {
    i++;
    if (r.price_outlier || !r.price_bnb) continue;
    fa.processTick({
      token_address: TOKEN, trade_type: r.trade_type,
      trader_address: r.trader_address, sender_address: r.sender_address,
      price_bnb: r.price_bnb, price_usd: null,
      bnb_amount: Number(r.bnb_amount), token_amount: Number(r.bnb_amount) / Number(r.price_bnb),
      block_number: r.block_number, timestamp: Date.parse(r.block_time),
      tx_hash: r.tx_hash, log_index: r.log_index,
    }, {});
    const t = r.block_time.slice(11, 19);
    if (!marks.includes(t)) continue;
    const fm = fa.buildFactorMap(TOKEN, Date.parse(r.block_time));
    const res = {};
    for (const [n, c] of Object.entries(COND)) { try { res[n] = ev.evaluate(c, fm); } catch (e) { res[n] = 'ERR:' + e.message.slice(0, 40); } }
    console.log(`@${t}#${i} ${r.trade_type} ${Number(r.bnb_amount).toFixed(3)}B | tradeCount=${fm.tradeCount} ExDust=${fm.holdersExDust} buyVol=${Number(fm.buyVolumeBnb).toFixed(2)} curVs=${fm.currentVsLaunchPct === null ? 'null' : fm.currentVsLaunchPct.toFixed(1)} act=${Number(fm.actTotalBnb).toFixed(2)} sinceFirst=${fm.sinceFirstTradeSec} age=${fm.tokenAgeSec} crew=${fm.cheatCrewBuyBnb} | P1=${res.P1} P2=${res.P2} P9=${res.P9}`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
