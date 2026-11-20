#!/usr/bin/env node
// 0xa025 两波捆绑买入案 对照分布扫描（bt-v147 203 成交票）
// 候选因子：同块≥N钱包买入的「波数」/ 捆绑块买入占出生窗买入% / 跨波复购钱包数；T177 键复刻；as-of 首买
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const CASE = '0xa025b8d8fb396890c0b469d8f056727e99577777';
const WIN_MS = 90000;
const DUST = 0.015;

function metrics(ticks) {
  const t0 = new Date(ticks[0].block_time).getTime();
  const win = ticks.filter(r => new Date(r.block_time).getTime() - t0 <= WIN_MS);
  const wBuy = new Map(), wSell = new Map();
  const blkBuy = new Map(); // blk -> Map(wallet -> bnb)
  const blkSellW = new Map(); // blk -> Set(wallet)
  const firstBlk = new Map();
  for (const r of win) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (r.trade_type === 'buy') {
      if (!w) continue;
      wBuy.set(w, (wBuy.get(w) || 0) + r.bnb_amount);
      if (!firstBlk.has(w)) firstBlk.set(w, r.block_number);
      let m = blkBuy.get(r.block_number); if (!m) { m = new Map(); blkBuy.set(r.block_number, m); }
      m.set(w, (m.get(w) || 0) + r.bnb_amount);
    } else if (w) {
      wSell.set(w, (wSell.get(w) || 0) + r.bnb_amount);
      let s = blkSellW.get(r.block_number); if (!s) { s = new Set(); blkSellW.set(r.block_number, s); }
      s.add(w);
    }
  }
  let winBuyBnb = 0; for (const v of wBuy.values()) winBuyBnb += v;
  // 尘线过滤后的 per-block distinct 买钱包
  const blkSized = new Map(); // blk -> {wallets:Set, bnb}
  for (const [blk, m] of blkBuy) {
    const wallets = new Set(); let bnb = 0;
    for (const [w, v] of m) if ((wBuy.get(w) || 0) >= DUST) { wallets.add(w); bnb += v; }
    blkSized.set(blk, { wallets, bnb });
  }
  const bundleBlocks = (min) => [...blkSized.entries()].filter(([, c]) => c.wallets.size >= min);
  const waves3 = bundleBlocks(3).length, waves4 = bundleBlocks(4).length, waves5 = bundleBlocks(5).length;
  let maxBuyers = 0; for (const [, c] of blkSized) if (c.wallets.size > maxBuyers) maxBuyers = c.wallets.size;
  const dom3 = bundleBlocks(3).reduce((s, [, c]) => s + c.bnb, 0);
  const dom5 = bundleBlocks(5).reduce((s, [, c]) => s + c.bnb, 0);
  // 跨波复购：在 ≥2 个 bundle 块（≥3 钱包）买入的钱包数
  const appear = new Map();
  for (const [, c] of bundleBlocks(3)) for (const w of c.wallets) appear.set(w, (appear.get(w) || 0) + 1);
  let repeatW = 0; for (const n of appear.values()) if (n >= 2) repeatW++;
  // T177 复刻：首买簇 / 卖出簇
  const fbBlk = new Map();
  for (const [w, blk] of firstBlk) if ((wBuy.get(w) || 0) >= DUST) { let s = fbBlk.get(blk); if (!s) { s = new Set(); fbBlk.set(blk, s); } s.add(w); }
  let buyClu = 0; for (const [, s] of fbBlk) if (s.size > buyClu) buyClu = s.size;
  let sellClu = 0; for (const [, ws] of blkSellW) { let n = 0; for (const w of ws) if ((wSell.get(w) || 0) >= DUST) n++; if (n > sellClu) sellClu = n; }
  return { winBuyBnb, waves3, waves4, waves5, maxBuyers, dom3, dom5, repeatW, buyClu, sellClu };
}

async function main() {
  const sb = dbManager.getClient();
  const { data: trs } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP).order('created_at', { ascending: true }).limit(1000);
  const info = new Map();
  for (const t of trs || []) {
    let e = info.get(t.token_address); if (!e) { e = { buy: 0, sell: 0, firstBuyAt: null }; info.set(t.token_address, e); }
    if (t.trade_direction === 'buy') { e.buy += t.input_amount; if (!e.firstBuyAt) e.firstBuyAt = t.created_at; }
    else e.sell += t.output_amount;
  }
  const tokens = [...info.keys()];
  console.log('tokens:', tokens.length);

  // token_create 批量
  const createAt = new Map();
  for (let i = 0; i < tokens.length; i += 100) {
    const { data: evs } = await sb.from('wss_events').select('token_address,block_time').eq('kind', 'token_create').in('token_address', tokens.slice(i, i + 100));
    for (const e of evs || []) if (!createAt.has(e.token_address)) createAt.set(e.token_address, e.block_time);
  }

  const rows = [];
  for (const tok of tokens) {
    const from = createAt.get(tok); if (!from) continue;
    const to = new Date(new Date(from).getTime() + WIN_MS + 1000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,trade_type,trader_address,sender_address,bnb_amount')
      .eq('token_address', tok).gte('block_time', from).lte('block_time', to)
      .order('block_number', { ascending: true }).limit(3000);
    if (!ticks || ticks.length < 5) continue;
    const full = metrics(ticks);
    // as-of 首买
    const e = info.get(tok);
    let asof = null;
    if (e.firstBuyAt) {
      const cut = ticks.filter(r => r.block_time <= e.firstBuyAt);
      if (cut.length >= 3) asof = metrics(cut);
    }
    rows.push({
      tok, pnl: e.sell - e.buy, buy: e.buy,
      winBuyBnb: full.winBuyBnb, waves3: full.waves3, waves5: full.waves5, maxBuyers: full.maxBuyers,
      dom5Pct: full.winBuyBnb > 0 ? full.dom5 / full.winBuyBnb * 100 : 0,
      dom3Pct: full.winBuyBnb > 0 ? full.dom3 / full.winBuyBnb * 100 : 0,
      repeatW: full.repeatW, buyClu: full.buyClu, sellClu: full.sellClu,
      aWaves5: asof ? asof.waves5 : null, aDom5Pct: asof && asof.winBuyBnb > 0 ? asof.dom5 / asof.winBuyBnb * 100 : null,
      aRepeatW: asof ? asof.repeatW : null, aMaxBuyers: asof ? asof.maxBuyers : null,
    });
  }
  console.log('有效票:', rows.length);

  const dist = (name, fn) => {
    const buckets = [0, 0, 0, 0, 0];
    for (const r of rows) { const v = fn(r); if (v === null || v === undefined) continue; if (v >= 1) buckets[0]++; if (v >= 2) buckets[1]++; if (v >= 3) buckets[2]++; if (v >= 4) buckets[3]++; if (v >= 5) buckets[4]++; }
    console.log(`${name}: ≥1:${buckets[0]} ≥2:${buckets[1]} ≥3:${buckets[2]} ≥4:${buckets[3]} ≥5:${buckets[4]}`);
  };
  console.log('\n=== 分布（full 窗 / as-of 首买）===');
  dist('waves5(同块≥5钱包买入波数)', r => r.waves5);
  dist('waves5@asof', r => r.aWaves5);
  dist('waves3', r => r.waves3);
  dist('repeatW(跨bundle块复购钱包)', r => r.repeatW);
  dist('repeatW@asof', r => r.aRepeatW);
  const distPct = (name, fn) => {
    const th = [10, 20, 30, 40, 50, 60]; const c = th.map(() => 0);
    for (const r of rows) { const v = fn(r); if (v === null || v === undefined) continue; th.forEach((t, i) => { if (v >= t) c[i]++; }); }
    console.log(`${name}: ` + th.map((t, i) => `≥${t}%:${c[i]}`).join(' '));
  };
  distPct('dom5Pct(≥5钱包块买占窗买%)', r => r.dom5Pct);
  distPct('dom5Pct@asof', r => r.aDom5Pct);
  distPct('dom3Pct', r => r.dom3Pct);

  // 候选线命中面（含 PnL 合计）
  const hit = (name, fn) => {
    const m = rows.filter(fn);
    const pnl = m.reduce((s, r) => s + r.pnl, 0);
    console.log(`${name}: 命中 ${m.length}/${rows.length} 合计PnL=${pnl.toFixed(4)}B`);
    return m;
  };
  console.log('\n=== 候选线命中面 ===');
  const m1 = hit('waves5@asof≥2', r => (r.aWaves5 ?? 0) >= 2);
  console.log('  样例:', m1.slice(0, 15).map(r => `${r.tok.slice(0, 8)}(${r.aWaves5}波/${(r.aDom5Pct ?? 0).toFixed(0)}%/pnl${r.pnl.toFixed(3)})`).join(' '));
  const m2 = hit('waves5@asof≥2 ∧ aDom5≥30%', r => (r.aWaves5 ?? 0) >= 2 && (r.aDom5Pct ?? 0) >= 30);
  console.log('  明细:', m2.map(r => `${r.tok.slice(0, 8)}(${r.aWaves5}波/dom${(r.aDom5Pct ?? 0).toFixed(0)}%/rw${r.aRepeatW}/pnl${r.pnl.toFixed(3)})`).join(' '));
  const m3 = hit('aRepeatW≥6', r => (r.aRepeatW ?? 0) >= 6);
  console.log('  明细:', m3.map(r => `${r.tok.slice(0, 8)}(rw${r.aRepeatW}/w5${r.aWaves5}/dom${(r.aDom5Pct ?? 0).toFixed(0)}%/pnl${r.pnl.toFixed(3)})`).join(' '));
  const m4 = hit('aDom5≥40% 单线', r => (r.aDom5Pct ?? 0) >= 40);
  console.log('  明细:', m4.map(r => `${r.tok.slice(0, 8)}(dom${(r.aDom5Pct ?? 0).toFixed(0)}%/w5${r.aWaves5}/rw${r.aRepeatW}/pnl${r.pnl.toFixed(3)})`).join(' '));

  console.log('\n=== case 所在 ===');
  const c = rows.find(r => r.tok === CASE);
  console.log(JSON.stringify(c, null, 1));

  // dom5 高位区间全列（≥25%）
  console.log('\n=== dom5Pct@asof ≥25 全列 ===');
  for (const r of rows.filter(r => (r.aDom5Pct ?? 0) >= 25).sort((a, b) => b.aDom5Pct - a.aDom5Pct)) {
    console.log(`${r.tok} dom5=${(r.aDom5Pct ?? 0).toFixed(1)}% w5=${r.aWaves5} w3=${r.waves3} rw=${r.aRepeatW} maxB=${r.aMaxBuyers} clu=${r.buyClu}/${r.sellClu} pnl=${r.pnl.toFixed(4)} winBuy=${r.winBuyBnb.toFixed(1)}B`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
