#!/usr/bin/env node
// T167c 后续研究：28ad vs 0x6075 时序事实核查 + 筹码轴分离度（用户提议「深破看流通筹码占比，价格可能不准」）
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const CASES = [
  { name: '28ad(four.meme)', tok: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', buyTs: '2026-11-05T07:15:58+00:00' },
  { name: '0x6075 苏琳(flap)', tok: '0x6075e97a4553c71ec1ef1a5bb29200e184f17777', buyTs: '2026-10-12T03:02:48+00:00' },
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
    const t0 = new Date(rows[0].block_time).getTime();
    const rel = rows.filter((r) => r.price_bnb != null && !r.price_outlier);
    const firstRel = Number(rel[0].price_bnb);
    const LAUNCH = 4496173469e-18;
    const floor = Math.min(LAUNCH, firstRel);
    const vs = (p) => ((Number(p) / floor) - 1) * 100;
    const S = (ts) => ((ts - t0) / 1000).toFixed(0) + 's';
    const buyTs = new Date(c.buyTs).getTime();

    // famous 首买/末卖（买点前的末卖——按代际）
    const famBuys = [], famSells = [];
    for (const r of rows) {
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const ts = new Date(r.block_time).getTime();
      if (!roster.has(w) || ts > buyTs) continue;
      (String(r.trade_type).toLowerCase() === 'buy' ? famBuys : famSells).push({ ts, r });
    }
    const famFirst = famBuys[0], famLastSell = famSells[famSells.length - 1];
    // famous 成本（买点前）
    let cost = 0, qty = 0;
    for (const { r } of famBuys) { cost += Number(r.bnb_amount || 0); qty += Number(r.bnb_amount || 0) / Number(r.price_bnb); }
    const gCost = qty > 0 ? cost / qty : null;

    // 可靠价最低（分段：famFirst→末卖 / 末卖→买点）+ 其时刻
    const minOf = (a, b) => {
      let m = Infinity, mt = null;
      for (const r of rel) { const ts = new Date(r.block_time).getTime(); if (ts >= a && ts < b && Number(r.price_bnb) < m) { m = Number(r.price_bnb); mt = ts; } }
      return { m, mt };
    };
    const m1 = minOf(famFirst.ts, famLastSell.ts), m2 = minOf(famLastSell.ts, buyTs);
    console.log(`\n===== ${c.name}`);
    console.log(`famous 首买 t+${S(famFirst.ts)} 末卖 t+${S(famLastSell.ts)} 买点 t+${S(buyTs)} | 群成本=${gCost ? vs(gCost).toFixed(1) + '%' : '?'}`);
    console.log(`首买→末卖段可靠最低: ${m1.m < Infinity ? vs(m1.m).toFixed(1) + '% @t+' + S(m1.mt) : '无'}`);
    console.log(`末卖→买点段可靠最低: ${m2.m < Infinity ? vs(m2.m).toFixed(1) + '% @t+' + S(m2.mt) : '无'}`);

    // 筹码面（截至买点）：wallet→净持仓(token)；famous 筹码去哪了
    const net = {}, buyBnb = {};
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      if (ts > buyTs) continue;
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const isBuy = String(r.trade_type).toLowerCase() === 'buy';
      const amt = Number(r.token_amount || 0);
      net[w] = (net[w] || 0) + (isBuy ? amt : -amt);
      if (isBuy) buyBnb[w] = (buyBnb[w] || 0) + Number(r.bnb_amount || 0);
    }
    const pos = Object.entries(net).filter(([w, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const sumPos = pos.reduce((s, [, v]) => s + v, 0);
    const famNet = Object.entries(net).filter(([w]) => roster.has(w)).reduce((s, [, v]) => s + v, 0);
    const top1 = pos[0], top2 = pos[1];
    console.log(`筹码(截至买点): 正净持有钱包=${pos.length} Σ正净=${(sumPos / 1e9).toFixed(1)}%流通(1e9)`);
    console.log(`  top1=${(top1[1] / sumPos * 100).toFixed(1)}%(${top1[0].slice(0, 8)}${roster.has(top1[0]) ? '★fam' : ''}) top2=${top2 ? (top2[1] / sumPos * 100).toFixed(1) + '%' : '-'} top10=${(pos.slice(0, 10).reduce((s, [, v]) => s + v, 0) / sumPos * 100).toFixed(1)}%`);
    console.log(`  famous 群净持仓=${(famNet / sumPos * 100).toFixed(1)}% | 前五持有: ` + pos.slice(0, 5).map(([w, v]) => (v / sumPos * 100).toFixed(1) + '%' + (roster.has(w) ? '★' : '')).join(' '));
    // 接盘结构：famous 卖出段（末卖前 60s~末卖）买入的非 famous 钱包量级
    let absorbN = 0, absorbB = 0;
    for (const r of rows) {
      const ts = new Date(r.block_time).getTime();
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      if (ts >= famLastSell.ts - 60000 && ts <= buyTs && String(r.trade_type).toLowerCase() === 'buy' && !roster.has(w)) { absorbN++; absorbB += Number(r.bnb_amount || 0); }
    }
    console.log(`  末卖前60s→买点 非famous买入=${absorbB.toFixed(2)}B/${absorbN}笔`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
