#!/usr/bin/env node
/** T225 review：三票 latch 钱包全史追踪 + top2/top3 行为摘要（老鼠仓形状取证） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOK = [
  ['必孕套', '0x0ef414b4b1196c597163208966a1ff991b927777'],
  ['Fomies', '0x3f7031be6094a94e8b75ad846fac6dfa1c977777'],
  ['WONDER', '0xb8446d58f2b97f83833e33792c0d6b80f5e17777'],
];
(async () => {
  const db = dbManager.getClient();
  for (const [sym, addr] of TOK) {
    const ev = await db.from('wss_events').select('block_time').eq('token_address', addr).eq('kind', 'token_create').limit(1);
    const t0 = new Date(ev.data[0].block_time).getTime();
    let raw = []; let fromId = 0;
    for (;;) {
      const r = await db.from('wss_price_ticks')
        .select('id, trade_type, trader_address, sender_address, price_bnb, bnb_amount, token_amount, block_time, block_number, log_index')
        .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (r.error) throw new Error(r.error.message);
      if (!r.data.length) break;
      raw = raw.concat(r.data); fromId = r.data[r.data.length - 1].id;
      if (r.data.length < 1000) break;
    }
    raw.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    // latch + 出口快照 + top2/top3
    const pos = new Map(); const buyBnb = new Map(); const sellBnb = new Map();
    let latch = null, lastTs = null, snapped = false, top = [];
    for (const row of raw) {
      const ts = new Date(row.block_time).getTime();
      if (lastTs !== null && ts - lastTs >= 60000 && !snapped) {
        snapped = true;
        top = [...pos.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
      }
      const w = row.sender_address || row.trader_address;
      if (w && Number(row.token_amount) > 0) {
        pos.set(w, (pos.get(w) || 0) + (row.trade_type === 'buy' ? Number(row.token_amount) : -Number(row.token_amount)));
        if (row.trade_type === 'buy') buyBnb.set(w, (buyBnb.get(w) || 0) + Number(row.bnb_amount));
        else sellBnb.set(w, (sellBnb.get(w) || 0) + Number(row.bnb_amount));
        if (row.trade_type === 'buy' && !latch && Number(row.bnb_amount) >= 0.3) latch = { wallet: w, tokens: Number(row.token_amount) };
      }
      lastTs = ts;
    }
    const CONST = 5.546338e-9;
    console.log(`\n===== ${sym} ${addr.slice(0, 10)}（出口 top3: ${top.join(', ')}）=====`);
    // latch 逐笔
    console.log(`-- latch=${latch.wallet.slice(0, 10)}（首笔 ${latch.tokens / 1e6}M 枚）全史逐笔 --`);
    let net = 0;
    for (const row of raw) {
      const w = row.sender_address || row.trader_address;
      if (w !== latch.wallet || !(Number(row.token_amount) > 0)) continue;
      const sec = (new Date(row.block_time).getTime() - t0) / 1000;
      const d = row.trade_type === 'buy' ? Number(row.token_amount) : -Number(row.token_amount);
      net += d;
      console.log(`  +${String(Math.round(sec)).padStart(6)}s ${row.trade_type.padEnd(4)} bnb=${Number(row.bnb_amount).toFixed(4).padStart(7)} px=${Number(row.price_bnb).toExponential(3)} (+${(Number(row.price_bnb) / CONST * 100 - 100).toFixed(1).padStart(6)}%) → 净${(net / 1e6).toFixed(2)}M (${(net / latch.tokens * 100).toFixed(0)}%首笔)`);
    }
    console.log(`  latch 终态: ${(net / 1e6).toFixed(2)}M 枚（${(net / latch.tokens * 100).toFixed(1)}% 首笔量）| 累计买 ${(buyBnb.get(latch.wallet) || 0).toFixed(3)}B 卖回 ${(sellBnb.get(latch.wallet) || 0).toFixed(3)}B`);
    // top2/top3 摘要
    for (const w of top.slice(1)) {
      if (!w) continue;
      console.log(`  top钱包 ${w.slice(0, 10)}: 买 ${(buyBnb.get(w) || 0).toFixed(3)}B / 卖 ${(sellBnb.get(w) || 0).toFixed(3)}B / 终态净 ${((pos.get(w) || 0) / 1e6).toFixed(2)}M`);
    }
    // 价格峰/末
    let peak = 0, peakSec = 0;
    for (const row of raw) { const p = Number(row.price_bnb); if (p > peak) { peak = p; peakSec = (new Date(row.block_time).getTime() - t0) / 1000; } }
    const last = raw[raw.length - 1];
    console.log(`  全史: ${raw.length} 笔 | 峰价 +${(peak / CONST * 100 - 100).toFixed(1)}%@+${Math.round(peakSec)}s | 末价 +${(Number(last.price_bnb) / CONST * 100 - 100).toFixed(1)}%`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
