#!/usr/bin/env node
// T167c 研究二：残余供给轴（用户判据「famous 卖出后还有多少筹码在外头可用于砸盘」）
// 口径：截至买点——①在外正净筹码（token 绝对量+÷曲线流通）②浮盈/套牢细分（加权成本 vs 买点现价）
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const CASES = [
  { name: '28ad(重启成功)', tok: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', buyTs: '2026-11-05T07:15:58+00:00' },
  { name: '0x6075苏琳(归零)', tok: '0x6075e97a4553c71ec1ef1a5bb29200e184f17777', buyTs: '2026-10-12T03:02:48+00:00' },
];

function loadRoster() {
  const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  const arr = Array.isArray(j) ? j : (j.wallets || j.addresses || []);
  return new Set(arr.map((x) => (typeof x === 'string' ? x.toLowerCase() : String(x.address || x.wallet || '').toLowerCase())).filter(Boolean));
}

async function main() {
  const sb = dbManager.getClient();
  const roster = loadRoster();
  for (const c of CASES) {
    const rows = [];
    let anchor = null;
    for (;;) {
      let q = sb.from('wss_price_ticks')
        .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address,price_outlier')
        .eq('token_address', c.tok).order('block_time', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('block_time', anchor);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
      anchor = data[data.length - 1].block_time;
    }
    const buyTs = new Date(c.buyTs).getTime();
    const t0 = new Date(rows[0].block_time).getTime();
    // 现价=买点前最后一笔可靠价
    const rel = rows.filter((r) => r.price_bnb != null && !r.price_outlier && new Date(r.block_time).getTime() <= buyTs);
    const cur = Number(rel[rel.length - 1].price_bnb);
    // famous 末卖时刻（买点前最后一笔 famous SELL）
    let lastSellTs = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (ts <= buyTs && roster.has(w) && String(r.trade_type).toLowerCase() === 'sell' && ts > lastSellTs) lastSellTs = ts;
    }
    // per-wallet：净持仓（买点时/末卖时两点快照）+ 加权成本（可靠价买入）
    const net = {}, netLS = {}, cost = {}, cq = {};
    let circTokens = 0; // 曲线流通=Σ买入 token_amount
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      if (ts > buyTs) continue;
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      const amt = Number(r.token_amount || 0);
      if (isBuy) {
        circTokens += amt;
        net[w] = (net[w] || 0) + amt;
        if (r.price_bnb && !r.price_outlier) { cost[w] = (cost[w] || 0) + Number(r.bnb_amount || 0); cq[w] = (cq[w] || 0) + amt; }
      } else net[w] = (net[w] || 0) - amt;
      if (ts <= lastSellTs) netLS[w] = net[w]; // 末卖时刻快照
    }
    let outAbs = 0, legacyQty = 0, legacyW = 0, freshQty = 0, nHold = 0;
    for (const [w, v] of Object.entries(net)) {
      if (v <= 0) continue;
      nHold++;
      outAbs += v;
      const heldLS = netLS[w] || 0; // 末卖时刻已持有量
      const legacy = Math.min(Math.max(heldLS, 0), v); // 老筹码残余=末卖前在场∩仍持有
      if (legacy > 0) { legacyQty += legacy; legacyW++; }
      freshQty += v - legacy; // 末卖后新进场的筹码（承接）
    }
    const M = 1e6;
    console.log(`\n===== ${c.name} 买点前现价=${cur.toExponential(3)}`);
    console.log(`曲线流通(累计买入)=${(circTokens / M).toFixed(1)}M | 在外正净筹码=${(outAbs / M).toFixed(2)}M(${(outAbs / circTokens * 100).toFixed(1)}%流通, ${nHold}钱包, 其中famous 0M（买点前已清场）)`);
    console.log(`老筹码残余(末卖前在场∩仍持有)=${(legacyQty / M).toFixed(2)}M/${legacyW}钱包(${(legacyQty / circTokens * 100).toFixed(1)}%流通) | 末卖后新钱=${(freshQty / M).toFixed(2)}M`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
