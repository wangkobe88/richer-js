#!/usr/bin/env node
// 0x37d9 锚定买点 burst 取证(182 跑)
// 锚=信号时刻;锚窗=锚前全部行;burst=锚窗内最后 ≥30s 静默段出口起 gap<5s 连续簇
// 输出:全行明细(带四名单标注)/ 涌入簇钱包身份+同块捆绑 / 买点后砸盘节奏 / 跨票习惯性
const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const TOKEN = (process.argv[2] || '0x37d93f71fde73ce25aff86bdfb63c8b56f957777').toLowerCase();
const ANCHOR = Date.parse(process.argv[3] || '2026-10-12T06:37:28+00:00');
const SKIP_CROSS = process.env.SKIP_CROSS === '1';
const lc = s => (s || '').toLowerCase();
const R = p => path.join(__dirname, '..', p);
const AGG = new Set([...require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS].map(lc));

const smartRaw = JSON.parse(fs.readFileSync(R('data/kol-study/smartmoney-accum.json'), 'utf8'));
const SMART = new Map(Object.entries(smartRaw.sources.smartmoney || {}).map(([k, v]) => [lc(k), v]));
const KOL = new Map(Object.entries(smartRaw.sources.kol || {}).map(([k, v]) => [lc(k), v]));
const FAMOUS = new Set((JSON.parse(fs.readFileSync(R('config/rosters/famous-copy-wallets.json'), 'utf8')).wallets || []).map(w => lc(typeof w === 'string' ? w : w.address)));
const CREW = new Set((JSON.parse(fs.readFileSync(R('config/rosters/cheat-crew-wallets.json'), 'utf8')).wallets || []).map(w => lc(typeof w === 'string' ? w : w.address)));
const syb = JSON.parse(fs.readFileSync(R('config/rosters/sybil-clusters.json'), 'utf8'));
const SYBIL = new Map();
for (const c of (syb.clusters || [])) for (const w of (c.wallets || c.members || [])) SYBIL.set(lc(w), 'sybil');

function tagOf(w) {
  const t = [];
  if (SMART.has(w)) t.push(`🧠smart(${SMART.get(w).twitter || 'hits' + SMART.get(w).hits})`);
  if (KOL.has(w)) t.push(`KOL(${KOL.get(w).twitter || ''})`);
  if (FAMOUS.has(w)) t.push('★famous');
  if (CREW.has(w)) t.push('🏴crew');
  if (SYBIL.has(w)) t.push('sybil');
  return t.join(' ');
}

async function pullTicks(sb, token) {
  const probe = await sb.from('wss_price_ticks').select('*').eq('token_address', token).limit(1);
  if (probe.error) throw probe.error;
  const cols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : [];
  const sideKey = cols.includes('trade_type') ? 'trade_type' : 'event_type';
  const want = ['id', 'block_time', 'block_number', 'log_index', 'tx_hash', sideKey, 'bnb_amount', 'token_amount', 'price_bnb', 'sender_address', 'trader_address'].join(',');
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select(want).eq('token_address', token).gt('id', cursor).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id > cursor) cursor = r.id;
    if (data.length < 1000) break;
  }
  rows.sort((a, b) => (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
  rows.forEach(r => { r.side = r[sideKey]; r.dt = Date.parse(r.block_time); r.wallet = lc(r.sender_address) || lc(r.trader_address); });
  return { rows, sideKey };
}

const fmt = ms => new Date(ms).toISOString().slice(5, 19);
const n2 = x => (x == null || !isFinite(x)) ? 'null' : Number(x).toFixed(4);

function locateBurstBefore(rows, anchorDt, stallSec = 30, tailGapSec = 5) {
  const win = rows.filter(r => r.dt <= anchorDt);
  let lastStallIdx = -1;
  for (let i = 1; i < win.length; i++) if (win[i].dt - win[i - 1].dt >= stallSec * 1000) lastStallIdx = i - 1;
  if (lastStallIdx < 0) return { win, seg: null };
  const exitIdx = lastStallIdx + 1;
  const seg = [win[exitIdx]];
  for (let i = exitIdx + 1; i < win.length; i++) {
    if (win[i].dt - win[i - 1].dt >= tailGapSec * 1000) break;
    seg.push(win[i]);
  }
  return { win, seg, preStall: win[exitIdx].dt - win[lastStallIdx].dt };
}

async function main() {
  const sb = dbManager.getClient();
  console.log(`\n##### 0x37d9 锚定取证 token=${TOKEN} anchor=${fmt(ANCHOR)} #####`);
  const { rows } = await pullTicks(sb, TOKEN);
  console.log(`全 ticks ${rows.length} 行 ${fmt(rows[0].dt)} → ${fmt(rows[rows.length - 1].dt)}\n`);
  console.log('== 全行明细（B=buy S=sell, [块] 金额B 价格 tag）==');
  for (const r of rows) {
    const tag = tagOf(r.wallet);
    const rt = AGG.has(lc(r.trader_address)) ? '↦router' : '';
    console.log(`${r.dt <= ANCHOR ? '前' : '后'} ${fmt(r.dt)} ${r.side === 'buy' ? 'B' : 'S'} [${r.block_number}] ${n2(r.bnb_amount)}B @${r.price_bnb ? (+r.price_bnb).toExponential(2) : '-'} ${r.wallet.slice(0, 12)}${rt} ${tag}`);
  }

  const { win, seg, preStall } = locateBurstBefore(rows, ANCHOR);
  const anchorIdx = rows.findIndex(r => r.dt > ANCHOR);
  const anchorRow = rows[anchorIdx >= 0 ? anchorIdx : rows.length - 1];

  console.log(`\n== 锚窗(锚前) ${win.length} 行 burst 定位 ==`);
  if (!seg) console.log('锚窗内无 ≥30s 静默段(全窗连贯)');
  else {
    const buys = seg.filter(r => r.side === 'buy'), sells = seg.filter(r => r.side === 'sell');
    console.log(`静默 ${(preStall / 1000).toFixed(0)}s → 出口 ${fmt(seg[0].dt)} 簇 ${seg.length} 行 跨度 ${((seg[seg.length - 1].dt - seg[0].dt) / 1000).toFixed(1)}s buy ${buys.length}笔${n2(buys.reduce((s, r) => s + +r.bnb_amount, 0))}B sell ${sells.length}笔${n2(sells.reduce((s, r) => s + +r.bnb_amount, 0))}B`);
    console.log(`簇距锚 ${((ANCHOR - seg[seg.length - 1].dt) / 1000).toFixed(1)}s（锚=买信号时刻）`);
    // 簇内 per-wallet
    const pw = new Map();
    for (const r of seg) {
      const k = r.wallet;
      if (!pw.has(k)) pw.set(k, { buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0, blocks: new Set(), routerN: 0 });
      const e = pw.get(k);
      if (r.side === 'buy') { e.buyBnb += +r.bnb_amount || 0; e.buyN++; }
      else { e.sellBnb += +r.bnb_amount || 0; e.sellN++; }
      e.blocks.add(r.block_number);
      if (AGG.has(lc(r.trader_address))) e.routerN++;
    }
    console.log('簇内钱包:');
    for (const [w, e] of [...pw.entries()].sort((a, b) => b[1].buyBnb - a[1].buyBnb)) {
      console.log(`  ${w} buy${n2(e.buyBnb)}B×${e.buyN} sell${n2(e.sellBnb)}B×${e.sellN} 块{${[...e.blocks].join(',')}}${e.routerN ? ' 路由行' + e.routerN : ''} ${tagOf(w)}`);
    }
    // 同块捆绑(簇内+锚窗尾,去尘0.03)
    console.log('锚窗同块捆绑簇(≥0.03B/钱包,剔路由,≥2钱包):');
    const blocks = new Map();
    for (const r of win) {
      if (r.side !== 'buy' || AGG.has(lc(r.trader_address))) continue;
      const b = blocks.get(r.block_number) || new Map();
      b.set(r.wallet, (b.get(r.wallet) || 0) + (+r.bnb_amount || 0));
      blocks.set(r.block_number, b);
    }
    let found = false;
    for (const [bn, ws] of [...blocks.entries()].sort((a, b) => b[0] - a[0])) {
      const list = [...ws.entries()].filter(([, v]) => v >= 0.03);
      if (list.length >= 2) {
        found = true;
        const amts = list.map(([, v]) => v.toFixed(4));
        console.log(`  块${bn} ${list.length}钱包: ` + list.map(([w, v]) => `${w.slice(0, 10)}=${n2(v)}${tagOf(w) ? '(' + tagOf(w) + ')' : ''}`).join(' ') + (new Set(amts).size < amts.length ? ' ⚠等额' : ''));
      }
    }
    if (!found) console.log('  (锚窗无 ≥2 去尘钱包同块)');
    // 等额簇 toFixed(4) 全等 ≥2 钱包(0.001 尘门)
    console.log('锚窗等额同块簇(toFixed(4) 全等, ≥0.001B):');
    let eq = false;
    for (const [bn, ws] of blocks) {
      const byAmt = new Map();
      for (const [w, v] of ws) { if (v < 0.001) continue; const k = v.toFixed(4); if (!byAmt.has(k)) byAmt.set(k, []); byAmt.get(k).push(w); }
      for (const [k, wl] of byAmt) if (wl.length >= 2) { eq = true; console.log(`  块${bn} 等额${k}B ×${wl.length}: ${wl.map(w => w.slice(0, 10)).join(' ')}`); }
    }
    if (!eq) console.log('  (无等额同块簇)');
  }

  // 买点后砸盘节奏
  console.log(`\n== 锚后(买点后)卖出节奏 ==`);
  const post = rows.filter(r => r.dt > ANCHOR);
  const sells = post.filter(r => r.side === 'sell');
  console.log(`锚后 ${post.length} 行(买${post.filter(r => r.side === 'buy').length}/卖${sells.length}), 卖额合计 ${n2(sells.reduce((s, r) => s + +r.bnb_amount, 0))}B`);
  const ps = new Map();
  for (const r of sells) {
    if (!ps.has(r.wallet)) ps.set(r.wallet, { bnb: 0, n: 0, first: r.dt });
    const e = ps.get(r.wallet); e.bnb += +r.bnb_amount || 0; e.n++;
  }
  for (const [w, e] of [...ps.entries()].sort((a, b) => b[1].first - a[1].first).slice(0, 15)) {
    console.log(`  ${w} 首卖${fmt(e.first)}(+${((e.first - ANCHOR) / 1000).toFixed(0)}s) 卖${n2(e.bnb)}B×${e.n} ${tagOf(w)}`);
  }

  if (SKIP_CROSS) { console.log('\n[done]'); return; }

  // 跨票习惯性: 主力=锚窗 burst 簇 buy≥0.02 非路由 + 锚前 0.2 级大单钱包
  const { sideKey } = { sideKey: rows[0].side ? (rows[0].trade_type ? 'trade_type' : 'event_type') : 'event_type' };
  const mainsSet = new Set();
  for (const r of win) if (r.side === 'buy' && !AGG.has(lc(r.trader_address)) && (+r.bnb_amount || 0) >= 0.02) mainsSet.add(r.wallet);
  const mains = [...mainsSet];
  console.log(`\n== 跨票习惯性: 主力钱包 ${mains.length} 个 ==`);
  for (const w of mains) console.log(`  ${w} ${tagOf(w)}`);
  const hist = new Map();
  for (const w of mains) {
    const m = new Map(); let cursor = 0, guard = 0;
    for (;;) {
      if (++guard > 60) { console.log(`  [${w.slice(0, 10)}] 超6万行截断`); break; }
      const { data, error } = await sb.from('wss_price_ticks')
        .select(`token_address,block_time,${sideKey},bnb_amount,id`).eq('sender_address', w).gt('id', cursor).limit(1000);
      if (error) throw error;
      if (!data.length) break;
      for (const r of data) {
        if ((r[sideKey]) !== 'buy') continue;
        const t = lc(r.token_address);
        if (!m.has(t)) m.set(t, { firstDt: Date.parse(r.block_time), buyN: 0, buyBnb: 0 });
        const e = m.get(t); e.buyN++; e.buyBnb += +r.bnb_amount || 0;
        e.firstDt = Math.min(e.firstDt, Date.parse(r.block_time));
      }
      for (const r of data) if (r.id > cursor) cursor = r.id;
      if (data.length < 1000) break;
    }
    hist.set(w, m);
    console.log(`  [B] ${w.slice(0, 10)} 全史买入 token ${m.size} 票`);
  }
  // 两两共现
  const pairs = [];
  for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
    const common = [...hist.get(mains[i]).keys()].filter(t => hist.get(mains[j]).has(t));
    if (common.length >= 2) pairs.push({ a: mains[i], b: mains[j], n: common.length, tokens: common });
  }
  pairs.sort((x, y) => y.n - x.n);
  console.log(`\n两两共现(≥2票):`);
  for (const p of pairs.slice(0, 20)) console.log(`  ${p.a.slice(0, 10)}×${p.b.slice(0, 10)} ${p.n}票`);
  // ≥3 主力聚集票
  const tokenHits = new Map();
  for (const [w, m] of hist) for (const t of m.keys()) { if (!tokenHits.has(t)) tokenHits.set(t, new Set()); tokenHits.get(t).add(w); }
  const multi = [...tokenHits.entries()].filter(([t, ws]) => t !== TOKEN && ws.size >= 3).map(([t, ws]) => ({ t, ws }));
  multi.sort((a, b) => b.ws.size - a.ws.size);
  console.log(`\n≥3 主力同票聚集 token ${multi.length} 个 top12:`);
  for (const m of multi.slice(0, 12)) console.log(`  ${m.t} ← ${m.ws.size}钱包 [${[...m.ws].map(w => w.slice(0, 8)).join(' ')}]`);
  // 聚集票形状复查: 主力首买聚集度 + 首买前静默(同款形状?)
  console.log(`\n聚集票形状复查 top6:`);
  for (const m of multi.slice(0, 6)) {
    const tRows = await pullTicks(sb, m.t);
    const firsts = [...m.ws].map(w => tRows.find(r => r.side === 'buy' && r.wallet === w)).filter(Boolean).sort((a, b) => a.dt - b.dt);
    if (!firsts.length) { console.log(`  ${m.t} 无 sender 命中买入行`); continue; }
    const span = (firsts[firsts.length - 1].dt - firsts[0].dt) / 1000;
    const i0 = tRows.indexOf(firsts[0]);
    const preGap = i0 > 0 ? (firsts[0].dt - tRows[i0 - 1].dt) / 1000 : 0;
    const bb = firsts.reduce((s, r) => s + +r.bnb_amount, 0);
    console.log(`  ${m.t} ${tRows.length}行 | 主力首买聚集 ${span.toFixed(0)}s 内 ${firsts.length}钱包 合计${n2(bb)}B | 首买前静默 ${preGap.toFixed(0)}s`);
  }
  console.log('\n[done]');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
