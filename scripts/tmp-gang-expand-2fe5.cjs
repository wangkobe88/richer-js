#!/usr/bin/env node
/** 0x2fe5 团伙深挖（182 跑）：① 种子扩簇（团伙票→扩展成员图谱） ② pair 缓存对拍（为什么漏） */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');
const zlib = require('zlib');

const THIS = '0x2fe5328cf2ea8cd632161564464c1e6c2e347777';
const SUSPECTS = [
  '0x778139e4f1', '0xd5155c1edf', '0x00c60c5228', '0x488db0e00e', '0x90e16cff92',
  '0x1feeee5e39', '0xcf3aa2e7b9', '0x8728bf942d', '0xc02250ed29',
  '0xefb1dc1ba3', '0x9219b2cca3', '0x24a57cb992', '0x5c338e1824', '0xbfa0dc8b8f',
  '0x66666baabb', '0x9667b10748', '0xf944f5b7f9',
  '0x27ac03fe76', '0x0fcf388ec0', '0x617f2b6aae', '0xdaf656398d', '0x24593a77d9',
  '0xcd95d68d8b', '0x8a2a9d7b11',
  '0x7154c02022', '0xfe5130eab2', '0x30f2f80acc', '0x81364b8ec0', '0x6b6df649eb',
  '0xc299cd75f7', '0xeb64740aff', '0xf205c591f9', '0x04a5352815', '0xa8fd5b9fb8',
  '0x06f0a61cfc', '0x0fd35eb464',
];

async function fetchTicksByToken(db, token) {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await db.from('wss_price_ticks')
      .select('id, block_time, block_number, trade_type, bnb_amount, sender_address, trader_address, quote_token')
      .eq('token_address', token).gt('id', cursor)
      .order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const db = dbManager.getClient();

  // ── 全地址解析（本票池 6+4 匹配）+ 平台确认 ──
  const tk = await fetchTicksByToken(db, THIS);
  const qset = new Set(tk.map(r => r.quote_token).filter(Boolean));
  console.log(`本票 ticks=${tk.length} quote_token distinct=${JSON.stringify([...qset]) || '(全 NULL=BNB 计价盘)'}`);
  const pool = new Set();
  for (const r of tk) {
    if (r.sender_address) pool.add(r.sender_address.toLowerCase());
    if (r.trader_address) pool.add(r.trader_address.toLowerCase());
  }
  const seeds = [];
  for (const p of SUSPECTS) {
    const hit = [...pool].find(a => a.startsWith(p.slice(0, 8)) && a.endsWith(p.slice(-4)));
    if (hit) seeds.push(hit); else console.log('未匹配:', p);
  }
  console.log(`seeds=${seeds.length}/36`);

  // ── ① 种子全史 → 团伙票清单 ──
  const seedRows = [];
  {
    let cursor = 0;
    for (;;) {
      const { data, error } = await db.from('wss_price_ticks')
        .select('id, block_time, token_address, sender_address, trader_address')
        .in('sender_address', seeds)
        .gt('id', cursor).order('id', { ascending: true }).limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      seedRows.push(...data);
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
  }
  console.log(`种子全史 ticks=${seedRows.length}`);
  const tokenSeeds = new Map(); // token -> Set(seed)
  for (const r of seedRows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!seeds.includes(w)) continue;
    const s = tokenSeeds.get(r.token_address) || new Set();
    s.add(w); tokenSeeds.set(r.token_address, s);
  }
  const gangTokens = [...tokenSeeds.entries()]
    .map(([t, s]) => ({ t, n: s.size }))
    .filter(x => x.n >= 4)
    .sort((a, b) => b.n - a.n);
  console.log(`\n种子 ≥4 共演票: ${gangTokens.length} 张（截 20 展示）`);
  gangTokens.slice(0, 20).forEach(g => console.log(`  ${g.t.slice(0, 8)}…${g.t.slice(-6)} seeds=${g.n}`));

  // ── ② 拉团伙票全 ticks → 扩展成员 ──
  const TOP = gangTokens.slice(0, 40);
  const member = new Map(); // wallet -> {tokens:Set, buyBnb, sellBnb, rows, first, last}
  let fetched = 0;
  for (const g of TOP) {
    const rows = await fetchTicksByToken(db, g.t);
    fetched += rows.length;
    for (const r of rows) {
      const w = (r.sender_address || r.trader_address || '(null)').toLowerCase();
      const e = member.get(w) || { tokens: new Set(), buyBnb: 0, sellBnb: 0, rows: 0, first: r.block_time, last: r.block_time, isSeed: seeds.includes(w) };
      e.tokens.add(g.t);
      const bnb = Number(r.bnb_amount) || 0;
      if (r.trade_type === 'buy') e.buyBnb += bnb; else e.sellBnb += bnb;
      e.rows++;
      if (r.block_time < e.first) e.first = r.block_time;
      if (r.block_time > e.last) e.last = r.block_time;
      member.set(w, e);
    }
  }
  console.log(`\ntop${TOP.length} 团伙票全 ticks=${fetched}，参与钱包=${member.size}`);
  const ext = [...member.entries()].filter(([w, e]) => !e.isSeed && e.tokens.size >= 5)
    .sort((a, b) => b[1].tokens.size - a[1].tokens.size);
  console.log(`\n-- 扩展成员候选（非种子、出现在 ≥5 张团伙票）: ${ext.length} 个，截 30 --`);
  for (const [w, e] of ext.slice(0, 30)) {
    console.log(`${w.slice(0, 8)}…${w.slice(-4)}: ${e.tokens.size} 票 buy=${e.buyBnb.toFixed(1)} sell=${e.sellBnb.toFixed(1)} rows=${e.rows} ${e.first.slice(0, 10)}→${e.last.slice(0, 10)}`);
  }
  const seedsGang = [...member.entries()].filter(([, e]) => e.isSeed);
  console.log(`\n-- 种子在团伙票上的覆盖 --`);
  for (const [w, e] of seedsGang.sort((a, b) => b[1].tokens.size - a[1].tokens.size).slice(0, 12)) {
    console.log(`${w.slice(0, 8)}…${w.slice(-4)}: ${e.tokens.size}/${TOP.length} 票 buy=${e.buyBnb.toFixed(1)} sell=${e.sellBnb.toFixed(1)}`);
  }

  // sybil 名单对拍
  let sybSet = new Set();
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/sybil-clusters.json')));
    const walk = (o) => {
      if (Array.isArray(o)) { for (const v of o) { if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) sybSet.add(v.toLowerCase()); else walk(v); } }
      else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
    };
    walk(m);
  } catch {}
  const hitSyb = [...member.keys()].filter(w => sybSet.has(w));
  console.log(`\nsybil 名单命中（团伙票参与者中）: ${hitSyb.length}/${member.size}`);

  // ── ③ pair 缓存对拍：种子间 pair 的 co/sellSync/even 为什么没连边 ──
  const PAIRS = path.join(__dirname, '../data/offline-cache/copy-trade-pairs.json.gz');
  let idx = null;
  if (!fs.existsSync(PAIRS)) {
    console.log('\npair 缓存不存在: ' + PAIRS);
  } else {
    const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(PAIRS)).toString());
    const pairs = meta.pairs || [];
    console.log(`\npair 缓存: ${pairs.length} pairs, meta=${JSON.stringify(meta.meta || {}).slice(0, 250)}`);
    idx = new Map();
    for (const p of pairs) idx.set(p.k, p);
    console.log('-- 种子×种子 pair 数值（强边=co≥50 且 sellSync 或 even 过半）--');
    let shown = 0;
    for (let i = 0; i < seeds.length && shown < 40; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        const p = idx.get(`${seeds[i]}|${seeds[j]}`) || idx.get(`${seeds[j]}|${seeds[i]}`);
        if (!p) continue;
        const co = Number(p.co) || 0;
        if (co < 10) continue;
        const ss = Number(p.sellSync) || 0, ev = Number(p.even) || 0;
        const strong = co >= 50 && (ss / co >= 0.5 || ev / co >= 0.5);
        const why = strong ? '★强边' : (co < 50 ? 'co<50' : '两比均<0.5');
        console.log(`${seeds[i].slice(0, 8)}…${seeds[i].slice(-4)} × ${seeds[j].slice(0, 8)}…${seeds[j].slice(-4)}: co=${co} sellSync=${ss} even=${ev} ${why}`);
        shown++;
      }
    }
    console.log('(种子×种子 co≥10 的 pair 展示了 ' + shown + ' 条)');
    // 种子的最高 co 外部 pair（看漏网形状）
    console.log('-- 种子最高 co 外部 pair（前 8）--');
    for (const s of seeds.slice(0, 8)) {
      let best = null;
      for (const [k, p] of idx.entries()) {
        const bar = k.indexOf('|');
        const a = k.slice(0, bar), b = k.slice(bar + 1);
        if (a !== s && b !== s) continue;
        if (!best || (Number(p.co) || 0) > (Number(best.p.co) || 0)) best = { p, peer: a === s ? b : a };
      }
      if (best) console.log(`${s.slice(0, 8)}…${s.slice(-4)} ↔ ${best.peer.slice(0, 8)}…${best.peer.slice(-4)}: co=${best.p.co} sellSync=${best.p.sellSync} even=${best.p.even}`);
    }
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
