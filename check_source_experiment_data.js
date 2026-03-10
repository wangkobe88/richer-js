/**
 * 检查源实验的数据情况
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSourceExperimentData() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  console.log('=== 检查源实验的数据 ===\n');

  // 1. 检查 experiment_time_series_data 表
  const { data: timeSeriesData, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('1. experiment_time_series_data 表:');
  console.log('  总记录数:', timeSeriesData?.length || 0);
  console.log('  错误:', tsError?.message || '无');

  if (timeSeriesData && timeSeriesData.length > 0) {
    const uniqueTokens = new Set();
    timeSeriesData.forEach(d => uniqueTokens.add(d.token_address));
    console.log('  唯一代币数:', uniqueTokens.size);

    // 统计每个代币的数据点数
    const tokenDataCount = {};
    timeSeriesData.forEach(d => {
      tokenDataCount[d.token_address] = (tokenDataCount[d.token_address] || 0) + 1;
    });

    console.log('\n  每个代币的数据点数分布:');
    const counts = Object.values(tokenDataCount);
    console.log('    最小:', Math.min(...counts));
    console.log('    最大:', Math.max(...counts));
    console.log('    平均:', (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1));
  }

  // 2. 检查 experiment_tokens 表
  const { data: tokensData, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('\n2. experiment_tokens 表:');
  console.log('  总记录数:', tokensData?.length || 0);
  console.log('  错误:', tokensError?.message || '无');

  // 3. 检查 strategy_signals 表
  const { data: signalsData, error: signalsError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('\n3. strategy_signals 表:');
  console.log('  总记录数:', signalsData?.length || 0);
  console.log('  错误:', signalsError?.message || '无');

  if (signalsData && signalsData.length > 0) {
    const uniqueTokens = new Set();
    signalsData.forEach(d => uniqueTokens.add(d.token_address));
    console.log('  唯一代币数:', uniqueTokens.size);
  }

  // 4. 检查 trades 表
  const { data: tradesData, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', sourceExpId);

  console.log('\n4. trades 表:');
  console.log('  总记录数:', tradesData?.length || 0);
  console.log('  错误:', tradesError?.message || '无');

  // 5. 统计 summary
  console.log('\n5. 数据完整性检查');
  console.log('  源实验应该收集的数据:');
  console.log('    - experiment_time_series_data:', timeSeriesData?.length || 0, '条');
  console.log('    - experiment_tokens:', tokensData?.length || 0, '条');
  console.log('    - strategy_signals:', signalsData?.length || 0, '条');
  console.log('    - trades:', tradesData?.length || 0, '条');

  console.log('\n⚠️  关键问题:');
  if ((timeSeriesData?.length || 0) < 100) {
    console.log('  experiment_time_series_data 数据很少！(< 100条)');
    console.log('  这会导致回测时只能处理少量代币');
    console.log('  可能原因:');
    console.log('    1. 源实验运行时间太短');
    console.log('    2. 数据收集配置有问题');
    console.log('    3. 数据插入失败');
  }
}

checkSourceExperimentData().catch(console.error);
