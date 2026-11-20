#!/usr/bin/env node
// T167c 研究三：老筹码残余轴铺豁免面 11 票——legacy%流通 vs pnl 分离度
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

// v2 去重票集（豁免面 10 + KEEP 1）：[前缀, pnl（v2 均值）]
const CASES = [
  ['0xee831cd1', -0.0559], ['0x0c90ea3f', -0.0351], ['0x6075e97a', -0.0333],
  ['0xf73e2a04', -0.0245], ['0xf63f6cd2', -0.0146], ['0xa0351815', -0.0073],
  ['0xc2af8c09', 0.0035], ['0xe15fa2ca', 0.0068], ['0xd23b0950', 0.0305],
  ['0x28ad2c7d', 1.4261], ['0x8baf97ff', 0.0087],
];

function loadRoster() {
  const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  const arr = Array.isArray(j) ? j : (j.wallets || j.addresses || []);
  return new Set(arr.map((x) => (typeof x === 'string' ? x.toLowerCase() : String(x.address || x.wallet || '').toLowerCase())).filter(Boolean));
}

async function main() {
  const sb = dbManager.getClient();
  const roster = loadRoster();
  const out = [];
  for (const [pre, pnl] of CASES) {
    // 全地址+买点：任一实验首笔成功买
    const { data: seed } = await sb.from('trades').select('token_address,created_at,experiment_id')
      .ilike('token_address', pre + '%').eq('trade_direction', 'buy').eq('success', true)
      .order('created_at', { ascending: true }).limit(1);
    if (!seed || !seed.length) { console.log(pre + ' 无成交（跳过——门链已拦，供给轴无消费点）'); continue; }
    const tok = seed[0].token_address, buyTs = new Date(seed[0].created_at).getTime();
    const rows = [];
    let anchor = null;
    for (;;) {
      let q = sb.from('wss_price_ticks')
        .select('block_time,trade_type,token_amount,sender_address,trader_address')
        .eq('token_address', tok).order('block_time', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('block_time', anchor);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      anchor = data[data.length - 1].block_time;
    }
    let lastSellTs = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (ts <= buyTs && roster.has(w) && String(r.trade_type).toLowerCase() === 'sell' && ts > lastSellTs) lastSellTs = ts;
    }
    if (!lastSellTs) { console.log(pre + ' 无 famous 卖'); continue; }
    const net = {}, netLS = {};
    let circ = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      if (ts > buyTs) continue;
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      const amt = Number(r.token_amount || 0);
      if (isBuy) { circ += amt; net[w] = (net[w] || 0) + amt; } else net[w] = (net[w] || 0) - amt;
      if (ts <= lastSellTs) netLS[w] = net[w];
    }
    let legacy = 0, legacyW = 0, outAbs = 0;
    for (const [w, v] of Object.entries(net)) {
      if (v <= 0) continue;
      outAbs += v;
      const l = Math.min(Math.max(netLS[w] || 0, 0), v);
      if (l > 0) { legacy += l; legacyW++; }
    }
    const legacyPct = circ > 0 ? (legacy / circ) * 100 : null;
    const outPctV = circ > 0 ? (outAbs / circ) * 100 : null;
    out.push({ pre, pnl, legacyPct, legacyW, outPct: outPctV });
    console.log(`${pre} pnl=${pnl >= 0 ? '+' : ''}${pnl} | 老筹码残余=${legacyPct === null ? '?' : legacyPct.toFixed(1) + '%流通'}/${legacyW}钱包 | 在外合计=${outPctV === null ? '?' : outPctV.toFixed(1) + '%'}`);
  }
  console.log('\n=== 按 legacy% 排序');
  out.sort((a, b) => a.legacyPct - b.legacyPct);
  for (const o of out) console.log(`  legacy=${o.legacyPct.toFixed(1).padStart(5)}% ${o.pnl >= 0 ? '+' : ''}${o.pnl} ${o.pre}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
