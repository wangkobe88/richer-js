import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const { data: ticks, error } = await c.from('wss_price_ticks')
  .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
  .eq('token_address','0xe4fe922f88c09cbe127cebfa25f84d2f00917777')
  .order('block_time', { ascending: true }).limit(2000);
if (error) throw new Error(error.message);
const LAUNCH = 5.546337995470633e-9;
const ts = t => new Date(t).getTime();
let cumTrades = 0, cumBuyBnb = 0;
const rows = [];
for (const t of ticks) {
  cumTrades++;
  if (t.trade_type === 'buy') cumBuyBnb += Number(t.bnb_amount);
  const pb = Number(t.price_bnb);
  const curVs = pb > 0 ? (pb / LAUNCH - 1) * 100 : null;
  rows.push({ time: t.block_time, ts: ts(t.block_time), type: t.trade_type, bnb: Number(t.bnb_amount), curVs, cumTrades, cumBuyBnb });
}
// 每个 tick 的 10s 窗 actTotalBnb
for (let i = 0; i < rows.length; i++) {
  let s = 0;
  for (let j = i; j >= 0 && rows[i].ts - rows[j].ts <= 10000; j--) s += rows[j].bnb;
  rows[i].act10 = s;
}
// 腿条件向量（P4-P14，P1-P3 已耗尽）
const legs = [
  ['P4',  {tc:16, bv:1,   hd:9,  cv:28.5}],
  ['P5',  {tc:20, bv:1.2, hd:12, cv:28.5}],
  ['P6',  {tc:24, bv:1.5, hd:12, cv:28.5}],
  ['P7',  {tc:30, bv:1.5, hd:12, cv:28.5}],
  ['P8',  {tc:36, bv:1.5, hd:12, cv:28.5}],
  ['P9',  {tc:45, bv:1.5, hd:12, cv:28.5}],
  ['P10', {tc:15, bv:2.5, cv:28.5}],
  ['P11', {tc:15, bv:2.5, cv:28.5}],
  ['P12', {tc:15, bv:2.5, cv:28.5}],
  ['P13', {tc:15, bv:2.5, cv:20}],
  ['P14', {tc:15, bv:2.5, cv:10}],
];
// 找出 N 臂（P10-12，无 holders 门）条件全过的 tick（holders 未知，先算其余三门）
let hits = [];
for (const r of rows) {
  if (r.curVs == null) continue;
  for (const [name, g] of legs) {
    if (g.hd) continue; // holdersExDust 无法从 ticks 算，跳过 P4-9
    const ok = r.cumTrades >= g.tc && r.cumBuyBnb >= g.bv && r.curVs <= g.cv && r.act10 >= 0.1;
    if (ok) { hits.push({ time: r.time, leg: name, curVs: r.curVs.toFixed(1), tc: r.cumTrades, bv: r.cumBuyBnb.toFixed(2), act10: r.act10.toFixed(3) }); break; }
  }
}
console.log('== N/RL 臂（P10-14）其余三门全过的 tick 数 ==', hits.length);
// 打印每个满足段的第一笔与最后一笔
if (hits.length) {
  console.log('首笔:', JSON.stringify(hits[0]));
  console.log('末笔:', JSON.stringify(hits[hits.length-1]));
  // 时间分布
  const byDay = {};
  for (const h of hits) { const d = h.time.slice(0,13); byDay[d] = (byDay[d]||0)+1; }
  console.log('时间分布:', JSON.stringify(byDay));
}
// curVs 轨迹摘要：每小时最后一笔
console.log('== curVs 轨迹（每小时采样） ==');
let lastHour = '';
for (const r of rows) {
  const h = r.time.slice(0,13);
  if (h !== lastHour) { if (lastHour) console.log(''); process.stdout.write(h + ':00 '); lastHour = h; }
  process.stdout.write((r.curVs==null?'?':r.curVs.toFixed(0)) + ' ');
}
console.log('');
// 关键时点明细
console.log('== 关键时点 ==');
for (const r of rows) {
  if (['2026-11-02T19:53:42','2026-11-02T21:29','2026-11-03T07:50'].some(k => r.time.startsWith(k))) {
    console.log(r.time, r.type, 'bnb=', r.bnb.toFixed(4), 'curVs=', r.curVs.toFixed(1)+'%', 'cumTrades=', r.cumTrades, 'cumBuy=', r.cumBuyBnb.toFixed(2), 'act10=', r.act10.toFixed(3));
  }
}
process.exit(0);
