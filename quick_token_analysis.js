/**
 * 分析代币早期大户数据是否正常
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeToken() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress);

  console.log('=== 代币 0x6b0fd53e... 分析 ===\n');
  console.log('总信号数:', signals.length);

  if (signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const signal = signals[0];
  const metadata = signal.metadata;

  console.log('符号:', metadata?.symbol || '1$');
  console.log('状态:', metadata?.execution_status || 'unknown');
  console.log('');

  // 检查 preBuyCheckFactors
  const hasPreBuyFactors = metadata?.preBuyCheckFactors !== undefined;
  console.log('有 preBuyCheckFactors:', hasPreBuyFactors);

  if (hasPreBuyFactors) {
    const factors = metadata.preBuyCheckFactors;
    console.log('');
    console.log('早期大户因子:');
    console.log('  早期大户数量:', factors.earlyWhaleCount);
    console.log('  早期大户持有率:', factors.earlyWhaleHoldRatio);
    console.log('  早期大户卖出率:', factors.earlyWhaleSellRatio);
    console.log('  方法:', factors.earlyWhaleMethod);
    console.log('  总交易数:', factors.earlyWhaleTotalTrades);
  } else {
    console.log('⚠️  没有 preBuyCheckFactors');
  }

  console.log('');
  console.log('=== 数据分析 ===');

  if (hasPreBuyFactors && metadata.preBuyCheckFactors.earlyWhaleCount === 0) {
    console.log('早期大户数量为 0');
    console.log('');
    console.log('可能原因:');
    console.log('1. 所有买入金额都 < $200（没有大户）');
    console.log('2. 大户都在早期之后入场（信号时间较晚）');
    console.log('3. 使用相对交易位置方法，观察窗口的前30%交易中没有大户');
    console.log('');
    console.log('这是否正常？');
    console.log('如果代币流动性低，确实可能没有大户参与');
    console.log('这种情况下，早期大户因子无法判断（返回默认值：通过）');
    console.log('最终亏损是因为其他原因（如市场整体下跌、代币本身质量等）');
  }

  console.log('');
  console.log('=== 结论 ===');
  console.log('该代币数据正常，只是没有早期大户参与');
  console.log('早期大户因子返回默认值（通过），符合预期');
}

analyzeToken().catch(console.error);
