#!/usr/bin/env node
// T167c 研究四：在外流通量谷值轴（用户口径修正）——famous 末卖后 Σ净在外筹码（未卖回池）的最小值
// 语义：谷值≈出清彻底完成过（筹码几乎全回池），之后的流量=新一波 → 豁免资格
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

// [前缀, pnl, 锚实验id（v2 代表实验；null=任一最早）]
const CASES = [
  ['0xee831cd1', -0.0559, null],
  ['0x0c90ea3f', -0.0351, 'c73b62be-bb1d-4acf-8002-652e5fb8a507'],
  ['0x6075e97a', -0.0333, 'c73b62be-bb1d-4acf-8002-652e5fb8a507'],
  ['0xf73e2a04', -0.0245, null],
  ['0xf63f6cd2', -0.0146, null],
  ['0xa0351815', -0.0073, null],
  ['0xc2af8c09', 0.0035, null],
  ['0xe15fa2ca', 0.0068, null],
  ['0xd23b0950', 0.0305, null],
  ['0x28ad2c7d', 1.4261, 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['0x8baf97ff', 0.0087, null],
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
  for (const [pre, pnl, expId] of CASES) {
    let seedQ = sb.from('trades').select('token_address,created_at')
      .ilike('token_address', pre + '%').eq('trade_direction', 'buy').eq('success', true)
      .order('created_at', { ascending: true }).limit(1);
    if (expId) seedQ = seedQ.eq('experiment_id', expId);
    const { data: seed } = await seedQ;
    if (!seed || !seed.length) { console.log(pre + ' 无成交'); continue; }
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
    // famous 末卖（买点前最后一笔 roster SELL）
    let lastSellTs = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (ts <= buyTs && roster.has(w) && String(r.trade_type).toLowerCase() === 'sell' && ts > lastSellTs) lastSellTs = ts;
    }
    if (!lastSellTs) { console.log(pre + ' 该锚无 famous 卖'); continue; }
    // 逐 tick 累计：在外流通 = Σ(买入token − 卖回token)（未卖回池的筹码总量）；曲线流通=Σ买入
    let outFloating = 0, circ = 0, trough = Infinity, troughTs = null, troughCirc = 0;
    let atBuy = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      if (ts > buyTs) break;
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      const amt = Number(r.token_amount || 0);
      if (isBuy) { circ += amt; outFloating += amt; } else outFloating -= amt;
      if (ts >= lastSellTs && outFloating < trough) { trough = outFloating; troughTs = ts; troughCirc = circ; }
      atBuy = outFloating;
    }
    const M = 1e6;
    const troughPct = troughCirc > 0 ? (trough / troughCirc) * 100 : null;
    out.push({ pre, pnl, trough, troughPct });
    console.log(`${pre} pnl=${pnl >= 0 ? '+' : ''}${pnl} | 谷值=${(trough / M).toFixed(1)}M(${troughPct.toFixed(1)}%当时流通) @t+${((troughTs - new Date(rows[0].block_time).getTime()) / 1000).toFixed(0)}s | 买点时在外=${(atBuy / M).toFixed(1)}M`);
  }
  console.log('\n=== 按谷值%（当时流通）排序');
  out.sort((a, b) => a.troughPct - b.troughPct);
  for (const o of out) console.log(`  谷值=${o.troughPct.toFixed(1).padStart(5)}% ${o.pnl >= 0 ? '+' : ''}${o.pnl} ${o.pre}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
