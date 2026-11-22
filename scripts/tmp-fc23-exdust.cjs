'use strict';
// 0xfc23 一姐：复算 holdersExDust 时间线（wallet=sender||trader，净持仓 token 数×首可靠价 P0_bnb ≥0.015）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-04T15:40:40Z').lte('block_time', '2026-10-04T15:44:00Z')
    .order('block_time', { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  const rows = (data || []).filter(r => !r.price_outlier && r.price_bnb && Number(r.bnb_amount) >= 0);
  // 首可靠价（BNB 轴）
  const p0 = rows[0].price_bnb;
  console.log(`窗内有效 ${rows.length} 行，P0=${p0.toExponential(4)}（${rows[0].block_time}）`);
  // 逐 tick 复算 ExDust（在关键时刻打印钱包明细）
  const net = new Map(); // wallet -> token 数量
  const DUST = 0.015;
  const exDust = () => {
    let n = 0;
    for (const v of net.values()) if (v * p0 >= DUST) n++;
    return n;
  };
  const marks = ['15:42:04', '15:42:32', '15:43:02', '15:43:05', '15:43:10', '15:43:18', '15:43:25'];
  let lastMark = '';
  const newWalletsAt0302 = [];
  const before0302 = new Set();
  for (const r of rows) {
    const t = r.block_time.slice(11, 19);
    const w = r.sender_address || r.trader_address;
    const tokens = Number(r.bnb_amount) / Number(r.price_bnb);
    const sign = r.trade_type === 'sell' ? -1 : 1;
    net.set(w, (net.get(w) || 0) + sign * tokens);
    if (t < '15:43:02' && sign > 0) before0302.add(w);
    if (t === '15:43:02' && sign > 0 && !before0302.has(w)) newWalletsAt0302.push(`${w.slice(0, 10)}(+${(tokens * p0).toFixed(3)}B折算)`);
    for (const m of marks) {
      if (t === m && m !== lastMark) { console.log(`@${m}  ExDust=${exDust()}  (net钱包数=${net.size})`); lastMark = m; }
    }
  }
  console.log('\n15:43:02 买入且此前无买入记录的钱包:', newWalletsAt0302.length ? newWalletsAt0302.join(', ') : '无（全是老钱包/卖方回补）');
  // 终态钱包明细
  console.log('\n窗末（15:44:00）钱包净持仓折算 BNB:');
  const arr = [...net.entries()].map(([w, v]) => ({ w, bnb: v * p0 })).sort((a, b) => b.bnb - a.bnb);
  for (const a of arr.slice(0, 12)) console.log(`  ${a.w.slice(0, 12)} ${a.bnb >= DUST ? '✓' : '尘'} ${a.bnb.toFixed(4)}B`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
