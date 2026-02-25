/**
 * 正确分析买入信号统计
 */

const { dbManager } = require('../src/services/dbManager');

async function analyzeBuySignals() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  // 获取所有买入信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  // 获取已购买代币
  const { data: boughtTokens } = await supabase
    .from('trades')
    .select('token_address')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy');

  const boughtAddresses = new Set(boughtTokens?.map(t => t.token_address) || []);

  console.log('📊 买入信号统计:');
  console.log('  总买入信号数:', buySignals?.length || 0);
  console.log('  已购买代币数:', boughtAddresses.size);

  // 统计执行状态
  const executed = buySignals?.filter(s => s.executed === true).length || 0;
  const notExecuted = buySignals?.filter(s => s.executed === false).length || 0;
  console.log('  信号已执行:', executed);
  console.log('  信号未执行:', notExecuted);

  // 找出有信号但未购买的代币
  const signalNotBought = buySignals?.filter(s => !boughtAddresses.has(s.token_address)) || [];
  console.log('  有信号但未购买:', signalNotBought.length);

  if (signalNotBought.length > 0) {
    console.log('\n🔍 有买入信号但未购买的代币:');
    signalNotBought.forEach(s => {
      console.log('  ', s.token_symbol, s.token_address);
      console.log('     执行状态:', s.executed);
      console.log('     创建时间:', s.created_at);
      console.log('     信号ID:', s.id);
    });
  }

  process.exit(0);
}

analyzeBuySignals()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
