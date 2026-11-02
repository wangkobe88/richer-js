// 组 11 CD55 质询归因（零 Jev 配额）：pump=none 误判？
// 立案 note：creator 0.6 买+海量 0.0001 尘买垫量拉至 +66%（365 行）后砸盘
// 归因点：①锚窗价格单调性/买卖失衡（40:3 笔、额比 30.9:1）②尘买垫量在锚窗内的分布
// ③t+21 同块 0.1000×10 簇占锚窗流量比例（排除项误伤假设）④全史后续走势
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const { data, error } = await c.from('wss_price_ticks')
  .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
  .eq('token_address', '0x637281e901d5632b858faaca20fc5b39ef2b7777')
  .gte('block_number', 0)
  .order('block_number', { ascending: true })
  .order('log_index', { ascending: true })
  .limit(8000);
if (error) throw new Error(error.message);
const all = data ?? [];

// ══ 锚窗 43 行 ══
{
  const win = all.slice(0, 43);
  const T0 = Date.parse(win[0].block_time);
  const span = (Date.parse(win[win.length - 1].block_time) - T0) / 1000;
  const buys = win.filter((r) => r.trade_type === 'buy');
  const sells = win.filter((r) => r.trade_type === 'sell');
  const bB = buys.reduce((a, r) => a + r.bnb_amount, 0);
  const sB = sells.reduce((a, r) => a + r.bnb_amount, 0);
  console.log(`══ 锚窗 43 行跨 ${Math.round(span)}s：密度 ${(43 / (span / 60)).toFixed(1)} 笔/分 ══`);
  console.log(`买 ${buys.length} 笔 ${bB.toFixed(3)} / 卖 ${sells.length} 笔 ${sB.toFixed(3)}（额比 ${(bB / Math.max(sB, 1e-9)).toFixed(1)}:1）｜笔均 ${(bB / buys.length).toFixed(4)}`);
  // 静默
  let silent = 0, prev = null, gaps = [];
  for (const r of win) {
    const t = Date.parse(r.block_time);
    if (prev !== null) { const g = (t - prev) / 1000; if (g >= 10) { silent += g; gaps.push(Math.round(g)); } }
    prev = t;
  }
  console.log(`静默：≥10s gap ${gaps.length} 段合计 ${Math.round(silent)}s 占 ${Math.round(silent / span * 100)}%（段长 ${gaps.join(',') || '无'}）`);
  // 尘买分布（按金额分档）
  const tiers = { '0.0001级(<0.001)': [0, 0], '0.001~0.01': [0, 0], '0.01~0.05': [0, 0], '0.05~0.15': [0, 0], '≥0.15': [0, 0] };
  for (const r of buys) {
    const a = r.bnb_amount;
    const k = a < 0.001 ? '0.0001级(<0.001)' : a < 0.01 ? '0.001~0.01' : a < 0.05 ? '0.01~0.05' : a < 0.15 ? '0.05~0.15' : '≥0.15';
    tiers[k][0]++; tiers[k][1] += a;
  }
  for (const [k, [n, amt]] of Object.entries(tiers)) if (n) console.log(`  买档 ${k}: ${n} 笔 ${amt.toFixed(4)} BNB`);
  // 同块簇流量：单块 ≥3 笔的块合计占比
  const byBlk = {};
  for (const r of buys) { const k = r.block_number; (byBlk[k] = byBlk[k] || []).push(r); }
  let clusterBuy = 0, clusterN = 0;
  for (const [blk, rs] of Object.entries(byBlk)) if (rs.length >= 3) { clusterBuy += rs.reduce((a, r) => a + r.bnb_amount, 0); clusterN += rs.length; }
  console.log(`同块簇（单块 ≥3 笔买入）：${clusterN} 笔 ${clusterBuy.toFixed(3)} BNB = 锚窗买入 ${(clusterBuy / bB * 100).toFixed(1)}%`);
  // 价格单调性
  let peak = -1, maxDd = 0, newHighs = 0, first = null, last = null;
  for (const r of win) {
    if (!r.price_bnb || r.price_bnb <= 0) continue;
    if (first === null) first = r.price_bnb;
    last = r.price_bnb;
    if (r.price_bnb > peak) { peak = r.price_bnb; newHighs++; }
    else if (peak > 0) maxDd = Math.max(maxDd, (peak - r.price_bnb) / peak);
  }
  console.log(`价格：${first.toExponential(2)} → ${last.toExponential(2)}（+${((last / first - 1) * 100).toFixed(0)}%）｜新高推进 ${newHighs} 次｜最大回撤 ${(maxDd * 100).toFixed(1)}%`);
  // 涨幅分布：分 4 段看推进节奏
  const seg = Math.floor(win.length / 4);
  for (let i = 0; i < 4; i++) {
    const s = win.slice(i * seg, i === 3 ? win.length : (i + 1) * seg);
    const ps = s.map((r) => r.price_bnb).filter((p) => p > 0);
    const b = s.filter((r) => r.trade_type === 'buy').length;
    const dust = s.filter((r) => r.trade_type === 'buy' && r.bnb_amount < 0.01).length;
    console.log(`  段${i + 1}（${s.length} 行 买${b} 其中<0.01 尘买 ${dust}）：价 ${ps[0].toExponential(2)} → ${ps[ps.length - 1].toExponential(2)}`);
  }
}

// ══ 全史走势 ══
{
  const T0 = Date.parse(all[0].block_time);
  const T1 = Date.parse(all[all.length - 1].block_time);
  const buys = all.filter((r) => r.trade_type === 'buy');
  const sells = all.filter((r) => r.trade_type === 'sell');
  const bB = buys.reduce((a, r) => a + r.bnb_amount, 0);
  const sB = sells.reduce((a, r) => a + r.bnb_amount, 0);
  const dustN = buys.filter((r) => r.bnb_amount < 0.01).length;
  const dustB = buys.filter((r) => r.bnb_amount < 0.01).reduce((a, r) => a + r.bnb_amount, 0);
  console.log(`\n══ 全史 ${all.length} 行 ${(T1 - T0) / 60000 | 0} 分钟 ══`);
  console.log(`买 ${buys.length} 笔 ${bB.toFixed(2)} / 卖 ${sells.length} 笔 ${sB.toFixed(2)}｜尘买（<0.01）${dustN} 笔 ${dustB.toFixed(3)} BNB`);
  let peak = -1, maxDd = 0, first = null, last = null;
  for (const r of all) {
    if (!r.price_bnb || r.price_bnb <= 0) continue;
    if (first === null) first = r.price_bnb;
    last = r.price_bnb;
    if (r.price_bnb > peak) peak = r.price_bnb;
    else maxDd = Math.max(maxDd, (peak - r.price_bnb) / peak);
  }
  console.log(`全史价：${first.toExponential(2)} → 峰 ${peak.toExponential(2)}（+${((peak / first - 1) * 100).toFixed(0)}%）→ 末 ${last.toExponential(2)}｜峰后最大回撤 ${(maxDd * 100).toFixed(1)}%`);
  // 时间等分 12 桶
  const buckets = 12, step = (T1 - T0) / buckets;
  for (let i = 0; i < buckets; i++) {
    const lo = T0 + i * step, hi = lo + step;
    const rows = all.filter((r) => { const t = Date.parse(r.block_time); return t >= lo && t < hi; });
    const ps = rows.map((r) => r.price_bnb).filter((p) => p > 0);
    const b = rows.filter((r) => r.trade_type === 'buy').length;
    const d = rows.filter((r) => r.trade_type === 'buy' && r.bnb_amount < 0.01).length;
    const s = rows.filter((r) => r.trade_type === 'sell').length;
    const last2 = ps.length ? ps[ps.length - 1] : null;
    console.log(`  t+${String(Math.round((lo - T0) / 1000)).padStart(5)}s ${last2 ? last2.toExponential(2) : '   —   '}  买${String(b).padStart(3)}（尘${String(d).padStart(3)}）卖${String(s).padStart(3)}`);
  }
}
process.exit(0);
