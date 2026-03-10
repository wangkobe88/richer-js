/**
 * 对比旧实验处理和未处理的代币数据
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareTokenData() {
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';

  console.log('=== 对比代币数据 ===\n');

  // 获取旧实验处理的代币
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('token_address')
    .eq('experiment_id', oldExpId);

  const oldProcessedTokens = new Set();
  oldSignals.forEach(s => oldProcessedTokens.add(s.token_address));

  // 随机选一个旧实验处理的代币
  const processedToken = Array.from(oldProcessedTokens)[0];

  // 选一个新增代币
  const newToken = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  console.log('1. 旧实验处理的代币:', processedToken);
  const { data: processedData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', processedToken)
    .order('timestamp', { ascending: true })
    .limit(5);

  console.log('   前5条数据:');
  processedData.forEach((d, i) => {
    console.log(`     ${i + 1}. timestamp=${d.timestamp}, early_return=${d.early_return || d.factor_values?.early_return || 'N/A'}`);
  });

  console.log('\n2. 新增代币:', newToken);
  const { data: newData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', newToken)
    .order('timestamp', { ascending: true })
    .limit(5);

  console.log('   前5条数据:');
  newData.forEach((d, i) => {
    console.log(`     ${i + 1}. timestamp=${d.timestamp}, early_return=${d.early_return || d.factor_values?.early_return || 'N/A'}`);
  });

  // 检查新实验中这两个代币的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '5072373e-b79d-4d66-b471-03c7c72730ec');

  console.log('\n3. 新实验中的信号:');

  const processedSignal = newSignals.find(s => s.token_address === processedToken);
  if (processedSignal) {
    console.log(`   ${processedToken.substring(0, 10)}... : 有信号`);
    console.log(`   trendFactors.earlyReturn: ${processedSignal.metadata?.trendFactors?.earlyReturn || 'N/A'}`);
  }

  const newSignal = newSignals.find(s => s.token_address === newToken);
  if (newSignal) {
    console.log(`   ${newToken.substring(0, 10)}... : 有信号`);
    console.log(`   trendFactors.earlyReturn: ${newSignal.metadata?.trendFactors?.earlyReturn || 'N/A'}`);
  }
}

compareTokenData().catch(console.error);
