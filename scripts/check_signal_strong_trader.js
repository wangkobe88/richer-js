const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSignal() {
  const signalId = 'd9131a25-0393-4533-8319-e86dfed512ae';
  const tokenAddress = '0xab67075c5c2aee6431106d7ee1dd6d1916ce4444';

  // 查询信号详情
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('token_address', tokenAddress);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  if (!signals || signals.length === 0) {
    console.log('未找到该代币的任何信号');
    return;
  }

  console.log(`找到 ${signals.length} 个信号\n`);

  for (const signal of signals) {
    console.log('=== 信号基本信息 ===');
    console.log('ID:', signal.id);
    console.log('实验ID:', signal.experiment_id);
    console.log('代币地址:', signal.token_address);
    console.log('交易对:', signal.inner_pair || '无');
    console.log('代币创建时间:', signal.token_launch_at ? new Date(signal.token_launch_at * 1000).toISOString() : '无');
    console.log('信号创建时间:', signal.created_at);

    console.log('\n=== 强势交易者因子 ===');
    const factors = signal.metadata?.preBuyCheckFactors || {};
    console.log('strongTraderNetPositionRatio:', factors.strongTraderNetPositionRatio);
    console.log('strongTraderTotalBuyRatio:', factors.strongTraderTotalBuyRatio);
    console.log('strongTraderTotalSellRatio:', factors.strongTraderTotalSellRatio);
    console.log('strongTraderWalletCount:', factors.strongTraderWalletCount);
    console.log('strongTraderTradeCount:', factors.strongTraderTradeCount);
    console.log('strongTraderSellIntensity:', factors.strongTraderSellIntensity);

    console.log('\n=== 其他预检查因子（用于对比）===');
    console.log('earlyTradesChecked:', factors.earlyTradesChecked);
    console.log('earlyTradesTotalCount:', factors.earlyTradesTotalCount);
    console.log('earlyTradesUniqueWallets:', factors.earlyTradesUniqueWallets);

    console.log('\n=== 执行状态 ===');
    console.log('executed:', signal.metadata?.executed);
    console.log('execution_status:', signal.metadata?.execution_status);
    console.log('execution_reason:', signal.metadata?.execution_reason);
    console.log('\n---\n');
  }
}

checkSignal().catch(console.error);
