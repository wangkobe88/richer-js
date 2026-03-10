/**
 * 从 time_series_data 获取 token_create_time
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTimeSeriesData() {
  const experimentId = '8a4ea415-6df6-499c-a659-b47fda546de5';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 从 time_series_data 获取数据
  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('loop_count', { ascending: true })
    .limit(1);

  console.log('=== Time Series Data ===\n');
  console.log('token_address:', timeSeriesData[0]?.token_address);
  console.log('token_create_time:', timeSeriesData[0]?.token_create_time);
  console.log('');

  if (timeSeriesData[0]?.token_create_time) {
    const tokenCreateTime = Math.floor(new Date(timeSeriesData[0].token_create_time).getTime() / 1000);
    console.log('tokenCreateTime (秒):', tokenCreateTime);
    console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());
    console.log('');

    // 从信号获取检查时间
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('metadata')
      .eq('experiment_id', experimentId)
      .eq('token_address', tokenAddress)
      .limit(1);

    const factors = signals[0]?.metadata?.preBuyCheckFactors;
    const checkTime = factors?.earlyTradesCheckTime;

    if (checkTime) {
      const timeGap = checkTime - tokenCreateTime;
      console.log('=== 时间差计算 ===\n');
      console.log('checkTime:', checkTime);
      console.log('tokenCreateTime:', tokenCreateTime);
      console.log('timeGap:', timeGap, '秒');
      console.log('');
      console.log('判断: timeGap <= 120?', timeGap <= 120);
      console.log('应该使用方法:', timeGap <= 120 ? 'real_early' : 'relative');
      console.log('实际使用方法:', factors?.earlyWhaleMethod);
    }
  }
}

checkTimeSeriesData().catch(console.error);
