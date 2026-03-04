const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verify() {
  const experimentId = 'dea2badf-4bbf-4eac-9a10-f6bf9dcc9717';
  const tokenAddress = '0xcd0827aa744903bfba63bb886da82e442f244444';

  // 获取代币信息
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  // 获取raw_api_data中的价格
  const rawApiData = token.raw_api_data;
  console.log('代币原始API数据中的价格:');
  console.log('  current_price_usd:', rawApiData?.current_price_usd);
  console.log('  launch_price:', rawApiData?.launch_price);
  console.log('');

  // 获取第一个时序点
  const { data: firstTs } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(1)
    .single();

  console.log('第一个时序点:');
  console.log('  price_usd:', firstTs.price_usd);
  console.log('  loop_count:', firstTs.loop_count);
  console.log('  timestamp:', new Date(firstTs.timestamp).toISOString());
  console.log('');

  // 推算价格历史缓存的第一个价格
  const fv = firstTs.factor_values || {};
  const trendReturn = fv.trendTotalReturn || 0;
  const currentPrice = firstTs.price_usd;

  // trendTotalReturn = (currentPrice - firstPrice) / firstPrice * 100
  // firstPrice = currentPrice / (1 + trendReturn / 100)
  const estimatedFirstPrice = currentPrice / (1 + trendReturn / 100);

  console.log('推算价格历史缓存的第一个价格:');
  console.log('  当前价格:', currentPrice);
  console.log('  trendTotalReturn:', trendReturn + '%');
  console.log('  推算的第一个价格:', estimatedFirstPrice);
  console.log('');

  console.log('结论:');
  console.log('  如果价格历史缓存的第一个价格是', estimatedFirstPrice);
  console.log('  而时序数据第一个点的价格是', currentPrice);
  console.log('  那么两者相差', ((currentPrice - estimatedFirstPrice) / estimatedFirstPrice * 100).toFixed(2) + '%');
}

verify();
