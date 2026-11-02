const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
async function main() {
  const client = dbManager.getClient();
  const tok = '0xe8e0c8737701105824403a5aaccd0030018a7777';
  const at = '2026-11-02T07:40:05Z';
  const a = await client.from('wss_price_ticks').select('id').eq('token_address', tok).lte('created_at', at).limit(1000);
  const b = await client.from('wss_price_ticks').select('id', { count: 'estimated' }).eq('token_address', tok).limit(1);
  const ev = await client.from('wss_events').select('block_time, payload').eq('token_address', tok).eq('kind', 'token_create').limit(1);
  console.log('首析时刻（07:40:05）已落 tick 行数 =', a.data ? a.data.length : a.error?.message, '（limit 1000 内）');
  console.log('全史至今 tick 行数(估) =', b.count ?? (b.data||[]).length);
  if (ev.data && ev.data[0]) console.log('token_create block_time =', ev.data[0].block_time, 'name/symbol =', JSON.stringify({n: ev.data[0].payload?.name, s: ev.data[0].payload?.symbol}));
  const ex = await client.from('experiments').select('config').eq('id', 'e3d00085-b796-4973-91fc-05013c438488').limit(1);
  const cfg = ex.data?.[0]?.config || {};
  console.log('v67 config.cheatCheck =', JSON.stringify(cfg.cheatCheck || (cfg.fourmemeWs||{}).cheatCheck || '(fourmemeWs 段也无)'));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
