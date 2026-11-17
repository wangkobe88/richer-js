// 来财 0xc84a…7777 价格轨迹：创建→fire→卖出，破发（<发行价常量）时序分析
const { dbManager } = require('../src/services/dbManager.js');
const T = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const LAUNCH = 4496173469e-18; // fourmeme 主流档常量（T127）
async function main() {
  const c = await dbManager.getClient();
  const { data: probe } = await c.from('wss_price_ticks').select('*').eq('token_address', T).limit(1);
  console.log('columns:', Object.keys(probe[0]).join(','));
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,trade_type,bnb_amount,price_outlier')
    .eq('token_address', T).range(0, 999);
  const { data: rows2 } = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,trade_type,bnb_amount,price_outlier')
    .eq('token_address', T).range(1000, 1999);
  const all = [...(rows || []), ...(rows2 || [])].filter((r) => r.price_bnb != null && r.price_outlier !== true)
    .sort((a, b) => new Date(a.block_time) - new Date(b.block_time));
  const t0 = new Date('2026-11-05T12:31:10Z').getTime();
  console.log(`可靠价序列 ${all.length} 行，时间跨度 ${((new Date(all[all.length - 1].block_time) - t0) / 1000).toFixed(1)}s`);
  // 买卖时间（v123 trades）
  const { data: tr } = await c.from('trades')
    .select('trade_direction,input_amount,output_amount,input_currency,output_currency,created_at,success')
    .eq('experiment_id', 'f454a704-706e-48d4-8049-6f885f9ae46b').eq('token_address', T);
  const buys = (tr || []).filter((t) => t.trade_direction === 'buy' && t.success !== false);
  const sells = (tr || []).filter((t) => t.trade_direction === 'sell' && t.success !== false);
  console.log('\n== v123 成交 ==');
  for (const b of buys) console.log(`BUY  ${b.created_at}`);
  for (const s of sells) console.log(`SELL ${s.created_at}`);
  // 轨迹关键点：每 5% 时间分位的价、launch 上下穿越
  let minP = Infinity, minT = null, maxP = 0, maxT = null;
  let belowFirst = null, backAbove = null;
  for (const r of all) {
    const ts = (new Date(r.block_time) - t0) / 1000;
    const p = Number(r.price_bnb);
    if (p < minP) { minP = p; minT = ts; }
    if (p > maxP) { maxP = p; maxT = ts; }
    if (p < LAUNCH && belowFirst == null) belowFirst = ts;
    if (belowFirst != null && backAbove == null && p >= LAUNCH) backAbove = ts;
  }
  const pct = (p) => ((p / LAUNCH - 1) * 100).toFixed(1);
  console.log(`\n全程最低 ${minP.toExponential(4)} (${pct(minP)}%) @ t+${minT.toFixed(1)}s`);
  console.log(`全程最高 ${maxP.toExponential(4)} (${pct(maxP)}%) @ t+${maxT.toFixed(1)}s`);
  console.log(`首次跌破发行价: ${belowFirst != null ? 't+' + belowFirst.toFixed(1) + 's' : '从未'}`);
  console.log(`首次收回发行价: ${backAbove != null ? 't+' + backAbove.toFixed(1) + 's' : '未收回/不适用'}`);
  // fire 前序列（t+0~20s）逐行
  console.log('\n== t+0~25s 开盘序列（fire≈t+15.7s）==');
  for (const r of all) {
    const ts = (new Date(r.block_time) - t0) / 1000;
    if (ts > 25) break;
    console.log(`t+${ts.toFixed(1)}s ${pct(r.price_bnb)}% ${r.trade_type === "buy" ? "BUY" : "SELL"} ${Number(r.bnb_amount).toFixed(3)}`);
  }
  // fire 之后每 10s 采样
  console.log('\n== fire 后轨迹采样（每 ~10s）==');
  let lastShown = -Infinity;
  for (const r of all) {
    const ts = (new Date(r.block_time) - t0) / 1000;
    if (ts < 16) continue;
    if (ts - lastShown >= 10) { lastShown = ts; console.log(`t+${ts.toFixed(0)}s ${pct(r.price_bnb)}%`); }
  }
  const last = all[all.length - 1];
  console.log(`末行 t+${((new Date(last.block_time) - t0) / 1000).toFixed(0)}s ${pct(last.price_bnb)}%`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
