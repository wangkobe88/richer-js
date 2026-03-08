/**
 * 检查实验配置和数据结构
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkExperiment() {
  const experimentId = 'afed3289-2f89-4da5-88f1-1468d61f8b3d';

  console.log('=== 检查实验配置 ===\n');

  // 1. 获取实验信息
  const { data: experiment, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (expError) {
    console.error('获取实验信息失败:', expError);
    return;
  }

  console.log('实验信息:');
  console.log(JSON.stringify(experiment, null, 2));

  // 2. 检查 experiment_tokens 表结构
  console.log('\n=== 检查 experiment_tokens 表结构 ===\n');

  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(1);

  if (tokensError) {
    console.error('获取代币失败:', tokensError);
  } else if (tokens && tokens.length > 0) {
    console.log('代币字段:', Object.keys(tokens[0]));
    console.log('\n示例代币:');
    console.log(JSON.stringify(tokens[0], null, 2));
  }

  // 3. 检查是否有 human_judges 数据
  console.log('\n=== 检查 human_judges 数据 ===\n');

  const { data: judgedTokens, error: judgedError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, human_judges')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

  if (judgedError) {
    console.error('获取人工判断代币失败:', judgedError);
  } else {
    console.log(`找到 ${judgedTokens?.length || 0} 个有人工判断的代币`);
    if (judgedTokens && judgedTokens.length > 0) {
      console.log('\n示例:');
      console.log(JSON.stringify(judgedTokens[0], null, 2));
    }
  }

  // 4. 检查 strategy_signals 表
  console.log('\n=== 检查 strategy_signals 表 ===\n');

  const { data: signals, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .limit(1);

  if (signalsError) {
    console.error('获取信号失败:', signalsError);
  } else if (signals && signals.length > 0) {
    console.log('信号字段:', Object.keys(signals[0]));
    console.log('\n示例信号:');
    console.log(JSON.stringify(signals[0], null, 2));
  }

  // 5. 查找可能有关联的实验
  console.log('\n=== 查找相关实验 ===\n');

  const { data: allExperiments, error: allExpError } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (allExpError) {
    console.error('获取实验列表失败:', allExpError);
  } else {
    console.log('最近的实验:');
    allExperiments.forEach(exp => {
      console.log(`  ${exp.id}: ${exp.experiment_name} (${exp.trading_mode})`);
    });
  }
}

checkExperiment().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
