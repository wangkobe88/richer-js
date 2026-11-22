'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FA = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
(async () => {
  const sb = dbManager.getClient();
  const [{ data: pack }, { data: rows, error }] = await Promise.all([
    sb.from('strategy_library').select('definition').eq('name', 'trading-standard-v1').order('version', { ascending: false }).limit(1),
    sb.from('wss_price_ticks')
      .select('block_time, block_number, log_index, trade_type, bnb_amount, token_amount, price_bnb, sender_address, trader_address, tx_hash, price_outlier')
      .eq('token_address', ADDR)
      .gte('block_time', '2026-10-03T11:26:50Z')
      .lt('block_time', '2026-10-03T11:40:00Z')
      .order('block_time', { ascending: true }).limit(1000),
  ]);
  if (error) throw new Error(error.message);
  const legs = pack[0].definition.buyLegs.filter(l => l.signalGate).map(l => ({ id: l.id, buyPhase: l.buyPhase, cond: l.condition }));
  console.log('signalGate 腿数:', legs.length, legs.map(l => l.id).join(','));
  const ticks = rows.map(r => ({
    token_address: ADDR, trade_type: r.trade_type, trader_address: r.trader_address,
    sender_address: r.sender_address, price_bnb: Number(r.price_bnb), price_usd: null,
    bnb_amount: Number(r.bnb_amount), token_amount: r.token_amount == null ? null : Number(r.token_amount),
    block_number: r.block_number, log_index: r.log_index, tx_hash: r.tx_hash,
    price_outlier: r.price_outlier, timestamp: Date.parse(r.block_time), platform: 'flap',
  }));
  const fa = new FA({ fourmemeWs: { factorParams: { netBuyWinTrades: 12 } } }, console);
  fa.registerToken(ADDR, { createdAtMs: 1791026810000, totalSupply: 1e9, platform: 'flap', symbol: '扁头' });
  const ev = new ConditionEvaluator();
  const fire = new Map(); const t0 = 1791026810000;
  for (const t of ticks) {
    fa.processTick(t, { emitFactors: false });
    const fm = fa.buildFactorMap(ADDR, t.timestamp);
    if (!fm) continue;
    for (const leg of legs) {
      if (ev.evaluate(leg.cond, fm)) {
        const k = leg.id;
        if (!fire.has(k)) fire.set(k, []);
        const arr = fire.get(k); if (arr.length < 3) arr.push(((t.timestamp - t0) / 1000).toFixed(0) + 's');
      }
    }
  }
  for (const [id, ts] of fire) console.log('触发腿:', id, '@', ts.join(','));
  console.log('触发腿总数:', fire.size, '/', legs.length);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
