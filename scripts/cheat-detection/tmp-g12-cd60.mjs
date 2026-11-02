// 组 12 CD60 TROLLON 0x3dbf…7777 healthy 裁定质询（零 Jev 配额）：
// ①insider_supply_sell=strong（低置信 0.37）明细：窗内卖出 4 笔的构成、
//   卖出钱包买入对照（买入<卖出10% =配额钱包）、createTx 同笔、creator 分批卖三件
// ②same_block_buy_wave=strong（贴线 0.48vs0.47）归因：5 个同块簇构成+簇钱包后续（持有 or 卖走）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const ADDR = '0x3dbf41d0abf4f791d57fb834395bb0ee96ce7777';

// 1) createTx meta（state [TOKEN] createTx= 行来源；形态对齐 Service _loadCreateMeta）
const ev = await c.from('wss_events')
  .select('payload')
  .eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
if (ev.error) throw new Error(ev.error.message);
const createRow = ev.data?.[0];
console.log('[CREATE] rows=', ev.data?.length, ' payload=', JSON.stringify(createRow?.payload ?? null) ?? 'null');
const createTx = createRow?.payload?.txHash || createRow?.payload?.tx_hash || null;

// 2) 全量 ticks 链序
const { data, error } = await c.from('wss_price_ticks')
  .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
  .eq('token_address', ADDR)
  .order('block_number', { ascending: true })
  .order('log_index', { ascending: true })
  .limit(3000);
if (error) throw new Error(error.message);
const all = data ?? [];
const W = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
console.log('total rows:', all.length);

// 3) 锚窗 48 行逐行
const win = all.slice(0, 48);
const T0 = Date.parse(win[0].block_time);
console.log(`══ 锚窗 48 行跨 ${Math.round((Date.parse(win[47].block_time) - T0) / 1000)}s ══`);
for (const r of win) {
  const t = ((Date.parse(r.block_time) - T0) / 1000).toFixed(0).padStart(4);
  console.log(`t+${t}s ${W(r).slice(0, 10)} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} @${Number(r.price_bnb).toExponential(2)} blk=${r.block_number} tx=${r.tx_hash?.slice(0, 10)}`);
}

// 4) 卖出钱包买入对照（rat 判据：买入额不足卖出额 10% = 配额钱包）
const agg = {};
for (const r of win) {
  const w = W(r);
  (agg[w] = agg[w] || { buy: 0, sell: 0, buyN: 0, sellN: 0, blocks: new Set(), txs: new Set() });
  const a = agg[w];
  if (r.trade_type === 'buy') { a.buy += r.bnb_amount; a.buyN++; } else { a.sell += r.bnb_amount; a.sellN++; }
  a.blocks.add(r.block_number); a.txs.add(r.tx_hash);
}
const totalSell = win.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
console.log(`\n══ 窗内卖出明细（合计 ${totalSell.toFixed(4)} BNB / ${win.filter((r) => r.trade_type === 'sell').length} 笔）══`);
const quotaWallets = [];
for (const [w, a] of Object.entries(agg)) {
  if (a.sell > 0) {
    const isQuota = a.buy < a.sell * 0.1;
    if (isQuota) quotaWallets.push([w, a]);
    console.log(`${w.slice(0, 10)} 买 ${a.buy.toFixed(4)}/${a.buyN}笔 卖 ${a.sell.toFixed(4)}/${a.sellN}笔 ${isQuota ? '←配额钱包(买入<卖出10%)' : '（有足额买入）'}`);
  }
}
const quotaSell = quotaWallets.reduce((s, [, a]) => s + a.sell, 0);
console.log(`配额钱包卖出合计 ${quotaSell.toFixed(4)} = 窗内总卖出 ${(quotaSell / totalSell * 100).toFixed(1)}%`);

// 5) creator 全链行为
const creator = (createRow?.payload?.creator || createRow?.payload?.creatorAddress || '').toLowerCase();
console.log(`\n══ creator=${creator ? creator.slice(0, 10) : '（payload 缺 creator）'} 全链行为 ══`);
if (creator) {
  let buy = 0, sell = 0, firstBuyTx = null, tFirstBuy = null;
  for (const r of all) {
    if (W(r) !== creator) continue;
    if (r.trade_type === 'buy') { if (!firstBuyTx) { firstBuyTx = r.tx_hash; tFirstBuy = r.block_time; } buy += r.bnb_amount; }
    else sell += r.bnb_amount;
    console.log(`  ${r.block_time?.slice(11, 19)} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} blk=${r.block_number} tx=${r.tx_hash?.slice(0, 10)}`);
  }
  const firstBuyShare = buy / win.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0) * 100;
  console.log(`creator 合计买 ${buy.toFixed(4)} 卖 ${sell.toFixed(4)}；首买 tx=${firstBuyTx?.slice(0, 10)} ${firstBuyTx && createTx && firstBuyTx.toLowerCase() === createTx.toLowerCase() ? '=createTx 同笔！' : (createTx ? '≠createTx' : '（createTx 缺席）')}；窗内买占比 ${firstBuyShare.toFixed(1)}%`);
}

// 6) 同块簇构成+后续（bw 归因：簇钱包持有=主导筹码 vs 卖走=刷量；同 tx 打包=最硬）
console.log(`\n══ 同块簇（锚窗买入，单块 ≥3 笔）══`);
const byBlk = {};
for (const r of win) if (r.trade_type === 'buy') { const k = r.block_number; (byBlk[k] = byBlk[k] || []).push(r); }
const winBuyTotal = win.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
for (const [blk, rs] of Object.entries(byBlk).sort((a, b) => b[1].length - a[1].length)) {
  if (rs.length < 3) continue;
  const wallets = [...new Set(rs.map(W))];
  const txs = [...new Set(rs.map((r) => r.tx_hash))];
  const amt = rs.reduce((a, r) => a + r.bnb_amount, 0);
  // 簇钱包后续行为（全史）
  const later = { buy: 0, sell: 0, hold: 0 };
  for (const r of all) {
    if (!wallets.includes(W(r))) continue;
    if (r.trade_type === 'buy') later.buy += r.bnb_amount; else later.sell += r.bnb_amount;
  }
  later.hold = later.buy - later.sell;
  console.log(`blk ${blk}: ${rs.length} 笔 ${amt.toFixed(4)} BNB（占窗内买 ${((amt / winBuyTotal) * 100).toFixed(1)}%）${wallets.length} 钱包 ${txs.length === 1 ? '★同 tx=' + txs[0].slice(0, 10) + '（打包最硬）' : txs.length + ' 个 tx'} 金额 ${rs.map((r) => Number(r.bnb_amount).toFixed(4)).join(',')} ；全史净持仓 ${(later.hold).toFixed(4)}（买 ${later.buy.toFixed(3)}/卖 ${later.sell.toFixed(3)}）`);
}

// 7) 全史弧线（13s ATH 后怎么走）
{
  const span = ((Date.parse(all[all.length - 1].block_time) - T0) / 60000).toFixed(1);
  console.log(`\n══ 全史 ${all.length} 行跨 ${span} 分 ══`);
  let peak = 0, lastP = null;
  for (const r of all) if (r.price_bnb > peak) peak = r.price_bnb;
  lastP = all[all.length - 1].price_bnb;
  const bAll = all.filter((r) => r.trade_type === 'buy');
  const sAll = all.filter((r) => r.trade_type === 'sell');
  console.log(`全史买 ${bAll.length} 笔 ${bAll.reduce((a, r) => a + r.bnb_amount, 0).toFixed(2)} / 卖 ${sAll.length} 笔 ${sAll.reduce((a, r) => a + r.bnb_amount, 0).toFixed(2)}；价 first→ATH ${peak.toExponential(2)}→last ${Number(lastP).toExponential(2)}`);
  // 尾段 30 行
  console.log('尾 15 行：');
  for (const r of all.slice(-15)) {
    const t = ((Date.parse(r.block_time) - T0) / 1000).toFixed(0);
    console.log(`  t+${t}s ${W(r).slice(0, 10)} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)}`);
  }
}
process.exit(0);
