require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOK = '0x4fe71b03ed8be235fb2b7671f8b84caecad57777';
async function main() {
  const sb = dbManager.getClient();
  const tr = await sb.from('trades').select('*').eq('experiment_id', EXP).eq('token_address', TOK).order('created_at', { ascending: true }).limit(20);
  if (tr.data) for (const t of tr.data) {
    console.log('trade:', t.created_at, t.side ?? t.trade_type, 'bnb=', t.bnb_amount ?? t.amount_bnb, 'profit=', t.profit_percent, 'price=', t.price_bnb ?? t.price);
  } else console.log('trades err:', tr.error.message);
  const tks = await sb.from('wss_price_ticks')
    .select('block_time, price_bnb, bnb_amount, trade_type, sender_address')
    .eq('token_address', TOK)
    .gte('block_time', '2026-10-03T08:29:00Z')
    .lte('block_time', '2026-10-03T08:46:00Z')
    .order('block_time', { ascending: true }).limit(1000);
  const rows = tks.data || [];
  console.log('ticks 08:29~08:46:', rows.length);
  if (rows.length) {
    const t0 = new Date(rows[0].block_time).getTime();
    let lastMin = null, cnt = 0, vol = 0;
    for (const t of rows) {
      const m = Math.floor((new Date(t.block_time).getTime() - t0) / 60000);
      if (m !== lastMin) {
        if (lastMin !== null) console.log(`  t+${lastMin}min: ${cnt} ticks, ${vol.toFixed(3)} BNB`);
        lastMin = m; cnt = 0; vol = 0;
      }
      cnt++; vol += Number(t.bnb_amount || 0);
      if (m <= 1 || m % 2 === 0) console.log(`  ${t.block_time.slice(11,19)} ${t.trade_type} bnb=${Number(t.bnb_amount).toFixed(4)} px=${Number(t.price_bnb).toExponential(3)}`);
    }
    if (lastMin !== null) console.log(`  t+${lastMin}min: ${cnt} ticks, ${vol.toFixed(3)} BNB`);
    const prices = rows.map(t => Number(t.price_bnb)).filter(p => p > 0);
    const first = prices[0];
    console.log('first px:', first.toExponential(3), 'max:', Math.max(...prices).toExponential(3), '(' + (Math.max(...prices)/first*100-100).toFixed(1) + '%)', 'min:', Math.min(...prices).toExponential(3), '(' + (Math.min(...prices)/first*100-100).toFixed(1) + '%)', 'last:', prices[prices.length-1].toExponential(3));
    // 钱包多样性
    const wallets = new Set(rows.map(t => (t.sender_address || t.trader_address || '').toLowerCase()).filter(Boolean));
    console.log('distinct wallets in window:', wallets.size);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
