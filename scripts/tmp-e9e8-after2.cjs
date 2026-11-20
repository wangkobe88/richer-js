const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0xe9e82d1fa74283991dec5543453373ec836b7777';
const SELL = 0.00000308409231082;
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,trader_address,sender_address,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T17:20:30')
    .lte('block_time', '2026-10-19T17:40:00')
    .order('block_time');
  console.log('rows:', (rows || []).length);
  let maxRel = 0, maxRelAt = null, last = null;
  for (const r of rows || []) {
    last = r;
    if (!r.price_outlier && r.price_bnb > maxRel) { maxRel = r.price_bnb; maxRelAt = r.block_time; }
  }
  console.log('sellPrice=', SELL, '→ after: maxRel=', maxRel, '@', maxRelAt, '| vs sell:', ((maxRel / SELL - 1) * 100).toFixed(1) + '%');
  console.log('lastTick:', last?.block_time, '| price=', last?.price_bnb, '| vs sell:', last ? ((last.price_bnb / SELL - 1) * 100).toFixed(1) + '%' : 'n/a');
  // 卖后 1/5/15min 切片
  for (const [tag, t] of [['+1min', '2026-10-19T17:22:06'], ['+5min', '2026-10-19T17:26:06'], ['+15min', '2026-10-19T17:36:06']]) {
    let m = 0, at = null;
    for (const r of rows || []) {
      if (r.block_time > t) break;
      if (!r.price_outlier && r.price_bnb > m) { m = r.price_bnb; at = r.block_time; }
    }
    if (m > 0 && at > SELL_AT_CHECK()) console.log(tag, 'maxRel(since sell)=', m, '@', at, '=', ((m / SELL - 1) * 100).toFixed(1) + '%');
    else if (m > 0) console.log(tag, '(窗内高点在卖前)', m);
  }
  function SELL_AT_CHECK() { return '2026-10-19T17:21:06'; }
  // 卖后逐笔前 25 行
  console.log('\n--- ticks after sell (first 25):');
  let n = 0;
  for (const r of rows || []) {
    if (r.block_time <= '2026-10-19T17:21:06') continue;
    console.log(r.block_time, r.trade_type, 'bnb=', r.bnb_amount, 'price=', r.price_bnb?.toPrecision(4), r.price_outlier ? '(outlier)' : '');
    if (++n >= 25) break;
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
