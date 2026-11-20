#!/usr/bin/env node
// 0x5629 作市团队取证·第一步：本票全量 ticks 形状分析（同块簇/等额分仓/对敲/快闪），找出团队钱包
const { dbManager } = require('../src/services/dbManager');

const TOKEN = process.env.TOKEN || '0x5629140e4033fcb352a06aeb7a60a734acc77777';
const lc = s => (s || '').toLowerCase();

async function pullTicks(sb) {
  const probe = await sb.from('wss_price_ticks').select('*').eq('token_address', TOKEN).limit(1);
  if (probe.error) throw probe.error;
  const cols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : [];
  const sideKey = cols.includes('trade_type') ? 'trade_type' : 'event_type';
  console.log('[probe] 行列名含 trade_type?', cols.includes('trade_type'), '→ 判向键 =', sideKey);
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

function walletOf(r) {
  return lc(r.sender_address) || lc(r.trader_address);
}

function main_(rows, sideKey) {
  const buys = rows.filter(r => r[sideKey] === 'buy');
  const sells = rows.filter(r => r[sideKey] === 'sell');
  const t0 = rows[0], tN = rows[rows.length - 1];
  const prices = rows.filter(r => !r.is_price_outlier && r.price_bnb > 0).map(r => r.price_bnb);
  const ath = Math.max(...prices), first = prices[0], last = prices[prices.length - 1];
  console.log(`\n=== 票概况 ${TOKEN} ===`);
  console.log(`ticks=${rows.length} (buy=${buys.length} sell=${sells.length})  跨度 ${t0.block_time} → ${tN.block_time}`);
  console.log(`可靠价: 首=${first.toExponential(4)}  ATH=${ath.toExponential(4)} (+${((ath / first - 1) * 100).toFixed(1)}%)  尾=${last.toExponential(4)} (${((last / first - 1) * 100).toFixed(1)}%)`);
  const totBuy = buys.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
  const totSell = sells.reduce((s, r) => s + (+r.bnb_amount || 0), 0);
  console.log(`总买=${totBuy.toFixed(2)} BNB  总卖=${totSell.toFixed(2)} BNB  毕业进度(÷15.998)=${(totBuy * 0.98 / 15.99808481559237 * 100).toFixed(1)}%`);

  // per-wallet 聚合
  const W = new Map();
  const note = (r) => {
    const w = walletOf(r);
    if (!w) return;
    let o = W.get(w);
    if (!o) { o = { w, buyN: 0, sellN: 0, buyBnb: 0, sellBnb: 0, buyTok: 0, sellTok: 0, first: r, last: r, blocks: new Set(), sellsInBuyBlock: 0 }; W.set(w, o); }
    const bnb = +r.bnb_amount || 0, tok = +r.token_amount || 0;
    if (r[sideKey] === 'buy') { o.buyN++; o.buyBnb += bnb; o.buyTok += tok; } else { o.sellN++; o.sellBnb += bnb; o.sellTok += tok; }
    o.last = r;
    o.blocks.add(r.block_number);
  };
  rows.forEach(note);

  // 同块结构：block → 买钱包列表 / 等额簇 / wash pair（同块 卖→买 ±2% 对数带）
  const blockBuys = new Map(), blockSells = new Map(), blockAll = new Map();
  for (const r of rows) {
    const w = walletOf(r); if (!w) continue;
    const k = r.block_number;
    if (!blockAll.has(k)) blockAll.set(k, []);
    blockAll.get(k).push({ r, w });
    if (r[sideKey] === 'buy') (blockBuys.get(k) || blockBuys.set(k, []).get(k)).push({ r, w });
    else (blockSells.get(k) || blockSells.set(k, []).get(k)).push({ r, w });
  }
  const eqClusters = []; // 等额同块买入簇（≥2 钱包，尘门 0.001）
  const washPairs = [];  // 同块 卖→买 对数带 ±2%
  const clusterBlocks = [];
  for (const [blk, arr] of blockBuys) {
    const wallets = [...new Set(arr.map(x => x.w))];
    if (wallets.length >= 3) clusterBlocks.push({ blk, wallets, bnb: arr.reduce((s, x) => s + (+x.r.bnb_amount || 0), 0), t: arr[0].r.block_time });
    const byAmt = new Map();
    for (const x of arr) {
      if ((+x.r.bnb_amount || 0) < 0.001) continue;
      const k = (+x.r.bnb_amount).toFixed(4);
      (byAmt.get(k) || byAmt.set(k, []).get(k)).push(x);
    }
    for (const [amt, xs] of byAmt) {
      const ws = [...new Set(xs.map(x => x.w))];
      if (ws.length >= 2) eqClusters.push({ blk, amt, wallets: ws, t: xs[0].r.block_time });
    }
  }
  for (const [blk, sArr] of blockSells) {
    const bArr = blockBuys.get(blk) || [];
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

  console.log(`\n=== 同块捆绑块（≥3 独立买钱包）top12 ===`);
  clusterBlocks.sort((a, b) => b.wallets.length - a.wallets.length);
  for (const c of clusterBlocks.slice(0, 12)) console.log(`blk=${c.blk} ${c.t} 钱包数=${c.wallets.length} 买额=${c.bnb.toFixed(2)}B`);
  console.log(`\n=== 同块等额买入簇（≥2 钱包 同额 toFixed4，尘门0.001）共 ${eqClusters.length} ===`);
  const eqWalletCount = new Map();
  for (const c of eqClusters) c.wallets.forEach(w => eqWalletCount.set(w, (eqWalletCount.get(w) || 0) + 1));
  eqClusters.slice(0, 25).forEach(c => console.log(`blk=${c.blk} ${c.t} ${c.amt}B × ${c.wallets.length}钱包 ${c.wallets.slice(0, 6).map(x => x.slice(0, 10)).join(',')}${c.wallets.length > 6 ? '…' : ''}`));
  console.log(`\n=== 同块 卖→买 对数带±2%（wash 嫌疑对）共 ${washPairs.length} ===`);
  const washCnt = new Map();
  for (const p of washPairs) { washCnt.set(p.seller, (washCnt.get(p.seller) || 0) + 1); washCnt.set(p.buyer, (washCnt.get(p.buyer) || 0) + 1); }
  washPairs.slice(0, 25).forEach(p => console.log(`blk=${p.blk} ${p.t} ${p.seller.slice(0, 10)}→${p.buyer.slice(0, 10)} ${p.amt}B`));

  console.log(`\n=== 钱包明细（按买额 top25；净B=买-卖；fl=首末秒差；eqC=等额簇次数 wC=wash次数）===`);
  const wl = [...W.values()].sort((a, b) => b.buyBnb - a.buyBnb);
  const fmt = o => {
    const fl = (new Date(o.last.block_time) - new Date(o.first.block_time)) / 1000;
    const netTok = o.buyTok - o.sellTok;
    const eq = eqWalletCount.get(o.w) || 0, wc = washCnt.get(o.w) || 0;
    return `${o.w} 买${o.buyBnb.toFixed(3)}B/${o.buyN}笔 卖${o.sellBnb.toFixed(3)}B/${o.sellN}笔 净${(o.buyBnb - o.sellBnb).toFixed(3)}B 净tok${netTok.toExponential(2)} fl=${fl.toFixed(0)}s 首价${(+o.first.price_bnb).toExponential(3)}@${o.first.block_time.slice(11, 19)} eqC=${eq} wC=${wc} blocks=${o.blocks.size}`;
  };
  wl.slice(0, 25).forEach(o => console.log(fmt(o)));
  console.log(`\n=== 钱包明细（按卖额 top15）===`);
  [...W.values()].sort((a, b) => b.sellBnb - a.sellBnb).slice(0, 15).forEach(o => console.log(fmt(o)));

  // 同秒/相邻秒协同：同一秒内 ≥3 钱包同向
  const secMap = new Map();
  for (const r of rows) {
    const k = r.block_time.slice(0, 19);
    if (!secMap.has(k)) secMap.set(k, []);
    secMap.get(k).push({ r, w: walletOf(r) });
  }
  const coordSecs = [...secMap.entries()].filter(([, a]) => new Set(a.map(x => x.w)).size >= 3).sort((a, b) => b[1].length - a[1].length);
  console.log(`\n=== 同秒 ≥3 钱包协同秒 top10（共${coordSecs.length}）===`);
  for (const [k, a] of coordSecs.slice(0, 10)) console.log(`${k} ${a.length}行/${new Set(a.map(x => x.w)).size}钱包 买/卖=${a.filter(x => x.r[sideKey] === 'buy').length}/${a.filter(x => x.r[sideKey] === 'sell').length}`);

  // 输出候选团队钱包（等额簇∪wash∪同块簇成员，按参与次数）
  const cand = new Map();
  for (const c of eqClusters) c.wallets.forEach(w => cand.set(w, (cand.get(w) || 0) + 1));
  for (const c of clusterBlocks) c.wallets.forEach(w => cand.set(w, (cand.get(w) || 0) + 1));
  console.log(`\n=== 候选团队钱包（簇参与次数 top20）===`);
  [...cand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([w, n]) => {
    const o = W.get(w);
    console.log(`${w} 簇参与=${n} ${o ? `买${o.buyBnb.toFixed(3)}B 卖${o.sellBnb.toFixed(3)}B fl=${((new Date(o.last.block_time) - new Date(o.first.block_time)) / 1000).toFixed(0)}s` : ''}`);
  });
}

async function main() {
  const sb = dbManager.getClient();
  const { data: ev } = await sb.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(10);
  console.log('=== wss_events（token 级）===');
  for (const e of ev || []) {
    const p = e.payload || {};
    console.log(`${e.kind} ${e.block_time} sym=${p.symbol ?? p.name ?? '?'} creator=${lc(p.creator_address || p.creator || '')} ${e.kind === 'token_create' ? 'meta=' + JSON.stringify(p).slice(0, 220) : ''}`);
  }
  const { rows, sideKey } = await pullTicks(sb);
  if (!rows.length) { console.log('无 ticks'); process.exit(0); }
  main_(rows, sideKey);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
