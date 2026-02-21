const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const tokenAddress = '0x46745a3d173e8dc0903095add3e2d5224b3c4444';
  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  // 获取源实验的时序数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, loop_count, price_usd, factor_values, token_symbol')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(50);

  console.log(`=== 代币 ${tokenAddress} 的源实验数据 ===\n`);

  if (!timeSeries || timeSeries.length === 0) {
    console.log('没有找到时序数据');
    return;
  }

  console.log(`共 ${timeSeries.length} 条数据\n`);
  console.log('轮次 | 价格 | riseSpeed | earlyReturn | age');
  console.log('-----|------|-----------|-------------|-----');

  for (const ts of timeSeries) {
    const price = parseFloat(ts.price_usd) || 0;
    const factors = ts.factor_values || {};
    const riseSpeed = factors.riseSpeed || 0;
    const earlyReturn = factors.earlyReturn || 0;
    const age = factors.age || 0;
    
    console.log(`${String(ts.loop_count).padStart(4)} | $${price.toExponential(2)} | ${riseSpeed.toFixed(2).padStart(9)} | ${earlyReturn.toFixed(2).padStart(10)}% | ${age.toFixed(2)}`);
  }

  // 计算价格变化趋势
  const prices = timeSeries.map(ts => parseFloat(ts.price_usd) || 0);
  if (prices.length >= 2) {
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const change = ((lastPrice - firstPrice) / firstPrice * 100);

    console.log('\n=== 价格趋势分析 ===');
    console.log(`起始价格: $${firstPrice.toExponential(2)}`);
    console.log(`结束价格: $${lastPrice.toExponential(2)}`);
    console.log(`最高价格: $${maxPrice.toExponential(2)}`);
    console.log(`最低价格: $${minPrice.toExponential(2)}`);
    console.log(`价格变化: ${change.toFixed(2)}%`);

    // 检查买入时刻附近的价格
    console.log('\n=== 前10条数据点 ===');
    for (let i = 0; i < Math.min(10, timeSeries.length); i++) {
      const ts = timeSeries[i];
      const price = parseFloat(ts.price_usd) || 0;
      const factors = ts.factor_values || {};
      console.log(`${i + 1}. 轮次${ts.loop_count} | $${price.toExponential(2)} | riseSpeed: ${factors.riseSpeed?.toFixed(2) || 'N/A'} | earlyReturn: ${factors.earlyReturn?.toFixed(2) || 'N/A'}%`);
    }
  }
})();
