// 一次性查询：0xed38…7777 重析后新行全貌 + 轮次表原始评级 + 买信号 metadata（单条小结果）
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xed389dfed0568f07b71ff678b92da1c052957777';

async function main() {
  const client = await dbManager.getClient();

  const { data: narr, error: e1 } = await client
    .from('token_narrative')
    .select('*')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (e1) throw e1;
  console.log('=== 重析后 token_narrative 行（标量列）===');
  for (const [k, v] of Object.entries(narr || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.length > 300) { console.log(`${k}: <${v.length}字> ${v.slice(0, 300)}…`); continue; }
    if (typeof v === 'object') continue;
    console.log(`${k}: ${JSON.stringify(v)}`);
  }
  const po = narr?.parsed_output || {};
  console.log(`parsed_output.token_category: ${JSON.stringify(po.token_category)}`);
  console.log(`parsed_output keys: ${Object.keys(po).join(', ')}`);
  const rad = narr?.raw_api_data || {};
  console.log(`raw_api_data.created_at: ${rad.created_at}`);

  const { data: rounds, error: e2 } = await client
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true })
    .limit(20);
  if (e2) throw e2;
  console.log(`\n=== narrative_analysis_rounds: ${rounds?.length ?? 0} 行 ===`);
  for (const r of rounds || []) {
    console.log(`round=${r.round} rating=${r.rating} reason=${String(r.reason ?? '').slice(0, 120)} at=${r.created_at} done=${r.completed_at}`);
  }

  const { data: sigs, error: e3 } = await client
    .from('strategy_signals')
    .select('id,metadata,created_at')
    .eq('token_address', ADDR)
    .eq('action', 'buy')
    .limit(2);
  if (e3) throw e3;
  for (const s of sigs || []) {
    const md = s.metadata || {};
    console.log(`\n=== 买信号 metadata 顶层键: ${Object.keys(md).join(', ')}`);
    for (const k of ['narrativeRating', 'narrativeCategory', 'narrativeRounds']) {
      if (md[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(md[k])}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
