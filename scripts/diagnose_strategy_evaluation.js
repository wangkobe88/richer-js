/**
 * 诊断代币 "4" 为什么没有触发买入策略
 * 模拟 StrategyEngine.evaluate() 的完整流程
 */

const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { dbManager } = require('../src/services/dbManager');

async function diagnoseStrategyEvaluation() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';
  const tokenAddress = '0x2fbee5e7dd23c2daf47bddfc042f9a1d471e4444';

  // 1. 获取实验配置
  const { data: experiment } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  const strategiesConfig = experiment.config.strategiesConfig;
  console.log('📊 实验买入策略配置:');
  console.log(JSON.stringify(strategiesConfig.buyStrategies, null, 2));

  // 2. 创建 ConditionEvaluator
  const evaluator = new ConditionEvaluator();

  // 3. 解析买入条件
  const buyCondition = strategiesConfig.buyStrategies[0].condition;
  console.log('\n🔍 买入条件:', buyCondition);

  const conditionAST = evaluator.parseCondition(buyCondition);
  console.log('\n🔍 条件 AST:', JSON.stringify(conditionAST, null, 2));

  // 4. 获取 Loop 2740 的时序数据
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp, factor_values, signal_type, signal_executed, execution_reason')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('loop_count', { ascending: true });

  console.log(`\n📊 总共 ${timeSeriesData.length} 个数据点`);

  // 5. 检查 Loop 2740
  const targetLoop = timeSeriesData.find(ts => ts.loop_count === 2740);

  if (targetLoop) {
    const f = typeof targetLoop.factor_values === 'string'
      ? JSON.parse(targetLoop.factor_values)
      : targetLoop.factor_values;

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`🔍 Loop 2740 详情:`);
    console.log(`   时间戳: ${new Date(targetLoop.timestamp).toISOString()}`);
    console.log(`   signal_type: ${targetLoop.signal_type}`);
    console.log(`   signal_executed: ${targetLoop.signal_executed}`);
    console.log(`   execution_reason: ${targetLoop.execution_reason}`);

    // 6. 模拟条件评估
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🔍 模拟 ConditionEvaluator.evaluate():');

    try {
      const conditionMet = evaluator.evaluate(conditionAST, f);
      console.log(`   结果: ${conditionMet ? '✅ 条件满足' : '❌ 条件不满足'}`);
    } catch (error) {
      console.log(`   ❌ 评估出错: ${error.message}`);
      console.log(`   错误堆栈: ${error.stack}`);
    }
  }

  // 7. 检查是否有策略信号记录
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 strategy_signals 表记录数: ${signals?.length || 0}`);
  if (signals && signals.length > 0) {
    signals.forEach(s => {
      console.log(`   Loop ${s.loop_count}: ${s.action} - ${s.reason || '无原因'}`);
    });
  }

  // 8. 检查代币状态
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('token_address, status, strategy_executions')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 代币状态:');
  console.log(`   status: ${token?.status || 'N/A'}`);
  console.log(`   strategy_executions: ${token?.strategy_executions ? JSON.stringify(token.strategy_executions) : 'null'}`);

  // 9. 分析可能的原因
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🔍 可能失败的原因:');

  // 策略启用状态
  const buyStrategy = strategiesConfig.buyStrategies[0];
  console.log(`\n1. 策略启用检查:`);
  console.log(`   - VirtualTradingEngine 中策略被硬编码为 enabled: true`);
  console.log(`   - 应该启用 ✅`);

  // 冷却期检查
  console.log(`\n2. 冷却期检查:`);
  console.log(`   - cooldown: ${buyStrategy.cooldown} 秒`);
  console.log(`   - 这是第一次买入，冷却期应该不影响 ✅`);

  // maxExecutions 检查
  console.log(`\n3. maxExecutions 检查:`);
  console.log(`   - maxExecutions: ${buyStrategy.maxExecutions}`);
  const executions = token?.strategy_executions;
  console.log(`   - 已执行次数: ${executions ? Object.keys(executions).length : 0}`);
  if (executions && Object.keys(executions).length > 0) {
    console.log(`   - ⚠️ 已达到最大执行次数?`);
  } else {
    console.log(`   - 未达到限制 ✅`);
  }

  // 条件评估
  console.log(`\n4. 条件评估检查:`);
  console.log(`   - 需要实际运行 ConditionEvaluator.evaluate()`);
}

diagnoseStrategyEvaluation()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
