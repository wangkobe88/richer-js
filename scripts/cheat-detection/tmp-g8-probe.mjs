// 组 8 两质询归因（零 Jev 配额）：
// ① CD38 sbw=burst 误判检验——锚窗 27 行时间轴+静默段/波切分+密度对比（用户：低活跃≠停滞涌入，无「突然增大」）
// ② CD42 tier=strong/bw=strong 校验——买入金额聚带 vs 散布（用户：散户痕迹重，局部模式非主流）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();
const w = (r) => (r.sender_address || r.trader_address || '?').toLowerCase();
const sw = (a) => a.slice(0, 4) + '…' + a.slice(-4);

async function load(addr) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,tx_hash')
    .eq('token_address', addr)
    .gte('block_number', 0)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ══ ① CD38 ══
{
  const ADDR = '0x2481ac81e8640e104fadf8c689c51a72cf758888';
  const all = await load(ADDR);
  const T0 = Date.parse(all[0].block_time);
  const win = all.slice(0, 27);
  const winSec = (Date.parse(win[win.length - 1].block_time) - T0) / 1000;
  console.log(`══ CD38 我们会活下去 全史 ${all.length} 行｜锚窗 27 行跨 ${Math.round(winSec)}s｜窗均密度 ${(27 / (winSec / 60)).toFixed(1)} 笔/分 ══`);
  console.log('\n== 锚窗时间轴（gap≥10s 标注静默）==');
  let prevT = null;
  for (const r of win) {
    const t = (Date.parse(r.block_time) - T0) / 1000;
    const gap = prevT === null ? 0 : t - prevT;
    console.log(`t+${String(Math.round(t)).padStart(4)}s${gap >= 10 ? `  ←静默 ${Math.round(gap)}s 后` : ''}  ${r.trade_type.toUpperCase().padEnd(4)} ${r.bnb_amount.toFixed(4).padStart(8)} @${r.price_bnb.toExponential(2)} w=${sw(w(r))} blk=${r.block_number} tx=${(r.tx_hash || '').replace(/^0x/, '').slice(0, 8)}`);
    prevT = t;
  }
  // 静默段后聚集判读：每段静默后紧跟的行数/买笔/买钱包/耗时，与全窗密度对比
  console.log('\n== 静默段后聚集逐段判读（涌入=密度显著高于窗均）==');
  const dens = 27 / (winSec / 60); // 笔/分
  let segs = [], cur = null; prevT = null; let prevGap = null;
  for (const r of win) {
    const t = Date.parse(r.block_time);
    const gap = prevT === null ? null : (t - prevT) / 1000;
    if (gap !== null && gap >= 10) { if (cur) segs.push(cur); cur = { gap, rows: [r] }; } else if (cur) cur.rows.push(r); else cur = { gap: null, rows: [r] };
    prevT = t;
  }
  if (cur) segs.push(cur);
  for (const [i, s] of segs.entries()) {
    const buys = s.rows.filter((r) => r.trade_type === 'buy');
    const wallets = [...new Set(buys.map(w))];
    const dur = (Date.parse(s.rows[s.rows.length - 1].block_time) - Date.parse(s.rows[0].block_time)) / 1000;
    const sd = s.rows.length / Math.max(dur / 60, 1 / 60);
    const tag = s.gap === null ? '开盘段' : `静默${Math.round(s.gap)}s后`;
    console.log(`段${i + 1} ${tag}: ${s.rows.length} 行（买 ${buys.length}/${wallets.length} 钱包 ${(buys.reduce((a, r) => a + r.bnb_amount, 0)).toFixed(3)} BNB）跨 ${Math.round(dur)}s 段内密度 ${sd.toFixed(1)} 笔/分 ${sd > dens * 3 ? '【密度跃升】' : '【≈窗均/低密度】'}`);
  }
}

// ══ ② CD42 ══
{
  const ADDR = '0xfe27d3211d9a8321bead2c77f69a2b0b4e557777';
  const all = await load(ADDR);
  const T0 = Date.parse(all[0].block_time);
  const win = all.slice(0, 88);
  const winSec = (Date.parse(win[win.length - 1].block_time) - T0) / 1000;
  const buys = win.filter((r) => r.trade_type === 'buy');
  const buyWallets = new Map();
  for (const r of buys) { const k = w(r); if (!buyWallets.has(k)) buyWallets.set(k, 0); buyWallets.set(k, buyWallets.get(k) + r.bnb_amount); }
  console.log(`\n══ CD42 SIC 全史 ${all.length} 行｜锚窗 88 行跨 ${Math.round(winSec)}s｜买 ${buys.length} 笔 ${(buys.reduce((a, r) => a + r.bnb_amount, 0)).toFixed(3)} BNB/${buyWallets.size} 钱包 ══`);
  // 买入金额聚带（对数域带宽 1.5）与带内钱包数
  const bl = [...buys].sort((a, b) => a.bnb_amount - b.bnb_amount);
  const bands = [];
  for (const r of bl) {
    const last = bands[bands.length - 1];
    if (last && r.bnb_amount / last.min <= 1.5) { last.rows.push(r); last.max = r.bnb_amount; }
    else bands.push({ min: r.bnb_amount, max: r.bnb_amount, rows: [r] });
  }
  const totalBuy = buys.reduce((a, r) => a + r.bnb_amount, 0);
  console.log('\n== 买入金额升序聚带（对数带宽 ≤1.5；带=金额区间非等额簇）==');
  for (const b of bands) {
    const amt = b.rows.reduce((a, r) => a + r.bnb_amount, 0);
    const ws = [...new Set(b.rows.map(w))];
    console.log(`${b.min.toFixed(4)}~${b.max.toFixed(4)}（×${(b.max / b.min).toFixed(2)}）${b.rows.length} 笔/${ws.length} 钱包 ${(amt).toFixed(3)} BNB=${(amt / totalBuy * 100).toFixed(1)}%${b.rows.length >= 3 && ws.length >= 3 ? ' 【聚带】' : ''}`);
  }
  // 主流判读：前三带覆盖 vs 散布；带内钱包重复度（同钱包多笔=自然加仓 vs 每钱包一笔=分仓）
  const top3 = [...bands].sort((a, b) => b.rows.length - a.rows.length).slice(0, 3);
  const t3rows = top3.reduce((a, b) => a + b.rows.length, 0), t3amt = top3.reduce((a, b) => a + b.rows.reduce((x, r) => x + r.bnb_amount, 0), 0);
  const multiEntry = [...buyWallets.entries()].filter(([, v]) => v > 0).length;
  const onceWallets = [...new Set(buys.map(w))].filter((k) => buys.filter((r) => w(r) === k).length === 1).length;
  console.log(`\n前三带覆盖：${t3rows}/${buys.length} 笔(${(t3rows / buys.length * 100).toFixed(0)}%)、${(t3amt / totalBuy * 100).toFixed(0)}% 金额`);
  console.log(`买入钱包 ${buyWallets.size} 个：仅一笔 ${onceWallets} 个/多笔 ${buyWallets.size - onceWallets} 个`);
  console.log(`金额分布：min ${bl[0].bnb_amount.toFixed(4)} / 中位 ${bl[Math.floor(bl.length / 2)].bnb_amount.toFixed(4)} / max ${bl[bl.length - 1].bnb_amount.toFixed(4)}（极差 ×${(bl[bl.length - 1].bnb_amount / bl[0].bnb_amount).toFixed(0)}）`);
  // 同块买入波分布（bw strong 校验）
  const blkMap = new Map();
  for (const r of buys) { const k = r.block_number; if (!blkMap.has(k)) blkMap.set(k, []); blkMap.get(k).push(r); }
  const waves = [...blkMap.entries()].filter(([, rs]) => rs.length >= 3);
  console.log(`\n同块 ≥3 笔买块：${waves.length} 个=${waves.reduce((a, [, rs]) => a + rs.length, 0)} 笔/${waves.reduce((a, [, rs]) => a + rs.reduce((x, r) => x + r.bnb_amount, 0), 0).toFixed(3)} BNB（占买 ${(waves.reduce((a, [, rs]) => a + rs.reduce((x, r) => x + r.bnb_amount, 0), 0) / totalBuy * 100).toFixed(1)}%）`);
  for (const [blk, rs] of waves) console.log(`  blk=${blk} ${rs.length} 笔 ${rs.reduce((a, r) => a + r.bnb_amount, 0).toFixed(3)} BNB 金额 ${Math.min(...rs.map((r) => r.bnb_amount)).toFixed(4)}~${Math.max(...rs.map((r) => r.bnb_amount)).toFixed(4)} w=${[...new Set(rs.map(w))].map(sw).join('/')}`);
}
process.exit(0);
