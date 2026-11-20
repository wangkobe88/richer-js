#!/usr/bin/env node
// 临时查证：0xddac…2127 用户点名收录 famous 前的行为画像（小查询，单地址）
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const W = '0xddac928a240bdace3994c2cc0783d4e29a002127';

async function main() {
  const sb = dbManager.getClient();

  // 1) 该地址全部 ticks（单地址，量级应不大；分页拉全）
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('token_address,block_time,trade_type,bnb_amount,sender_address')
      .order('id', { ascending: true }).range(from, from + 999)
      .eq('sender_address', W)
      .gte('block_time', new Date(Date.now() - 14 * 86400e3).toISOString());
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
    if (from > 30000) throw new Error('over 30k rows, abort');
  }
  console.log('total tick rows:', rows.length);

  // 2) per-token 汇总
  const byTok = new Map();
  for (const r of rows) {
    const t = byTok.get(r.token_address) || { buy: 0, sell: 0, buyN: 0, sellN: 0, first: r.block_time, last: r.block_time };
    if (r.trade_type === 'BUY' || r.trade_type === 'buy') { t.buy += Number(r.bnb_amount || 0); t.buyN++; }
    else { t.sell += Number(r.bnb_amount || 0); t.sellN++; }
    if (r.block_time < t.first) t.first = r.block_time;
    if (r.block_time > t.last) t.last = r.block_time;
    byTok.set(r.token_address, t);
  }
  console.log('distinct tokens:', byTok.size);
  const toks = [...byTok.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last));
  for (const [addr, t] of toks.slice(0, 30)) {
    console.log(`${addr} buy=${t.buy.toFixed(4)}(${t.buyN}) sell=${t.sell.toFixed(4)}(${t.sellN}) win=${t.first.slice(5, 16)}~${t.last.slice(5, 16)}`);
  }

  // 3) 与 famous roster 同场情况（最近 5 票）
  const roster = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map((w) => w.toLowerCase());
  for (const [addr] of toks.slice(0, 5)) {
    const { data: co, error } = await sb.from('wss_price_ticks')
      .select('sender_address,trader_address')
      .eq('token_address', addr)
      .range(0, 999);
    if (error) throw new Error(error.message);
    const wallets = new Set((co || []).map((r) => (r.sender_address || r.trader_address || '').toLowerCase()));
    const hit = roster.filter((w) => wallets.has(w) && w !== W);
    console.log(`co-present ${addr}: roster hits=${hit.length} ${hit.slice(0, 4).join(',')}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
