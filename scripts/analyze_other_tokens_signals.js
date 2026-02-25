/**
 * 分析其它高涨幅代币的信号情况
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeOtherTokensSignals() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 获取已购买代币
  const { data: boughtTokens } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy');

  const boughtAddresses = new Set(boughtTokens?.map(t => t.token_address) || []);

  // 获取有买入信号的代币
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('token_address, token_symbol, action, status, executed, execution_reason, created_at')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  console.log('📊 信号统计:');
  console.log('  总买入信号数:', buySignals?.length || 0);
  console.log('  已购买代币数:', boughtAddresses.size);

  // 统计信号状态
  const executed = buySignals?.filter(s => s.executed === true).length || 0;
  const notExecuted = buySignals?.filter(s => s.executed === false).length || 0;
  console.log('  信号已执行:', executed);
  console.log('  信号未执行:', notExecuted);

  // 找出有信号但未购买的代币
  const signalNotBought = buySignals?.filter(s => !boughtAddresses.has(s.token_address)) || [];
  console.log('  有信号但未购买:', signalNotBought.length);

  // 打印这些代币的详情
  if (signalNotBought.length > 0) {
    console.log('\n🔍 有买入信号但未购买的代币:');
    signalNotBought.forEach(s => {
      console.log('  ', s.token_symbol, '|', s.token_address);
      console.log('     执行状态:', s.executed);
      console.log('     失败原因:', s.execution_reason || '无');
      console.log('     创建时间:', s.created_at);
      console.log();
    });
  }

  // 分析预检查失败的情况
  const preCheckFailed = signalNotBought.filter(s =>
    s.execution_reason && s.execution_reason.includes('预检查失败')
  );
  console.log('📊 预检查失败的代币数:', preCheckFailed.length);

  if (preCheckFailed.length > 0) {
    console.log('\n预检查失败的原因统计:');
    const reasons = {};
    preCheckFailed.forEach(s => {
      const reason = s.execution_reason || '未知';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`  ${reason}: ${count} 个`);
    }
  }

  process.exit(0);
}

analyzeOtherTokensSignals()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
