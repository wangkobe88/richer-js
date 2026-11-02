const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const TOK = '0xd827bc26713cb6412f4d163766938dee3d0c7777';
async function main() {
  const client = dbManager.getClient();
  // 1) wss_events 探列名 + token_create
  const ev = await client.from('wss_events').select('*').eq('token_address', TOK).limit(5);
  if (ev.error) { console.log('ev error:', ev.error.message); }
  for (const r of ev.data || []) {
    console.log('== wss_event kind=' + r.kind);
    console.log('  cols: ' + Object.keys(r).join(','));
    const p = r.payload || {};
    console.log('  payload: ' + JSON.stringify(p).slice(0, 800));
  }
  // 2) cheat_detection 全行
  const cd = await client.from('cheat_detection').select('*').eq('token_address', TOK)
    .order('created_at', { ascending: true });
  console.log('\n== cheat_detection ' + (cd.data || []).length + ' 行');
  for (const row of cd.data || []) {
    const d = row.snapshot_digest || {};
    console.log('-- ' + row.created_at + ' status=' + row.status + ' verdict=' + row.verdict);
    console.log('   grade=' + d.grade + ' v=' + d.gradeVersion + ' reasons=' + JSON.stringify(d.gradeReasons));
    console.log('   phenomena=' + JSON.stringify(d.phenomena));
    console.log('   extLevels=' + JSON.stringify(d.extLevels) + ' act=' + d.activityLevel + ' dom=' + d.bundledDominance);
    console.log('   anchors=' + JSON.stringify(d.anchors));
    console.log('   famous=' + JSON.stringify(d.famous));
    console.log('   tickCount=' + d.tickCount + ' capped=' + d.capped + ' watermark=' + d.watermark);
  }
  // 3) 全史 ticks
  const t = await client.from('wss_price_ticks')
    .select('block_number, log_index, trade_type, bnb_amount, token_amount, sender_address, trader_address')
    .eq('token_address', TOK).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(100);
  console.log('\n== 全史 ticks ' + (t.data || []).length + ' 笔');
  for (const r of t.data) console.log('  blk ' + r.block_number + '.' + r.log_index + ' ' + (r.trade_type === 'buy' ? '买' : '卖') + ' ' + Number(r.bnb_amount).toFixed(4) + ' BNB ' + (Number(r.token_amount || 0) / 1e6).toFixed(1) + 'Mtok sender=' + (r.sender_address || 'NULL').slice(0, 12));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
