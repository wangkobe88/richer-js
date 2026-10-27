// 一次性查询：0x3324…7777 价格表现 + 叙事轮次（单行小结果）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0x3324d7c228d05d2b6d1d8674613e221b228b7777';

async function main() {
  const client = await dbManager.getClient();
  const { data: ticks, error: e1 } = await client
    .from('wss_price_ticks')
    .select('price_bnb, block_time')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(1);
  if (e1) throw e1;
  const { data: last, error: e2 } = await client
    .from('wss_price_ticks')
    .select('price_bnb, block_time')
    .eq('token_address', ADDR)
    .order('id', { ascending: false })
    .limit(1);
  if (e2) throw e2;
  const { data: mx, error: e3 } = await client
    .from('wss_price_ticks')
    .select('price_bnb, block_time')
    .eq('token_address', ADDR)
    .order('price_bnb', { ascending: false })
    .limit(1);
  if (e3) throw e3;
  console.log(`首 tick: ${ticks?.[0]?.price_bnb} @ ${ticks?.[0]?.block_time}`);
  console.log(`末 tick: ${last?.[0]?.price_bnb} @ ${last?.[0]?.block_time}`);
  console.log(`max tick: ${mx?.[0]?.price_bnb} @ ${mx?.[0]?.block_time}`);
  if (ticks?.[0]?.price_bnb && mx?.[0]?.price_bnb) {
    console.log(`峰倍数: ${(Number(mx[0].price_bnb) / Number(ticks[0].price_bnb)).toFixed(1)}x`);
  }

  const { data: rounds, error: e4 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(10);
  if (e4) throw e4;
  console.log(`\nrounds: ${rounds?.length ?? 0} 行`);
  for (const r of rounds || []) {
    console.log(`  exp=${r.experiment_id} round=${r.round_number} reason=${r.reason} status=${r.status} rating=${r.rating} at=${r.created_at}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
