#!/usr/bin/env node
/** 独舞票出口时刻 top3 钱包分解（单地址 vs 多地址分持的事实） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = [
  ['LAB', '0x1a0810861af30ed2b85ec2c195f36fb58fc97777'],
  ['개구리씨', '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777'],
  ['吕吕', '0xbda9abd9e7f9afefabfd0965c9d6f07153347777'],
  ['必孕套', '0x0ef414b4b1196c597163208966a1ff991b927777'],
  ['庄周', '0x29f4940f61456774daceed255c69873002617777'],
  ['Fomies', '0x3f7031be6094a94e8b75ad846fac6dfa1c977777'],
  ['宿命对视', '0x82ad3f5f083a62d2f7dbb8b1c762d2bb2be27777'],
  ['Willow', '0x5cd0755bb61818c7b1f2c0dae03b83c63bd67777'],
  ['WONDER', '0xb8446d58f2b97f83833e33792c0d6b80f5e17777'],
  ['湖南', '0xe1fcd957c62bc2da3b8337a986710142531d7777'],
  ['ZEC', '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777'],
  ['逆向一切', '0x0818d5a38cf7289da1834ee941f4140f3ccb7777'],
  ['躺椅', '0xb347441293b11b2d4a87dacf8eda8e1d06417777'],
  ['蜈蚣', '0x5fcc5d3fe73217bfbd84b07ef7265d94a0567777'],
];
(async () => {
  const db = dbManager.getClient();
  for (const [sym, addr] of TOK) {
    let raw = []; let fromId = 0;
    for (;;) {
      const r = await db.from('wss_price_ticks')
        .select('id, trade_type, trader_address, sender_address, bnb_amount, token_amount, block_number, block_time, log_index')
        .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (r.error) throw new Error(r.error.message);
      if (!r.data.length) break;
      raw = raw.concat(r.data); fromId = r.data[r.data.length - 1].id;
      if (r.data.length < 1000) break;
    }
    raw.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    const pos = new Map(); let latch = null; let lastTs = null; let snapped = false;
    let top = null;
    for (const row of raw) {
      const ts = new Date(row.block_time).getTime();
      if (lastTs !== null && ts - lastTs >= 60000 && !snapped) {
        snapped = true;
        const arr = [...pos.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        const sum = arr.reduce((s, [, v]) => s + v, 0);
        top = { sum, arr: arr.slice(0, 3), latchW: latch ? latch.wallet : null, latchBnb: latch ? 0 : 0 };
        break; // 出口快照后不再需要继续
      }
      const w = row.sender_address || row.trader_address;
      if (w && Number(row.token_amount) > 0) {
        pos.set(w, (pos.get(w) || 0) + (row.trade_type === 'buy' ? Number(row.token_amount) : -Number(row.token_amount)));
        if (row.trade_type === 'buy' && !latch && Number(row.bnb_amount) >= 0.3) latch = { wallet: w };
      }
      lastTs = ts;
    }
    if (!top) { console.log(`${sym.padEnd(8)} 无出口快照`); continue; }
    const parts = top.arr.map(([w, v], i) => `${w.slice(0, 8)}=${(v / top.sum * 100).toFixed(0)}%${top.latchW && w === top.latchW ? '★latch' : ''}`);
    console.log(`${sym.padEnd(8)} top3: ${parts.join(' | ')}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
