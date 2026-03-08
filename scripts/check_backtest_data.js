/**
 * 查看回测实验 ab75cb2b 的所有相关数据
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkAllData() {
  const experimentId = 'ab75cb2b-4930-4049-a3bd-f96e3de6af47';

  // 获取实验配置
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  const sourceExperimentId = experiment.config?.backtest?.sourceExperimentId;
  console.log(`实验ID: ${experimentId}`);
  console.log(`源实验ID: ${sourceExperimentId}`);
  console.log('');

  // 查看这个回测实验的 trades 表数据
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId);

  console.log(`回测实验的 trades 表记录数: ${trades?.length || 0}`);

  if (trades && trades.length > 0) {
    console.log('回测实验有交易数据！');
    console.log('示例:', JSON.stringify(trades[0], null, 2));
  }

  // 查看源实验的 trades 表数据
  if (sourceExperimentId) {
    const { data: sourceTrades } = await supabase
      .from('trades')
      .select('*')
      .eq('experiment_id', sourceExperimentId)
      .order('created_at', { ascending: true })
      .limit(10);

    console.log(`\n源实验的 trades 表记录数: ${sourceTrades?.length || 0}`);

    if (sourceTrades && sourceTrades.length > 0) {
      console.log('源实验交易示例:');
      console.log(JSON.stringify(sourceTrades[0], null, 2));
    }
  }

  // 检查是否有其他表存储了回测结果
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  console.log(`\n回测实验的 experiment_tokens 表记录数: ${tokens?.length || 0}`);

  if (tokens && tokens.length > 0) {
    console.log('示例代币:', tokens[0].token_symbol);
  }
}

checkAllData().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('查询失败:', error);
  process.exit(1);
});
