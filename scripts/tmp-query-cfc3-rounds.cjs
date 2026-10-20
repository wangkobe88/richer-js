// 一次性查询：0xcfc3…7777 叙事轮次留痕（单票小结果）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xcfc39a869380200949685d16197e93f100207777';
async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('id', { ascending: true })
    .limit(20);
  if (error) throw error;
  console.log(`rounds: ${data?.length ?? 0}`);
  for (const r of data || []) {
    const { id, experiment_id, reason, rating, category, started_at, finished_at, error, metadata } = r;
    console.log(`#${id} exp=${experiment_id} reason=${reason} rating=${rating} cat=${category} ${started_at}→${finished_at} err=${String(error || '').slice(0,120)}`);
    if (metadata && Object.keys(metadata).length) console.log('   md:', JSON.stringify(metadata).slice(0, 400));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
