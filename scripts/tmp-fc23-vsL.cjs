'use strict';
// 0xfc23 一姐：BNB 轴 vsL 路径（15:42:00~15:44:30）——判断 15:43:02 时各价格域腿的可触发区间
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-04T15:40:48Z').lte('block_time', '2026-10-04T15:44:30Z')
    .order('block_time', { ascending: true }).limit(1500);
  if (error) throw new Error(error.message);
  const launch = 5.546337995470633e-9; // flap BNB 轴地板锚常量
  console.log(`窗内 ${data.length} 行（outlier ${data.filter(r => r.price_outlier).length}）`);
  let hi = 0, hiT = '';
  let lastVs = null;
  const marks = ['15:42:04', '15:42:32', '15:43:02', '15:43:20', '15:43:40'];
  for (const r of data) {
    const t = r.block_time.slice(11, 19);
    const vs = r.price_bnb ? (r.price_bnb / launch - 1) * 100 : null;
    if (vs !== null && vs > hi) { hi = vs; hiT = t; }
    if (marks.includes(t) && vs !== null) console.log(`※ ${t} ${r.trade_type} ${(r.bnb_amount || 0).toFixed(3)}B vsL=+${vs.toFixed(1)}%`);
    lastVs = vs;
  }
  console.log(`\n窗内 vsL 峰值=+${hi.toFixed(1)}% @${hiT}；末值=+${lastVs === null ? 'n/a' : lastVs.toFixed(1)}%`);
  // 每 10s 桶 vsL 首/末/峰
  const buckets = {};
  for (const r of data) {
    if (r.price_outlier || !r.price_bnb) continue;
    const key = r.block_time.slice(11, 18) + '0';
    const vs = (r.price_bnb / launch - 1) * 100;
    const b = buckets[key] = buckets[key] || { first: vs, last: vs, hi: vs, n: 0, vol: 0 };
    b.n++; b.vol += Number(r.bnb_amount || 0); b.last = vs; b.hi = Math.max(b.hi, vs);
  }
  for (const k of Object.keys(buckets).sort()) {
    const b = buckets[k];
    console.log(`${k}  n=${String(b.n).padStart(3)} vol=${b.vol.toFixed(2)}B  vsL首=+${b.first.toFixed(1)} 末=+${b.last.toFixed(1)} 峰=+${b.hi.toFixed(1)}%`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
