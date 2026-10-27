// 一次性查询：0x08be…7777 两笔 trades 完整字段
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x08be87804707fe0ebc86ef56d4bddb202c627777';
async function main() {
  const client = await dbManager.getClient();
  const { data: trades, error } = await client
    .from('trades')
    .select('*')
    .eq('token_address', ADDR.toLowerCase())
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) throw error;
  for (const t of trades || []) {
    const md = t.metadata || {};
    console.log('=== trade at', t.created_at, '===');
    for (const [k, v] of Object.entries(t)) {
      if (k === 'metadata') continue;
      if (v !== null && v !== undefined) console.log(`  ${k}: ${String(JSON.stringify(v)).slice(0, 220)}`);
    }
    console.log('  metadata.cardTrade:', JSON.stringify(md.cardTrade));
    console.log('  metadata 摘要:', JSON.stringify(Object.keys(md)).slice(0, 400));
    if (md.sellReason || md.reason || md.executionReason) console.log('  卖出原因:', md.sellReason || md.reason || md.executionReason);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
