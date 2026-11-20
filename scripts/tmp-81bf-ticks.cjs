#!/usr/bin/env node
// 0x81bf burst 波钱包提取：全量 ticks（小票 <几分钟，行数小）
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const TOKEN = '0x81bf04448ad0b72258ab5d9e0a1f77e59cdf7777';
const lc = s => (s || '').toLowerCase();

async function main() {
  const sb = dbManager.getClient();
  const want = ['id','block_time','block_number','log_index','trade_type','bnb_amount','price_bnb','sender_address','trader_address'].join(',');
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks').select(want)
      .eq('token_address', TOKEN).gt('id', cursor).order('id', { ascending: false }).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id < cursor || cursor === 0) cursor = r.id;
    if (data.length < 1000) break;
  }
  // 链上真序
  rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  console.log(`总行数=${rows.length} 首=${rows[0]?.block_time} 末=${rows[rows.length - 1]?.block_time}`);
  fs.writeFileSync('/tmp/tmp-81bf-ticks.json', JSON.stringify(rows));

  // per-wallet 聚合
  const W = new Map();
  for (const r of rows) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    if (!w) continue;
    let o = W.get(w); if (!o) { o = { buyBnb: 0, sellBnb: 0, buyN: 0, sellN: 0, blocks: new Set(), firstBuyVsLaunch: null, last: null }; W.set(w, o); }
    const bnb = +r.bnb_amount || 0;
    if (r.trade_type === 'buy') { o.buyBnb += bnb; o.buyN++; } else { o.sellBnb += bnb; o.sellN++; }
    o.blocks.add(r.block_number);
    if (!o.last) o.last = r.block_time;
  }
  console.log(`\n=== 钱包聚合（按买入额排序）===`);
  for (const [w, o] of [...W.entries()].sort((a, b) => b[1].buyBnb - a[1].buyBnb)) {
    console.log(`${w} 买${o.buyBnb.toFixed(4)}B×${o.buyN} 卖${o.sellBnb.toFixed(4)}B×${o.sellN} 块数=${o.blocks.size}`);
  }

  // 同块 bundling：per-block wallet×buy
  const BB = new Map(); // block -> Map(wallet -> buyBnb)
  for (const r of rows) {
    if (r.trade_type !== 'buy') continue;
    const w = lc(r.sender_address) || lc(r.trader_address);
    if (!w) continue;
    if (!BB.has(r.block_number)) BB.set(r.block_number, new Map());
    BB.get(r.block_number).set(w, (BB.get(r.block_number).get(w) || 0) + (+r.bnb_amount || 0));
  }
  console.log(`\n=== 同块买入块（≥2 钱包）===`);
  for (const [blk, ws] of [...BB.entries()].sort((a, b) => b[1].size - a[1].size)) {
    if (ws.size < 2) continue;
    const t = rows.find(r => r.block_number === blk);
    console.log(`block ${blk} @${t?.block_time} 钱包数=${ws.size}: ${[...ws.entries()].map(([w, b]) => `${w.slice(0, 10)}=${b.toFixed(4)}`).join(' ')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
