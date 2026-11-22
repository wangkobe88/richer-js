#!/usr/bin/env node
// JG-6 取证：쿠우타 0xc0e8 自然传播盘假设验证——分段参与者结构（谁在低点接、第二波谁拉、famous 是否真离场）。本地单票 1512 行小结果。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xc0e896ddec43881055a25786c17fa5d5d6337777';
const SIG1 = new Date('2026-10-03T02:30:40Z').getTime(); // 首次被拦
const SIG5 = new Date('2026-10-03T02:33:46Z').getTime(); // 末次被拦

function loadRoster(p, key) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = key ? (j[key] || []) : j;
    return new Set(arr.map(x => typeof x === 'string' ? x.toLowerCase() : (x.address || '').toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
}
const FAM = loadRoster(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'wallets');
const SMART = loadRoster(path.join(__dirname, '../data/kol-study/smartmoney-accum.json'), 'snapshots');

(async () => {
  const sb = dbManager.getClient();
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id, trade_type, trader_address, sender_address, price_bnb, bnb_amount, block_time, block_number')
      .eq('token_address', TOKEN).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  for (const r of rows) {
    r.t = new Date(r.block_time).getTime();
    r.w = (r.sender_address || r.trader_address || '').toLowerCase();
    r.isBuy = r.trade_type === 'BUY' || r.trade_type === 'buy';
  }
  rows.sort((a, b) => a.t - b.t || a.id - b.id);
  console.log('ticks:', rows.length, 'FAM roster:', FAM.size, 'SMART roster:', SMART.size);

  // 低点（末次被拦后）
  const after = rows.filter(r => r.t >= SIG5);
  let minP = Infinity, minT = null;
  for (const r of after) if (r.price_bnb < minP) { minP = r.price_bnb; minT = r.t; }
  const peak = rows.reduce((m, r) => r.price_bnb > m.p ? { p: r.price_bnb, t: r.t } : m, { p: 0, t: 0 });
  const pAt = ts => { let best = null; for (const r of rows) if (r.t <= ts) best = r; return best ? best.price_bnb : null; };
  console.log(`\n末次被拦@02:33:46 价 ${pAt(SIG5).toExponential(3)} | 低点 ${new Date(minT).toISOString().slice(11,19)} ${minP.toExponential(3)} (较拦点 ${(minP/pAt(SIG5)-1)*100 | 0}%) | 峰值 ${new Date(peak.t).toISOString().slice(11,19)} ${peak.p.toExponential(3)} (对低点 ×${(peak.p/minP).toFixed(1)})`);

  // 分段：①第一波(开盘~SIG1) ②崩塌段(SIG1~SIG5) ③低点段(SIG5~低点+60s) ④第二波(低点+60s~峰值) ⑤峰值后
  const t0 = rows[0].t;
  const segs = [
    ['①第一波 冲高', t0, SIG1],
    ['②崩塌段(5次被拦)', SIG1, SIG5],
    ['③低位盘整', SIG5, minT + 60000],
    ['④第二波拉升', minT + 60000, peak.t],
    ['⑤峰值后', peak.t, Infinity],
  ];
  const seen = new Set();
  for (const [name, a, b] of segs) {
    const seg = rows.filter(r => r.t >= a && r.t < b);
    const buys = seg.filter(r => r.isBuy), sells = seg.filter(r => !r.isBuy);
    const sum = arr => arr.reduce((s, r) => s + (r.bnb_amount || 0), 0);
    const wallets = new Set(seg.map(r => r.w).filter(Boolean));
    const newW = [...wallets].filter(w => !seen.has(w));
    for (const w of wallets) seen.add(w);
    const famB = buys.filter(r => FAM.has(r.w)), famS = sells.filter(r => FAM.has(r.w));
    const smB = buys.filter(r => SMART.has(r.w)), smSS = sells.filter(r => SMART.has(r.w));
    // 大户买（单笔≥0.2B）
    const big = buys.filter(r => (r.bnb_amount || 0) >= 0.2);
    console.log(`\n${name} ${new Date(a).toISOString().slice(11,19)}~${isFinite(b)?new Date(b).toISOString().slice(11,19):'末'} (${((Math.min(b,peak.t)-a)/1000|0)}s)`);
    console.log(`  买 ${buys.length} 笔/${sum(buys).toFixed(2)}B (${newW.length} 新钱包) | 卖 ${sells.length} 笔/${sum(sells).toFixed(2)}B`);
    console.log(`  famous: 买${famB.length}笔/${sum(famB).toFixed(3)}B 卖${famS.length}笔/${sum(famS).toFixed(3)}B | smart: 买${smB.length}笔/${sum(smB).toFixed(3)}B 卖${smSS.length}笔/${sum(smSS).toFixed(3)}B`);
    if (big.length) console.log(`  单笔≥0.2B 买: ${big.map(r => `${r.w.slice(0,8)}@${new Date(r.t).toISOString().slice(11,19)} ${(r.bnb_amount).toFixed(2)}B${FAM.has(r.w)?'★fam':''}${SMART.has(r.w)?'☆sm':''}`).join(' | ')}`);
  }

  // famous 全程行为（每钱包：总买/总卖/首末时间）
  console.log('\n=== famous 钱包全程行为 ===');
  const famAll = new Map();
  for (const r of rows) {
    if (!FAM.has(r.w)) continue;
    const e = famAll.get(r.w) || { buy: 0, sell: 0, first: r.t, last: r.t, n: 0 };
    if (r.isBuy) e.buy += r.bnb_amount || 0; else e.sell += r.bnb_amount || 0;
    e.last = r.t; e.n++;
    famAll.set(r.w, e);
  }
  for (const [w, e] of famAll) {
    console.log(`  ${w.slice(0,10)} 买${e.buy.toFixed(3)}B 卖${e.sell.toFixed(3)}B 净${(e.buy-e.sell).toFixed(3)}B ${e.n}笔 ${new Date(e.first).toISOString().slice(11,19)}~${new Date(e.last).toISOString().slice(11,19)}${e.last > minT + 60000 ? '  ←第二波仍活跃' : ''}`);
  }

  // smart 全程
  const smAll = new Map();
  for (const r of rows) {
    if (!SMART.has(r.w)) continue;
    const e = smAll.get(r.w) || { buy: 0, sell: 0, first: r.t, last: r.t };
    if (r.isBuy) e.buy += r.bnb_amount || 0; else e.sell += r.bnb_amount || 0;
    e.last = r.t;
    smAll.set(r.w, e);
  }
  console.log('\n=== smart 名单钱包全程（有动作的） ===');
  for (const [w, e] of smAll) console.log(`  ${w.slice(0,10)} 买${e.buy.toFixed(3)}B 卖${e.sell.toFixed(3)}B ${new Date(e.first).toISOString().slice(11,19)}~${new Date(e.last).toISOString().slice(11,19)}${e.first > minT ? '  ←低点后进场' : ''}`);

  // 第二波 top10 买家（非名单 = 散户/未知）
  const wave2 = rows.filter(r => r.t >= minT + 60000 && r.t < peak.t && r.isBuy);
  const byw = new Map();
  for (const r of wave2) byw.set(r.w, (byw.get(r.w) || 0) + (r.bnb_amount || 0));
  const top = [...byw.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
  console.log(`\n=== 第二波 top10 买家（${wave2.length} 笔/${wave2.reduce((s, r) => s + (r.bnb_amount||0), 0).toFixed(2)}B） ===`);
  for (const [w, v] of top) console.log(`  ${w.slice(0,10)} ${v.toFixed(3)}B${FAM.has(w)?' ★fam':''}${SMART.has(w)?' ☆sm':''}`);

  // 低点段企稳细节：SIG5~低点+60s 的买卖笔数序列（每 30s 桶）
  console.log('\n=== 低位盘整段 30s 桶（买笔/卖笔/买B） ===');
  for (let t = SIG5; t < minT + 60000; t += 30000) {
    const b = rows.filter(r => r.t >= t && r.t < t + 30000 && r.isBuy);
    const s = rows.filter(r => r.t >= t && r.t < t + 30000 && !r.isBuy);
    const p = pAt(t + 30000);
    console.log(`  ${new Date(t).toISOString().slice(11,19)} 买${b.length}/${b.reduce((x, r) => x + (r.bnb_amount||0), 0).toFixed(2)}B 卖${s.length}/${s.reduce((x, r) => x + (r.bnb_amount||0), 0).toFixed(2)}B 价${p ? p.toExponential(3) : '-'}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
