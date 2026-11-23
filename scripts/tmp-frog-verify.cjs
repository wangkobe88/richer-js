#!/usr/bin/env node
/** 개구리씨 引擎口径(defer 两阶段)重放：独舞腿四键评估 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const TOK = '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777';
const CREATE = new Date('2026-10-12T00:00:00Z').getTime(); // 占位，下面用真值
(async () => {
  const db = dbManager.getClient();
  const ev = await db.from('wss_events').select('block_time, payload').eq('token_address', TOK).eq('kind', 'token_create').limit(1);
  const t0 = new Date(ev.data[0].block_time).getTime();
  let raw = []; let fromId = 0;
  while (true) {
    const r = await db.from('wss_price_ticks')
      .select('id, trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_number, block_time, log_index, price_outlier, platform, quote_token')
      .eq('token_address', TOK).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (r.error) throw new Error(r.error.message);
    if (!r.data.length) break;
    raw = raw.concat(r.data); fromId = r.data[r.data.length - 1].id;
    if (r.data.length < 1000) break;
  }
  raw.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  const ticks = raw.map(row => ({
    token_address: TOK, trade_type: row.trade_type, trader_address: row.trader_address,
    sender_address: row.sender_address || null, price_bnb: Number(row.price_bnb), price_usd: null,
    bnb_amount: Number(row.bnb_amount || 0), token_amount: Number(row.token_amount || 0),
    block_number: row.block_number, timestamp: new Date(row.block_time).getTime(),
    tx_hash: row.tx_hash || null, log_index: row.log_index, price_outlier: row.price_outlier || false,
    platform: row.platform, quote_token: row.quote_token || null,
  }));
  const fa = new FourMemeFactorAggregator({ logger: console });
  fa.registerToken(TOK, { createdAtMs: t0, symbol: 'FROG', platform: (raw[0] || {}).platform || 'flap' });
  const ce = new ConditionEvaluator();
  // defer 两阶段：价格段先（emitFactors:false）→ wallet 段后
  let cluster = null; let lastTs = null;
  for (const t of ticks) {
    if (cluster === null || t.timestamp - cluster.lastTs > 1000) {
      if (cluster) {
        const f = fa.buildFactorMap(TOK, cluster.lastTs + 200);
        if (f && f.quietSpanMs >= 60000 && f.quietSurgeBuyBnb >= 0.4) {
          console.log(`fire 候选 @+${((cluster.lastTs + 200 - t0) / 1000).toFixed(1)}s:`,
            `big=${f.quietExitBigBuyers} tailBuyEx=${f.quietExitTailBuyBnbEx} endSell=${f.quietExitEndWithSell} latchHold=${f.quietExitLatchHoldPct}`,
            `curVs=${f.currentVsLaunchPct} exitVs=${f.quietExitVsLaunchPct} surge=${f.quietSurgeBuyBnb} surgeSec=${f.quietSurgeSec && f.quietSurgeSec.toFixed(1)}`);
        }
      }
      cluster = { lastTs: t.timestamp };
    } else cluster.lastTs = Math.max(cluster.lastTs, t.timestamp);
    const res = fa.processTick(t, { emitFactors: false, deferWallet: true });
    if (res && res.priceAccepted !== undefined) fa.applyWalletTick(t);
    lastTs = t.timestamp;
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
