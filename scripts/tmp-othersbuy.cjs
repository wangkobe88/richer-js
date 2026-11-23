#!/usr/bin/env node
/** 8 票出口快照 quietExitOthersBuyBnb 分布（定线用） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const TOK = [
  ['LAB(+305%毕业)', '0x1a0810861af30ed2b85ec2c195f36fb58fc97777'],
  ['개구리씨(+404%毕业)', '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777'],
  ['湖南(平)', '0xe1fcd957c62bc2da3b8337a986710142531d7777'],
  ['ZEC(平)', '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777'],
  ['Willow(-0.4%)', '0x5cd0755bb61818c7b1f2c0dae03b83c63bd67777'],
  ['Fomies(-19%)', '0x3f7031be6094a94e8b75ad846fac6dfa1c977777'],
  ['庄周(-20%)', '0x29f4940f61456774daceed255c69873002617777'],
  ['吕吕(-26%)', '0xbda9abd9e7f9afefabfd0965c9d6f07153347777'],
];
(async () => {
  const db = dbManager.getClient();
  for (const [sym, addr] of TOK) {
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
    let val = '未定格';
    for (const t of ticks) { fa.processTick(t, { emitFactors: false }); }
    const f = fa.buildFactorMap(addr, ticks[ticks.length - 1].timestamp);
    // 取首次定格的快照（重放完后是最后一次静默的——用中途 build：改为在首个 gap 处断）
    // 简化：重放一遍在首 gap 后取值
    const fa2 = new FourMemeFactorAggregator({ logger: { info(){}, warn(){}, error(){} } });
    fa2.registerToken(addr, { createdAtMs: t0, symbol: sym, platform: ev.data[0].platform || 'flap' });
    // 引擎口径：逐 tick 找 fire 形状点（quietSpan≥60s∧surge≥0.4∧surgeSec≤30）取快照
    let got = null;
    let lastTs = null, lastTake = -Infinity;
    for (const t of ticks) {
      fa2.processTick(t, { emitFactors: false });
      if (lastTs !== null && t.timestamp - lastTs >= 1000 && t.timestamp - lastTake >= 5000) {
        const ff = fa2.buildFactorMap(addr, t.timestamp + 200);
        if (ff && ff.quietSpanMs >= 60000 && ff.quietSurgeBuyBnb >= 0.4 && ff.quietSurgeSec !== null && ff.quietSurgeSec <= 30) {
          got = ff.quietExitOthersBuyBnb;
          lastTake = t.timestamp;
        }
      }
      lastTs = t.timestamp;
    }
    console.log(`${sym.padEnd(14)} othersBuy(出口快照,剔 latch)=${got}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
