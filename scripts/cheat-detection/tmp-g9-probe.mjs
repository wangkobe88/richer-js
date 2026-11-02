// 组 9 CD44 质询归因（零 Jev 配额）：
// ① act=mid 是否误判——锚窗 39 行密度/静默占比/笔均三要素手算 + 波动缺失形状（买卖失衡/单调性）
// ② 新锚取证——「持续低活跃度缓慢拉盘」全史后续走势（用户点名看后续）+ 对照 CD46 healthy 长活盘的正常波动
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

async function load(addr) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .eq('token_address', addr)
    .gte('block_number', 0)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(8000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function profile(name, all, anchorN) {
  const T0 = Date.parse(all[0].block_time);
  const win = all.slice(0, anchorN);
  const span = (Date.parse(win[win.length - 1].block_time) - T0) / 1000;
  const buys = win.filter((r) => r.trade_type === 'buy');
  const sells = win.filter((r) => r.trade_type === 'sell');
  const buyBnb = buys.reduce((a, r) => a + r.bnb_amount, 0);
  const sellBnb = sells.reduce((a, r) => a + r.bnb_amount, 0);
  console.log(`\n══ ${name} 全史 ${all.length} 行 ══`);
  console.log(`锚窗 ${anchorN} 行跨 ${Math.round(span)}s：密度 ${(anchorN / (span / 60)).toFixed(1)} 笔/分｜买 ${buys.length} 笔 ${buyBnb.toFixed(3)} BNB / 卖 ${sells.length} 笔 ${sellBnb.toFixed(3)} BNB（笔比 ${buys.length}:${sells.length}、额比 ${(buyBnb / Math.max(sellBnb, 1e-9)).toFixed(1)}:1）`);
  // 静默占比（≥10s gap 合计）
  let silent = 0, prev = null, gaps = [];
  for (const r of win) {
    const t = Date.parse(r.block_time);
    if (prev !== null) { const g = (t - prev) / 1000; if (g >= 10) { silent += g; gaps.push(Math.round(g)); } }
    prev = t;
  }
  console.log(`静默：≥10s gap ${gaps.length} 段合计 ${Math.round(silent)}s 占窗 ${Math.round(silent / span * 100)}%（段长 ${gaps.join(',') || '无'}）｜笔均额 ${(win.reduce((a, r) => a + r.bnb_amount, 0) / win.length).toFixed(4)} BNB`);
  // 锚窗价格单调性：逐笔可靠价最大回撤
  let peak = -1, maxDd = 0, newHighs = 0;
  for (const r of win) {
    if (!r.price_bnb || r.price_bnb <= 0) continue;
    if (r.price_bnb > peak) { peak = r.price_bnb; newHighs++; }
    else if (peak > 0) maxDd = Math.max(maxDd, (peak - r.price_bnb) / peak);
  }
  console.log(`锚窗价格：${win.find((r) => r.price_bnb > 0)?.price_bnb.toExponential(2)} → ${[...win].reverse().find((r) => r.price_bnb > 0)?.price_bnb.toExponential(2)}｜新高推进 ${newHighs} 次｜最大回撤 ${(maxDd * 100).toFixed(1)}%`);
  return { T0, span };
}

function arc(name, all, buckets = 16) {
  const T0 = Date.parse(all[0].block_time);
  const T1 = Date.parse(all[all.length - 1].block_time);
  const totalMin = (T1 - T0) / 60000;
  const buys = all.filter((r) => r.trade_type === 'buy');
  const sells = all.filter((r) => r.trade_type === 'sell');
  console.log(`\n== ${name} 全史走势（${Math.round(totalMin)} 分钟）==`);
  console.log(`全史买 ${buys.length} 笔 ${buys.reduce((a, r) => a + r.bnb_amount, 0).toFixed(2)} BNB / 卖 ${sells.length} 笔 ${sells.reduce((a, r) => a + r.bnb_amount, 0).toFixed(2)} BNB（额比 ${(buys.reduce((a, r) => a + r.bnb_amount, 0) / Math.max(sells.reduce((a, r) => a + r.bnb_amount, 0), 1e-9)).toFixed(1)}:1）`);
  // 时间等分桶末价弧线 + 每桶买卖笔数
  const step = (T1 - T0) / buckets;
  const lines = [];
  let peak = -1, maxDd = 0;
  const bucketStats = Array.from({ length: buckets }, () => ({ b: 0, s: 0 }));
  for (const r of all) {
    const bi = Math.min(buckets - 1, Math.floor((Date.parse(r.block_time) - T0) / step));
    if (r.trade_type === 'buy') bucketStats[bi].b++; else bucketStats[bi].s++;
  }
  for (let i = 0; i < buckets; i++) {
    const lo = T0 + i * step, hi = lo + step;
    const rows = all.filter((r) => { const t = Date.parse(r.block_time); return t >= lo && t < hi; });
    const prices = rows.map((r) => r.price_bnb).filter((p) => p > 0);
    const last = prices.length ? prices[prices.length - 1] : null;
    if (last !== null) {
      if (last > peak) peak = last; else maxDd = Math.max(maxDd, (peak - last) / peak);
    }
    const bar = last !== null ? '█'.repeat(Math.max(1, Math.round(Math.log10(last / (all.find((r) => r.price_bnb > 0)?.price_bnb || last) + 1e-9) * 8 + 1))) : '·';
    lines.push(`  t+${String(Math.round((lo - T0) / 1000 / 60)).padStart(4)}m ${last ? last.toExponential(2) : '  —  '} ${bar.padEnd(10)} 买${String(bucketStats[i].b).padStart(3)}/卖${String(bucketStats[i].s).padStart(3)}`);
  }
  console.log(lines.join('\n'));
  console.log(`全史峰值 ${peak.toExponential(2)}｜峰后最大回撤 ${(maxDd * 100).toFixed(1)}%｜末价 ${([...all].reverse().find((r) => r.price_bnb > 0)?.price_bnb || 0).toExponential(2)}`);
}

// ══ CD44（质询票）══
{
  const all = await load('0x13326823759c702e6ac478e3901b05c195307777');
  profile('CD44 币安信任', all, 39);
  arc('CD44 币安信任', all);
}

// ══ CD46（对照：healthy 长活盘的正常波动）══
{
  const all = await load('0x2e1319d91ea6c583dc93440fd0416c66bf3c7777');
  profile('CD46 安全币安（对照）', all, 24);
  arc('CD46 安全币安（对照）', all);
}
process.exit(0);
