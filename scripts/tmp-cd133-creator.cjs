const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
async function main() {
  const client = dbManager.getClient();
  const ev = await client.from('wss_events')
    .select('kind, block_number, block_time, payload')
    .eq('token_address', '0xe8e0c8737701105824403a5aaccd0030018a7777').limit(5);
  console.log('error:', ev.error ? JSON.stringify(ev.error).slice(0, 300) : 'null');
  console.log('rows:', (ev.data || []).length);
  for (const r of ev.data || []) {
    const p = r.payload || {};
    console.log('kind=' + r.kind + ' blk=' + r.block_number + ' time=' + r.block_time);
    console.log('  payload keys: ' + Object.keys(p).join(','));
    console.log('  payload: ' + JSON.stringify(p).slice(0, 600));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
