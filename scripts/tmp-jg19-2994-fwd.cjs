'use strict';
// JG-19：Waterdrop 卖后价格路径 + 承接迟到核验（burst 快卖误伤）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0x29946c3421ccebb43ca6d30970629c5a432a7777';
(async () => {
  const sb = dbManager.getClient();
  const SELL = Date.parse('2026-10-03T16:47:40Z');
  const { data, error } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-03T16:46:50Z').lte('block_time', '2026-10-03T17:50:00Z')
    .order('block_time', { ascending: true }).limit(3000);
  if (error) throw new Error(error.message);
  const rows = (data || []).filter(r => !r.price_outlier && r.price_bnb);
  console.log(`窗内有效 tick ${rows.length} 行`);
  const sellPx = rows.length ? rows[0].price_bnb : null;
  // 找卖出时刻的基准价（卖出 tick 附近价）
  let base = null;
  for (const r of rows) { if (Date.parse(r.block_time) <= SELL) base = r.price_bnb; }
  console.log('卖出时刻价:', base && base.toExponential(4));
  // 承接观测窗（16:47:25~16:47:40，fire+15s）内非 burst 买入——burst 成员不可知，粗看窗内全部买入
  const inWin = rows.filter(r => Date.parse(r.block_time) >= Date.parse('2026-10-03T16:47:25Z') && Date.parse(r.block_time) <= SELL);
  console.log('\n承接窗（fire+15s）内 tick:');
  for (const r of inWin) console.log(`  ${r.block_time.slice(11, 19)} ${r.trade_type} ${Number(r.bnb_amount).toFixed(3)}B ${(r.sender_address || '').slice(0, 10)}`);
  // 卖后路径：10s 桶
  const buckets = {};
  for (const r of rows) {
    const t = Date.parse(r.block_time);
    if (t < SELL) continue;
    const dt = Math.floor((t - SELL) / 10000); // 10s 桶
    const b = buckets[dt] = buckets[dt] || { n: 0, vol: 0, hi: 0, last: r.price_bnb };
    b.n++; b.vol += Number(r.bnb_amount || 0); b.hi = Math.max(b.hi, r.price_bnb); b.last = r.price_bnb;
  }
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  console.log('\n卖后 10s 桶（vs 卖出价）:');
  let peak = 0, peakT = '';
  for (const k of keys.slice(0, 40)) {
    const b = buckets[k];
    const vsSell = base ? ((b.last / base - 1) * 100).toFixed(1) : '-';
    const hiVs = base ? ((b.hi / base - 1) * 100).toFixed(1) : '-';
    if (b.hi > peak) { peak = b.hi; peakT = '+' + (k * 10) + 's'; }
    console.log(`+${String(k * 10).padStart(4)}s  n=${String(b.n).padStart(3)} 量=${b.vol.toFixed(2)}B 末=${vsSell}% 峰=${hiVs}%`);
  }
  console.log(`\n卖后峰值: ${base ? ((peak / base - 1) * 100).toFixed(1) : '-'}% @${peakT}`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
