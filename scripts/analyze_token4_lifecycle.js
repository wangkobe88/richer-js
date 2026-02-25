/**
 * 详细分析代币 "4" 的完整生命周期
 * 找出为什么策略触发但执行失败
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeToken4Lifecycle() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';
  const tokenAddress = '0x2fbee5e7dd23c2daf47bddfc042f9a1d471e4444';

  console.log('🔍 详细分析代币 "4" 的执行失败原因:\n');

  // 1. 检查完整的时序数据
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count, timestamp, factor_values, signal_type, signal_executed, execution_reason')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('loop_count', { ascending: true });

  console.log(`📊 总共 ${timeSeriesData?.length || 0} 个数据点\n`);

  // 2. 找到满足所有买入条件的 Loop
  const targetLoop = timeSeriesData.find(ts => {
    const f = typeof ts.factor_values === 'string' ? JSON.parse(ts.factor_values) : ts.factor_values;
    return f.trendCV > 0.005 &&
           f.trendDirectionCount >= 2 &&
           f.trendStrengthScore >= 30 &&
           f.trendTotalReturn >= 5 &&
           f.tvl >= 3000 &&
           f.txVolumeU24h >= 3500 &&
           f.holders >= 25 &&
           f.trendRecentDownRatio < 0.5 &&
           f.trendConsecutiveDowns < 2 &&
           f.earlyReturn < 160 &&
           f.drawdownFromHighest > -25;
  });

  if (!targetLoop) {
    console.log('❌ 没有找到满足所有买入条件的 Loop');
    return;
  }

  const f = typeof targetLoop.factor_values === 'string'
    ? JSON.parse(targetLoop.factor_values)
    : targetLoop.factor_values;

  console.log('✅ 找到满足所有条件的 Loop:', targetLoop.loop_count);
  console.log('   时间:', new Date(targetLoop.timestamp).toISOString());
  console.log('   signal_type:', targetLoop.signal_type);
  console.log('   signal_executed:', targetLoop.signal_executed);
  console.log('   execution_reason:', targetLoop.execution_reason);

  // 3. 检查数据库中的相关记录
  console.log('\n📊 数据库记录检查:');

  // strategy_signals 表
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);
  console.log('  strategy_signals 记录数:', signals?.length || 0);

  // trades 表
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);
  console.log('  trades 记录数:', trades?.length || 0);

  // 4. 分析可能的失败原因
  console.log('\n🔍 执行失败分析:');

  // 检查日志中的错误
  console.log('  根据 code 分析，可能的失败点:');
  console.log('  1. _executeStrategy 检查点:');
  console.log('     - token.status !== "monitoring" → 应该通过 (status=monitoring)');
  console.log('     - Dev 钱包检查失败 → 需要日志确认');
  console.log('     - 持有者黑名单检查失败 → 需要日志确认');
  console.log('     - CardPositionManager 未初始化 → 需要日志确认');
  console.log('  2. processSignal → _executeBuy 检查点:');
  console.log('     - getCardPositionManager 返回 null → 可能原因!');

  // 5. 检查代币的 creator_address
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('creator_address, platform, chain')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  console.log('\n📊 代币基本信息:');
  console.log('  creator_address:', token?.creator_address || 'null');
  console.log('  platform:', token?.platform || 'N/A');
  console.log('  chain:', token?.chain || 'N/A');

  // 6. 检查持有者黑名单数据
  const { data: holderData } = await supabase
    .from('token_holders')
    .select('holder_type, risk_level')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);

  console.log('\n📊 持有者数据:');
  console.log('  记录数:', holderData?.length || 0);
  if (holderData && holderData.length > 0) {
    const negativeHolders = holderData.filter(h => h.risk_level === 1 || h.holder_type === 'negative_holder' || h.holder_type === 'pump_group');
    console.log('  黑名单持有者数:', negativeHolders.length);
    if (negativeHolders.length > 0) {
      console.log('  ⚠️ 发现黑名单持有者，这可能是执行失败的原因!');
    }
  }

  // 7. 关键发现总结
  console.log('\n🔍 关键发现:');
  console.log('  1. strategy_signals 表中没有代币 4 的记录');
  console.log('  2. 这意味着 processSignal() 要么没有被调用，要么在保存信号前失败了');
  console.log('  3. 根据 _executeStrategy 代码，失败最可能的原因是:');
  console.log('     - Dev 钱包检查失败 (isNegativeDevWallet = true)');
  console.log('     - 持有者黑名单检查失败 (holderCheck.hasNegative = true)');
  console.log('     - CardPositionManager 初始化失败');

  console.log('\n💡 建议:');
  console.log('  1. 检查日志中是否有 "Dev 钱包" 或 "黑名单持有者" 相关的错误');
  console.log('  2. 验证 CardPositionManager 初始化逻辑是否正确');
  console.log('  3. 添加更详细的调试日志以追踪执行流程');
}

analyzeToken4Lifecycle()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
