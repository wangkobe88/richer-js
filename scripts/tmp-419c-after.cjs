const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0x419c12c85c034f7e9f2d8a6a4de604059db77777';
async function main() {
  const sb = dbManager.getClient();
  const { data: rows } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,trader_address,sender_address,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-19T07:49:00')
    .lte('block_time', '2026-10-19T08:10:00')
    .order('block_time');
  const SELL_MS = Date.parse('2026-10-19T07:50:03Z');
  const SELL_PX = 0.000004263405742228; // USD 域；tick 折算用汇率 600 对照量级即可
  let maxRel = 0, maxAt = null;
  for (const r of rows || []) {
    if (Date.parse(r.block_time) <= SELL_MS) continue;
    if (!r.price_outlier && r.price_bnb > maxRel) { maxRel = r.price_bnb; maxAt = r.block_time; }
  }
  // 买价 BNB 域参照：卖价 4.2634e-6 USD ÷ 600 ≈ 7.106e-9
  const sellBnb = SELL_PX / 600;
  console.log('sellBnb≈', sellBnb.toExponential(3), '→ after maxRel=', maxRel.toExponential(3), '@', maxAt, '| vs sell:', ((maxRel / sellBnb - 1) * 100).toFixed(1) + '%');
  console.log('\n--- ticks around sell (07:49:45 ~ 07:50:40):');
  for (const r of rows || []) {
    if (r.block_time < '2026-10-19T07:49:45' || r.block_time > '2026-10-19T07:50:40') continue;
    console.log(r.block_time.slice(11,23), r.trade_type, 'bnb=', +r.bnb_amount.toFixed(4), 'px=', r.price_bnb?.toExponential(3), r.price_outlier ? '(out)' : '');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
