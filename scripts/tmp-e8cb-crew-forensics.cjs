#!/usr/bin/env node
// 0xe8cb 操盘团伙取证：单票全量 ticks —— 同块簇/等额分仓/wash/共现图团伙(连通分量)/团伙时间线 vs 价格
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xe8cb59a8c2118292c38ebd6061d05c09a9227777';
const lc = s => (s || '').toLowerCase();
const ROUTERS = ['0x1de460f363af910f51726def188f9004276bf4bc','0x9689992f5b5c09447f15906d8d11214944488341','0x3508dca95a64c9378cb07ef6f40553a50905372a','0xd36b6d646ac6e23672e9eedec558164c7f2d6deb','0x9e698d361bb2375bd335dad156accbbad45bf364','0x01a21c857a3219991fba2b1a2824b1b758966b54','0x296b00198dc7ec3410e12da814d9267bb8df506a','0x90497450f2a706f1951b5bdda52b4e5d16f34c06','0x168303a96a767e2a6b2e00cb862eb95e416f72fa'];

async function pullTicks(sb) {
  const probe = await sb.from('wss_price_ticks').select('*').eq('token_address', TOKEN).limit(1);
  if (probe.error) throw probe.error;
  const cols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : [];
  const sideKey = cols.includes('trade_type') ? 'trade_type' : 'event_type';
  const outlierKey = cols.includes('price_outlier') ? 'price_outlier' : 'is_price_outlier';
  const want = ['id', 'block_time', 'block_number', 'log_index', 'tx_hash', sideKey,
    'bnb_amount', 'token_amount', 'price_bnb', 'sender_address', 'trader_address', outlierKey].join(',');
  const rows = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select(want).eq('token_address', TOKEN).gt('id', cursor).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id > cursor) cursor = r.id;
    if (data.length < 1000) break;
  }
  rows.forEach(r => { r.is_price_outlier = r[outlierKey]; });
  rows.sort((a, b) => (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
  return { rows, sideKey };
}

const walletOf = r => lc(r.sender_address) || lc(r.trader_address);
const isRouterW = w => ROUTERS.includes(w);

function main_(rows, sideKey) {
  const buys = rows.filter(r => r[sideKey] === 'buy');
  const sells = rows.filter(r => r[sideKey] === 'sell');
  const relRows = rows.filter(r => !r.is_price_outlier && r.price_bnb > 0);
  const first = relRows[0]?.price_bnb, ath = Math.max(...relRows.map(r => r.price_bnb));
  const t0 = rows[0], tN = rows[rows.length - 1];
  console.log(`\n=== 票概况 ${TOKEN} ===`);
  console.log(`ticks=${rows.length} (buy=${buys.length} sell=${sells.length})  跨度 ${t0.block_time} → ${tN.block_time} (${((new Date(tN.block_time) - new Date(t0.block_time)) / 60000).toFixed(1)}min)`);
  console.log(`可靠价: 首=${first.toExponential(4)}  ATH=${ath.toExponential(4)} (+${((ath / first - 1) * 100).toFixed(1)}%)`);
  const totBuy = buys.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
  const totSell = sells.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
  console.log(`总买=${totBuy.toFixed(2)} BNB  总卖=${totSell.toFixed(2)} BNB`);

  // per-wallet
  const W = new Map();
  for (const r of rows) {
    const w = walletOf(r); if (!w) continue;
    let o = W.get(w);
    if (!o) { o = { w, buyN: 0, sellN: 0, buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, first: r, last: r, blocks: new Set() }; W.set(w, o); }
    const bnb = +r.bnb_amount || 0, tok = +r.token_amount || 0;
    if (r[sideKey] === 'buy') { o.buyN++; o.buyBnb += bnb; o.buyTok += tok; } else { o.sellN++; o.sellBnb += bnb; o.sellTok += tok; }
    o.last = r; o.blocks.add(r.block_number);
  }

  // block 结构
  const blockArr = new Map();
  for (const r of rows) {
    const w = walletOf(r); if (!w) continue;
    const k = r.block_number;
    if (!blockArr.has(k)) blockArr.set(k, []);
    blockArr.get(k).push({ r, w });
  }
  const eqClusters = [], washPairs = [], clusterBlocks = [], coordSellBlocks = [];
  for (const [blk, arr] of blockArr) {
    const bArr = arr.filter(x => x.r[sideKey] === 'buy'), sArr = arr.filter(x => x.r[sideKey] === 'sell');
    const bWallets = [...new Set(bArr.map(x => x.w))];
    if (bWallets.length >= 3) clusterBlocks.push({ blk, wallets: bWallets, bnb: bArr.reduce((s, x) => s + (+x.r.bnb_amount || 0), 0), t: bArr[0].r.block_time });
    const sWallets = [...new Set(sArr.map(x => x.w))];
    if (sWallets.length >= 3) coordSellBlocks.push({ blk, wallets: sWallets, bnb: sArr.reduce((s, x) => s + (+x.r.bnb_amount || 0), 0), t: sArr[0].r.block_time });
    const byAmt = new Map();
    for (const x of bArr) {
      if ((+x.r.bnb_amount || 0) < 0.001) continue;
      const k = (+x.r.bnb_amount).toFixed(4);
      (byAmt.get(k) || byAmt.set(k, []).get(k)).push(x);
    }
    for (const [amt, xs] of byAmt) {
      const ws = [...new Set(xs.map(x => x.w))];
      if (ws.length >= 2) eqClusters.push({ blk, amt, wallets: ws, t: xs[0].r.block_time });
    }
    for (const s of sArr) {
      if ((+s.r.bnb_amount || 0) < 0.001) continue;
      const lp = Math.log(+s.r.bnb_amount);
      for (const b of bArr) {
        if (b.w === s.w) continue;
        if ((+b.r.bnb_amount || 0) < 0.001) continue;
        if (Math.abs(Math.log(+b.r.bnb_amount) - lp) <= 0.02) { washPairs.push({ blk, seller: s.w, buyer: b.w, amt: (+s.r.bnb_amount).toFixed(4), t: s.r.block_time }); break; }
      }
    }
  }
  console.log(`\n=== 同块捆绑块（≥3 独立买钱包）共${clusterBlocks.length} top12 ===`);
  clusterBlocks.sort((a, b) => b.wallets.length - a.wallets.length);
  for (const c of clusterBlocks.slice(0, 12)) console.log(`blk=${c.blk} ${c.t.slice(11, 19)} 买钱包=${c.wallets.length} 买额=${c.bnb.toFixed(2)}B`);
  console.log(`\n=== 同块协同卖出块（≥3 独立卖钱包）共${coordSellBlocks.length} top12 ===`);
  coordSellBlocks.sort((a, b) => b.wallets.length - a.wallets.length);
  for (const c of coordSellBlocks.slice(0, 12)) console.log(`blk=${c.blk} ${c.t.slice(11, 19)} 卖钱包=${c.wallets.length} 卖额=${c.bnb.toFixed(2)}B`);
  console.log(`\n=== 同块等额买入簇（≥2 钱包 同额，尘门0.001）共 ${eqClusters.length} ===`);
  const eqWalletCount = new Map();
  for (const c of eqClusters) c.wallets.forEach(w => eqWalletCount.set(w, (eqWalletCount.get(w) || 0) + 1));
  eqClusters.slice(0, 30).forEach(c => console.log(`blk=${c.blk} ${c.t.slice(11, 19)} ${c.amt}B × ${c.wallets.length}钱包 ${c.wallets.slice(0, 6).map(x => x.slice(0, 8)).join(',')}${c.wallets.length > 6 ? '…' : ''}`));
  console.log(`\n=== 同块 卖→买 对数带±2%（wash 嫌疑对）共 ${washPairs.length} ===`);
  washPairs.slice(0, 20).forEach(p => console.log(`blk=${p.blk} ${p.t.slice(11, 19)} ${p.seller.slice(0, 8)}→${p.buyer.slice(0, 8)} ${p.amt}B`));

  // ── 共现图团伙：同 block 共现 pair ≥2 次建边，连通分量 ≥3 钱包 ──
  const pairCnt = new Map();
  const pk = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  for (const [, arr] of blockArr) {
    const ws = [...new Set(arr.map(x => x.w))];
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const k = pk(ws[i], ws[j]);
      pairCnt.set(k, (pairCnt.get(k) || 0) + 1);
    }
  }
  const edges = [...pairCnt.entries()].filter(([, n]) => n >= 2).map(([k, n]) => [...k.split('|'), n]);
  console.log(`\n=== 共现图：pair 总数=${pairCnt.size} 强边(≥2次共现)=${edges.length} ===`);
  const parent = new Map();
  const find = x => { let p = parent.get(x); if (p === undefined) { parent.set(x, x); return x; } if (p === x) return x; p = find(p); parent.set(x, p); return p; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of edges) { parent.set(e[0], parent.get(e[0]) ?? e[0]); parent.set(e[1], parent.get(e[1]) ?? e[1]); union(e[0], e[1]); }
  const comps = new Map();
  for (const w of parent.keys()) { const r = find(w); (comps.get(r) || comps.set(r, []).get(r)).push(w); }
  const crews = [...comps.values()].filter(a => a.length >= 3).sort((a, b) => b.length - a.length);
  console.log(`团伙候选（连通分量 ≥3 钱包）共 ${crews.length}：`);
  const crewSets = [];
  for (const crew of crews) {
    const set = new Set(crew);
    let buyBnb = 0, sellBnb = 0, buyN = 0, sellN = 0, firstT = null, lastT = null;
    for (const w of crew) { const o = W.get(w); buyBnb += o.buyBnb; sellBnb += o.sellBnb; buyN += o.buyN; sellN += o.sellN; if (!firstT || o.first.block_time < firstT) firstT = o.first.block_time; if (!lastT || o.last.block_time > lastT) lastT = o.last.block_time; }
    console.log(`\n-- 团伙（${crew.length} 钱包）买${buyBnb.toFixed(2)}B/${buyN}笔 卖${sellBnb.toFixed(2)}B/${sellN}笔 首末 ${firstT.slice(11, 19)}→${lastT.slice(11, 19)} 占总买${(buyBnb / totBuy * 100).toFixed(1)}% 总卖${(sellBnb / totSell * 100).toFixed(1)}%`);
    for (const w of crew) {
      const o = W.get(w);
      const fl = (new Date(o.last.block_time) - new Date(o.first.block_time)) / 1000;
      console.log(`   ${w} 买${o.buyBnb.toFixed(3)}B/${o.buyN} 卖${o.sellBnb.toFixed(3)}B/${o.sellN} 净tok${(o.buyTok - o.sellTok).toExponential(2)} fl=${fl.toFixed(0)}s eqC=${eqWalletCount.get(w) || 0} router=${isRouterW(w) ? 'Y' : 'n'}`);
    }
    crewSets.push(set);
  }

  // ── 团伙整体时间线 vs 价格（每 30s 桶：团伙买卖额 + 均价涨跌） ──
  if (crewSets.length) {
    const biggest = crewSets[0];
    console.log(`\n=== 最大团伙(${biggest.size}钱包) 时间线：30s 桶 团伙买/卖 vs 价格 ===`);
    const t0ms = new Date(t0.block_time).getTime();
    const buckets = new Map();
    for (const r of rows) {
      const w = walletOf(r);
      const b = Math.floor((new Date(r.block_time).getTime() - t0ms) / 30000);
      let o = buckets.get(b); if (!o) { o = { cBuy: 0, cSell: 0, oBuy: 0, oSell: 0, px: null, n: 0 }; buckets.set(b, o); }
      const bnb = +r.bnb_amount || 0;
      if (biggest.has(w)) { if (r[sideKey] === 'buy') { o.cBuy += bnb; } else o.cSell += bnb; }
      else { if (r[sideKey] === 'buy') o.oBuy += bnb; else o.oSell += bnb; }
      if (!r.is_price_outlier && r.price_bnb > 0) { o.px = r.price_bnb; }
      o.n++;
    }
    const basePx = first;
    for (const b of [...buckets.keys()].sort((a, b) => a - b)) {
      const o = buckets.get(b);
      if (o.cBuy < 0.01 && o.cSell < 0.01 && o.oBuy < 0.05 && o.oSell < 0.05 && o.n < 5) continue;
      const pct = o.px ? ((o.px / basePx - 1) * 100).toFixed(0).padStart(5) : '  n/a';
      const flag = (o.cBuy > 0.05 ? '◤团伙买' : '') + (o.cSell > 0.05 ? '◢团伙卖' : '');
      console.log(`t+${(b * 30 + 15)}s 价${pct}% 团买${o.cBuy.toFixed(2).padStart(6)} 团卖${o.cSell.toFixed(2).padStart(6)} | 它买${o.oBuy.toFixed(2).padStart(6)} 它卖${o.oSell.toFixed(2).padStart(6)} 行${String(o.n).padStart(3)} ${flag}`);
    }
  }

  console.log(`\n=== 钱包明细（按买额 top25；净B=买-卖；fl=首末秒差；eqC=等额簇次数）===`);
  const wl = [...W.values()].sort((a, b) => b.buyBnb - a.buyBnb);
  const fmt = o => {
    const fl = (new Date(o.last.block_time) - new Date(o.first.block_time)) / 1000;
    return `${o.w} 买${o.buyBnb.toFixed(3)}B/${o.buyN}笔 卖${o.sellBnb.toFixed(3)}B/${o.sellN}笔 净${(o.buyBnb - o.sellBnb).toFixed(3)}B 净tok${(o.buyTok - o.sellTok).toExponential(2)} fl=${fl.toFixed(0)}s 首@${o.first.block_time.slice(11, 19)} eqC=${eqWalletCount.get(o.w) || 0} blocks=${o.blocks.size} router=${isRouterW(o.w) ? 'Y' : 'n'}`;
  };
  wl.slice(0, 25).forEach(o => console.log(fmt(o)));
  console.log(`\n=== 钱包明细（按卖额 top15）===`);
  [...W.values()].sort((a, b) => b.sellBnb - a.sellBnb).slice(0, 15).forEach(o => console.log(fmt(o)));
}

async function main() {
  const sb = dbManager.getClient();
  const { data: ev } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(10);
  console.log('=== wss_events（token 级）===');
  for (const e of ev || []) {
    const p = e.payload || {};
    console.log(`${e.kind} ${e.block_time} sym=${p.symbol ?? p.name ?? '?'} creator=${lc(p.creator_address || p.creator || '')} ${e.kind === 'token_create' ? 'meta=' + JSON.stringify(p).slice(0, 260) : ''}`);
  }
  const { rows, sideKey } = await pullTicks(sb);
  if (!rows.length) { console.log('无 ticks'); process.exit(0); }
  main_(rows, sideKey);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
