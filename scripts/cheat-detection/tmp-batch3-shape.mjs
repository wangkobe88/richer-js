// tmp：批次三 CD41/CD42/CD45 误伤形态归因（pump/bw 题反锚为何未兜住）
// 零 Jev 零配额：拉锚窗 ticks + 纯函数统计（182 跑；tmp-*.mjs 不提交）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const CASES = [
  { id: 'CD41', addr: '0x49013b5c6f2a18767a6faba3a2a73a261a407777', anchor: 24 },
  { id: 'CD42', addr: '0xfe27d3211d9a8321bead2c77f69a2b0b4e557777', anchor: 88 },
  { id: 'CD45', addr: '0xb3aae472395f6a83827d2a9c628162d375447777', anchor: 57 },
];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const AGG = '0x1de460'; // GMGN 聚合路由前缀（trader 层）

const w = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const fmt = (x) => (x == null ? '-' : x.toFixed(4));

async function main() {
  const db = await dbManager.getClient();
  for (const c of CASES) {
    const { data, error } = await db.from('wss_price_ticks').select(TICK_COLS)
      .eq('token_address', c.addr)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(c.anchor);
    if (error) throw error;
    const rows = data ?? [];
    // token_create 锚（开盘段判定）
    const { data: ev } = await db.from('wss_events').select('payload,block_time')
      .eq('kind', 'token_create').eq('token_address', c.addr).limit(1);
    const createAt = ev && ev[0] && ev[0].payload && ev[0].payload.blockTimeMs
      ? Number(ev[0].payload.blockTimeMs) : null;

    console.log(`\n===== ${c.id} ${c.addr} 锚=${c.anchor} 实拉=${rows.length} =====`);
    const t0 = new Date(rows[0].block_time).getTime();
    const t1 = new Date(rows[rows.length - 1].block_time).getTime();
    const mins = (t1 - t0) / 60000;
    console.log(`窗：${(t1 - t0) / 1000}s=${mins.toFixed(2)}min | 密度=${(rows.length / Math.max(mins, 0.01)).toFixed(1)}笔/min | 首行距create=${createAt ? ((t0 - createAt) / 1000).toFixed(1) + 's' : '-'}`);

    const buys = rows.filter((r) => r.trade_type === 'buy');
    const sells = rows.filter((r) => r.trade_type === 'sell');
    const buyAmt = buys.reduce((s, r) => s + Number(r.bnb_amount), 0);
    const sellAmt = sells.reduce((s, r) => s + Number(r.bnb_amount), 0);
    const thru = (buyAmt + sellAmt) / Math.max(mins, 0.01);
    console.log(`买卖：买${buys.length}笔/${buyAmt.toFixed(3)} 卖${sells.length}笔/${sellAmt.toFixed(3)} 笔比${(buys.length / Math.max(sells.length, 1)).toFixed(1)}:1 额比${(buyAmt / Math.max(sellAmt, 0.0001)).toFixed(1)}:1 | 吞吐=${thru.toFixed(2)}BNB/min | 聚合路由占买额=${(buys.filter((r) => (r.trader_address || '').toLowerCase().startsWith(AGG)).reduce((s, r) => s + Number(r.bnb_amount), 0) / Math.max(buyAmt, 1e-9) * 100).toFixed(1)}%`);

    // 价格轨迹（可靠价=非 outlier）
    const pr = rows.filter((r) => r.price_bnb && !r.price_outlier).map((r) => ({ p: Number(r.price_bnb), t: r.block_time, bt: r.trade_type }));
    if (pr.length) {
      let hi = pr[0].p, peak = pr[0].p, maxDD = 0, newHigh = 0;
      for (const x of pr) { if (x.p > hi) { hi = x.p; newHigh++; } const dd = (x.p - hi) / hi * 100; if (dd < maxDD) maxDD = dd; peak = Math.max(peak, x.p); }
      console.log(`价格：${pr[0].p.toExponential(3)}→${pr[pr.length - 1].p.toExponential(3)} (${((pr[pr.length - 1].p / pr[0].p - 1) * 100).toFixed(1)}%) 新高${newHigh}次 最大回撤${maxDD.toFixed(1)}%`);
    }

    // 买入金额分布
    const amounts = buys.map((r) => Number(r.bnb_amount)).sort((a, b) => a - b);
    const med = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
    const dust = amounts.filter((x) => x < 0.005).length;
    console.log(`买入金额：笔均${fmt(amounts.reduce((s, x) => s + x, 0) / Math.max(amounts.length, 1))} 中位${fmt(med)} min${fmt(amounts[0])} max${fmt(amounts[amounts.length - 1])} | 尘埃(<0.005)${dust}/${amounts.length}笔`);

    // 钱包 top5 买
    const byWallet = new Map();
    for (const r of buys) { const k = w(r); if (!byWallet.has(k)) byWallet.set(k, { n: 0, amt: 0, blocks: new Set() }); const o = byWallet.get(k); o.n++; o.amt += Number(r.bnb_amount); o.blocks.add(r.block_number); }
    const top = [...byWallet.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 5);
    console.log(`买钱包${byWallet.size}个 top5：${top.map(([k, o]) => `${k.slice(0, 8)}(${o.n}笔/${o.amt.toFixed(3)}BNB/${o.amt / buyAmt * 100 > 5 ? (o.amt / buyAmt * 100).toFixed(0) + '%' : ''}${o.n >= 3 ? '/连推' : ''})`).join(' ')}`);

    // 同块买入波（≥3 笔买 且 ≥2 不同钱包，全量枚举）
    const byBlock = new Map();
    for (const r of buys) { if (!byBlock.has(r.block_number)) byBlock.set(r.block_number, []); byBlock.get(r.block_number).push(r); }
    const waves = [];
    for (const [blk, rs] of byBlock) {
      const ws = new Set(rs.map(w));
      if (rs.length >= 3 && ws.size >= 2) {
        const txs = new Set(rs.map((r) => r.tx_hash)).size;
        waves.push({ blk, n: rs.length, wallets: ws.size, txs, amt: rs.reduce((s, r) => s + Number(r.bnb_amount), 0), list: rs.map((r) => Number(r.bnb_amount).toFixed(4)).join(','), ts: rs[0].block_time, rel: ((new Date(rs[0].block_time).getTime() - t0) / 1000).toFixed(0) });
      }
    }
    waves.sort((a, b) => a.blk - b.blk);
    const waveAmt = waves.reduce((s, x) => s + x.amt, 0);
    console.log(`同块买入波(≥3笔≥2钱包)：${waves.length}个 波额合计${waveAmt.toFixed(3)}=占买${(waveAmt / Math.max(buyAmt, 1e-9) * 100).toFixed(1)}%`);
    for (const x of waves) console.log(`  blk${x.blk} t+${x.rel}s ${x.n}笔/${x.wallets}钱包/tx${x.txs} ${x.amt.toFixed(3)}BNB [${x.list}]`);
    // 同块≥2 笔全部（含小簇）
    let pair2 = 0;
    for (const [blk, rs] of byBlock) { const ws = new Set(rs.map(w)); if (rs.length >= 2 && ws.size >= 2) pair2++; }
    console.log(`  （含小簇：同块≥2钱包的块共${pair2}个/买块总数${byBlock.size}）`);

    // 卖侧明细
    console.log(`卖侧${sells.length}笔：${sells.map((r) => `t+${((new Date(r.block_time).getTime() - t0) / 1000).toFixed(0)}s ${Number(r.bnb_amount).toFixed(4)}(${w(r).slice(0, 6)})`).join(' | ')}`);

    // 波成员后续卖出（持有判定：波钱包有无卖出）
    const soldWallets = new Set(sells.map(w));
    const waveW = new Set();
    for (const x of waves) { for (const r of byBlock.get(x.blk) || []) waveW.add(w(r)); }
    const inter = [...waveW].filter((k) => soldWallets.has(k));
    console.log(`波成员后续卖出：${inter.length}/${waveW.size} 钱包卖出${inter.length ? '（' + inter.map((k) => k.slice(0, 8)).join(',') + '）' : '（全持有）'}`);

    // 逐笔明细（前 30 行紧凑：t+ / 块 / 方向 / 金额 / 价 / 钱包 / tx 短）
    console.log('逐笔（前30）：');
    rows.slice(0, 30).forEach((r, i) => {
      console.log(`  ${i + 1} t+${((new Date(r.block_time).getTime() - t0) / 1000).toFixed(1)}s blk${r.block_number} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)} p=${Number(r.price_bnb).toExponential(2)} w=${w(r).slice(0, 8)} tx=${(r.tx_hash || '').slice(0, 8)}${r.price_outlier ? ' [outlier]' : ''}`);
    });
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
