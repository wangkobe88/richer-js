// 本地单条小结果读取：查两个 token 的叙事评级对比
import { dbManager } from './src/services/dbManager.js';

const ADDRS = [
  '0xa7c9c86e2d3b6cb7de698d8067635ebd8e627777',
  '0xbeea1d618e533a387d941f58a7d4c9b7bd377777',
];

const client = dbManager.getClient();

for (const addr of ADDRS) {
  const { data, error } = await client
    .from('token_narrative')
    .select('token_address, token_symbol, platform, is_valid, prompt_type, prompt_version, analyzed_at, pre_check_result, stage1_result, stage2_result, stage3_result, analysis_stage, extracted_info')
    .eq('token_address', addr.toLowerCase())
    .maybeSingle();
  if (error) {
    console.log(`=== ${addr} 查询失败:`, JSON.stringify(error));
    continue;
  }
  if (!data) {
    console.log(`=== ${addr} 无叙事记录`);
    continue;
  }
  console.log(`\n========== ${data.token_symbol} (${addr}) ==========`);
  console.log('is_valid:', data.is_valid, '| prompt_type:', data.prompt_type, '| analyzed_at:', data.analyzed_at);
  console.log('narrative_rating:', data.narrative_rating);
  const s3 = data.stage3_result;
  if (s3) {
    console.log('--- stage3_result keys:', Object.keys(s3));
    console.log(JSON.stringify(s3, null, 1).slice(0, 2500));
  }
  const ei = data.extracted_info;
  if (ei) {
    console.log('--- extracted_info 摘要:', JSON.stringify(ei).slice(0, 800));
  }
  const s1 = data.stage1_result;
  if (s1) console.log('--- stage1_result:', JSON.stringify(s1).slice(0, 1200));
}

process.exit(0);
