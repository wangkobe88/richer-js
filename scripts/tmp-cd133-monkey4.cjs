const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const EXP = 'e3d00085-9aa9-4dd2-8422-c30c14a9a576';
async function main() {
  const client = dbManager.getClient();
  // 1) 0xe8e0c873 的名字（修正列名：wss_events 无 block_number）
  for (const tok of ['0xe8e0c8737701105824403a5aaccd0030018a7777', '0xd827bc26713cb6412f4d163766938dee3d0c7777']) {
    const ev = await client.from('wss_events').select('kind,platform,block_time,payload')
      .eq('token_address', tok).eq('kind', 'token_create').limit(1);
    const p = (ev.data[0] || {}).payload || {};
    console.log(tok.slice(0, 10) + '… name=' + JSON.stringify(p.name) + ' symbol=' + JSON.stringify(p.symbol) + ' platform=' + ev.data[0].platform + ' create=' + ev.data[0].block_time + ' eventTs=' + p.eventTsSec);
  }
  // 2) 两张票在 v67 的 signal 行
  for (const [tok, label] of [['0xd827bc26713cb6412f4d163766938dee3d0c7777', 'd827(真猴子)'], ['0xe8e0c8737701105824403a5aaccd0030018a7777', 'e8e0(同名票)']]) {
    const s = await client.from('strategy_signals').select('signal_type, action, status, created_at, metadata')
      .eq('experiment_id', EXP).eq('token_address', tok).order('created_at', { ascending: true }).limit(10);
    console.log('\n== ' + label + ' v67 signals ' + (s.data || []).length + ' 行');
    for (const r of s.data || []) {
      const cc = (r.metadata || {}).cheatCheck;
      console.log('  ' + r.created_at + ' ' + r.signal_type + '/' + r.action + '/' + r.status + ' cheatCheck=' + (cc ? JSON.stringify(cc).slice(0, 200) : '无'));
    }
  }
  // 3) 监控池
  const mp = await client.from('token_monitoring_pool').select('token_address, status, first_seen_at, last_activity_at')
    .in('token_address', ['0xd827bc26713cb6412f4d163766938dee3d0c7777', '0xe8e0c8737701105824403a5aaccd0030018a7777']);
  console.log('\n== monitoring_pool:');
  for (const r of mp.data || []) console.log('  ' + r.token_address.slice(0, 10) + ' status=' + r.status + ' first_seen=' + r.first_seen_at + ' last=' + r.last_activity_at);
  // 4) 真猴子全史行数 + 首末 block_time
  const t = await client.from('wss_price_ticks').select('id, block_number, block_time, trade_type')
    .eq('token_address', '0xd827bc26713cb6412f4d163766938dee3d0c7777')
    .order('id', { ascending: true }).limit(1);
  const t2 = await client.from('wss_price_ticks').select('id, block_number, block_time')
    .eq('token_address', '0xd827bc26713cb6412f4d163766938dee3d0c7777')
    .order('id', { ascending: false }).limit(1);
  console.log('\n== 真猴子 ticks 首行: ' + JSON.stringify(t.data[0] || {}));
  console.log('== 真猴子 ticks 末行: ' + JSON.stringify(t2.data[0] || {}));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
