// CD17 sbw=burst_suspect 0.95 归因：锚窗 31 tick 时间轴+静默段/波识别+波内钱包全史对冲（零 Jev 配额）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();
const ADDR = '0xb3566fd337409e09bb39fd7f3b4e75b783007777';

const { data, error } = await c.from('wss_price_ticks')
  .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,tx_hash')
  .eq('token_address', ADDR)
  .gte('block_number', 0)
  .order('block_number', { ascending: true })
  .order('log_index', { ascending: true })
  .limit(5000);
if (error) throw new Error(error.message);
const all = data ?? [];
console.log(`全史 ${all.length} 行`);
const T0 = Date.parse(all[0].block_time);
const w = (r) => (r.sender_address || r.trader_address || '?').toLowerCase();
const sw = (a) => a.slice(0, 4) + '…' + a.slice(-4);

// ── 锚窗 31 行时间轴（run.mjs 同口径：链上真序前 31） ──
const win = all.slice(0, 31);
console.log('\n== 锚窗 31 行时间轴 ==');
let prevT = null;
for (const r of win) {
  const t = (Date.parse(r.block_time) - T0) / 1000;
  const gap = prevT === null ? 0 : t - prevT;
  console.log(`t+${String(Math.round(t)).padStart(4)}s${gap >= 10 ? `  ←静默 ${Math.round(gap)}s 后` : ''}  ${r.trade_type.toUpperCase().padEnd(4)} ${r.bnb_amount.toFixed(4).padStart(8)} @${r.price_bnb.toExponential(2)} w=${sw(w(r))} blk=${r.block_number} tx=${(r.tx_hash || '').replace(/^0x/, '').slice(0, 8)}`);
  prevT = t;
}

// ── 静默段识别（题面口径：无任何行 ≥10s=静默）与波切分 ──
console.log('\n== 静默段与波切分（≥10s 静默后 ≥3 笔聚集=一波）==');
let waves = [];
let cur = null;
prevT = null;
for (const r of win) {
  const t = Date.parse(r.block_time);
  if (prevT !== null && (t - prevT) / 1000 >= 10 && cur && cur.rows.length) { waves.push(cur); cur = null; }
  if (!cur) cur = { rows: [], start: t };
  cur.rows.push(r);
  prevT = t;
}
if (cur) waves.push(cur);
for (const [i, wv] of waves.entries()) {
  const buys = wv.rows.filter((r) => r.trade_type === 'buy');
  const wallets = [...new Set(wv.rows.filter((r) => r.trade_type === 'buy').map(w))];
  const t0 = (Date.parse(wv.rows[0].block_time) - T0) / 1000;
  const t1 = (Date.parse(wv.rows[wv.rows.length - 1].block_time) - T0) / 1000;
  console.log(`波${i + 1}: t+${Math.round(t0)}s~t+${Math.round(t1)}s ${wv.rows.length} 行（买 ${buys.length} 笔/${buys.length ? (buys.reduce((s, r) => s + r.bnb_amount, 0)).toFixed(3) : '0'} BNB，买钱包 ${wallets.length} 个）`);
}

// ── 波内买入钱包的全史对冲（窗口外卖出=后续离场） ──
console.log('\n== 全史 per-wallet 买卖（波内买入钱包；win 外卖出=窗口后离场）==');
const winEnd = Date.parse(win[win.length - 1].block_time);
const agg = new Map();
for (const r of all) {
  const k = w(r);
  if (!agg.has(k)) agg.set(k, { buy: 0, buyN: 0, sell: 0, sellN: 0, postSell: 0, first: r.block_time, last: r.block_time });
  const e = agg.get(k);
  if (r.trade_type === 'buy') { e.buy += r.bnb_amount; e.buyN++; } else { e.sell += r.bnb_amount; e.sellN++; }
  if (Date.parse(r.block_time) > winEnd && r.trade_type === 'sell') e.postSell += r.bnb_amount;
  e.last = r.block_time;
}
const sorted = [...agg.entries()].sort((a, b) => b[1].buy - a[1].buy);
for (const [k, e] of sorted.slice(0, 18)) {
  console.log(`${sw(k)} 买 ${e.buy.toFixed(4)}×${e.buyN} 卖 ${e.sell.toFixed(4)}×${e.sellN}  窗后卖 ${e.postSell.toFixed(4)}  末动 ${((Date.parse(e.last) - T0) / 60000).toFixed(1)}min`);
}
