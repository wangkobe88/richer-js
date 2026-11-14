// T029 前视重放：无税人生三键（t1）+t6 低市值臂逐 tick 首满足时刻（182 跑）
// 口径：wallet=sender_address||trader_address；buyVolume=Σ buy bnb_amount（全量 tick）；
// holdersExDust=净持仓 token×当前可靠价 ≥0.015 BNB 的钱包数（FA holderDustBnb 默认，近似）
const fs = require('fs');
const path = '/home/ubuntu/richer-js/scripts/buy-point/sets/bp-2026-11-05-v73-trades-ticks/0xfba95a4e00883f82f04a459b107bd4788e2c4444.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const rows = raw.rows || [];
const DUST = 0.015;

let tradeCount = 0, buyVol = 0;
const netTok = new Map(); // wallet -> 净 token
let firstRelPrice = null;
const marks = [];
let t1Done = false, t6Done = false, count8 = null, volDone = null, holdDone = null;

rows.forEach((r, i) => {
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  const isBuy = String(r.trade_type).toLowerCase() === 'buy';
  const amt = Number(r.token_amount) || 0;
  if (isBuy) { tradeCount += 1; buyVol += Number(r.bnb_amount) || 0; netTok.set(w, (netTok.get(w) || 0) + amt); }
  else { netTok.set(w, (netTok.get(w) || 0) - amt); }
  if (!firstRelPrice && r.price_bnb && !r.price_outlier) firstRelPrice = r.price_bnb;
  const price = (r.price_bnb && !r.price_outlier) ? r.price_bnb : firstRelPrice;

  if (count8 === null && tradeCount >= 8) count8 = { i, at: r.block_time, n: tradeCount };
  if (volDone === null && buyVol >= 0.75) volDone = { i, at: r.block_time, v: +buyVol.toFixed(3) };
  let holders = 0;
  if (price) { for (const v of netTok.values()) if (v * price >= DUST) holders += 1; }
  if (holdDone === null && holders >= 6) holdDone = { i, at: r.block_time, h: holders };
  const t1ok = tradeCount >= 8 && buyVol >= 0.75 && holders >= 6;
  if (!t1Done && t1ok) { t1Done = true; marks.push({ leg: 't1 三键首齐', i, at: r.block_time, price: r.price_bnb, tradeCount, buyVol: +buyVol.toFixed(3), holders }); }
  // t6 v1 无峰门：marketCap>0 ∧ <=7.5（mcap≈price×1e9 totalSupply，flap/fourmeme 1e9）
  const mcap = price ? price * 1e9 : null;
  if (!t6Done && mcap !== null && mcap > 0 && mcap <= 7.5) { t6Done = true; marks.push({ leg: 't6 低市值臂首满足', i, at: r.block_time, price: r.price_bnb, mcap: +mcap.toFixed(3) }); }
});

console.log('rows:', rows.length, '首行:', rows[0].block_time, '末行:', rows[rows.length - 1].block_time);
console.log('count8:', JSON.stringify(count8));
console.log('volDone:', JSON.stringify(volDone));
console.log('holdDone:', JSON.stringify(holdDone));
console.log('marks:', JSON.stringify(marks, null, 1));
// t1 发射 07:53:21 前后的行
const around = rows.filter((r) => r.block_time >= '2026-11-05T07:52:50' && r.block_time <= '2026-11-05T07:53:25');
console.log('07:52:50-07:53:25 行数:', around.length);
around.forEach((r, i) => console.log(' ', r.block_time, r.trade_type, r.bnb_amount, 'px=' + r.price_bnb));
