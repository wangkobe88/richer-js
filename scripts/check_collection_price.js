const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const tokenAddress = '0x46745a3d173e8dc0903095add3e2d5224b3c4444';
  const sourceExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb';

  // 获取源实验的时序数据
  const { data: timeSeries } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, loop_count, price_usd, factor_values')
    .eq('experiment_id', sourceExpId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(10);

  console.log(`=== 代币 ${tokenAddress} 的详细数据 ===\n`);

  for (const ts of timeSeries) {
    const price = parseFloat(ts.price_usd) || 0;
    const factors = ts.factor_values || {};
    const collectionPrice = factors.collectionPrice || 0;
    const launchPrice = factors.launchPrice || 0;
    const earlyReturn = factors.earlyReturn || 0;
    const riseSpeed = factors.riseSpeed || 0;

    console.log(`轮次 ${ts.loop_count}:`);
    console.log(`  price_usd: $${price.toExponential(2)}`);
    console.log(`  collectionPrice: $${collectionPrice.toExponential(2)}`);
    console.log(`  launchPrice: $${launchPrice.toExponential(2)}`);
    console.log(`  earlyReturn: ${earlyReturn.toFixed(2)}%`);
    console.log(`  riseSpeed: ${riseSpeed.toFixed(2)}`);
    console.log('');
  }

  // 分析 collectionPrice 的值
  const firstTS = timeSeries[0];
  if (firstTS) {
    const firstPrice = parseFloat(firstTS.price_usd) || 0;
    const collectionPrice = firstTS.factor_values?.collectionPrice || 0;
    
    console.log('=== 问题分析 ===');
    console.log(`首次价格: $${firstPrice.toExponential(2)}`);
    console.log(`collectionPrice: $${collectionPrice.toExponential(2)}`);
    
    if (collectionPrice > 0) {
      const calculatedReturn = ((firstPrice - collectionPrice) / collectionPrice) * 100;
      console.log(`计算的 earlyReturn: ${calculatedReturn.toFixed(2)}%`);
      console.log(`存储的 earlyReturn: ${firstTS.factor_values.earlyReturn?.toFixed(2) || 'N/A'}%`);
    }
  }
})();
