require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';
async function main() {
  const sb = dbManager.getClient();
  const { data } = await sb.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, sender_address, trader_address')
    .eq('token_address', TOK)
    .in('block_time', ['2026-10-03T08:29:25.000Z','2026-10-03T08:30:14.000Z'])
    .order('block_time').limit(10)
    .then(r => r).catch(async () => ({}));
  // block_time 精确匹配不可靠，改拉窗内大额行
  const r2 = await sb.from('wss_price_ticks')
    .select('block_time, trade_type, bnb_amount, sender_address')
    .eq('token_address', TOK)
    .gte('block_time', '2026-10-03T08:29:00Z').lte('block_time', '2026-10-03T08:30:30Z')
    .order('block_time').limit(200);
  for (const t of (r2.data || [])) {
    if (Number(t.bnb_amount) >= 0.5) console.log(t.block_time, t.trade_type, Number(t.bnb_amount).toFixed(4), t.sender_address);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
