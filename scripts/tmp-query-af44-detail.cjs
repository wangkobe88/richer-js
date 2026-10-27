// 一次性查询：0xaf44…7777 重析后词句题细节（单行读取）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xaf442b52ccf1df61b5e62ec8c4cc05e9a9447777';

async function main() {
  const client = await dbManager.getClient();
  const { data: n, error: e } = await client
    .from('token_narrative')
    .select('final_rating, block_reason, block_stage, event_category, total_score, analyzed_at, relation_result, event_result, jev_version')
    .eq('token_address', ADDR);
  if (e) throw e;
  const row = n[0];
  console.log(`rating=${row.final_rating} block=${row.block_stage}:${row.block_reason}`);
  console.log(`category=${row.event_category} score=${row.total_score} jev=${row.jev_version} at=${row.analyzed_at}`);
  const rel = row.relation_result?.details?.jev ?? row.relation_result?.details ?? {};
  console.log('\n=== relation_result.jev 摘要 ===');
  console.log(JSON.stringify(rel, null, 1).slice(0, 3500));
  const ev = row.event_result?.details?.jev?.probabilities ?? {};
  console.log('\n=== event 分类概率 ===');
  console.log(JSON.stringify(ev).slice(0, 1200));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
