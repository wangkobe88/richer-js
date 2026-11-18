// ea78：payload keys + 首次回到 ≤+28.5% 的精确时刻
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FL = 6.14 / (107036752 + 1e9);
const LINE = FL * 1.285;

(async () => {
  const c = await dbManager.getClient();

  const ev = await c.from('wss_events').select('kind,block_time,payload')
    .eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
  const p = (ev.data && ev.data[0] && ev.data[0].payload) || {};
  console.log('token_create payload keys:', Object.keys(p).join(','));
  console.log(JSON.stringify(p).slice(0, 400));

  // 首次回到 ≤+28.5%（signal 前）
  const q = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T05:49:05Z')
    .lte('price_bnb', LINE)
    .order('block_time', { ascending: true })
    .limit(3);
  console.log(`\n+28.5%线=${LINE.toExponential(4)}`);
  for (const r of (q.data || [])) {
    console.log(`首次回落: ${r.block_time} px=${Number(r.price_bnb).toExponential(3)} (${(((r.price_bnb / FL) - 1) * 100).toFixed(1)}%) ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)}`);
  }

  // 信号时刻 09:59:57 前后 30s ticks
  const q2 = await c.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T09:59:20Z')
    .lte('block_time', '2026-11-05T10:00:30Z')
    .order('block_time', { ascending: true }).limit(60);
  console.log('\n09:59:20~10:00:30 ticks:');
  for (const r of (q2.data || [])) {
    console.log(`  ${r.block_time} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} px=${Number(r.price_bnb).toExponential(3)} (${r.price_bnb == null ? '-' : (((r.price_bnb / FL) - 1) * 100).toFixed(1)}%)`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
