const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function queryToken() {
  const experimentId = 'dea2badf-4bbf-4eac-9a10-f6bf9dcc9717';
  const tokenAddress = '0xcd0827aa744903bfba63bb886da82e442f244444';

  // 获取代币基本信息
  const { data: tokenData, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  // 获取时序数据的前几个点和后几个点
  const { data: tsData, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, price_usd, loop_count, factor_values')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(5);

  // 获取时序数据的中间跳变点
  const { data: tsMiddle, error: tsMidError } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, price_usd, loop_count, factor_values')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .gte('loop_count', 138)
    .lte('loop_count', 145)
    .order('loop_count', { ascending: true });

  if (!tokenError) {
    console.log('代币信息:');
    console.log('  symbol:', tokenData.token_symbol);
    console.log('  discovered_at:', new Date(tokenData.discovered_at).toISOString());
    console.log('  created_at:', new Date(tokenData.created_at).toISOString());
    console.log('');
  }

  if (!tsError) {
    console.log('时序数据前5个点:');
    tsData.forEach((d, i) => {
      const fv = d.factor_values || {};
      const trendReturn = fv.trendTotalReturn || 0;
      const dataPoints = fv.trendDataPoints || 0;
      const timeStr = new Date(d.timestamp).toISOString().substring(11, 23);
      console.log(`  Loop ${d.loop_count}: price=${d.price_usd}, trendReturn=${trendReturn.toFixed(2)}%, dataPoints=${dataPoints}, time=${timeStr}`);
    });
    console.log('');
  }

  if (!tsMidError) {
    console.log('时序数据中间跳变点 (Loop 138-145):');
    tsMiddle.forEach((d) => {
      const fv = d.factor_values || {};
      const trendReturn = fv.trendTotalReturn || 0;
      const dataPoints = fv.trendDataPoints || 0;
      const timeStr = new Date(d.timestamp).toISOString().substring(11, 23);
      console.log(`  Loop ${d.loop_count}: price=${d.price_usd}, trendReturn=${trendReturn.toFixed(2)}%, dataPoints=${dataPoints}, time=${timeStr}`);
    });
  }

  // 计算时间差
  if (!tokenError && !tsError) {
    const discoverTime = new Date(tokenData.discovered_at).getTime();
    const firstTsTime = new Date(tsData[0].timestamp).getTime();
    const timeDiff = (firstTsTime - discoverTime) / 1000;
    console.log('');
    console.log('时间差分析:');
    console.log(`  discovered_at 到第一个时序点: ${timeDiff}秒`);
  }
}

queryToken().catch(console.error);
