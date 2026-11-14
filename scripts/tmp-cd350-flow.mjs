/** CD350 AI 流量画像（182 跑，一次性）：锚 25 笔+后续窗——买家金额分布/规整度/
 * 钱包集中/时序均匀性/GMGN 路由占比/卖出对照，「不像散户」判据观察 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const sb = () => require_('../src/services/dbManager').dbManager.getClient();

const TOKEN = '0x4237b7ed6dcc670c6fd6e62aeebb15f3c1517777';
const ROUTER = '0x1de4601c2f1ba0a4';
const COLS = 'id,block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address';
const rows = [];
let cursor = 0;
for (let p = 0; p < 40; p++) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(COLS).eq('token_address', TOKEN).gt('id', cursor)
    .order('id', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
  cursor = data[data.length - 1].id;
}
rows.sort((a, b) => Number(a.block_number) - Number(b.block_number) || Number(a.log_index) - Number(b.log_index));
console.log('全窗行数:', rows.length);

const t0 = new Date(rows[0].block_time).getTime();
const anchor = rows[24]; // 锚=25 笔
const win = rows.slice(0, 80); // 锚窗+后续 55 笔观察段
const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

// 1) 逐笔时间线（锚窗 25 + 后续）
console.log('\n== 逐笔（前 80 笔；* = 锚后）==');
win.forEach((r, i) => {
  const w = wallet(r);
  console.log(`${i >= 25 ? '*' : ' '} ${String(i + 1).padStart(3)} ${r.block_time.slice(11, 19)} b${r.block_number} ${r.trade_type.padEnd(4)} ${Number(r.bnb_amount).toFixed(4)} BNB @${r.price_bnb ? Number(r.price_bnb).toPrecision(2) : '-'} ${w.slice(0, 8)}…${w.slice(-4)}${(r.trader_address || '').toLowerCase().startsWith(ROUTER) ? ' [GMGN]' : ''}`);
});

// 2) 买入金额分布（锚窗内 / 锚后 55 笔）
function profile(seg, label) {
  const buys = seg.filter((r) => r.trade_type === 'buy');
  const sells = seg.filter((r) => r.trade_type === 'sell');
  const amts = buys.map((r) => Number(r.bnb_amount));
  const sorted = [...amts].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
  // 金额规整度：toFixed(4) 相同的聚集
  const byAmt = {};
  for (const a of amts) { const k = a.toFixed(4); byAmt[k] = (byAmt[k] || 0) + 1; }
  const dupTop = Object.entries(byAmt).sort((x, y) => y[1] - x[1]).slice(0, 5);
  // 钱包集中
  const wCount = {};
  for (const r of buys) wCount[wallet(r)] = (wCount[wallet(r)] || 0) + 1;
  const wTop = Object.entries(wCount).sort((x, y) => y[1] - x[1]).slice(0, 5);
  // 时序均匀性：买入间隔
  const ts = buys.map((r) => new Date(r.block_time).getTime());
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  const gmgn = buys.filter((r) => (r.trader_address || '').toLowerCase().startsWith(ROUTER)).length;
  console.log(`\n== ${label} ==`);
  console.log(`买 ${buys.length} / 卖 ${sells.length} | 金额 q25/50/75/max = ${q(0.25)} / ${q(0.5)} / ${q(0.75)} / ${sorted[sorted.length - 1]}`);
  console.log(`规整度 top5: ${dupTop.map(([k, v]) => `${k}×${v}`).join(' ')}`);
  console.log(`钱包数 ${Object.keys(wCount).length}，复买 top5: ${wTop.map(([k, v]) => `${k.slice(0, 6)}…×${v}`).join(' ')}`);
  console.log(`间隔 ms min/med/max = ${gaps[0]} / ${gaps[Math.floor(gaps.length / 2)]} / ${gaps[gaps.length - 1]}（CV=${(gaps.reduce((a, b) => a + b, 0) / gaps.length / (gaps[Math.floor(gaps.length / 2)] || 1)).toFixed(2)}×中位）`);
  console.log(`GMGN 路由买 ${gmgn}/${buys.length}`);
}
profile(rows.slice(0, 25), '锚窗 25 笔');
profile(rows.slice(25, 80), '锚后 55 笔');
profile(rows, '全窗');
writeFileSync('/tmp/cd350-flow.json', JSON.stringify(rows.map((r) => ({
  t: r.block_time, b: r.block_number, type: r.trade_type, bnb: Number(r.bnb_amount),
  price: r.price_bnb ? Number(r.price_bnb) : null, w: wallet(r), gmgn: (r.trader_address || '').toLowerCase().startsWith(ROUTER),
})), null, 1));
console.log('\n落 /tmp/cd350-flow.json');
