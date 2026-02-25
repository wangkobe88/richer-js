/**
 * 调查代币"4"的策略执行情况
 */

const { dbManager } = require('../src/services/dbManager');

async function investigateTokenStrategy() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';
  const tokenAddress = '0x2fbee5e7dd23c2daf47bddfc042f9a1d471e4444';

  // 获取 Loop 2740 附近的时序数据
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp, factor_values, signal_type, signal_executed, execution_reason')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('loop_count', { ascending: true });

  console.log('📊 代币 "4" 的策略执行情况:\n');

  // 找到满足条件的 Loop 2740
  const targetLoop = timeSeriesData.find(ts => ts.loop_count === 2740);

  if (targetLoop) {
    console.log('Loop 2740 (满足所有条件):');
    console.log('  signal_type:', targetLoop.signal_type);
    console.log('  signal_executed:', targetLoop.signal_executed);
    console.log('  execution_reason:', targetLoop.execution_reason);
  }

  // 检查前后是否有买入信号
  console.log('\n📊 检查前后是否有买入信号...');
  let hasBuySignal = false;
  for (const ts of timeSeriesData) {
    if (ts.signal_type === 'BUY' || ts.signal_type === 'buy') {
      hasBuySignal = true;
      console.log(`  Loop ${ts.loop_count}: signal_type=${ts.signal_type}, executed=${ts.signal_executed}`);
    }
  }

  if (!hasBuySignal) {
    console.log('  没有找到任何买入信号');
  }

  // 检查策略信号表
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);

  console.log('\n📊 strategy_signals 表记录数:', signals?.length || 0);

  // 检查 trades 表
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);

  console.log('📊 trades 表记录数:', trades?.length || 0);

  // 分析：为什么没有生成买入信号
  console.log('\n🔍 分析：为什么没有生成买入信号？');
  console.log('可能原因：');
  console.log('1. 策略引擎 evaluate() 方法返回了 null');
  console.log('2. 代币状态不是 monitoring（已确认是 monitoring）');
  console.log('3. 其他代码逻辑阻止了策略触发');
}

investigateTokenStrategy()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
