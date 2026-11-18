// ea78：quote_set payload + 首 10 笔完整 tick 行（含 token 数量列）→ 推真实 P0
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';

(async () => {
  const c = await dbManager.getClient();

  const ev = await c.from('wss_events').select('kind,block_time,payload')
    .eq('token_address', ADDR).eq('kind', 'token_quote_set').limit(1);
  console.log('token_quote_set payload:');
  console.log(JSON.stringify(ev.data && ev.data[0], null, 1));

  const q = await c.from('wss_price_ticks').select('*')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-11-05T05:48:00Z')
    .lte('block_time', '2026-11-05T05:48:40Z')
    .order('block_time', { ascending: true }).limit(30);
  const rows = q.data || [];
  console.log(`\n首 ${rows.length} 行（全部列）:`);
  if (rows.length) console.log('列:', Object.keys(rows[0]).join(','));
  for (const r of rows) {
    const o = { ...r };
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'number') o[k] = v.toPrecision(8);
    }
    console.log(JSON.stringify(o));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
