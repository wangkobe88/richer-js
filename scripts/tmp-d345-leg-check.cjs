const { dbManager } = require('../src/services/dbManager');
(async () => {
  const c = dbManager.getClient();
  const r = await c
    .from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount')
    .eq('token_address', '0x89aa0e56ed746727f53e8bc720b747487e4e7777')
    .gte('block_time', '2026-10-12T20:18:55Z')
    .lte('block_time', '2026-10-12T20:20:30Z')
    .order('block_time', { ascending: true })
    .limit(300);
  const rows = r.data || [];
  console.log('ticks:', rows.length);
  const peak = Math.max(...rows.map(x => x.price_bnb));
  console.log('本段峰:', peak.toExponential(4));
  for (const x of rows) {
    const dd = (x.price_bnb/peak*100 - 100);
    console.log(x.block_time.slice(11,23), x.price_bnb.toExponential(4), 'dd_vs_peak:', dd.toFixed(1) + '%', 'bnb:', x.bnb_amount?.toFixed(3));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
