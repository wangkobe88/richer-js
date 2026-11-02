const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x23f1c4afb4ec09fbde68166bff0adbc5d1d57777';
const AGG = '0x1de460'; // GMGN 聚合路由前缀（trader 层）

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  // 0) 平台与创建
  const { data: ev } = await client.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', TOKEN).order('block_time').limit(10);
  const created = (ev || []).find(e => e.kind === 'token_create');
  const createdMs = created ? Date.parse(created.block_time) : null;
  console.log('=== 基本面 ===');
  console.log('platform:', created?.payload?.platform ?? '?', ' created_at:', created?.block_time);

  // 1) 全 ticks
  const { data: ticks, error } = await client.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(50000);
  if (error) { console.error('ticks err:', error.message); process.exit(1); }
  console.log('total ticks:', ticks.length, ' range:', ticks[0]?.block_time, '~', ticks[ticks.length - 1]?.block_time);

  const buys = ticks.filter(t => t.trade_type === 'buy');
  const sells = ticks.filter(t => t.trade_type === 'sell');
  console.log('buys:', buys.length, ' sells:', sells.length,
    ' buyBnb:', buys.reduce((s, t) => s + (t.bnb_amount || 0), 0).toFixed(3),
    ' sellBnb:', sells.reduce((s, t) => s + (t.bnb_amount || 0), 0).toFixed(3),
    ' outlier:', ticks.filter(t => t.price_outlier).length);

  const wallet = (t) => t.sender_address || t.trader_address;
  const totalBuyBnb = buys.reduce((s, t) => s + (t.bnb_amount || 0), 0);

  // 2) 价格轨迹（可靠价链）
  let max = 0, maxT = null; const rel = ticks.filter(t => !t.price_outlier && t.price_bnb);
  for (const t of rel) if (t.price_bnb > max) { max = t.price_bnb; maxT = t.block_time; }
  const first = rel[0], last = rel[rel.length - 1];
  console.log('\n=== 价格 ===');
  console.log('首价:', first?.price_bnb?.toExponential(3), first?.block_time, ' age:', createdMs ? ((Date.parse(first.block_time) - createdMs) / 1000).toFixed(0) + 's' : '?');
  console.log('ATH:', max.toExponential(3), maxT, ' age:', createdMs ? ((Date.parse(maxT) - createdMs) / 1000).toFixed(0) + 's' : '?');
  console.log('末价:', last?.price_bnb?.toExponential(3), last?.block_time, ' vs ATH:', ((last.price_bnb / max - 1) * 100).toFixed(1) + '%');

  // 3) 钱包买入结构
  const perWallet = new Map(); // w -> {buyBnb,buyN,sellBnb,sellN,firstBuyMs,lastActMs,blocks:Set}
  for (const t of ticks) {
    const w = wallet(t); if (!w) continue;
    let e = perWallet.get(w); if (!e) { e = { buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0, firstBuyMs: null, lastActMs: 0, blocks: new Set() }; perWallet.set(w, e); }
    const ms = Date.parse(t.block_time);
    if (t.trade_type === 'buy') { e.buyBnb += t.bnb_amount || 0; e.buyN++; if (e.firstBuyMs === null) e.firstBuyMs = ms; }
    else { e.sellBnb += t.bnb_amount || 0; e.sellN++; }
    e.lastActMs = Math.max(e.lastActMs, ms); e.blocks.add(t.block_number);
  }
  const rank = [...perWallet.entries()].sort((a, b) => b[1].buyBnb - a[1].buyBnb);
  const t1 = rank[0]?.[1].buyBnb || 0, t2 = (rank[0]?.[1].buyBnb || 0) + (rank[1]?.[1].buyBnb || 0);
  console.log('\n=== 钱包结构 ===');
  console.log('独立钱包数:', rank.length, ' top1买占比:', (t1 / totalBuyBnb * 100).toFixed(1) + '%', ' top2:', (t2 / totalBuyBnb * 100).toFixed(1) + '%');
  console.log('前 12 买入钱包:');
  for (const [w, e] of rank.slice(0, 12)) {
    console.log(' ', w.slice(0, 10), ' buy', e.buyBnb.toFixed(3), 'BNB ×' + e.buyN, ' sell', e.sellBnb.toFixed(3), '×' + e.sellN,
      ' 首买 age:', createdMs && e.firstBuyMs ? ((e.firstBuyMs - createdMs) / 1000).toFixed(0) + 's' : '-');
  }
  const nullSender = ticks.filter(t => !t.sender_address).length;
  const aggTrader = ticks.filter(t => (t.trader_address || '').toLowerCase().startsWith(AGG)).length;
  console.log('sender NULL 行:', nullSender, '/', ticks.length, ' GMGN聚合路由行:', aggTrader, '/', ticks.length);

  // 4) 同块买入簇
  const blockBuys = new Map();
  for (const t of buys) { const k = t.block_number; if (!blockBuys.has(k)) blockBuys.set(k, []); blockBuys.get(k).push(t); }
  const clusters = [...blockBuys.entries()].filter(([, a]) => a.length >= 3).sort((a, b) => b[1].length - a[1].length);
  console.log('\n=== 同块买入簇（≥3 笔/块）===');
  console.log('簇数:', clusters.length, ' 簇内总笔数:', clusters.reduce((s, [, a]) => s + a.length, 0), '/', buys.length);
  for (const [blk, a] of clusters.slice(0, 8)) {
    const ws = [...new Set(a.map(wallet))];
    console.log(' block', blk, a.length + '笔', new Set(ws).size + ' 钱包', 'Σ' + a.reduce((s, t) => s + t.bnb_amount, 0).toFixed(3) + ' BNB', ' age:', createdMs ? ((Date.parse(a[0].block_time) - createdMs) / 1000).toFixed(0) + 's' : '?');
  }

  // 5) 等额买入簇（四位舍入 0.0001 BNB，T74 口径）
  const even = new Map();
  for (const t of buys) { const k = Math.round((t.bnb_amount || 0) * 10000); if (!even.has(k)) even.set(k, []); even.get(k).push(t); }
  const evenHits = [...even.entries()].filter(([, a]) => a.length >= 3 && a[0].bnb_amount >= 0.001).sort((a, b) => b[1].length - a[1].length);
  console.log('\n=== 等额买入簇（≥3 笔同额 ≥0.001 BNB）===');
  for (const [k, a] of evenHits.slice(0, 8)) {
    const ws = [...new Set(a.map(wallet))];
    console.log(' ', (k / 10000).toFixed(4), 'BNB ×' + a.length, ws.size + ' 钱包', ' 首笔 age:', createdMs ? ((Date.parse(a[0].block_time) - createdMs) / 1000).toFixed(0) + 's' : '?',
      ' 尾号:', ws.map(w => w.slice(-4)).join(','));
  }

  // 6) 快进快出（买→首卖间隔 <60s 的钱包）
  console.log('\n=== 快进快出（首买→首卖 <60s）===');
  const scalpers = [];
  for (const [w, e] of perWallet) {
    if (!e.firstBuyMs || !e.sellN) continue;
    const firstSell = ticks.filter(t => wallet(t) === w && t.trade_type === 'sell')[0];
    if (firstSell) {
      const d = (Date.parse(firstSell.block_time) - e.firstBuyMs) / 1000;
      if (d < 60) scalpers.push({ w, d, buyBnb: e.buyBnb, sellBnb: e.sellBnb });
    }
  }
  scalpers.sort((a, b) => a.d - b.d);
  console.log('钱包数:', scalpers.length, ' Σ买:', scalpers.reduce((s, x) => s + x.buyBnb, 0).toFixed(3), 'BNB Σ卖:', scalpers.reduce((s, x) => s + x.sellBnb, 0).toFixed(3));
  for (const x of scalpers.slice(0, 10)) console.log(' ', x.w.slice(0, 10), ' 买', x.buyBnb.toFixed(3), '→卖', x.sellBnb.toFixed(3), ' 间隔', x.d.toFixed(0) + 's');

  // 7) 卖出集中度与节奏
  const sellRank = [...perWallet.entries()].filter(([, e]) => e.sellBnb > 0).sort((a, b) => b[1].sellBnb - a[1].sellBnb);
  const totalSellBnb = sells.reduce((s, t) => s + (t.bnb_amount || 0), 0);
  console.log('\n=== 卖出 ===');
  console.log('卖钱包数:', sellRank.length, ' top1卖占比:', sellRank.length ? (sellRank[0][1].sellBnb / totalSellBnb * 100).toFixed(1) + '%' : '-');
  for (const [w, e] of sellRank.slice(0, 6)) console.log(' ', w.slice(0, 10), ' sell', e.sellBnb.toFixed(3), '×' + e.sellN, ' 曾买', e.buyBnb.toFixed(3));
  // 每 60s 买卖量序列
  console.log('\n每 2min 买卖量（age 秒计）:');
  const bucket = new Map();
  for (const t of ticks) {
    const age = createdMs ? Math.floor((Date.parse(t.block_time) - createdMs) / 120000) : null; if (age === null) continue;
    if (!bucket.has(age)) bucket.set(age, { b: 0, s: 0, n: 0 });
    const e = bucket.get(age); if (t.trade_type === 'buy') e.b += t.bnb_amount || 0; else e.s += t.bnb_amount || 0; e.n++;
  }
  for (const [k, e] of [...bucket.entries()].sort((a, b) => a[0] - b[0])) {
    if (e.n < 2 && k > 20) continue;
    console.log(' ', (k * 120 / 60).toFixed(1) + 'min', ' buy', e.b.toFixed(3), ' sell', e.s.toFixed(3), ' ×' + e.n);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
