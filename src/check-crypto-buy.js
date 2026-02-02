/**
 * 检查 cryPTO 代币买入详情
 */
require('dotenv').config({ path: '../config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkCryptoBuy() {
  const tokenSymbol = 'cryPTO';
  const tokenAddress = '0x55bc3b37fc9a72570b2d35074797dd16f5024444';
  const buyTime = new Date('2026-02-02T08:03:37.677Z');

  console.log(`📊 检查代币 "${tokenSymbol}" 的买入详情\n`);

  // 获取买入时间前后的时序数据
  const startTime = new Date(buyTime.getTime() - 60000);
  const endTime = new Date(buyTime.getTime() + 60000);

  const { data: timeSeriesData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', '95042847-cccd-4316-be03-f172e2885993')
    .eq('token_symbol', tokenSymbol)
    .gte('timestamp', startTime.toISOString())
    .lte('timestamp', endTime.toISOString())
    .order('timestamp', { ascending: true });

  console.log(`时序数据（买入时间 ${buyTime.toISOString()} 前后）:`);
  if (timeSeriesData && timeSeriesData.length > 0) {
    timeSeriesData.forEach((d, i) => {
      const price = d.price_usd ? parseFloat(d.price_usd).toExponential(4) : 'N/A';
      const collectionPrice = d.factor_values?.collectionPrice ? parseFloat(d.factor_values.collectionPrice).toExponential(4) : 'N/A';
      const earlyReturn = d.factor_values?.earlyReturn !== undefined ? d.factor_values.earlyReturn.toFixed(2) + '%' : 'N/A';
      const age = d.factor_values?.age !== undefined ? d.factor_values.age.toFixed(2) + 'min' : 'N/A';
      const signal = d.signal_type || '-';
      const timeDiff = ((new Date(d.timestamp) - buyTime) / 1000).toFixed(0) + 's';

      console.log(`  [${i + 1}] ${d.timestamp} (${timeDiff}相对于买入)`);
      console.log(`      价格: ${price} | 收集价格: ${collectionPrice}`);
      console.log(`      earlyReturn: ${earlyReturn} | age: ${age} | 信号: ${signal}`);
    });
  } else {
    console.log('  未找到时序数据');
  }

  // 获取所有时序数据
  console.log('\n所有时序数据:');
  const { data: allData } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, price_usd, factor_values')
    .eq('experiment_id', '95042847-cccd-4316-be03-f172e2885993')
    .eq('token_symbol', tokenSymbol)
    .order('timestamp', { ascending: true });

  if (allData && allData.length > 0) {
    allData.forEach((d, i) => {
      const price = d.price_usd ? d.price_usd : 'N/A';
      const collectionPrice = d.factor_values?.collectionPrice ? d.factor_values.collectionPrice : 'N/A';
      const earlyReturn = d.factor_values?.earlyReturn !== undefined ? d.factor_values.earlyReturn.toFixed(2) + '%' : 'N/A';
      const age = d.factor_values?.age !== undefined ? d.factor_values.age.toFixed(2) + 'min' : 'N/A';

      console.log(`  [${i + 1}] ${d.timestamp}`);
      console.log(`      价格: ${price} | 收集价格: ${collectionPrice}`);
      console.log(`      earlyReturn: ${earlyReturn} | age: ${age}`);
    });
  } else {
    console.log('  未找到任何时序数据');
  }
}

checkCryptoBuy().catch(console.error);
