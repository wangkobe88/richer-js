/**
 * 检查代币的详细信息
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTokenDetails() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: true });

  if (signals.length === 0) {
    console.log('没有找到信号');
    return;
  }

  const firstSignal = signals[0];

  console.log('=== 1$ 代币详细信息 ===\n');
  console.log('代币地址:', tokenAddress);
  console.log('符号:', firstSignal.metadata?.symbol || '1$');
  console.log('创建时间:', firstSignal.metadata?.token_create_time, '(' + new Date((firstSignal.metadata?.token_create_time || 0) * 1000).toLocaleString() + ')');
  console.log('信号时间:', firstSignal.metadata?.signal_time, '(' + new Date((firstSignal.metadata?.signal_time || 0) * 1000).toLocaleString() + ')');
  console.log('内盘交易对:', firstSignal.metadata?.inner_pair);
  console.log('链:', firstSignal.metadata?.chain);
  console.log('');

  const factors = firstSignal.metadata?.preBuyCheckFactors;
  if (factors) {
    console.log('=== preBuyCheckFactors ===');
    console.log('早期交易检查时间:', factors.earlyTradesCheckTime, '(' + new Date((factors.earlyTradesCheckTime || 0) * 1000).toLocaleString() + ')');
    console.log('预期起始时间:', factors.earlyTradesExpectedFirstTime);
    console.log('预期结束时间:', factors.earlyTradesExpectedLastTime);
    console.log('实际起始时间:', factors.earlyTradesDataFirstTime);
    console.log('实际结束时间:', factors.earlyTradesDataLastTime);
    console.log('实际跨度:', factors.earlyTradesActualSpan, '秒');
    console.log('交易总数:', factors.earlyTradesTotalCount);
    console.log('');
  }

  // 检查 experiment_time_series_data 表
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(5);

  console.log('=== experiment_time_series_data 表数据（前5条）===');
  timeSeries.forEach((row, i) => {
    console.log(`\n记录 ${i + 1}:`);
    console.log('  时间戳:', row.timestamp, '(' + new Date(row.timestamp * 1000).toLocaleString() + ')');
    console.log('  创建时间:', row.token_create_time);
    console.log('  inner_pair:', row.inner_pair);
    console.log('  chain:', row.chain);
  });
}

checkTokenDetails().catch(console.error);
