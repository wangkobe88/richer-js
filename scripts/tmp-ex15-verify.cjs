#!/usr/bin/env node
/** 8 票 fire 时刻 actTotalBnb60Ex15 分布（用户口径死透判据） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const TOK = [
  ['LAB', '0x1a0810861af30ed2b85ec2c195f36fb58fc97777', 283],
  ['개구리씨', '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777', 113],
  ['湖南', '0xe1fcd957c62bc2da3b8337a986710142531d7777', 323],
  ['ZEC', '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777', 18],
  ['Willow', '0x5cd0755bb61818c7b1f2c0dae03b83c63bd67777', 122],
  ['Fomies', '0x3f7031be6094a94e8b75ad846fac6dfa1c977777', 84],
  ['庄周', '0x29f4940f61456774daceed255c69873002617777', 568],
  ['吕吕', '0xbda9abd9e7f9afefabfd0965c9d6f07153347777', 68],
];
(async () => {
  const db = dbManager.getClient();
  for (const [sym, addr, fireSec] of TOK) {
    const ev = await db.from('wss_events').select('block_time, platform').eq('token_address', addr).eq('kind', 'token_create').limit(1);
    const t0 = new Date(ev.data[0].block_time).getTime();
    let raw = []; let fromId = 0;
    for (;;) {
      const r = await db.from('wss_price_ticks')
        .select('id, trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_number, block_time, log_index, price_outlier, platform, quote_token')
        .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (r.error) throw new Error(r.error.message);
      if (!r.data.length) break;
      raw = raw.concat(r.data); fromId = r.data[r.data.length - 1].id;
      if (r.data.length < 1000) break;
    }
    raw.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    const ticks = raw.map(row => ({
      token_address: addr, trade_type: row.trade_type, trader_address: row.trader_address,
      sender_address: row.sender_address || null, price_bnb: Number(row.price_bnb), price_usd: null,
      bnb_amount: Number(row.bnb_amount || 0), token_amount: Number(row.token_amount || 0),
      block_number: row.block_number, timestamp: new Date(row.block_time).getTime(),
      tx_hash: null, log_index: row.log_index, price_outlier: row.price_outlier || false,
      platform: row.platform, quote_token: row.quote_token || null,
    }));
    const fa = new FourMemeFactorAggregator({ logger: { info(){}, warn(){}, error(){} } });
    fa.registerToken(addr, { createdAtMs: t0, symbol: sym, platform: ev.data[0].platform || 'flap' });
    let f = null;
    for (const t of ticks) {
      if (t.timestamp > t0 + fireSec * 1000 + 1200) break;
      fa.processTick(t, { emitFactors: false });
    }
    f = fa.buildFactorMap(addr, t0 + fireSec * 1000 + 200);
    console.log(`${sym.padEnd(8)} fire@${fireSec}s act15=${f.actTotalBnb15s} act60=${f.actTotalBnb60s} **60Ex15=${(f.actTotalBnb60Ex15 !== null ? f.actTotalBnb60Ex15.toFixed(4) : 'null')}**`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
