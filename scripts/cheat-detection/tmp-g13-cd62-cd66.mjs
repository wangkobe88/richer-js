// 组 13 双质询归因探针（零 Jev 配额）：
// ①CD62 unhealthy 但 bw=strong 疑误伤——归因：同块波有无结构证据（同 tx 打包/金额同质化）
//    还是纯同时性；密度（行/分钟）是否够 D3.16 ②高密度反锚阈值（≥70/min）
// ②CD66 unhealthy 非作弊（前期狙击手多+KOL 0x3472 早参与）——验证 sniper 打新潮假说：
//    买入时间分布（首几块集中 vs 持续全窗）、等额簇金额档位、KOL 参与位置
// ③CD67 cheat（作弊无疑）对照：同口径并排
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const TICKETS = [
  { id: 'CD62', addr: '0xc83fe64da5be4a5ac39e53ecadecdb32f2fa7777', anchor: 47 },
  { id: 'CD66', addr: '0xbdb9f5a1f610b421b76282b75a1444255bc77777', anchor: 77 },
  { id: 'CD67', addr: '0x63986ea6f6af2215c4be4cec606e10ef071f7777', anchor: 52 },
];
const KOL = '0x3472ccf6209925204b9cf352171ee150904fda7e';
const W = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

for (const tk of TICKETS) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,sender_address,trader_address')
    .eq('token_address', tk.addr)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  const win = (data ?? []).slice(0, tk.anchor);
  const t0 = Date.parse(win[0].block_time);
  const t1 = Date.parse(win[win.length - 1].block_time);
  const winSec = (t1 - t0) / 1000;
  const buys = win.filter((r) => r.trade_type === 'buy');
  const totBuy = buys.reduce((s, r) => s + Number(r.bnb_amount), 0);

  console.log(`\n===== ${tk.id} ${tk.addr.slice(0, 10)} 锚=${tk.anchor} =====`);
  console.log(`窗长=${winSec.toFixed(1)}s 密度=${(win.length / (winSec / 60)).toFixed(1)} 行/分 | 买 ${buys.length} 笔 Σ${totBuy.toFixed(3)} | 卖 ${win.length - buys.length} 笔 | t0=${win[0].block_time.slice(11, 19)}`);

  // ── 1) 买入按 block 分组（波形状）
  const byBlock = new Map();
  for (const r of buys) {
    const k = r.block_number;
    if (!byBlock.has(k)) byBlock.set(k, []);
    byBlock.get(k).push(r);
  }
  const waveBlocks = [...byBlock.entries()]
    .map(([blk, rows]) => ({
      blk,
      rows,
      wallets: new Set(rows.map(W)).size,
      amt: rows.reduce((s, r) => s + Number(r.bnb_amount), 0),
      txs: new Set(rows.map((r) => r.tx_hash)),
      t: ((Date.parse(rows[0].block_time) - t0) / 1000).toFixed(1),
    }))
    .filter((b) => b.rows.length >= 3 && b.wallets >= 3)
    .sort((a, b) => b.amt - a.amt);
  const waveBuy = waveBlocks.reduce((s, b) => s + b.amt, 0);
  console.log(`-- 同块波（≥3笔≥3钱包）：${waveBlocks.length} 个块 | 波买入 Σ${waveBuy.toFixed(3)} 占总买 ${((waveBuy / totBuy) * 100).toFixed(1)}%`);
  for (const b of waveBlocks.slice(0, 10)) {
    const amts = b.rows.map((r) => Number(r.bnb_amount).toFixed(4));
    const sameTx = b.txs.size < b.rows.length ? ` ⚠同tx打包(${b.txs.size}tx/${b.rows.length}行)` : ` 独立tx(${b.txs.size})`;
    console.log(`  blk ${b.blk} t+${b.t}s ${b.rows.length}笔/${b.wallets}钱包 Σ${b.amt.toFixed(3)}${sameTx} 金额[${amts.join(' ')}]`);
  }
  // 全部买入块的时间分布（前 12 块）
  console.log('-- 买入块时序（块→t+/笔/钱包/Σ额，前 14 个有买入的块）：');
  let bi = 0;
  for (const [blk, rows] of byBlock) {
    if (bi++ >= 14) break;
    const t = ((Date.parse(rows[0].block_time) - t0) / 1000).toFixed(1);
    console.log(`  blk ${blk} t+${t}s ${rows.length}笔/${new Set(rows.map(W)).size}钱包 Σ${rows.reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(3)}`);
  }

  // ── 2) 买入金额聚带（带内 max/min ≤1.5）
  const sorted = buys.map((r) => ({ a: Number(r.bnb_amount), w: W(r), t: ((Date.parse(r.block_time) - t0) / 1000).toFixed(1) })).sort((x, y) => x.a - y.a);
  const bands = [];
  for (const r of sorted) {
    const last = bands[bands.length - 1];
    if (last && r.a <= last.max * 1.5) { last.rows.push(r); last.max = r.a; }
    else bands.push({ min: r.a, max: r.a, rows: [r] });
  }
  console.log('-- 买入金额聚带（≤1.5 带内比，按额排序）：');
  for (const b of bands) {
    const wallets = new Set(b.rows.map((r) => r.w)).size;
    const sum = b.rows.reduce((s, r) => s + r.a, 0);
    if (sum < totBuy * 0.02 && b.rows.length < 3) continue; // 尘带折叠
    const ts = [...new Set(b.rows.map((r) => r.t))];
    console.log(`  带 ${b.min.toFixed(4)}~${b.max.toFixed(4)} ${b.rows.length}笔/${wallets}钱包 Σ${sum.toFixed(3)} 占${((sum / totBuy) * 100).toFixed(1)}% t+[${ts.slice(0, 8).join(',')}${ts.length > 8 ? '…' : ''}]`);
  }

  // ── 3) 同块波成员窗末净持仓（在场与否）
  const agg = new Map();
  for (const r of win) {
    const w = W(r); if (!w) continue;
    const a = agg.get(w) || 0;
    agg.set(w, a + (r.trade_type === 'buy' ? Number(r.bnb_amount) : -Number(r.bnb_amount)));
  }
  const waveWallets = new Set(waveBlocks.flatMap((b) => b.rows.map(W)));
  let posSum = 0, inField = 0;
  for (const w of waveWallets) {
    const p = agg.get(w) || 0;
    if (p > 0) { inField++; posSum += p; }
  }
  const allPos = [...agg.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  console.log(`-- 波成员 ${waveWallets.size} 钱包：窗末仍在场(正净) ${inField} 个，正净合计 ${posSum.toFixed(3)} ÷ 全场正净 ${allPos.toFixed(3)} = ${allPos > 0 ? ((posSum / allPos) * 100).toFixed(1) : '-'}%`);

  // ── 4) KOL 参与（CD66）
  const kolRows = win.filter((r) => W(r) === KOL);
  if (kolRows.length) {
    console.log(`-- KOL 0x3472…0fda7e：${kolRows.length} 行`);
    for (const r of kolRows) {
      const t = ((Date.parse(r.block_time) - t0) / 1000).toFixed(1);
      console.log(`   t+${t}s ${r.trade_type} ${Number(r.bnb_amount).toFixed(4)}`);
    }
  }
}
process.exit(0);
