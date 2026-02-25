/**
 * 检查分析结果覆盖率
 */

const { dbManager } = require('../src/services/dbManager');

async function checkAnalysisResults() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 获取所有代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, status, analysis_results')
    .eq('experiment_id', experimentId);

  let hasAnalysis = 0;
  let noAnalysis = 0;
  const returnRanges = {
    '0-50%': 0,
    '50-100%': 0,
    '100-200%': 0,
    '200-300%': 0,
    '300-500%': 0,
    '500%+': 0
  };

  for (const token of tokens) {
    const analysis = typeof token.analysis_results === 'string'
      ? JSON.parse(token.analysis_results)
      : token.analysis_results;

    if (analysis && analysis.max_change_percent !== undefined) {
      hasAnalysis++;
      const maxReturn = analysis.max_change_percent;
      if (maxReturn < 50) returnRanges['0-50%']++;
      else if (maxReturn < 100) returnRanges['50-100%']++;
      else if (maxReturn < 200) returnRanges['100-200%']++;
      else if (maxReturn < 300) returnRanges['200-300%']++;
      else if (maxReturn < 500) returnRanges['300-500%']++;
      else returnRanges['500%+']++;
    } else {
      noAnalysis++;
    }
  }

  console.log('📊 分析结果统计:');
  console.log(`  有分析结果: ${hasAnalysis} 个`);
  console.log(`  无分析结果: ${noAnalysis} 个`);
  console.log('\n📈 最高涨幅分布:');
  for (const [range, count] of Object.entries(returnRanges)) {
    if (count > 0) {
      console.log(`  ${range}: ${count} 个`);
    }
  }
}

checkAnalysisResults()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
