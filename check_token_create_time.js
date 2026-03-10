/**
 * 检查回测引擎传递的 tokenCreateTime
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkTokenCreateTime() {
  const experimentId = '8a4ea415-6df6-499c-a659-b47fda546de5';
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';

  // 从 experiment_tokens 表获取代币信息
  const { data: tokenData } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .maybeSingle();

  console.log('=== 代币信息 ===\n');
  console.log('token_address:', tokenData?.token_address);
  console.log('token_created_at:', tokenData?.token_created_at);
  console.log('launch_at:', tokenData?.launch_at);
  console.log('');

  // 转换为时间戳
  if (tokenData?.token_created_at) {
    const tokenCreateTime = Math.floor(new Date(tokenData.token_created_at).getTime() / 1000);
    console.log('tokenCreateTime (秒):', tokenCreateTime);
    console.log('tokenCreateTime (日期):', new Date(tokenCreateTime * 1000).toLocaleString());
  }

  if (tokenData?.launch_at) {
    console.log('launch_at (秒):', tokenData.launch_at);
    console.log('launch_at (日期):', new Date(tokenData.launch_at * 1000).toLocaleString());
  }

  console.log('');

  // 获取信号数据中的检查时间
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .limit(1);

  if (signals.length > 0) {
    const factors = signals[0].metadata?.preBuyCheckFactors;
    console.log('=== 信号数据 ===\n');
    console.log('earlyWhaleMethod:', factors?.earlyWhaleMethod);
    console.log('earlyWhaleEarlyThreshold:', factors?.earlyWhaleEarlyThreshold);
    console.log('');

    // 计算 timeGap
    const checkTime = factors?.earlyTradesCheckTime;
    const tokenCreateTime = Math.floor(new Date(tokenData?.token_created_at).getTime() / 1000);

    if (checkTime && tokenCreateTime) {
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

checkTokenCreateTime().catch(console.error);
