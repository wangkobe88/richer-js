#!/usr/bin/env node
// 0x37d9 burst 取证：聪明钱 × 捆绑团伙 × 跨票习惯性（182 跑）
// 1) 票内定位 burst（CD407 簇口径：最后 ≥30s 静默段出口起、行间 gap<5s 连续）
// 2) burst 簇/波窗钱包四名单标注（smartmoney/famous/crew/sybil）+ 同块捆绑（CD420 去尘 0.03 剔路由）+ burst 后卖出节奏
// 3) 主力钱包跨票共现矩阵 + 共同票 burst 形状复查（习惯性验证）
const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const TOKEN = (process.argv[2] || '0x37d93f71fde73ce25aff86bdfb63c8b56f957777').toLowerCase();
const SKIP_CROSS = process.env.SKIP_CROSS === '1';
const lc = s => (s || '').toLowerCase();
const R = p => path.join(__dirname, '..', p);
let SIDE_KEY = null;

const AGG = new Set([...require('../src/trading-engine/pre-check/aggregator-routers').AGGREGATOR_ROUTER_ADDRS].map(lc));

const smartRaw = JSON.parse(fs.readFileSync(R('data/kol-study/smartmoney-accum.json'), 'utf8'));
const SMART = new Map(Object.entries(smartRaw.sources.smartmoney || {}).map(([k, v]) => [lc(k), v]));
const KOL = new Map(Object.entries(smartRaw.sources.kol || {}).map(([k, v]) => [lc(k), v]));
const FAMOUS = new Set((JSON.parse(fs.readFileSync(R('config/rosters/famous-copy-wallets.json'), 'utf8')).wallets || []).map(w => lc(typeof w === 'string' ? w : w.address)));
const CREW = new Set((JSON.parse(fs.readFileSync(R('config/rosters/cheat-crew-wallets.json'), 'utf8')).wallets || []).map(w => lc(typeof w === 'string' ? w : w.address)));
const syb = JSON.parse(fs.readFileSync(R('config/rosters/sybil-clusters.json'), 'utf8'));
const SYBIL = new Map();
for (const c of (syb.clusters || [])) for (const w of (c.wallets || c.members || [])) SYBIL.set(lc(w), c.id || 'sybil');

function tagOf(w) {
  const t = [];
  if (SMART.has(w)) t.push(`🧠smart(${SMART.get(w).twitter || SMART.get(w).hits + 'hits'})`);
  if (KOL.has(w)) t.push(`KOL(${KOL.get(w).twitter || ''})`);
  if (FAMOUS.has(w)) t.push(`★famous`);
  if (CREW.has(w)) t.push(`🏴crew`);
  if (SYBIL.has(w)) t.push(`sybil`);
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
  SIDE_KEY = sideKey;
  return rows;
}

// CD407 burst 簇：最后 ≥30s 静默段出口行起，行间 gap<5s 连续，首个 gap≥5s 截断（切断行不含）
function locateBurst(rows, stallSec = 30, tailGapSec = 5) {
  let lastStallIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].dt - rows[i - 1].dt >= stallSec * 1000) lastStallIdx = i - 1;
  }
  if (lastStallIdx < 0) return null;
  const exitIdx = lastStallIdx + 1;
  const seg = [rows[exitIdx]];
  for (let i = exitIdx + 1; i < rows.length; i++) {
    if (rows[i].dt - rows[i - 1].dt >= tailGapSec * 1000) break;
    seg.push(rows[i]);
  }
  return { exitIdx, seg, stallEnd: rows[lastStallIdx] };
}

function fmt(ms) { return new Date(ms).toISOString().slice(5, 19); }
const n2 = x => (x == null || !isFinite(x)) ? 'null' : Number(x).toFixed(4);

async function main() {
  const sb = dbManager.getClient();
  console.log(`\n########## A. 本票 burst 取证 ${TOKEN} ##########`);
  const rows = await pullTicks(sb, TOKEN);
  console.log(`[A] 全 ticks ${rows.length} 行  ${fmt(rows[0].dt)} → ${fmt(rows[rows.length - 1].dt)}  buy=${rows.filter(r => r.side === 'buy').length} sell=${rows.filter(r => r.side === 'sell').length}`);

  const burst = locateBurst(rows);
  if (!burst) { console.log('[A] 无 ≥30s 静默段，无 burst 簇'); }
  else {
    const seg = burst.seg;
    const segBuys = seg.filter(r => r.side === 'buy');
    const segSells = seg.filter(r => r.side === 'sell');
    const buyBnb = segBuys.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
    const sellBnb = segSells.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
    console.log(`\n[A] burst 簇：静默段止于 ${fmt(burst.stallEnd.dt)}（段长前 gap=${(burst.exitIdx > 0 ? (rows[burst.exitIdx].dt - rows[burst.exitIdx - 1].dt) / 1000 : 0).toFixed(1)}s）`);
    console.log(`[A] 簇 ${seg.length} 行 ${fmt(seg[0].dt)} → ${fmt(seg[seg.length - 1].dt)}（跨度 ${((seg[seg.length - 1].dt - seg[0].dt) / 1000).toFixed(1)}s） buy ${segBuys.length} 笔 ${n2(buyBnb)}B / sell ${segSells.length} 笔 ${n2(sellBnb)}B`);

    // 波窗（出口+60s）内 per-wallet
    const waveEnd = seg[0].dt + 60 * 1000;
    const wave = rows.filter(r => r.dt >= seg[0].dt && r.dt <= waveEnd);
    const perWallet = new Map();
    for (const r of wave) {
      if (r.side !== 'buy') continue;
      const rted = AGG.has(lc(r.trader_address));
      const k = r.wallet;
      if (!perWallet.has(k)) perWallet.set(k, { bnb: 0, n: 0, blocks: new Set(), routed: 0, first: r.dt, last: r.dt, sellBnb: 0, sellN: 0, firstSellDt: null });
      const e = perWallet.get(k);
      e.bnb += (+r.bnb_amount || 0); e.n++; e.blocks.add(r.block_number);
      if (rted) e.routed++; e.last = r.dt;
    }
    for (const r of wave) {
      if (r.side !== 'sell') continue;
      const e = perWallet.get(r.wallet);
      if (e) { e.sellBnb += (+r.bnb_amount || 0); e.sellN++; if (!e.firstSellDt) e.firstSellDt = r.dt; }
    }
    console.log(`\n[A] 波窗（出口+60s）买入钱包 ${perWallet.size} 个（含路由行计数）：`);
    const wl = [...perWallet.entries()].sort((a, b) => b[1].bnb - a[1].bnb);
    for (const [w, e] of wl) {
      const rted = e.routed > 0 ? ` 路由行${e.routed}` : '';
      console.log(`  ${w} buy ${n2(e.bnb)}B×${e.n} 块[${[...e.blocks].slice(0, 4).join(',')}${e.blocks.size > 4 ? '..' : ''}] 首买${fmt(e.first)}${rted} | 波窗内卖 ${n2(e.sellBnb)}B×${e.sellN}${e.firstSellDt ? ' 首卖' + fmt(e.firstSellDt) : ''} ${tagOf(w)}`);
    }

    // 同块捆绑（CD405/CD420：去尘 0.03 剔路由，单块 per-wallet 合计）
    const blocks = new Map();
    for (const r of wave) {
      if (r.side !== 'buy' || AGG.has(lc(r.trader_address))) continue;
      const b = blocks.get(r.block_number) || new Map();
      b.set(r.wallet, (b.get(r.wallet) || 0) + (+r.bnb_amount || 0));
      blocks.set(r.block_number, b);
    }
    console.log(`\n[A] 波窗同块捆绑（≥0.03B/钱包，剔路由）：`);
    const bEntries = [...blocks.entries()].map(([bn, ws]) => ({ bn, ws: [...ws.entries()].filter(([, v]) => v >= 0.03) })).filter(e => e.ws.length >= 2).sort((a, b) => b.ws.length - a.ws.length);
    for (const e of bEntries.slice(0, 8)) {
      console.log(`  块 ${e.bn}（${e.ws.length} 钱包）：` + e.ws.map(([w, v]) => `${w.slice(0, 10)}=${n2(v)}`).join(' '));
      const amounts = e.ws.map(([, v]) => v.toFixed(4));
      if (new Set(amounts).size < amounts.length) console.log(`    ⚠ 等额分仓迹象 toFixed(4)=${amounts.join('|')}`);
    }
    if (!bEntries.length) console.log('  （无 ≥2 去尘钱包同块）');

    // burst 内买入者的后续卖出节奏（本票内）
    console.log(`\n[A] burst 簇买入者全票卖出节奏：`);
    const segSellers = new Set(segBuys.map(r => r.wallet));
    for (const w of segSellers) {
      const mySells = rows.filter(r => r.side === 'sell' && r.wallet === w);
      const myBuys = segBuys.filter(r => r.wallet === w);
      if (!mySells.length) { console.log(`  ${w} 买${n2(myBuys.reduce((s, r) => s + +r.bnb_amount, 0))}B → 全票零卖出（留仓/未走）`); continue; }
      const firstSell = mySells[0];
      const totalSell = mySells.reduce((s, r) => s + +r.bnb_amount, 0);
      console.log(`  ${w} 买${n2(myBuys.reduce((s, r) => s + +r.bnb_amount, 0))}B → 首卖 ${fmt(firstSell.dt)}（+${((firstSell.dt - myBuys[0].dt) / 1000).toFixed(0)}s）合计卖 ${n2(totalSell)}B×${mySells.length}`);
    }
  }

  if (SKIP_CROSS || !burst) return;
  console.log(`\n########## B. 跨票习惯性验证 ##########`);
  // 主力钱包 = 波窗 buy ≥0.03 非路由钱包（top 12）
  const waveEnd2 = burst.seg[0].dt + 60 * 1000;
  const wave2 = rows.filter(r => r.dt >= burst.seg[0].dt && r.dt <= waveEnd2 && r.side === 'buy' && !AGG.has(lc(r.trader_address)));
  const wAgg = new Map();
  for (const r of wave2) wAgg.set(r.wallet, (wAgg.get(r.wallet) || 0) + (+r.bnb_amount || 0));
  const mains = [...wAgg.entries()].filter(([, v]) => v >= 0.03).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`[B] 主力钱包 ${mains.length} 个（含标注）：`);
  mains.forEach(([w, v]) => console.log(`  ${w} ${n2(v)}B ${tagOf(w)}`));

  // 每钱包全史 token 扫描（sender 或 trader 命中——先查 sender 口径 wallet；单钱包分页拉 token_address+block_time）
  const hist = new Map(); // w -> Map(token -> {firstDt, buyN, buyBnb})
  for (const [w] of mains) {
    const m = new Map();
    for (const col of ['sender_address']) {
      let cursor = 0, guard = 0;
      for (;;) {
        if (++guard > 40) { console.log(`  [${w.slice(0, 10)}] 行数超 4 万截断`); break; }
        const { data, error } = await sb.from('wss_price_ticks')
          .select(`token_address,block_time,${SIDE_KEY || 'event_type'},bnb_amount,id`)
          .eq(col, w).gt('id', cursor).limit(1000);
        if (error) throw error;
        if (!data.length) break;
        for (const r of data) {
          const t = lc(r.token_address);
          const side = r.trade_type || r.event_type;
          if (side !== 'buy') continue;
          if (!m.has(t)) m.set(t, { firstDt: Date.parse(r.block_time), buyN: 0, buyBnb: 0 });
          const e = m.get(t);
          e.buyN++; e.buyBnb += (+r.bnb_amount || 0);
          e.firstDt = Math.min(e.firstDt, Date.parse(r.block_time));
        }
        for (const r of data) if (r.id > cursor) cursor = r.id;
        if (data.length < 1000) break;
      }
    }
    hist.set(w, m);
    console.log(`  [B] ${w.slice(0, 10)}… 全史买入 token ${m.size} 个`);
  }

  // 两两共现
  console.log(`\n[B] 主力钱包两两共现 token 数（≥2 共同票）：`);
  const pairList = [];
  for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
    const a = mains[i][0], b = mains[j][0];
    const common = [...hist.get(a).keys()].filter(t => hist.get(b).has(t));
    if (common.length >= 2) pairList.push({ a, b, n: common.length, tokens: common });
  }
  pairList.sort((x, y) => y.n - x.n);
  for (const p of pairList.slice(0, 15)) console.log(`  ${p.a.slice(0, 10)}×${p.b.slice(0, 10)} 共现 ${p.n} 票`);

  // 多钱包聚集票：≥3 主力同票出现
  const tokenHits = new Map();
  for (const [w, m] of hist) for (const t of m.keys()) {
    if (!tokenHits.has(t)) tokenHits.set(t, new Set());
    tokenHits.get(t).add(w);
  }
  const multi = [...tokenHits.entries()].filter(([t, ws]) => t !== TOKEN && ws.size >= 3).map(([t, ws]) => ({ t, ws }));
  multi.sort((a, b) => b.ws.size - a.ws.size);
  console.log(`\n[B] ≥3 主力钱包同票出现的 token（习惯团伙场）共 ${multi.length} 个，top10：`);
  for (const m of multi.slice(0, 10)) console.log(`  ${m.t} ← ${m.ws.size} 钱包 [${[...m.ws].map(w => w.slice(0, 8)).join(' ')}]`);

  // 抽查 top5 聚集票的 burst 形状（复用定位）
  console.log(`\n[B] 聚集票形状复查（是否存在同款 静默→集中涌入）：`);
  for (const m of multi.slice(0, 5)) {
    const tRows = await pullTicks(sb, m.t);
    const tBurst = locateBurst(tRows);
    const mainsFirst = [...m.ws].map(w => {
      const firstBuy = tRows.find(r => r.side === 'buy' && r.wallet === w);
      return firstBuy ? { w, dt: firstBuy.dt, bnb: firstBuy.bnb_amount } : null;
    }).filter(Boolean).sort((a, b) => a.dt - b.dt);
    if (!mainsFirst.length) { console.log(`  ${m.t}：主力无买入行（可能是 trader 命中）`); continue; }
    const spanSec = (mainsFirst[mainsFirst.length - 1].dt - mainsFirst[0].dt) / 1000;
    // 主力首买前是否有 ≥30s 静默
    const idx = tRows.findIndex(r => r.side === 'buy' && r.wallet === mainsFirst[0].w && r.dt === mainsFirst[0].dt);
    let preStall = 0;
    if (idx > 0) preStall = (mainsFirst[0].dt - tRows[idx - 1].dt) / 1000;
    const burstHit = tBurst && mainsFirst.some(f => f.dt >= tBurst.seg[0].dt && f.dt <= tBurst.seg[tBurst.seg.length - 1].dt);
    console.log(`  ${m.t} ${tRows.length}行 | 主力首买聚集 ${spanSec.toFixed(1)}s 内 ${mainsFirst.length} 钱包 | 首买前静默 ${preStall.toFixed(1)}s | 落在 burst 簇内: ${burstHit ? '是' : '否'}`);
  }
  console.log('\n[done]');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
