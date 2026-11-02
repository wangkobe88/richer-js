// f1dc Ragu 细节：twitter_info 完整形状 + final jev 审计全量 + 推文文本
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xf1dca9bf42c5f565063f493f693455c86dff7777';
(async () => {
  const db = dbManager.getClient();
  const { data: tn, error } = await db.from('token_narrative')
    .select('twitter_info,raw_api_data,final_result,event_score_result,token_category')
    .eq('token_address', ADDR);
  if (error) throw error;
  const row = tn[0];
  console.log('=== token_category:', row.token_category);
  console.log('=== twitter_info keys:', row.twitter_info ? Object.keys(row.twitter_info).join(',') : 'NULL');
  console.log(JSON.stringify(row.twitter_info, null, 1).slice(0, 3000));
  const rad = row.raw_api_data || {};
  console.log('=== raw_api_data keys:', Object.keys(rad).join(','));
  if (rad.metadata) console.log('meta:', JSON.stringify(rad.metadata).slice(0, 300));
  const fin = row.final_result;
  console.log('=== final.details.jev (全量):');
  console.log(JSON.stringify(fin?.details?.jev, null, 1));
  console.log('=== final.details keys:', fin?.details ? Object.keys(fin.details).join(',') : '-');
  const d = fin?.details || {};
  for (const k of ['blockReason','eventCompositeScore','relevanceScore','qualityScore','timingScore','impactTier','effectiveImpactTier']) {
    if (d[k] !== undefined) console.log(`  ${k}:`, d[k]);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
