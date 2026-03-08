/**
 * 检查实验 ab75cb2b-4930-4049-a3bd-f96e3de6af47 的详细配置和源实验
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkExperiment() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  // 获取实验配置
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  console.log('【实验配置】');
  console.log(JSON.stringify(experiment.config, null, 2));
  console.log('');

  // 获取源实验ID
  const sourceExperimentId = experiment.config?.backtest?.sourceExperimentId;
  console.log(`源实验ID: ${sourceExperimentId}`);
  console.log('');

  if (sourceExperimentId) {
    // 检查源实验的数据
    const { data: sourceTokens } = await supabase
      .from('experiment_tokens')
      .select('*')
      .eq('experiment_id', sourceExperimentId)
      .limit(10);

    console.log(`源实验代币数量: ${sourceTokens?.length || 0}`);

    if (sourceTokens && sourceTokens.length > 0) {
      console.log('\n源实验代币示例:');
      sourceTokens.forEach(t => {
        const maxChange = t.analysis_results?.max_change_percent || 0;
        console.log(`  ${t.token_symbol}: 最高涨幅 ${maxChange.toFixed(2)}%`);
      });
    }

    // 检查源实验的交易记录
    const { data: sourceTrades } = await supabase
      .from('trades')
      .select('*')
      .eq('experiment_id', sourceExperimentId);

    console.log(`\n源实验交易数: ${sourceTrades?.length || 0}`);
  }

  // 检查回测配置
  const minMaxChange = experiment.config?.backtest?.min_max_change_percent;
  console.log(`\n回测最低涨幅要求: ${minMaxChange || '未设置'}%`);
}

checkExperiment().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
