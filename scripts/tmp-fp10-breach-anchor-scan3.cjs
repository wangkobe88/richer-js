#!/usr/bin/env node
// FP10/T167b 面验证 v3：方向 B 分离度——豁免成交票「famous 末卖→买点」窗口新买入量
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

// v2 输出的去重票集（FULL 10 + KEEP 1）
const TICKETS = [
  { tok: '0xee831cd1', full: true, avg: -0.0559 },
  { tok: '0x0c90ea3f', full: true, avg: -0.0351 },
  { tok: '0x6075e97a', full: true, avg: -0.0333 },
  { tok: '0xf73e2a04', full: true, avg: -0.0245 },
  { tok: '0xf63f6cd2', full: true, avg: -0.0146 },
  { tok: '0xa0351815', full: true, avg: -0.0073 },
  { tok: '0xc2af8c09', full: true, avg: 0.0035 },
  { tok: '0xe15fa2ca', full: true, avg: 0.0068 },
  { tok: '0xd23b0950', full: true, avg: 0.0305 },
  { tok: '0x28ad2c7d', full: true, avg: 1.4261 },
  { tok: '0x8baf97ff', full: false, avg: 0.0087 },
];

function loadRoster() {
  const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  const arr = Array.isArray(j) ? j : (j.wallets || j.addresses || []);
  return new Set(arr.map((x) => (typeof x === 'string' ? x.toLowerCase() : String(x.address || x.wallet || '').toLowerCase())).filter(Boolean));
}

async function main() {
  const sb = dbManager.getClient();
  const roster = loadRoster();

  // 每票：找成交信号（BUY、factorCheck 有 fam_low_exit 豁免域内）锚时刻 + famous 末卖时刻 → 窗口买入
  for (const t of TICKETS) {
    // token 全地址：从信号表按前缀匹配不行，用 trades 表前缀也不行——先取一条信号反查全地址
    const { data: seed } = await sb.from('strategy_signals').select('token_address,experiment_id')
      .like('token_address', t.tok + '%').eq('signal_type', 'BUY').limit(1);
    if (!seed || !seed.length) { console.log(t.tok + ' 未找到'); continue; }
    const token = seed[0].token_address;

    // ticks 全量
    const rows = [];
    let anchor = null;
    for (;;) {
      let q = sb.from('wss_price_ticks')
        .select('block_time,trade_type,bnb_amount,sender_address,trader_address')
        .eq('token_address', token).order('block_time', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('block_time', anchor);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      anchor = data[data.length - 1].block_time;
    }
    // famous 末卖时刻（roster 钱包的最后一笔 SELL）
    let lastSellTs = 0;
    for (const r of rows) {
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (roster.has(w) && String(r.trade_type).toLowerCase() === 'sell') {
        const ts = new Date(r.block_time).getTime();
        if (ts > lastSellTs) lastSellTs = ts;
      }
    }
    if (!lastSellTs) { console.log(t.tok + ' 无 famous 卖行'); continue; }

    // 买点=各实验首笔成功买 trade 的最早 executed 时刻（created_at=窗内钟）
    const { data: tr } = await sb.from('trades')
      .select('experiment_id,created_at').eq('token_address', token)
      .eq('trade_direction', 'buy').eq('success', true)
      .order('created_at', { ascending: true }).limit(50);
    const buyTs = tr && tr.length ? new Date(tr[0].created_at).getTime() : null;

    // 末卖→买点窗口买入（不含 famous 自身；窗口=（末卖, 买点]；若买点早于末卖（跨实验错位）则跳过窗口统计）
    let wB = 0, wN = 0; const wW = new Set();
    let gap = null;
    if (buyTs) {
      gap = (buyTs - lastSellTs) / 1000;
      for (const r of rows) {
        const ts = new Date(r.block_time).getTime();
        const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
        if (ts > lastSellTs && ts <= buyTs && String(r.trade_type).toLowerCase() === 'buy' && !roster.has(w)) {
          wB += Number(r.bnb_amount || 0); wN++; wW.add(w);
        }
      }
    }
    // 对照：末卖前 60s 的买入量（背景流量）
    let preB = 0, preN = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (ts > lastSellTs - 60000 && ts <= lastSellTs && String(r.trade_type).toLowerCase() === 'buy' && !roster.has(w)) { preB += Number(r.bnb_amount || 0); preN++; }
    }
    console.log(`${t.tok} pnl=${t.avg >= 0 ? '+' : ''}${t.avg} ${t.full ? '≤30s' : '>30s'} | 末卖→买点 gap=${gap === null ? '-' : gap.toFixed(0) + 's'} 窗口新买=${wB.toFixed(3)}B/${wN}笔/${wW.size}钱包 | 末卖前60s买=${preB.toFixed(3)}B/${preN}笔`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
