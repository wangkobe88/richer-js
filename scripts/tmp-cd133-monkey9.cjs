const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
async function main() {
  const client = dbManager.getClient();
  // 1) d827 在 07:47 重启后的 ticks 总数（FA 重累计是否够 15）
  const t = await client.from('wss_price_ticks').select('id, block_time, trade_type, bnb_amount, sender_address')
    .eq('token_address', '0xd827bc26713cb6412f4d163766938dee3d0c7777')
    .gte('block_time', '2026-11-02T07:47:41+00:00')
    .order('id', { ascending: true }).limit(200);
  console.log('d827 07:47 后 ticks=' + t.data.length + ' 笔');
  for (const r of t.data) console.log('  ' + r.block_time + ' ' + r.trade_type + ' ' + Number(r.bnb_amount).toFixed(4) + ' sender=' + (r.sender_address || 'NULL').slice(0, 12));
  // 2) e8e0 的 creator
  const ev = await client.from('wss_events').select('payload').eq('token_address', '0xe8e0c8737701105824403a5aaccd0030018a7777').eq('kind', 'token_create').limit(1);
  console.log('\ne8e0 creator=' + ((ev.data[0] || {}).payload || {}).creator);
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
